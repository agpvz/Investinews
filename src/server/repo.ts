// Data access. Plain SQL kept in one place so both SQLite engines behave identically.
import type { Db, Stmt } from './db.ts';
import type { Article, EventRow, Identity, NotificationPrefs, PushSubscriptionRow, Source, Watch } from '../core/model.ts';
import type { ClusterArticle } from '../core/cluster.ts';
import { newId } from '../core/ids.ts';

const j = (v: unknown) => JSON.stringify(v ?? null);
const arr = (s: string | null | undefined): string[] => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

// ---------- watches ----------
export const listWatches = (db: Db) => db.all<Watch>('SELECT * FROM watches ORDER BY created_at ASC');
export const getWatch = (db: Db, id: string) => db.get<Watch>('SELECT * FROM watches WHERE id = ?', [id]);
export async function findWatch(db: Db, w: { kind: string; exchange?: string | null; symbol?: string | null; query?: string | null }) {
  return db.get<Watch>('SELECT * FROM watches WHERE kind = ? AND COALESCE(exchange, \'\') = ? AND COALESCE(symbol, \'\') = ? AND COALESCE(query, \'\') = ?', [w.kind, w.exchange || '', w.symbol || '', w.query || '']);
}
export async function createWatch(db: Db, w: Partial<Watch> & { kind: Watch['kind']; label: string }, identities: Omit<Identity, 'watch_id' | 'id'>[] = []): Promise<Watch> {
  const now = Date.now(); const id = newId('w_');
  const stmts: Stmt[] = [{ sql: 'INSERT INTO watches (id, kind, label, symbol, exchange, query, include_terms, exclude_terms, muted, notify_scope, notify_from, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [id, w.kind, w.label, w.symbol ?? null, w.exchange ?? null, w.query ?? null, w.include_terms ?? '[]', w.exclude_terms ?? '[]', w.muted ?? 0, w.notify_scope ?? 'all', w.notify_from ?? now, now, now] }];
  for (const i of identities) stmts.push({ sql: 'INSERT OR IGNORE INTO identities (watch_id, kind, value) VALUES (?,?,?)', params: [id, i.kind, i.value] });
  await db.batch(stmts);
  return (await getWatch(db, id))!;
}
export async function updateWatch(db: Db, id: string, patch: Partial<Watch>): Promise<Watch | undefined> {
  const allowed = ['label', 'include_terms', 'exclude_terms', 'muted', 'notify_scope', 'notify_from'] as const;
  const sets: string[] = []; const params: (string | number | null)[] = [];
  for (const k of allowed) if (patch[k] !== undefined) { sets.push(`${k} = ?`); params.push(patch[k] as string | number | null); }
  if (sets.length) { sets.push('updated_at = ?'); params.push(Date.now()); params.push(id); await db.run(`UPDATE watches SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getWatch(db, id);
}
export const deleteWatch = (db: Db, id: string) => db.run('DELETE FROM watches WHERE id = ?', [id]);
export const identitiesAll = (db: Db) => db.all<Identity>('SELECT * FROM identities');
export const addIdentity = (db: Db, watchId: string, kind: Identity['kind'], value: string) => db.run('INSERT OR IGNORE INTO identities (watch_id, kind, value) VALUES (?,?,?)', [watchId, kind, value]);
export const deleteIdentity = (db: Db, id: number) => db.run('DELETE FROM identities WHERE id = ?', [id]);

// ---------- sources ----------
export const listSources = (db: Db) => db.all<Source>('SELECT * FROM sources ORDER BY created_at ASC');
export const getSource = (db: Db, id: string) => db.get<Source>('SELECT * FROM sources WHERE id = ?', [id]);
export const findSourceByUrl = (db: Db, type: string, url: string) => db.get<Source>('SELECT * FROM sources WHERE type = ? AND url = ?', [type, url]);
export async function createSource(db: Db, s: { type: Source['type']; name: string; url?: string | null; interval_sec?: number; config?: Record<string, unknown>; enabled?: number }, watchIds: string[] = []): Promise<Source> {
  const id = newId('s_'); const now = Date.now();
  const stmts: Stmt[] = [{ sql: 'INSERT INTO sources (id, type, name, url, enabled, interval_sec, config, next_due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)', params: [id, s.type, s.name, s.url ?? null, s.enabled ?? 1, s.interval_sec ?? 600, j(s.config ?? {}), 0, now] }];
  for (const w of watchIds) stmts.push({ sql: 'INSERT OR IGNORE INTO watch_sources (watch_id, source_id) VALUES (?,?)', params: [w, id] });
  await db.batch(stmts);
  return (await getSource(db, id))!;
}
export async function updateSource(db: Db, id: string, patch: Partial<Source> & { config?: string }): Promise<Source | undefined> {
  const allowed = ['name', 'url', 'enabled', 'interval_sec', 'config', 'etag', 'last_modified', 'last_checked_at', 'last_success_at', 'last_item_published_at', 'last_error', 'fail_count', 'cooldown_until', 'next_due_at'] as const;
  const sets: string[] = []; const params: (string | number | null)[] = [];
  for (const k of allowed) if (patch[k] !== undefined) { sets.push(`${k} = ?`); params.push(patch[k] as string | number | null); }
  if (sets.length) { params.push(id); await db.run(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getSource(db, id);
}
export const deleteSource = (db: Db, id: string) => db.run('DELETE FROM sources WHERE id = ?', [id]);
export const linkWatchSource = (db: Db, watchId: string, sourceId: string) => db.run('INSERT OR IGNORE INTO watch_sources (watch_id, source_id) VALUES (?,?)', [watchId, sourceId]);
export const unlinkWatchSource = (db: Db, watchId: string, sourceId: string) => db.run('DELETE FROM watch_sources WHERE watch_id = ? AND source_id = ?', [watchId, sourceId]);
export const watchSourceLinks = (db: Db) => db.all<{ watch_id: string; source_id: string }>('SELECT watch_id, source_id FROM watch_sources');
export const sourcesDue = (db: Db, now: number) => db.all<Source>("SELECT * FROM sources WHERE enabled = 1 AND type != 'link' AND next_due_at <= ? AND (cooldown_until IS NULL OR cooldown_until <= ?) ORDER BY next_due_at ASC", [now, now]);
export const sourcesPollable = (db: Db) => db.all<Source>("SELECT * FROM sources WHERE enabled = 1 AND type != 'link' ORDER BY created_at ASC");

// ---------- articles / events ----------
export interface NewArticle extends Omit<Article, 'id'> {}
export async function insertArticleIfNew(db: Db, a: NewArticle): Promise<{ inserted: boolean; article: Article }> {
  const id = newId('a_');
  const r = await db.run('INSERT OR IGNORE INTO articles (id, source_id, source_item_id, url, canonical_url, url_key, headline, title_key, publisher, description, published_at, published_known, updated_at, fetched_at, first_seen_at, category, event_type, filing_accession, filing_form, symbol, exchange, query, flags, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, a.source_id, a.source_item_id, a.url, a.canonical_url, a.url_key, a.headline, a.title_key, a.publisher, a.description, a.published_at, a.published_known, a.updated_at, a.fetched_at, a.first_seen_at, a.category, a.event_type, a.filing_accession, a.filing_form, a.symbol, a.exchange, a.query, a.flags, a.raw]);
  const article = (await db.get<Article>('SELECT * FROM articles WHERE source_id = ? AND source_item_id = ?', [a.source_id, a.source_item_id]))!;
  return { inserted: r.changes > 0, article };
}
export const getArticle = (db: Db, id: string) => db.get<Article>('SELECT * FROM articles WHERE id = ?', [id]);

/** Articles (with their event and matched watches) seen within the clustering window. */
export async function clusterCandidates(db: Db, sinceMs: number): Promise<ClusterArticle[]> {
  const rows = await db.all<{ id: string; event_id: string; url_key: string; title_key: string; publisher: string; published_at: number | null; first_seen_at: number; filing_accession: string | null; category: string; flags: string; symbol: string | null; watch_ids: string | null }>(
    `SELECT a.id, ea.event_id, a.url_key, a.title_key, a.publisher, a.published_at, a.first_seen_at, a.filing_accession, a.category, a.flags, a.symbol,
            (SELECT group_concat(ew.watch_id, ',') FROM event_watches ew WHERE ew.event_id = ea.event_id) AS watch_ids
     FROM articles a JOIN event_articles ea ON ea.article_id = a.id
     WHERE COALESCE(a.published_at, a.first_seen_at) >= ? ORDER BY a.first_seen_at DESC LIMIT 5000`, [sinceMs]);
  return rows.map((r) => ({ id: r.id, eventId: r.event_id, urlKey: r.url_key, titleKey: r.title_key, publisher: r.publisher, publishedAt: r.published_at, firstSeenAt: r.first_seen_at, accession: r.filing_accession, category: r.category, flags: arr(r.flags), symbol: r.symbol, watchIds: r.watch_ids ? r.watch_ids.split(',') : [] }));
}

export const getEvent = (db: Db, id: string) => db.get<EventRow>('SELECT * FROM events WHERE id = ?', [id]);
export const eventArticles = (db: Db, eventId: string) => db.all<Article & { source_name: string; source_type: string }>('SELECT a.*, s.name AS source_name, s.type AS source_type FROM articles a JOIN event_articles ea ON ea.article_id = a.id JOIN sources s ON s.id = a.source_id WHERE ea.event_id = ? ORDER BY COALESCE(a.published_at, a.first_seen_at) ASC, a.first_seen_at ASC', [eventId]);
export const eventWatchIds = async (db: Db, eventId: string) => (await db.all<{ watch_id: string }>('SELECT watch_id FROM event_watches WHERE event_id = ?', [eventId])).map((r) => r.watch_id);

export async function createEventFromArticle(db: Db, a: Article, material: boolean, watchIds: { id: string; reason: string }[], suppressPush = 0): Promise<EventRow> {
  const id = newId('e_'); const now = Date.now();
  const sort = a.published_known ? a.published_at! : a.first_seen_at;
  const stmts: Stmt[] = [
    { sql: 'INSERT INTO events (id, lead_article_id, lead_headline, category, event_type, filing_accession, first_published_at, published_known, sort_time, last_updated_at, first_seen_at, source_count, article_count, material, flags, version, suppress_push, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [id, a.id, a.headline, a.category, a.event_type, a.filing_accession, a.published_known ? a.published_at : null, a.published_known, sort, a.updated_at ?? sort, a.first_seen_at, 1, 1, material ? 1 : 0, a.flags, 1, suppressPush, now, now] },
    { sql: 'INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?,?,?)', params: [id, a.id, now] },
  ];
  for (const w of watchIds) stmts.push({ sql: 'INSERT OR IGNORE INTO event_watches (event_id, watch_id, matched_at, reason) VALUES (?,?,?,?)', params: [id, w.id, now, w.reason] });
  await db.batch(stmts);
  return (await getEvent(db, id))!;
}

/** Attach an article to an event and recompute derived fields. Never changes sort_time once a known publish time exists. */
export async function addArticleToEvent(db: Db, eventId: string, a: Article, watchIds: { id: string; reason: string }[]): Promise<{ newWatchIds: string[] }> {
  const now = Date.now();
  const existing = new Set(await eventWatchIds(db, eventId));
  const stmts: Stmt[] = [{ sql: 'INSERT OR IGNORE INTO event_articles (event_id, article_id, added_at) VALUES (?,?,?)', params: [eventId, a.id, now] }];
  const newWatchIds: string[] = [];
  for (const w of watchIds) if (!existing.has(w.id)) { newWatchIds.push(w.id); stmts.push({ sql: 'INSERT OR IGNORE INTO event_watches (event_id, watch_id, matched_at, reason) VALUES (?,?,?,?)', params: [eventId, w.id, now, w.reason] }); }
  await db.batch(stmts);
  await refreshEventStats(db, eventId);
  return { newWatchIds };
}

export async function refreshEventStats(db: Db, eventId: string): Promise<EventRow | undefined> {
  const arts = await eventArticles(db, eventId);
  if (!arts.length) { await db.run('DELETE FROM events WHERE id = ?', [eventId]); return undefined; }
  const known = arts.filter((x) => x.published_known && x.published_at != null);
  const lead = known.length ? known.reduce((m, x) => (x.published_at! < m.published_at! ? x : m)) : arts.reduce((m, x) => (x.first_seen_at < m.first_seen_at ? x : m));
  const firstPub = known.length ? Math.min(...known.map((x) => x.published_at!)) : null;
  const firstSeen = Math.min(...arts.map((x) => x.first_seen_at));
  const lastUpd = Math.max(...arts.map((x) => x.updated_at ?? x.published_at ?? x.first_seen_at));
  const publishers = new Set(arts.map((x) => x.publisher.toLowerCase()));
  const flags = [...new Set(arts.flatMap((x) => arr(x.flags)))];
  const ev = await getEvent(db, eventId);
  // sort_time is sticky: keep an existing known-time sort_time so re-fetches never reorder history
  const sort = ev && ev.published_known ? ev.sort_time : firstPub ?? firstSeen;
  await db.run('UPDATE events SET lead_article_id = ?, lead_headline = ?, first_published_at = ?, published_known = ?, sort_time = ?, last_updated_at = ?, first_seen_at = ?, source_count = ?, article_count = ?, flags = ?, updated_at = ? WHERE id = ?',
    [lead.id, lead.headline, firstPub, firstPub != null ? 1 : 0, sort, lastUpd, firstSeen, publishers.size, arts.length, j(flags), Date.now(), eventId]);
  return getEvent(db, eventId);
}

export const bumpEventVersion = (db: Db, eventId: string) => db.run('UPDATE events SET version = version + 1, updated_at = ? WHERE id = ?', [Date.now(), eventId]);
export const setEventMaterial = (db: Db, eventId: string, material: boolean) => db.run('UPDATE events SET material = ?, updated_at = ? WHERE id = ?', [material ? 1 : 0, Date.now(), eventId]);

export interface FeedQuery { watchId?: string; sourceId?: string; category?: string; unread?: boolean; since?: number; until?: number; q?: string; sort?: 'first' | 'updated'; limit?: number; offset?: number; matchedOnly?: boolean }
export interface FeedEvent extends EventRow { read_at: number | null; watch_ids: string; publishers: string; lead_url: string; lead_publisher: string; source_ids: string }

export async function listEvents(db: Db, f: FeedQuery): Promise<FeedEvent[]> {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.watchId) { where.push('e.id IN (SELECT event_id FROM event_watches WHERE watch_id = ?)'); params.push(f.watchId); }
  else if (f.matchedOnly !== false) where.push('EXISTS (SELECT 1 FROM event_watches ew2 WHERE ew2.event_id = e.id)');
  if (f.sourceId) { where.push('e.id IN (SELECT ea.event_id FROM event_articles ea JOIN articles a2 ON a2.id = ea.article_id WHERE a2.source_id = ?)'); params.push(f.sourceId); }
  if (f.category) { where.push('e.category = ?'); params.push(f.category); }
  if (f.unread) where.push('r.read_at IS NULL');
  if (f.since) { where.push('e.sort_time >= ?'); params.push(f.since); }
  if (f.until) { where.push('e.sort_time < ?'); params.push(f.until); }
  if (f.q) {
    const hasFts = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'").catch(() => undefined);
    if (hasFts) { where.push('e.id IN (SELECT ea.event_id FROM event_articles ea JOIN articles a3 ON a3.id = ea.article_id WHERE a3.rowid IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?))'); params.push(ftsQuery(f.q)); }
    else { where.push('e.id IN (SELECT ea.event_id FROM event_articles ea JOIN articles a3 ON a3.id = ea.article_id WHERE a3.headline LIKE ? OR a3.description LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  }
  const order = f.sort === 'updated' ? 'e.last_updated_at DESC' : 'e.sort_time DESC';
  params.push(Math.min(200, f.limit ?? 60), f.offset ?? 0);
  return db.all<FeedEvent>(`SELECT e.*, r.read_at,
      (SELECT group_concat(ew.watch_id, ',') FROM event_watches ew WHERE ew.event_id = e.id) AS watch_ids,
      (SELECT group_concat(DISTINCT a.publisher) FROM articles a JOIN event_articles ea ON ea.article_id = a.id WHERE ea.event_id = e.id) AS publishers,
      (SELECT group_concat(DISTINCT a.source_id) FROM articles a JOIN event_articles ea ON ea.article_id = a.id WHERE ea.event_id = e.id) AS source_ids,
      la.url AS lead_url, la.publisher AS lead_publisher
    FROM events e LEFT JOIN read_state r ON r.event_id = e.id LEFT JOIN articles la ON la.id = e.lead_article_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, e.id DESC LIMIT ? OFFSET ?`, params);
}
function ftsQuery(q: string): string { return q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"`).join(' AND '); }

export const unreadCounts = (db: Db) => db.all<{ watch_id: string; n: number }>('SELECT ew.watch_id, COUNT(*) AS n FROM event_watches ew LEFT JOIN read_state r ON r.event_id = ew.event_id WHERE r.read_at IS NULL GROUP BY ew.watch_id');
export const markRead = (db: Db, ids: string[]) => db.batch(ids.map((id) => ({ sql: 'INSERT OR REPLACE INTO read_state (event_id, read_at) VALUES (?, ?)', params: [id, Date.now()] })));
export const markUnread = (db: Db, ids: string[]) => db.batch(ids.map((id) => ({ sql: 'DELETE FROM read_state WHERE event_id = ?', params: [id] })));
export const markAllRead = (db: Db, watchId?: string) => watchId ? db.run('INSERT OR REPLACE INTO read_state (event_id, read_at) SELECT event_id, ? FROM event_watches WHERE watch_id = ?', [Date.now(), watchId]) : db.run('INSERT OR REPLACE INTO read_state (event_id, read_at) SELECT id, ? FROM events', [Date.now()]);

/** Merge event `from` into `to`. Deliveries already recorded for either event stay, so no re-push happens. */
export async function mergeEvents(db: Db, fromId: string, toId: string): Promise<EventRow | undefined> {
  if (fromId === toId) return getEvent(db, toId);
  const now = Date.now();
  await db.batch([
    { sql: 'UPDATE OR IGNORE event_articles SET event_id = ? WHERE event_id = ?', params: [toId, fromId] },
    { sql: 'UPDATE OR IGNORE event_watches SET event_id = ? WHERE event_id = ?', params: [toId, fromId] },
    { sql: 'INSERT INTO cluster_overrides (kind, from_event_id, to_event_id, created_at) VALUES (?,?,?,?)', params: ['merge', fromId, toId, now] },
    { sql: 'UPDATE deliveries SET event_id = ? WHERE event_id = ?', params: [toId, fromId] },
    { sql: 'DELETE FROM events WHERE id = ?', params: [fromId] },
  ]);
  return refreshEventStats(db, toId);
}
/** Split an article out into its own event (push suppressed: the story was already notified). */
export async function splitArticle(db: Db, articleId: string): Promise<EventRow | undefined> {
  const a = await getArticle(db, articleId); if (!a) return undefined;
  const link = await db.get<{ event_id: string }>('SELECT event_id FROM event_articles WHERE article_id = ?', [articleId]); if (!link) return undefined;
  const watches = await db.all<{ watch_id: string; reason: string }>('SELECT watch_id, reason FROM event_watches WHERE event_id = ?', [link.event_id]);
  await db.run('DELETE FROM event_articles WHERE article_id = ?', [articleId]);
  const ev = await createEventFromArticle(db, a, false, watches.map((w) => ({ id: w.watch_id, reason: w.reason })), 1);
  await db.run('INSERT INTO cluster_overrides (kind, article_id, from_event_id, to_event_id, created_at) VALUES (?,?,?,?,?)', ['split', articleId, link.event_id, ev.id, Date.now()]);
  await refreshEventStats(db, link.event_id);
  return ev;
}

// ---------- push / notifications ----------
export const listSubscriptions = (db: Db, activeOnly = true) => db.all<PushSubscriptionRow>(`SELECT * FROM push_subscriptions ${activeOnly ? 'WHERE expired = 0' : ''} ORDER BY created_at ASC`);
export async function upsertSubscription(db: Db, s: { endpoint: string; p256dh: string; auth: string; user_agent?: string; label?: string }): Promise<PushSubscriptionRow> {
  const now = Date.now(); const id = newId('p_');
  await db.run('INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_agent, label, created_at, last_seen_at, expired) VALUES (?,?,?,?,?,?,?,?,0) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at, expired = 0', [id, s.endpoint, s.p256dh, s.auth, s.user_agent || '', s.label || '', now, now]);
  return (await db.get<PushSubscriptionRow>('SELECT * FROM push_subscriptions WHERE endpoint = ?', [s.endpoint]))!;
}
export const deleteSubscriptionByEndpoint = (db: Db, endpoint: string) => db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
export const markSubscriptionExpired = (db: Db, id: string) => db.run('UPDATE push_subscriptions SET expired = 1 WHERE id = ?', [id]);
export const getPrefs = async (db: Db) => (await db.get<NotificationPrefs>("SELECT * FROM notification_prefs WHERE id = 'default'"))!;
export async function setPrefs(db: Db, p: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const allowed = ['quiet_start', 'quiet_end', 'mode', 'digest_interval_min', 'updates_enabled', 'global_mute'] as const;
  const sets: string[] = []; const params: (string | number | null)[] = [];
  for (const k of allowed) if (p[k] !== undefined) { sets.push(`${k} = ?`); params.push(p[k] as string | number | null); }
  if (sets.length) { sets.push('updated_at = ?'); params.push(Date.now()); await db.run(`UPDATE notification_prefs SET ${sets.join(', ')} WHERE id = 'default'`, params); }
  return getPrefs(db);
}
export interface DeliveryRow { id: number; idem_key: string; kind: string; event_id: string | null; subscription_id: string; watch_ids: string; status: string; attempts: number; payload: string; error: string | null; created_at: number; not_before: number; sent_at: number | null }
export async function insertDeliveryIfNew(db: Db, d: { idem_key: string; kind: string; event_id: string | null; subscription_id: string; watch_ids: string[]; payload: Record<string, unknown>; not_before?: number }): Promise<boolean> {
  const r = await db.run('INSERT OR IGNORE INTO deliveries (idem_key, kind, event_id, subscription_id, watch_ids, status, attempts, payload, created_at, not_before) VALUES (?,?,?,?,?,?,0,?,?,?)', [d.idem_key, d.kind, d.event_id, d.subscription_id, j(d.watch_ids), 'queued', j(d.payload), Date.now(), d.not_before ?? 0]);
  return r.changes > 0;
}
export const pendingDeliveries = (db: Db, now: number) => db.all<DeliveryRow>("SELECT * FROM deliveries WHERE status = 'queued' AND not_before <= ? AND attempts < 6 ORDER BY created_at ASC LIMIT 200", [now]);
export const updateDelivery = (db: Db, id: number, patch: { status?: string; attempts?: number; error?: string | null; sent_at?: number | null; not_before?: number }) => {
  const sets: string[] = []; const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) { sets.push(`${k} = ?`); params.push(v as string | number | null); }
  params.push(id); return db.run(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`, params);
};
export const deliveriesForEvent = (db: Db, eventId: string) => db.all<DeliveryRow & { label: string }>('SELECT d.*, p.label FROM deliveries d LEFT JOIN push_subscriptions p ON p.id = d.subscription_id WHERE d.event_id = ? ORDER BY d.created_at DESC', [eventId]);
export const recentDeliveries = (db: Db, limit = 50) => db.all<DeliveryRow>('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT ?', [limit]);

// ---------- jobs / settings ----------
export async function acquireJobLock(db: Db, name: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  await db.run('INSERT OR IGNORE INTO jobs (name) VALUES (?)', [name]);
  const r = await db.run('UPDATE jobs SET locked_until = ?, last_run_at = ? WHERE name = ? AND (locked_until IS NULL OR locked_until < ?)', [now + ttlMs, now, name, now]);
  return r.changes > 0;
}
export const releaseJobLock = (db: Db, name: string, status: string, summary: string) => db.run('UPDATE jobs SET locked_until = NULL, last_finished_at = ?, last_status = ?, last_summary = ? WHERE name = ?', [Date.now(), status, summary, name]);
export const getJob = (db: Db, name: string) => db.get<{ name: string; locked_until: number | null; last_run_at: number | null; last_finished_at: number | null; last_status: string | null; last_summary: string | null }>('SELECT * FROM jobs WHERE name = ?', [name]);
export const getSetting = async (db: Db, key: string) => (await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
export const setSetting = (db: Db, key: string, value: string) => db.run('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [key, value, Date.now()]);

export async function prune(db: Db, retentionDays: number): Promise<{ articles: number; events: number }> {
  const cutoff = Date.now() - retentionDays * 86400_000;
  const a = await db.run('DELETE FROM articles WHERE first_seen_at < ? AND id IN (SELECT ea.article_id FROM event_articles ea JOIN events e ON e.id = ea.event_id WHERE e.sort_time < ?)', [cutoff, cutoff]);
  const e = await db.run('DELETE FROM events WHERE id NOT IN (SELECT event_id FROM event_articles)');
  await db.run("DELETE FROM deliveries WHERE created_at < ? AND status != 'queued'", [cutoff]);
  return { articles: a.changes, events: e.changes };
}

export async function exportAll(db: Db) {
  return { exported_at: new Date().toISOString(), watches: await listWatches(db), identities: await identitiesAll(db), sources: (await listSources(db)).map(({ etag, last_modified, ...s }) => s), watch_sources: await watchSourceLinks(db), prefs: await getPrefs(db), events: await db.all('SELECT * FROM events ORDER BY sort_time DESC'), event_articles: await db.all('SELECT * FROM event_articles'), event_watches: await db.all('SELECT * FROM event_watches'), articles: await db.all('SELECT id, source_id, source_item_id, url, canonical_url, headline, publisher, description, published_at, published_known, fetched_at, first_seen_at, category, event_type, filing_accession, filing_form, symbol, exchange, flags FROM articles'), read_state: await db.all('SELECT * FROM read_state') };
}
export async function deleteAllData(db: Db): Promise<void> {
  for (const t of ['deliveries', 'push_subscriptions', 'read_state', 'cluster_overrides', 'event_watches', 'event_articles', 'events', 'articles', 'watch_sources', 'identities', 'sources', 'watches', 'settings']) await db.run(`DELETE FROM ${t}`);
  await db.run("UPDATE notification_prefs SET quiet_start = NULL, quiet_end = NULL, mode = 'immediate', digest_interval_min = 60, updates_enabled = 0, global_mute = 0, updated_at = ? WHERE id = 'default'", [Date.now()]);
  await db.run("UPDATE jobs SET locked_until = NULL, last_status = NULL, last_summary = NULL");
}
