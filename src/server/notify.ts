// Notification decisions and Web Push delivery with an idempotent ledger.
import type { EventRow, NotificationPrefs, PushSubscriptionRow, Watch } from '../core/model.ts';
import type { AppCtx } from './env.ts';
import * as repo from './repo.ts';
import { inQuietHours, quietHoursEnd } from '../core/time.ts';
import { sendWebPush } from '../core/webpush.ts';
import { truncate } from '../core/text.ts';

export function pushConfigured(ctx: AppCtx): boolean { return !!(ctx.cfg.vapidPublicKey && ctx.cfg.vapidPrivateKey); }

/**
 * Which watches want a push for this event. Rules:
 *  - never during a source's baseline (first) poll unless the watch opted into recent history (notify_from < created_at);
 *  - the event's time (published time when known, else first seen) must be after the watch's notify_from;
 *  - watch not muted, scope allows it (all, or material only), global mute off, event not created by a split/merge.
 */
export function eligibleWatches(event: EventRow, watches: Watch[], prefs: NotificationPrefs, baseline = false): Watch[] {
  if (prefs.global_mute || event.suppress_push) return [];
  const eventTime = event.published_known && event.first_published_at != null ? event.first_published_at : event.first_seen_at;
  return watches.filter((w) => !w.muted && w.notify_scope !== 'none' && eventTime >= w.notify_from && !(baseline && w.notify_from >= w.created_at) && (w.notify_scope === 'all' || event.material));
}

export function buildPayload(event: EventRow, watches: Watch[], leadPublisher: string, kind: 'initial' | 'update' | 'test' | 'digest'): Record<string, unknown> {
  const tags = watches.map((w) => w.label);
  const label = event.category === 'filing' ? `SEC ${event.event_type || 'filing'}` : leadPublisher;
  const title = truncate(`${tags.slice(0, 2).join(' · ') || 'Investinews'}${tags.length > 2 ? ` +${tags.length - 2}` : ''} · ${label}`, 80);
  return { kind, title, body: truncate(event.lead_headline, 160), eventId: event.id, url: `/#/event/${event.id}`, tag: event.id, watchLabels: tags, sourceCount: event.source_count, publishedAt: event.first_published_at, publishedKnown: !!event.published_known, version: event.version };
}

function scheduleTime(prefs: NotificationPrefs, tz: string, now: number): number {
  return inQuietHours(now, prefs.quiet_start, prefs.quiet_end, tz) ? quietHoursEnd(now, prefs.quiet_start, prefs.quiet_end, tz) : now;
}

/** Queue at most one initial notification per (event, device). Safe to call repeatedly. */
export async function queueInitial(ctx: AppCtx, event: EventRow, matched: Watch[], leadPublisher: string, baseline = false): Promise<number> {
  if (!pushConfigured(ctx)) return 0;
  const prefs = await repo.getPrefs(ctx.db);
  const eligible = eligibleWatches(event, matched, prefs, baseline);
  if (!eligible.length) return 0;
  const subs = await repo.listSubscriptions(ctx.db);
  if (!subs.length) return 0;
  const payload = buildPayload(event, eligible, leadPublisher, 'initial');
  const notBefore = scheduleTime(prefs, ctx.cfg.tz, Date.now());
  let queued = 0;
  for (const s of subs) if (await repo.insertDeliveryIfNew(ctx.db, { idem_key: `${event.id}:initial:${s.id}`, kind: 'initial', event_id: event.id, subscription_id: s.id, watch_ids: eligible.map((w) => w.id), payload, not_before: notBefore })) queued++;
  if (queued) ctx.log('notify.queued', { eventId: event.id, devices: queued, watches: eligible.length });
  return queued;
}

/** Explicit opt-in update notification (event + version + device idempotency). */
export async function queueUpdate(ctx: AppCtx, event: EventRow, matched: Watch[], leadPublisher: string): Promise<number> {
  if (!pushConfigured(ctx)) return 0;
  const prefs = await repo.getPrefs(ctx.db);
  if (!prefs.updates_enabled) return 0;
  const eligible = eligibleWatches(event, matched, prefs);
  if (!eligible.length) return 0;
  // Only if the initial notification for this event was (or is being) sent to that device.
  const subs = await repo.listSubscriptions(ctx.db);
  const payload = { ...buildPayload(event, eligible, leadPublisher, 'update'), title: truncate(`Update · ${eligible.map((w) => w.label).slice(0, 2).join(' · ')}`, 80) };
  let queued = 0;
  for (const s of subs) if (await repo.insertDeliveryIfNew(ctx.db, { idem_key: `${event.id}:update:${event.version}:${s.id}`, kind: 'update', event_id: event.id, subscription_id: s.id, watch_ids: eligible.map((w) => w.id), payload, not_before: scheduleTime(prefs, ctx.cfg.tz, Date.now()) })) queued++;
  return queued;
}

