import { describe, it, expect } from 'vitest';
import { makeCtx, fakeSource } from './helpers.ts';
import * as repo from '../src/server/repo.ts';
import { processItem, loadState, pollSource } from '../src/server/ingest.ts';
import { flushDeliveries, queueInitial } from '../src/server/notify.ts';
import { runPollJob } from '../src/server/jobs.ts';
import { generateVapidKeys } from '../src/core/webpush.ts';
import { openNodeDb, migrateNode } from '../src/server/db.ts';
import { createWatchWithSources } from '../src/server/watches.ts';
import { b64url } from '../src/core/ids.ts';
import type { NormalizedItem } from '../src/core/model.ts';

const T0 = Date.now() - 3600e3;
const item = (over: Partial<NormalizedItem>): NormalizedItem => ({ sourceItemId: over.url || 'x', url: 'https://a.com/1', headline: 'h', publisher: 'A', publishedAt: T0, ...over });

async function pushCtx() {
  const keys = await generateVapidKeys();
  const ctx = await makeCtx({ cfg: { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey } });
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = await repo.upsertSubscription(ctx.db, { endpoint: 'https://push.example/dev1', p256dh: b64url.encode(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64url.encode(crypto.getRandomValues(new Uint8Array(16))), label: 'dev1' });
  const sent: string[] = [];
  const fetchImpl = (async (url: string) => { sent.push(String(url)); return new Response('', { status: 201 }); }) as unknown as typeof fetch;
  return { ctx, sub, sent, fetchImpl };
}

describe('ingestion, clustering and notifications', () => {
  it('creates three distinct watches with explicit source availability', async () => {
    const ctx = await makeCtx();
    const a = await createWatchWithSources(ctx, { kind: 'ticker', symbol: 'NVDA', exchange: 'NASDAQ', cik: '0001045810', name: 'NVIDIA CORP' });
    const b = await createWatchWithSources(ctx, { kind: 'ticker', symbol: 'NPN', exchange: 'JSE' });
    const c = await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' });
    expect(new Set([a.watch.id, b.watch.id, c.watch.id]).size).toBe(3);
    expect((await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' })).created).toBe(false);
    const sources = await repo.listSources(ctx.db); const links = await repo.watchSourceLinks(ctx.db);
    const of = (wid: string) => links.filter((l) => l.watch_id === wid).map((l) => sources.find((s) => s.id === l.source_id)!);
    expect(of(a.watch.id).map((s) => s.type).sort()).toEqual(['link', 'link', 'sec_submissions']);
    expect(of(b.watch.id).some((s) => s.name.startsWith('JSE SENS'))).toBe(true);
    expect(of(b.watch.id).every((s) => s.type === 'link')).toBe(true);
    expect(of(c.watch.id).map((s) => s.type)).toEqual(['link']);
    expect((await repo.identitiesAll(ctx.db)).filter((i) => i.watch_id === a.watch.id).map((i) => i.kind).sort()).toEqual(['alias', 'cik', 'issuer_name']);
  });

  it('groups syndicated articles into one event and keeps watch feeds newest-first', async () => {
    const ctx = await makeCtx();
    const w = (await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' })).watch;
    const src = await repo.createSource(ctx.db, { type: 'rss', name: 'alert', url: 'https://example.com/alert' }, [w.id]);
    const st = await loadState(ctx);
    const r1 = await processItem(ctx, src, item({ url: 'https://pub1.com/story', headline: 'US tightens AI export controls', publisher: 'Pub1', publishedAt: T0 }), st);
    const r2 = await processItem(ctx, src, item({ url: 'https://pub2.com/story?utm_source=x', headline: 'US Tightens AI Export Controls - Pub2', publisher: 'Pub2', publishedAt: T0 + 60e3 }), st);
    const r3 = await processItem(ctx, src, item({ url: 'https://pub3.com/other', headline: 'Chipmakers fall after AI export controls news', publisher: 'Pub3', publishedAt: T0 + 7200e3 }), st);
    expect(r1.newEvent).toBe(true); expect(r2.eventId).toBe(r1.eventId); expect(r2.layer).toBe('title'); expect(r3.newEvent).toBe(true);
    const ev = (await repo.getEvent(ctx.db, r1.eventId!))!;
    expect(ev.source_count).toBe(2); expect(ev.article_count).toBe(2); expect(ev.first_published_at).toBe(T0); expect(ev.last_updated_at).toBe(T0 + 60e3);
    const feed = await repo.listEvents(ctx.db, { watchId: w.id });
    expect(feed.map((e) => e.id)).toEqual([r3.eventId, r1.eventId]);
    const unified = await repo.listEvents(ctx.db, {});
    expect(unified.length).toBe(2);
    // re-processing the same items is a no-op (idempotent upsert)
    const again = await processItem(ctx, src, item({ url: 'https://pub1.com/story', headline: 'US tightens AI export controls', publisher: 'Pub1' }), st);
    expect(again.inserted).toBe(false);
    expect((await repo.eventArticles(ctx.db, r1.eventId!)).length).toBe(2);
  });

  it('keeps SEC filings with different accessions separate and re-fetch never reorders', async () => {
    const ctx = await makeCtx();
    const w = (await createWatchWithSources(ctx, { kind: 'ticker', symbol: 'NVDA', exchange: 'NASDAQ', cik: '0001045810', name: 'NVIDIA CORP' })).watch;
    const src = (await repo.listSources(ctx.db)).find((s) => s.type === 'sec_submissions')!;
    const st = await loadState(ctx);
    const f = (acc: string, ts: number) => item({ sourceItemId: acc, url: `https://www.sec.gov/Archives/${acc}.htm`, headline: '8-K: NVIDIA CORP', publisher: 'SEC EDGAR', category: 'filing', eventType: '8-K', filingAccession: acc, filingForm: '8-K', symbol: 'NVDA', exchange: 'NASDAQ', publishedAt: ts });
    const a = await processItem(ctx, src, f('0001045810-26-000010', T0), st);
    const b = await processItem(ctx, src, f('0001045810-26-000011', T0 + 1000), st);
    expect(a.eventId).not.toBe(b.eventId);
    const evA = (await repo.getEvent(ctx.db, a.eventId!))!; expect(evA.material).toBe(1); expect(evA.filing_accession).toBe('0001045810-26-000010');
    const before = (await repo.listEvents(ctx.db, { watchId: w.id })).map((e) => [e.id, e.sort_time]);
    await processItem(ctx, src, f('0001045810-26-000010', T0), st); // re-fetch
    const after = (await repo.listEvents(ctx.db, { watchId: w.id })).map((e) => [e.id, e.sort_time]);
    expect(after).toEqual(before);
  });

  it('sends zero pushes on baseline, one per device per new event, none on retries, restarts or extra syndication', async () => {
    const { ctx, sent, fetchImpl } = await pushCtx();
    const w1 = (await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' })).watch;
    const w2 = (await createWatchWithSources(ctx, { kind: 'topic', query: 'export controls' })).watch;
    const src = await repo.createSource(ctx.db, { type: 'rss', name: 'alert', url: 'https://example.com/alert' }, [w1.id, w2.id]);
    const st = await loadState(ctx);
    // baseline poll (source never succeeded yet)
    await processItem(ctx, src, item({ url: 'https://old.com/1', headline: 'Old story about AI export controls', publishedAt: Date.now() - 86400e3 }), st, Date.now(), true);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
    expect(sent.length).toBe(0);
    // new event after baseline, matches both watches -> exactly one device notification
    const r = await processItem(ctx, src, item({ url: 'https://new.com/1', headline: 'New AI export controls announced', publishedAt: Date.now() }), st);
    expect(r.matched!.length).toBe(2);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 1 });
    // queueing again for the same event is idempotent; flush again sends nothing
    const ev = (await repo.getEvent(ctx.db, r.eventId!))!;
    expect(await queueInitial(ctx, ev, [w1, w2], 'A')).toBe(0);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
    // a third syndicated copy joins without a new push
    await processItem(ctx, src, item({ url: 'https://syn.com/1', headline: 'New AI Export Controls Announced - Syn', publisher: 'Syn', publishedAt: Date.now() }), st);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
    expect(sent.length).toBe(1);
    // "restart": a fresh process over the same database reprocesses the same items
    const db2 = await openNodeDb(ctx.file); await migrateNode(db2, (await import('./helpers.ts')).MIGRATIONS);
    const ctx2 = { ...ctx, db: db2 };
    const st2 = await loadState(ctx2);
    await processItem(ctx2, src, item({ url: 'https://new.com/1', headline: 'New AI export controls announced', publishedAt: Date.now() }), st2);
    expect(await flushDeliveries(ctx2, fetchImpl)).toMatchObject({ sent: 0 });
    expect(sent.length).toBe(1);
    expect((await repo.deliveriesForEvent(ctx2.db, r.eventId!)).length).toBe(1);
  });

  it('respects mute, quiet hours, material-only scope and digest mode', async () => {
    const { ctx, sent, fetchImpl } = await pushCtx();
    const w = (await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' })).watch;
    const src = await repo.createSource(ctx.db, { type: 'rss', name: 'alert', url: 'https://example.com/alert' }, [w.id]);
    const st = await loadState(ctx);
    await repo.updateWatch(ctx.db, w.id, { muted: 1 });
    const stM = await loadState(ctx);
    await processItem(ctx, src, item({ url: 'https://n.com/1', headline: 'Muted: AI export controls one', publishedAt: Date.now() }), stM);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
    await repo.updateWatch(ctx.db, w.id, { muted: 0, notify_scope: 'material' });
    const st2 = await loadState(ctx);
    await processItem(ctx, src, item({ url: 'https://n.com/2', headline: 'AI export controls conference schedule', publishedAt: Date.now() }), st2);
    await processItem(ctx, src, item({ url: 'https://n.com/3', headline: 'Regulator opens investigation into AI export controls breach', publishedAt: Date.now() }), st2);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 1 });
    // quiet hours: always-on window -> delivery deferred
    await repo.updateWatch(ctx.db, w.id, { notify_scope: 'all' });
    await repo.setPrefs(ctx.db, { quiet_start: '00:00', quiet_end: '23:59' });
    const st3 = await loadState(ctx);
    await processItem(ctx, src, item({ url: 'https://n.com/4', headline: 'Late night AI export controls update', publishedAt: Date.now() }), st3);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
    const pending = await ctx.db.all<{ not_before: number }>("SELECT not_before FROM deliveries WHERE status = 'queued'");
    expect(pending.length).toBe(1); expect(pending[0].not_before).toBeGreaterThan(Date.now() + 60e3);
    await repo.setPrefs(ctx.db, { quiet_start: null, quiet_end: null, mode: 'digest', digest_interval_min: 15 });
    await ctx.db.run("UPDATE deliveries SET not_before = 0 WHERE status = 'queued'");
    await processItem(ctx, src, item({ url: 'https://n.com/5', headline: 'Second digest item on AI export controls', publishedAt: Date.now() }), st3);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 2 }); // two events, one digest push
    expect(sent.length).toBe(2);
    expect(await flushDeliveries(ctx, fetchImpl)).toMatchObject({ sent: 0 });
  });

  it('polls a source through the adapter, handles failures independently and locks the job', async () => {
    const { ctx } = await pushCtx();
    const w = (await createWatchWithSources(ctx, { kind: 'topic', query: 'AI export controls' })).watch;
    const good = await repo.createSource(ctx.db, { type: 'rss', name: 'good', url: 'http://127.0.0.1:1/never' }, [w.id]); // unreachable -> error path
    const r = await pollSource(ctx, good);
    expect(r.error).toBeTruthy();
    const s = (await repo.getSource(ctx.db, good.id))!;
    expect(s.fail_count).toBe(1); expect(s.cooldown_until).toBeGreaterThan(Date.now()); expect(s.last_error).toBeTruthy();
    expect(await repo.acquireJobLock(ctx.db, 'poll', 60e3)).toBe(true);
    expect((await runPollJob(ctx)).ran).toBe(false);
    await repo.releaseJobLock(ctx.db, 'poll', 'ok', '');
    const job = await runPollJob(ctx, { force: true, skipPrune: true });
    expect(job.ran).toBe(true);
    expect(job.poll!.errors.length).toBe(1);
    // merge/split overrides
    const st = await loadState(ctx);
    const src = await repo.createSource(ctx.db, { type: 'rss', name: 'x', url: 'https://example.com/x' }, [w.id]);
    const a = await processItem(ctx, src, item({ url: 'https://a.com/a', headline: 'Story about AI export controls A', publishedAt: Date.now() }), st);
    const b = await processItem(ctx, src, item({ url: 'https://b.com/b', headline: 'Completely different AI export controls topic B', publishedAt: Date.now() }), st);
    expect(a.eventId).not.toBe(b.eventId);
    const merged = await repo.mergeEvents(ctx.db, b.eventId!, a.eventId!);
    expect(merged!.article_count).toBe(2); expect(await repo.getEvent(ctx.db, b.eventId!)).toBeUndefined();
    const arts = await repo.eventArticles(ctx.db, a.eventId!);
    const split = await repo.splitArticle(ctx.db, arts[1].id);
    expect(split!.suppress_push).toBe(1); expect((await repo.getEvent(ctx.db, a.eventId!))!.article_count).toBe(1);
  });
});
