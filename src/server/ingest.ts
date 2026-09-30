// Ingestion pipeline: adapter fetch -> normalized item -> idempotent upsert -> relevance match -> cluster -> notify.
import type { Article, Identity, NormalizedItem, Source, Watch } from '../core/model.ts';
import type { AppCtx } from './env.ts';
import * as repo from './repo.ts';
import { getAdapter } from './adapters/index.ts';
import { canonicalizeUrl, urlKey } from '../core/url.ts';
import { titleKey, isMaterial, jaccard, tokens, MATERIAL_TERMS } from '../core/text.ts';
import { matchArticleToWatch } from '../core/match.ts';
import { decideCluster, SYNDICATION_WINDOW_MS, type ClusterArticle } from '../core/cluster.ts';
import { queueInitial, queueUpdate } from './notify.ts';
import { FetchError } from './fetch.ts';

export interface PollSummary { sources: number; fetched: number; newArticles: number; newEvents: number; joined: number; errors: { source: string; error: string }[]; notModified: number }

interface RunState { watches: Watch[]; identities: Map<string, Identity[]>; bound: Map<string, Set<string>>; candidates: ClusterArticle[] | null }

async function loadState(ctx: AppCtx): Promise<RunState> {
  const watches = await repo.listWatches(ctx.db);
  const identities = new Map<string, Identity[]>();
  for (const i of await repo.identitiesAll(ctx.db)) { const l = identities.get(i.watch_id) || []; l.push(i); identities.set(i.watch_id, l); }
  const bound = new Map<string, Set<string>>();
  for (const l of await repo.watchSourceLinks(ctx.db)) { const s = bound.get(l.source_id) || new Set(); s.add(l.watch_id); bound.set(l.source_id, s); }
  return { watches, identities, bound, candidates: null };
}

export function normalize(source: Source, it: NormalizedItem, now: number): repo.NewArticle {
  const canonical = canonicalizeUrl(it.url);
  const known = it.publishedAt != null && Number.isFinite(it.publishedAt);
  return {
    source_id: source.id, source_item_id: String(it.sourceItemId).slice(0, 500), url: it.url.slice(0, 2000), canonical_url: canonical.slice(0, 2000), url_key: urlKey(canonical).slice(0, 2000),
    headline: it.headline.trim().slice(0, 500), title_key: titleKey(it.headline).slice(0, 500), publisher: (it.publisher || '').trim().slice(0, 120) || 'unknown', description: (it.description || '').slice(0, 1000),
    published_at: known ? it.publishedAt! : null, published_known: known ? 1 : 0, updated_at: it.updatedAt ?? null, fetched_at: now, first_seen_at: now,
    category: it.category || 'news', event_type: it.eventType ?? null, filing_accession: it.filingAccession ?? null, filing_form: it.filingForm ?? null,
    symbol: it.symbol ?? null, exchange: it.exchange ?? null, query: it.query ?? null, flags: JSON.stringify(it.flags || []), raw: JSON.stringify(it.raw || {}).slice(0, 4000),
  };
}

/** Process one normalized item. Returns what happened so callers (and tests) can assert on it. */
export async function processItem(ctx: AppCtx, source: Source, it: NormalizedItem, st: RunState, now = Date.now(), baseline = false): Promise<{ inserted: boolean; eventId?: string; newEvent?: boolean; layer?: string; matched?: string[] }> {
  if (!it.url || !it.headline) return { inserted: false };
  const { inserted, article } = await repo.insertArticleIfNew(ctx.db, normalize(source, it, now));
  if (!inserted) return { inserted: false };
  const boundWatches = st.bound.get(source.id) || new Set<string>();
  const matched: { w: Watch; reason: string }[] = [];
  for (const w of st.watches) {
    const r = matchArticleToWatch(article, w, st.identities.get(w.id) || [], boundWatches.has(w.id));
    if (r.matched) matched.push({ w, reason: r.reason });
  }
  if (!st.candidates) st.candidates = await repo.clusterCandidates(ctx.db, now - SYNDICATION_WINDOW_MS - 3600_000);
  const flags: string[] = JSON.parse(article.flags || '[]');
  const decision = decideCluster({ urlKey: article.url_key, titleKey: article.title_key, headline: article.headline, publisher: article.publisher, publishedAt: article.published_at, firstSeenAt: article.first_seen_at, accession: article.filing_accession, category: article.category, flags, symbol: article.symbol, watchIds: matched.map((m) => m.w.id) }, st.candidates);
  const watchIds = matched.map((m) => ({ id: m.w.id, reason: m.reason }));
  const material = isMaterial(article.headline, article.filing_form);
  let eventId: string; let newEvent = false;
  if (decision) {
    eventId = decision.eventId;
    const before = await repo.getEvent(ctx.db, eventId);
    const { newWatchIds } = await repo.addArticleToEvent(ctx.db, eventId, article, watchIds);
    const after = await repo.getEvent(ctx.db, eventId);
    if (after && before) {
      if (material && !after.material) await repo.setEventMaterial(ctx.db, eventId, true);
      // Material development: substantially new headline text, materially worded, later than the lead. Opt-in only (checked in queueUpdate).
      const novel = jaccard(tokens(article.headline), tokens(before.lead_headline)) < 0.5 && MATERIAL_TERMS.test(article.headline) && (article.published_at ?? article.first_seen_at) > (before.first_published_at ?? before.first_seen_at) + 2 * 3600_000;
      if (novel) { await repo.bumpEventVersion(ctx.db, eventId); const ev = (await repo.getEvent(ctx.db, eventId))!; const ws = st.watches.filter((w) => watchIds.some((x) => x.id === w.id) || newWatchIds.includes(w.id)); await queueUpdate(ctx, ev, ws, article.publisher); }
    }
    // A newly matched watch on an already-known event: no initial push for it (per-event/device rule), just the association.
  } else {
    const ev = await repo.createEventFromArticle(ctx.db, article, material, watchIds);
    eventId = ev.id; newEvent = true;
    await queueInitial(ctx, ev, matched.map((m) => m.w), article.publisher, baseline);
  }
  st.candidates.unshift({ id: article.id, eventId, urlKey: article.url_key, titleKey: article.title_key, publisher: article.publisher, publishedAt: article.published_at, firstSeenAt: article.first_seen_at, accession: article.filing_accession, category: article.category, flags, symbol: article.symbol, watchIds: watchIds.map((w) => w.id) });
  return { inserted: true, eventId, newEvent, layer: decision?.layer ?? 'new', matched: watchIds.map((w) => w.id) };
}

