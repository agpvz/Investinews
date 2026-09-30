// HTTP API (Hono). Runs unchanged on Node and on Cloudflare Pages Functions.
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppCtx } from './env.ts';
import * as repo from './repo.ts';
import { resolveInput, createWatchWithSources, PUBLISHER_PRESETS, EXCHANGES } from './watches.ts';
import { runPollJob } from './jobs.ts';
import { pollSource } from './ingest.ts';
import { sourceStatus, safeJson } from './adapters/index.ts';
import { rssAdapter, isGoogleAlertsFeed } from './adapters/rss.ts';
import { safeFetch } from './fetch.ts';
import { parseFeed } from '../core/rss.ts';
import { isHttpUrl, isPrivateHost } from '../core/url.ts';
import { queueTest, flushDeliveries, pushConfigured } from './notify.ts';
import { formatInZone } from '../core/time.ts';

export const APP_VERSION = '2.0.0';
type Env = { Bindings: AppCtx };

const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const COOKIE = 'inv_session';

export function createApp() {
  const app = new Hono<Env>();

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const { cfg } = c.env;
    const path = new URL(c.req.url).pathname;
    if (path === '/api/health' || path === '/api/auth/login' || path === '/api/auth/status') return next();
    if (path === '/api/jobs/poll' && cfg.jobToken) { const t = c.req.header('x-job-token') || ''; if (timingSafeEqual(t, cfg.jobToken)) return next(); }
    if (cfg.appToken) {
      const bearer = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
      const cookie = getCookie(c, COOKIE) || '';
      if (!timingSafeEqual(bearer, cfg.appToken) && !timingSafeEqual(cookie, cfg.appToken)) return c.json({ error: 'unauthorized' }, 401);
    } else if (path === '/api/jobs/poll' && cfg.jobToken) return c.json({ error: 'unauthorized' }, 401);
    return next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: APP_VERSION, time: Date.now(), db: c.env.db.kind }));
  app.get('/api/auth/status', (c) => c.json({ required: !!c.env.cfg.appToken, authenticated: !c.env.cfg.appToken || timingSafeEqual(getCookie(c, COOKIE) || '', c.env.cfg.appToken) }));
  app.post('/api/auth/login', async (c) => {
    const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: '' }));
    if (!c.env.cfg.appToken) return c.json({ ok: true, note: 'no token configured' });
    if (!token || !timingSafeEqual(token, c.env.cfg.appToken)) return c.json({ error: 'invalid token' }, 401);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: new URL(c.req.url).protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 90 });
    return c.json({ ok: true });
  });
  app.post('/api/auth/logout', (c) => { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ ok: true }); });

  // ---- bootstrap / status ----
  async function watchesWithMeta(ctx: AppCtx) {
    const [watches, unread, sources, links] = await Promise.all([repo.listWatches(ctx.db), repo.unreadCounts(ctx.db), repo.listSources(ctx.db), repo.watchSourceLinks(ctx.db)]);
    const unreadMap = new Map(unread.map((u) => [u.watch_id, u.n]));
    const now = Date.now();
    return watches.map((w) => {
      const ws = links.filter((l) => l.watch_id === w.id).map((l) => sources.find((s) => s.id === l.source_id)).filter(Boolean) as typeof sources;
      const st = ws.map((s) => ({ id: s.id, type: s.type, name: s.name, ...sourceStatus(s, now), last_checked_at: s.last_checked_at, last_success_at: s.last_success_at }));
      const lastOk = Math.max(0, ...ws.map((s) => s.last_success_at || 0));
      return { ...w, include_terms: safeArr(w.include_terms), exclude_terms: safeArr(w.exclude_terms), unread: unreadMap.get(w.id) || 0, sources: st, last_success_at: lastOk || null, health: st.some((s) => s.status === 'connected' || s.status === 'polling') ? 'ok' : st.some((s) => s.status === 'error' || s.status === 'stale' || s.status === 'rate_limited') ? 'error' : 'link-only' };
    });
  }
  const safeArr = (s: string) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  async function sourcesWithStatus(ctx: AppCtx) {
    const [sources, links, watches] = await Promise.all([repo.listSources(ctx.db), repo.watchSourceLinks(ctx.db), repo.listWatches(ctx.db)]);
    const now = Date.now();
    return sources.map((s) => ({ ...s, config: safeJson(s.config), ...sourceStatus(s, now), watch_ids: links.filter((l) => l.source_id === s.id).map((l) => l.watch_id), watch_labels: links.filter((l) => l.source_id === s.id).map((l) => watches.find((w) => w.id === l.watch_id)?.label).filter(Boolean), google_alert: s.type === 'rss' && !!s.url && isGoogleAlertsFeed(s.url) }));
  }

  app.get('/api/bootstrap', async (c) => {
    const ctx = c.env;
    const [watches, sources, prefs, job, subs] = await Promise.all([watchesWithMeta(ctx), sourcesWithStatus(ctx), repo.getPrefs(ctx.db), repo.getJob(ctx.db, 'poll'), repo.listSubscriptions(ctx.db)]);
    return c.json({ version: APP_VERSION, tz: ctx.cfg.tz, watches, sources, prefs, job, push: { configured: pushConfigured(ctx), vapidPublicKey: ctx.cfg.vapidPublicKey, subscriptions: subs.map((s) => ({ id: s.id, label: s.label, user_agent: s.user_agent, created_at: s.created_at, endpointHost: hostOfSafe(s.endpoint) })) }, auth: { required: !!ctx.cfg.appToken }, exchanges: Object.keys(EXCHANGES), db: ctx.db.kind, serverTime: Date.now() });
  });
  const hostOfSafe = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

  app.get('/api/status', async (c) => {
    const ctx = c.env;
    const [sources, job, deliveries, counts] = await Promise.all([sourcesWithStatus(ctx), repo.getJob(ctx.db, 'poll'), repo.recentDeliveries(ctx.db, 30), ctx.db.get<{ articles: number; events: number; watches: number; subs: number }>('SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM watches) AS watches, (SELECT COUNT(*) FROM push_subscriptions WHERE expired = 0) AS subs')]);
    return c.json({ sources, job, deliveries: deliveries.map((d) => ({ ...d, payload: undefined })), counts, push: { configured: pushConfigured(ctx) }, tz: ctx.cfg.tz, retentionDays: ctx.cfg.retentionDays, db: ctx.db.kind, now: Date.now(), nowLocal: formatInZone(Date.now(), ctx.cfg.tz, true) });
  });

  // ---- watches ----
  app.post('/api/resolve', async (c) => { const { q } = await c.req.json<{ q: string }>(); if (!q?.trim()) return c.json({ error: 'q required' }, 400); return c.json(await resolveInput(c.env, q)); });
  app.get('/api/watches', async (c) => c.json(await watchesWithMeta(c.env)));
  app.post('/api/watches', async (c) => {
    try { const body = await c.req.json(); const r = await createWatchWithSources(c.env, body); return c.json({ ...r, watch: (await watchesWithMeta(c.env)).find((w) => w.id === r.watch.id) }, r.created ? 201 : 200); }
    catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  app.patch('/api/watches/:id', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string') patch.label = body.label.slice(0, 80);
    if (Array.isArray(body.include_terms)) patch.include_terms = JSON.stringify(body.include_terms.map(String).slice(0, 50));
    if (Array.isArray(body.exclude_terms)) patch.exclude_terms = JSON.stringify(body.exclude_terms.map(String).slice(0, 50));
    if (body.muted !== undefined) patch.muted = body.muted ? 1 : 0;
    if (['all', 'material', 'none'].includes(String(body.notify_scope))) patch.notify_scope = body.notify_scope;
    if (typeof body.notify_from === 'number') patch.notify_from = body.notify_from;
    const w = await repo.updateWatch(c.env.db, c.req.param('id'), patch);
    return w ? c.json((await watchesWithMeta(c.env)).find((x) => x.id === w.id)) : c.json({ error: 'not found' }, 404);
  });
  app.delete('/api/watches/:id', async (c) => { await repo.deleteWatch(c.env.db, c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/watches/:id/identities', async (c) => { const { kind, value } = await c.req.json<{ kind: 'alias' | 'issuer_name'; value: string }>(); if (!value?.trim()) return c.json({ error: 'value required' }, 400); await repo.addIdentity(c.env.db, c.req.param('id'), kind === 'issuer_name' ? 'issuer_name' : 'alias', value.trim().slice(0, 120)); return c.json({ ok: true }); });
  app.get('/api/watches/:id/identities', async (c) => c.json((await repo.identitiesAll(c.env.db)).filter((i) => i.watch_id === c.req.param('id'))));
  app.delete('/api/identities/:id', async (c) => { await repo.deleteIdentity(c.env.db, Number(c.req.param('id'))); return c.json({ ok: true }); });

  // ---- sources ----
  app.get('/api/sources', async (c) => c.json(await sourcesWithStatus(c.env)));
  app.get('/api/sources/presets', (c) => c.json(PUBLISHER_PRESETS));
  app.post('/api/sources/validate', async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    if (!url || !isHttpUrl(url)) return c.json({ error: 'enter an http(s) feed url' }, 400);
    if (isPrivateHost(new URL(url).hostname) && !c.env.cfg.allowPrivateFeeds) return c.json({ error: 'private or local hosts are not allowed' }, 400);
    try {
      const res = await safeFetch(url, { userSupplied: !c.env.cfg.allowPrivateFeeds, resolveHost: c.env.resolveHost, headers: { 'User-Agent': 'investinews/2.0 (+personal news reader; RSS)' } });
      if (res.status !== 200) return c.json({ error: `feed returned HTTP ${res.status}` }, 400);
      const feed = parseFeed(res.text, { maxItems: 10 });
      if (!feed.items.length) return c.json({ error: 'no items found; is this an RSS/Atom feed?' }, 400);
      return c.json({ ok: true, title: feed.title, kind: feed.kind, googleAlert: isGoogleAlertsFeed(url), sample: feed.items.slice(0, 5).map((i) => ({ title: i.title, link: i.link, ts: i.ts })) });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  app.post('/api/sources', async (c) => {
    const b = await c.req.json<{ url: string; name?: string; watchIds?: string[]; interval_sec?: number; category?: string }>();
    if (!b.url || !isHttpUrl(b.url)) return c.json({ error: 'url required' }, 400);
    if (isPrivateHost(new URL(b.url).hostname) && !c.env.cfg.allowPrivateFeeds) return c.json({ error: 'private or local hosts are not allowed' }, 400);
    const existing = await repo.findSourceByUrl(c.env.db, 'rss', b.url);
    const src = existing || (await repo.createSource(c.env.db, { type: 'rss', name: (b.name || b.url).slice(0, 120), url: b.url, interval_sec: Math.max(300, Math.min(86400, Number(b.interval_sec) || 900)), config: { category: b.category === 'release' ? 'release' : 'news' } }));
    for (const w of b.watchIds || []) await repo.linkWatchSource(c.env.db, w, src.id);
    return c.json((await sourcesWithStatus(c.env)).find((s) => s.id === src.id), existing ? 200 : 201);
  });
  app.patch('/api/sources/:id', async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (typeof b.name === 'string') patch.name = b.name.slice(0, 120);
    if (b.enabled !== undefined) { patch.enabled = b.enabled ? 1 : 0; if (b.enabled) { patch.fail_count = 0; patch.cooldown_until = null; patch.next_due_at = 0; patch.last_error = null; } }
    if (b.interval_sec !== undefined) patch.interval_sec = Math.max(300, Math.min(86400, Number(b.interval_sec) || 900));
    const s = await repo.updateSource(c.env.db, c.req.param('id'), patch);
    if (!s) return c.json({ error: 'not found' }, 404);
    if (Array.isArray(b.watchIds)) { const links = await repo.watchSourceLinks(c.env.db); for (const l of links.filter((x) => x.source_id === s.id)) if (!b.watchIds.includes(l.watch_id)) await repo.unlinkWatchSource(c.env.db, l.watch_id, s.id); for (const w of b.watchIds) await repo.linkWatchSource(c.env.db, String(w), s.id); }
    return c.json((await sourcesWithStatus(c.env)).find((x) => x.id === s.id));
  });
  app.delete('/api/sources/:id', async (c) => { await repo.deleteSource(c.env.db, c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/sources/:id/refresh', async (c) => {
    const s = await repo.getSource(c.env.db, c.req.param('id')); if (!s) return c.json({ error: 'not found' }, 404);
    if (s.type === 'link') return c.json({ error: 'external link sources cannot be polled' }, 400);
    await repo.updateSource(c.env.db, s.id, { cooldown_until: null, next_due_at: 0 });
    const r = await pollSource(c.env, (await repo.getSource(c.env.db, s.id))!);
    await flushDeliveries(c.env);
    return c.json({ ...r, source: (await sourcesWithStatus(c.env)).find((x) => x.id === s.id) });
  });

  // ---- feed / events ----
  app.get('/api/feed', async (c) => {
    const q = c.req.query();
    const events = await repo.listEvents(c.env.db, { watchId: q.watch || undefined, sourceId: q.source || undefined, category: q.category || undefined, unread: q.unread === '1', since: q.since ? Number(q.since) : undefined, until: q.until ? Number(q.until) : undefined, q: q.q || undefined, sort: q.sort === 'updated' ? 'updated' : 'first', limit: Number(q.limit) || 60, offset: Number(q.offset) || 0, matchedOnly: q.all !== '1' });
    return c.json(events.map((e) => ({ ...e, watch_ids: e.watch_ids ? e.watch_ids.split(',') : [], publishers: e.publishers ? e.publishers.split(',') : [], source_ids: e.source_ids ? e.source_ids.split(',') : [], flags: safeArr(e.flags) })));
  });
  app.get('/api/events/:id', async (c) => {
    const ev = await repo.getEvent(c.env.db, c.req.param('id')); if (!ev) return c.json({ error: 'not found' }, 404);
    const [articles, watchIds, deliveries, read] = await Promise.all([repo.eventArticles(c.env.db, ev.id), repo.eventWatchIds(c.env.db, ev.id), repo.deliveriesForEvent(c.env.db, ev.id), c.env.db.get<{ read_at: number }>('SELECT read_at FROM read_state WHERE event_id = ?', [ev.id])]);
    return c.json({ ...ev, flags: safeArr(ev.flags), read_at: read?.read_at ?? null, watch_ids: watchIds, articles: articles.map((a) => ({ ...a, flags: safeArr(a.flags), raw: safeJson(a.raw) })), deliveries: deliveries.map((d) => ({ id: d.id, kind: d.kind, status: d.status, attempts: d.attempts, created_at: d.created_at, sent_at: d.sent_at, error: d.error, device: d.label || d.subscription_id })) });
  });
  app.post('/api/events/read', async (c) => { const { ids, read } = await c.req.json<{ ids: string[]; read?: boolean }>(); if (!Array.isArray(ids)) return c.json({ error: 'ids required' }, 400); if (read === false) await repo.markUnread(c.env.db, ids); else await repo.markRead(c.env.db, ids); return c.json({ ok: true }); });
  app.post('/api/events/read-all', async (c) => { const { watch } = await c.req.json<{ watch?: string }>().catch(() => ({ watch: undefined })); await repo.markAllRead(c.env.db, watch || undefined); return c.json({ ok: true }); });
  app.post('/api/events/:id/merge', async (c) => { const { into } = await c.req.json<{ into: string }>(); const ev = await repo.mergeEvents(c.env.db, c.req.param('id'), into); return ev ? c.json(ev) : c.json({ error: 'not found' }, 404); });
  app.post('/api/articles/:id/split', async (c) => { const ev = await repo.splitArticle(c.env.db, c.req.param('id')); return ev ? c.json(ev) : c.json({ error: 'not found' }, 404); });

  // ---- prefs / push ----
  app.get('/api/prefs', async (c) => c.json(await repo.getPrefs(c.env.db)));
  app.patch('/api/prefs', async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const p: Record<string, unknown> = {};
    const hhmm = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
    if ('quiet_start' in b) p.quiet_start = hhmm(b.quiet_start);
    if ('quiet_end' in b) p.quiet_end = hhmm(b.quiet_end);
    if (b.mode === 'immediate' || b.mode === 'digest') p.mode = b.mode;
    if (b.digest_interval_min !== undefined) p.digest_interval_min = Math.max(15, Math.min(1440, Number(b.digest_interval_min) || 60));
    if (b.updates_enabled !== undefined) p.updates_enabled = b.updates_enabled ? 1 : 0;
    if (b.global_mute !== undefined) p.global_mute = b.global_mute ? 1 : 0;
    return c.json(await repo.setPrefs(c.env.db, p));
  });
  app.get('/api/push/public-key', (c) => c.json({ configured: pushConfigured(c.env), publicKey: c.env.cfg.vapidPublicKey }));
  app.post('/api/push/subscribe', async (c) => {
    if (!pushConfigured(c.env)) return c.json({ error: 'push not configured on server (VAPID keys missing)' }, 503);
    const b = await c.req.json<{ subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; label?: string }>();
    const s = b.subscription;
    if (!s?.endpoint || !isHttpUrl(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return c.json({ error: 'invalid subscription' }, 400);
    const row = await repo.upsertSubscription(c.env.db, { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: (c.req.header('user-agent') || '').slice(0, 200), label: (b.label || '').slice(0, 60) });
    return c.json({ id: row.id, label: row.label, created_at: row.created_at });
  });
  app.post('/api/push/unsubscribe', async (c) => { const { endpoint } = await c.req.json<{ endpoint: string }>(); if (endpoint) await repo.deleteSubscriptionByEndpoint(c.env.db, endpoint); return c.json({ ok: true }); });
  app.post('/api/push/test', async (c) => {
    if (!pushConfigured(c.env)) return c.json({ error: 'push not configured' }, 503);
    const { endpoint } = await c.req.json<{ endpoint?: string }>().catch(() => ({ endpoint: undefined }));
    const subs = await repo.listSubscriptions(c.env.db);
    const targets = endpoint ? subs.filter((s) => s.endpoint === endpoint) : subs;
    if (!targets.length) return c.json({ error: 'no subscription for this device' }, 404);
    for (const s of targets) await queueTest(c.env, s.id);
    const r = await flushDeliveries(c.env);
    return c.json({ ok: r.sent > 0, ...r, deliveries: (await repo.recentDeliveries(c.env.db, targets.length)).map((d) => ({ status: d.status, error: d.error })) });
  });

  // ---- jobs / maintenance ----
  app.post('/api/refresh', async (c) => {
    const { watch } = await c.req.json<{ watch?: string }>().catch(() => ({ watch: undefined }));
    let sourceIds: string[] | undefined;
    if (watch) {
      // A watch is fed by its own bound sources plus every unbound (keyword-matched) feed.
      const links = await repo.watchSourceLinks(c.env.db);
      const boundToAny = new Set(links.map((l) => l.source_id));
      const mine = links.filter((l) => l.watch_id === watch).map((l) => l.source_id);
      const unbound = (await repo.sourcesPollable(c.env.db)).filter((s) => !boundToAny.has(s.id)).map((s) => s.id);
      sourceIds = [...new Set([...mine, ...unbound])];
    }
    if (sourceIds) for (const id of sourceIds) await repo.updateSource(c.env.db, id, { cooldown_until: null, next_due_at: 0 });
    return c.json(await runPollJob(c.env, { force: true, sourceIds }));
  });
  app.post('/api/jobs/poll', async (c) => c.json(await runPollJob(c.env, { force: c.req.query('force') === '1' })));
  app.get('/api/export', async (c) => { const data = await repo.exportAll(c.env.db); c.header('Content-Disposition', `attachment; filename="investinews-export-${new Date().toISOString().slice(0, 10)}.json"`); return c.json(data); });
  app.delete('/api/data', async (c) => { const { confirm } = await c.req.json<{ confirm: string }>().catch(() => ({ confirm: '' })); if (confirm !== 'DELETE') return c.json({ error: 'send {"confirm":"DELETE"}' }, 400); await repo.deleteAllData(c.env.db); return c.json({ ok: true }); });

  app.notFound((c) => (new URL(c.req.url).pathname.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.text('not found', 404)));
  app.onError((err, c) => { c.env?.log?.('http.error', { path: new URL(c.req.url).pathname, error: err.message }); return c.json({ error: err.message || 'internal error' }, 500); });
  return app;
}