export async function queueTest(ctx: AppCtx, subscriptionId: string): Promise<boolean> {
  return repo.insertDeliveryIfNew(ctx.db, { idem_key: `test:${subscriptionId}:${Date.now()}`, kind: 'test', event_id: null, subscription_id: subscriptionId, watch_ids: [], payload: { kind: 'test', title: 'Investinews · test notification', body: 'Push delivery is working on this device.', url: '/#/settings', tag: 'test' } });
}

const backoffMs = (attempt: number) => Math.min(6 * 3600_000, 30_000 * 2 ** attempt) + Math.floor(Math.random() * 15_000);

/** Send queued deliveries. Digest mode coalesces per device; quiet hours are respected via not_before. */
export async function flushDeliveries(ctx: AppCtx, fetchImpl?: typeof fetch): Promise<{ sent: number; failed: number; expired: number; skipped: number }> {
  const out = { sent: 0, failed: 0, expired: 0, skipped: 0 };
  if (!pushConfigured(ctx)) return out;
  const keys = { publicKey: ctx.cfg.vapidPublicKey!, privateKey: ctx.cfg.vapidPrivateKey! };
  const now = Date.now();
  const prefs = await repo.getPrefs(ctx.db);
  const pending = await repo.pendingDeliveries(ctx.db, now);
  if (!pending.length) return out;
  const subs = new Map((await repo.listSubscriptions(ctx.db, false)).map((s) => [s.id, s]));
  const send = async (sub: PushSubscriptionRow, payload: Record<string, unknown>, rows: repo.DeliveryRow[], topic?: string) => {
    if (sub.expired) { for (const d of rows) { await repo.updateDelivery(ctx.db, d.id, { status: 'expired', error: 'subscription expired' }); out.expired++; } return; }
    try {
      const res = await sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), keys, ctx.cfg.vapidSubject, { ttl: 86400, urgency: 'normal', topic, fetchImpl });
      if (res.ok) { for (const d of rows) { await repo.updateDelivery(ctx.db, d.id, { status: 'sent', sent_at: Date.now(), attempts: d.attempts + 1, error: null }); out.sent++; } }
      else if (res.gone) { await repo.markSubscriptionExpired(ctx.db, sub.id); for (const d of rows) { await repo.updateDelivery(ctx.db, d.id, { status: 'expired', attempts: d.attempts + 1, error: `push service ${res.status}` }); out.expired++; } }
      else { const retry = res.retryAfterSec ? res.retryAfterSec * 1000 : null; for (const d of rows) { const attempts = d.attempts + 1; await repo.updateDelivery(ctx.db, d.id, { status: attempts >= 6 ? 'failed' : 'queued', attempts, error: `HTTP ${res.status} ${res.body || ''}`.trim(), not_before: Date.now() + (retry ?? backoffMs(attempts)) }); out.failed++; } }
    } catch (e) {
      for (const d of rows) { const attempts = d.attempts + 1; await repo.updateDelivery(ctx.db, d.id, { status: attempts >= 6 ? 'failed' : 'queued', attempts, error: String((e as Error).message).slice(0, 200), not_before: Date.now() + backoffMs(attempts) }); out.failed++; }
    }
  };
  if (prefs.mode === 'digest') {
    const bySub = new Map<string, repo.DeliveryRow[]>();
    for (const d of pending) { if (d.kind === 'test') continue; const l = bySub.get(d.subscription_id) || []; l.push(d); bySub.set(d.subscription_id, l); }
    for (const [subId, rows] of bySub) {
      const sub = subs.get(subId); if (!sub) { for (const d of rows) await repo.updateDelivery(ctx.db, d.id, { status: 'skipped', error: 'no subscription' }); continue; }
      const last = Number(await repo.getSetting(ctx.db, `digest_last:${subId}`)) || 0;
      if (now - last < prefs.digest_interval_min * 60_000) { out.skipped += rows.length; continue; }
      const heads = rows.map((d) => { try { return JSON.parse(d.payload) as { body: string }; } catch { return { body: '' }; } }).map((p) => p.body).filter(Boolean);
      const payload = { kind: 'digest', title: `Investinews · ${rows.length} new event${rows.length > 1 ? 's' : ''}`, body: truncate(heads.slice(0, 3).join(' • '), 200), url: '/#/feed?unread=1', tag: 'digest', count: rows.length };
      await send(sub, payload, rows, 'digest');
      await repo.setSetting(ctx.db, `digest_last:${subId}`, String(Date.now()));
    }
    for (const d of pending.filter((x) => x.kind === 'test')) { const sub = subs.get(d.subscription_id); if (sub) await send(sub, JSON.parse(d.payload), [d]); }
    return out;
  }
  for (const d of pending) {
    const sub = subs.get(d.subscription_id);
    if (!sub) { await repo.updateDelivery(ctx.db, d.id, { status: 'skipped', error: 'no subscription' }); out.skipped++; continue; }
    let payload: Record<string, unknown>; try { payload = JSON.parse(d.payload); } catch { payload = { title: 'Investinews', body: '' }; }
    await send(sub, payload, [d], d.event_id ? d.event_id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : undefined);
  }
  return out;
}