const cooldownFor = (failCount: number, status: number) => { const base = status === 429 ? 15 * 60_000 : 60_000; return Math.min(6 * 3600_000, base * 2 ** Math.min(failCount, 8)) + Math.floor(Math.random() * 30_000); };

export { loadState };
export async function pollSource(ctx: AppCtx, source: Source, st?: RunState, summary?: PollSummary): Promise<{ newArticles: number; error?: string }> {
  const adapter = getAdapter(source.type);
  if (!adapter) return { newArticles: 0, error: `no adapter for ${source.type}` };
  const state = st || (await loadState(ctx));
  const now = Date.now();
  const baseline = !source.last_success_at; // first successful poll = backfill baseline: no push burst
  try {
    const result = await adapter.fetch(ctx, source);
    let newArticles = 0; let latest = source.last_item_published_at || 0;
    for (const it of result.items) {
      const r = await processItem(ctx, source, it, state, now, baseline);
      if (r.inserted) { newArticles++; if (summary) { summary.newArticles++; if (r.newEvent) summary.newEvents++; else summary.joined++; } }
      if (it.publishedAt && it.publishedAt > latest) latest = it.publishedAt;
    }
    if (summary) { summary.fetched += result.items.length; if (result.notModified) summary.notModified++; }
    await repo.updateSource(ctx.db, source.id, { etag: result.etag ?? source.etag, last_modified: result.lastModified ?? source.last_modified, last_checked_at: now, last_success_at: now, last_item_published_at: latest || null, last_error: null, fail_count: 0, cooldown_until: null, next_due_at: now + source.interval_sec * 1000 });
    ctx.log('poll.ok', { source: source.id, type: source.type, items: result.items.length, newArticles, notModified: !!result.notModified });
    return { newArticles };
  } catch (e) {
    const err = e as Error & { status?: number };
    const status = err instanceof FetchError ? err.status : 0;
    const failCount = source.fail_count + 1;
    const cooldown = now + cooldownFor(failCount, status);
    await repo.updateSource(ctx.db, source.id, { last_checked_at: now, last_error: String(err.message || err).slice(0, 300), fail_count: failCount, cooldown_until: cooldown, next_due_at: cooldown });
    ctx.log('poll.error', { source: source.id, type: source.type, error: String(err.message).slice(0, 200), failCount });
    if (summary) summary.errors.push({ source: source.id, error: String(err.message).slice(0, 200) });
    return { newArticles: 0, error: String(err.message) };
  }
}

/** Poll every due source (or all pollable sources when force). Sources fail independently. */
export async function pollSources(ctx: AppCtx, opts: { force?: boolean; sourceIds?: string[] } = {}): Promise<PollSummary> {
  const now = Date.now();
  let sources = opts.force ? await repo.sourcesPollable(ctx.db) : await repo.sourcesDue(ctx.db, now);
  if (opts.sourceIds?.length) sources = sources.filter((s) => opts.sourceIds!.includes(s.id));
  const summary: PollSummary = { sources: sources.length, fetched: 0, newArticles: 0, newEvents: 0, joined: 0, errors: [], notModified: 0 };
  const st = await loadState(ctx);
  for (const s of sources) await pollSource(ctx, s, st, summary);
  return summary;
}
