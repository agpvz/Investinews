import { api, ApiError, setUnauthorizedHandler } from './api.ts';
import { registerSw, pushState, enablePush, disablePush, pushHints, type PushState } from './push.ts';

// ---------- state ----------
type Route = { view: string; id?: string; params: URLSearchParams };
const S = {
  boot: null as any, feed: [] as any[], feedDone: false, sel: -1, detail: null as any, route: { view: 'feed', params: new URLSearchParams() } as Route,
  tzMode: (localStorage.getItem('inv.tz') || 'local') as 'local' | 'utc', push: null as PushState | null, loginRequired: false, filters: { sort: 'first', unread: false, category: '', window: '', source: '', all: false, q: '' },
  presets: [] as any[], lastRefresh: 0,
};
const $ = <T extends HTMLElement = HTMLInputElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tz = () => (S.tzMode === 'utc' ? 'UTC' : S.boot?.tz || 'Africa/Johannesburg');
const fmtAbs = (ts: number | null | undefined, sec = false) => ts ? new Intl.DateTimeFormat('en-GB', { timeZone: tz(), year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: sec ? '2-digit' : undefined, hour12: false }).format(new Date(ts)).replace(',', '') : '—';
const fmtClock = (ts: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
const fmtRel = (ts: number) => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return `${Math.floor(s)}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`; return fmtAbs(ts).slice(0, 8); };
const tzLabel = () => (S.tzMode === 'utc' ? 'UTC' : (S.boot?.tz === 'Africa/Johannesburg' ? 'SAST' : (S.boot?.tz || 'local').split('/').pop()));
const watchById = (id: string) => S.boot?.watches?.find((w: any) => w.id === id);
const sourceById = (id: string) => S.boot?.sources?.find((s: any) => s.id === id);
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

function banner(msg: string, kind: '' | 'err' | 'ok' = '', ms = 5000) { const b = $('#banner'); b.className = `banner ${kind}`; b.innerHTML = `<span>${esc(msg)}</span><button class="btn btn-sm btn-ghost" data-act="banner-close">×</button>`; b.hidden = false; if (ms) setTimeout(() => { if (b.textContent?.includes(msg)) b.hidden = true; }, ms); }

// ---------- routing ----------
function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '') || 'feed';
  const [pathPart, query = ''] = h.split('?');
  const [view, id] = pathPart.split('/');
  return { view: view || 'feed', id, params: new URLSearchParams(query) };
}
function go(path: string) { location.hash = path.startsWith('#') ? path : `#/${path}`; }
function feedPath(over: Partial<typeof S.filters> & { watch?: string | null } = {}) {
  const p = new URLSearchParams(S.route.view === 'feed' ? S.route.params : '');
  const cur = { watch: p.get('watch') || '', ...S.filters, ...over } as any;
  const u = new URLSearchParams();
  if (cur.watch) u.set('watch', cur.watch);
  for (const k of ['sort', 'category', 'window', 'source', 'q']) if (cur[k] && !(k === 'sort' && cur[k] === 'first')) u.set(k, cur[k]);
  if (cur.unread) u.set('unread', '1'); if (cur.all) u.set('all', '1');
  const s = u.toString(); return `#/feed${s ? `?${s}` : ''}`;
}

// ---------- rendering: watches ----------
function renderWatches() {
  const el = $('#watches');
  if (!S.boot) { el.innerHTML = '<div class="loading">loading…</div>'; return; }
  const cur = S.route.view === 'feed' ? S.route.params.get('watch') || '' : '';
  const ws: any[] = S.boot.watches;
  const total = ws.reduce((a: number, w: any) => a + (w.unread || 0), 0);
  el.innerHTML = `<div class="sect"><span>Watches</span><span><button class="btn btn-sm btn-ghost" data-act="focus-cmd" title="Add a watch (/)">+ watch</button></span></div>
    <a class="watch ${!cur && S.route.view === 'feed' ? 'active' : ''}" href="#/feed"><span class="label" style="color:var(--fg)">All events</span><span class="unread ${total ? '' : 'zero'}">${total}</span><span class="meta">${ws.length} watch${ws.length === 1 ? '' : 'es'} · ${S.boot.sources.filter((s: any) => s.type !== 'link' && s.enabled).length} feeds</span></a>
    ${ws.length ? ws.map((w: any) => `<a class="watch ${w.kind} ${cur === w.id ? 'active' : ''}" href="#/feed?watch=${w.id}" data-watch="${w.id}">
      <span class="label">${esc(w.label)}${w.muted ? ' <span class="muted-tag">(muted)</span>' : ''}</span><span class="unread ${w.unread ? '' : 'zero'}">${w.unread}</span>
      <span class="meta"><span class="dot ${w.health}" title="${esc(w.sources.map((s: any) => `${s.name}: ${s.status}`).join('\n'))}"></span>${w.last_success_at ? `upd ${fmtClock(w.last_success_at)}` : w.sources.some((s: any) => s.type !== 'link') ? 'not polled yet' : 'links only'}${w.kind === 'ticker' && w.sources.some((s: any) => s.type === 'sec_submissions') ? ' · SEC' : ''}${w.sources.filter((s: any) => s.type === 'rss').length ? ` · ${w.sources.filter((s: any) => s.type === 'rss').length} rss` : ''}</span></a>`).join('')
      : '<div class="empty">No watches yet.<br>Type <b>watch NASDAQ:NVDA</b>, <b>JSE:NPN</b> or <b>AI export controls</b> in the command bar.</div>'}
    <div class="sect"><span>Sections</span></div>
    <a class="watch" href="#/sources"><span class="label" style="color:var(--fg-2)">Sources</span><span class="dim">${S.boot.sources.filter((s: any) => ['error', 'stale', 'rate_limited'].includes(s.status)).length ? '<span class="err">!</span>' : ''}</span></a>
    <a class="watch" href="#/settings"><span class="label" style="color:var(--fg-2)">Settings & push</span><span></span></a>
    <a class="watch" href="#/status"><span class="label" style="color:var(--fg-2)">Diagnostics</span><span></span></a>
    <a class="watch" href="#/help"><span class="label" style="color:var(--fg-2)">Help</span><span class="dim">?</span></a>`;
}

// ---------- rendering: feed ----------
function filtersFromRoute() { const p = S.route.params; S.filters = { sort: p.get('sort') === 'updated' ? 'updated' : 'first', unread: p.get('unread') === '1', category: p.get('category') || '', window: p.get('window') || '', source: p.get('source') || '', all: p.get('all') === '1', q: p.get('q') || '' }; }
const windowMs: Record<string, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
async function loadFeed(append = false) {
  const p = S.route.params; const f = S.filters;
  const items = await api.feed({ watch: p.get('watch') || undefined, source: f.source, category: f.category, unread: f.unread ? '1' : undefined, since: f.window && windowMs[f.window] ? Date.now() - windowMs[f.window] : undefined, q: f.q, sort: f.sort, all: f.all ? '1' : undefined, limit: 60, offset: append ? S.feed.length : 0 });
  if (append) S.feed = S.feed.concat(items); else S.feed = items;
  S.feedDone = items.length < 60;
}
function renderFeed() {
  const el = $('#main'); const p = S.route.params; const w = p.get('watch') ? watchById(p.get('watch')!) : null; const f = S.filters;
  const pollable = S.boot.sources.filter((s: any) => s.type !== 'link' && s.enabled);
  const head = `<div class="feed-head">
    <span class="title">${w ? `<span class="${w.kind === 'topic' ? 'tag topic' : 'accent'}">${esc(w.label)}</span>${w.kind === 'ticker' && w.sources.find((s: any) => s.type === 'sec_submissions') ? ' <span class="dim">· SEC connected</span>' : ''}` : 'LATEST'}${f.q ? ` <span class="dim">· "${esc(f.q)}"</span>` : ''}</span>
    <button class="chip ${f.sort === 'first' ? 'on' : ''}" data-act="sort" data-v="first" title="Order by first published time">first published</button><button class="chip ${f.sort === 'updated' ? 'on' : ''}" data-act="sort" data-v="updated" title="Order by latest update">latest update</button>
    <button class="chip ${f.unread ? 'on' : ''}" data-act="unread" title="u">unread</button>
    <select class="chip" data-act="category" aria-label="Event type"><option value="">all types</option><option value="news" ${f.category === 'news' ? 'selected' : ''}>news</option><option value="filing" ${f.category === 'filing' ? 'selected' : ''}>filings</option><option value="release" ${f.category === 'release' ? 'selected' : ''}>releases</option></select>
    <select class="chip" data-act="window" aria-label="Time window"><option value="">any time</option>${['1h', '24h', '7d', '30d'].map((x) => `<option value="${x}" ${f.window === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select class="chip" data-act="source" aria-label="Source"><option value="">all sources</option>${pollable.map((s: any) => `<option value="${s.id}" ${f.source === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <button class="chip ${f.all ? 'on' : ''}" data-act="all" title="Include events that matched no watch">unmatched too</button>
    ${(f.q || f.unread || f.category || f.window || f.source || f.all) ? '<button class="chip" data-act="clear">clear</button>' : ''}
    <button class="btn btn-sm" data-act="refresh" title="r">refresh</button><button class="btn btn-sm btn-ghost" data-act="read-all" title="Mark all as read">mark read</button></div>`;
  let body = '';
  if (!S.feed.length) {
    const noFeeds = !pollable.length;
    body = `<div class="empty">${noFeeds ? 'No pollable sources yet. Watches with only external links show nothing here.<br>Add a <b>Google Alert RSS</b> or an <b>investor-relations feed</b> under Sources, or watch a US-listed ticker to get SEC filings.' : f.q || f.unread || f.window || f.category ? 'No events match these filters.' : S.boot.job?.last_run_at ? 'No events yet. Feeds have been polled; new items appear here as they are published.' : 'No events yet — first poll pending. Press <b>refresh</b> to fetch now.'}</div>`;
  } else body = S.feed.map((e, i) => renderEventRow(e, i)).join('') + (S.feedDone ? '' : '<div class="more"><button class="btn" data-act="more">load more</button></div>');
  el.innerHTML = head + body;
  el.classList.add('show'); $('#watches').classList.remove('show');
}
function renderEventRow(e: any, i: number) {
  const known = !!e.published_known; const t = known ? e.first_published_at : e.first_seen_at;
  const tags = (e.watch_ids || []).map((id: string) => watchById(id)).filter(Boolean).map((w: any) => `<span class="tag ${w.kind}">${esc(w.label)}</span>`).join('');
  const pubs: string[] = e.publishers || [];
  return `<article class="ev ${e.read_at ? 'read' : 'unread'} ${i === S.sel ? 'sel' : ''}" data-i="${i}" data-id="${e.id}" tabindex="0" aria-label="${esc(e.lead_headline)}">
    <span class="t ${known ? '' : 'unk'}" title="${known ? 'First published' : 'Publish time unknown; showing first seen'} ${fmtAbs(t, true)} (${tzLabel()})">${known ? '' : 'seen '}${fmtRel(t)}</span>
    <span class="h">${esc(e.lead_headline)}</span>
    <span class="n"><b>${e.source_count}</b> src${e.article_count > e.source_count ? ` · ${e.article_count} art` : ''}${e.material ? ' · <span class="warn">material</span>' : ''}</span>
    <span class="tags">${e.category === 'filing' ? `<span class="tag filing">SEC ${esc(e.event_type || 'filing')}</span>` : ''}${tags}${(e.flags || []).map((fl: string) => `<span class="tag flag">${esc(fl)}</span>`).join('')}<span class="tag pub">${esc(pubs.slice(0, 3).join(', '))}${pubs.length > 3 ? ` +${pubs.length - 3}` : ''}</span>${e.last_updated_at > (e.first_published_at || e.first_seen_at) + 60e3 ? `<span class="dim">upd ${fmtRel(e.last_updated_at)}</span>` : ''}</span></article>`;
}

// ---------- rendering: detail ----------
async function openEvent(id: string, markRead = true) {
  const el = $('#detail'); el.classList.add('show'); el.innerHTML = '<div class="loading">loading…</div>';
  try {
    const ev = await api.event(id); S.detail = ev;
    if (markRead && !ev.read_at) { await api.markRead([id]); ev.read_at = Date.now(); const row = S.feed.find((x) => x.id === id); if (row) row.read_at = ev.read_at; const wl = ev.watch_ids.map(watchById).filter(Boolean); for (const w of wl) w.unread = Math.max(0, (w.unread || 0) - 1); renderWatches(); document.querySelector(`.ev[data-id="${CSS.escape(id)}"]`)?.classList.replace('unread', 'read'); }
    renderDetail(ev);
  } catch (e) { el.innerHTML = `<div class="empty err">${esc((e as Error).message)}</div>`; }
}
function renderDetail(ev: any) {
  const el = $('#detail');
  const lead = ev.articles.find((a: any) => a.id === ev.lead_article_id) || ev.articles[0];
  const watches = (ev.watch_ids || []).map(watchById).filter(Boolean);
  const filing = ev.category === 'filing' ? (lead?.raw || {}) : null;
  el.innerHTML = `<div class="detail">
    <div class="row"><button class="btn btn-sm detail-close" data-act="close-detail">← back</button><span class="dim">event ${esc(ev.id)}</span><span class="dim" style="margin-left:auto">${ev.read_at ? 'read' : 'unread'}</span></div>
    <h2>${esc(ev.lead_headline)}</h2>
    <div class="row">${watches.map((w: any) => `<a class="tag ${w.kind}" href="#/feed?watch=${w.id}">${esc(w.label)}</a>`).join('')}${ev.category === 'filing' ? `<span class="tag filing">SEC ${esc(ev.event_type)}</span>` : ''}${ev.material ? '<span class="warn">material</span>' : ''}${(ev.flags || []).map((f: string) => `<span class="tag flag">${esc(f)}</span>`).join('')}</div>
    <div class="actions"><a class="btn btn-accent" href="${esc(lead?.url || '#')}" target="_blank" rel="noopener noreferrer">open original ↗</a><button class="btn" data-act="toggle-read">${ev.read_at ? 'mark unread' : 'mark read'}</button><button class="btn btn-ghost" data-act="merge-into">merge into…</button></div>
    <dl class="kv"><dt>first published</dt><dd>${ev.published_known ? fmtAbs(ev.first_published_at, true) : '<span class="dim">unknown (sorted by first seen)</span>'}</dd><dt>last updated</dt><dd>${fmtAbs(ev.last_updated_at, true)}</dd><dt>first seen</dt><dd>${fmtAbs(ev.first_seen_at, true)}</dd><dt>sources</dt><dd>${ev.source_count} publisher${ev.source_count === 1 ? '' : 's'}, ${ev.article_count} article${ev.article_count === 1 ? '' : 's'}</dd>
      ${filing ? `<dt>form</dt><dd>${esc(filing.form)}</dd><dt>accession</dt><dd>${esc(filing.accession)}</dd>${filing.items ? `<dt>items</dt><dd>${esc(filing.items)}</dd>` : ''}${filing.reportDate ? `<dt>period</dt><dd>${esc(filing.reportDate)}</dd>` : ''}<dt>index</dt><dd><a href="${esc(filing.indexUrl)}" target="_blank" rel="noopener noreferrer">EDGAR filing index ↗</a></dd>` : ''}
      <dt>times shown in</dt><dd>${tzLabel()} (stored UTC)</dd></dl>
    <div class="sect"><span>Articles (${ev.articles.length}, publication order)</span></div>
    ${ev.articles.map((a: any) => `<div class="art"><a class="ah" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.headline)} ↗</a><div class="am"><span class="cyan">${esc(a.publisher)}</span><span>${a.published_known ? fmtAbs(a.published_at) : '<i>publish time unknown</i>'}</span><span>seen ${fmtAbs(a.first_seen_at)}</span><span>${esc(a.source_name)}</span>${a.id === ev.lead_article_id ? '<span class="accent">lead</span>' : `<button class="btn btn-sm btn-ghost" data-act="split" data-article="${a.id}" title="Move this article to its own event">split</button>`}${(a.flags || []).map((f: string) => `<span class="err">${esc(f)}</span>`).join('')}</div>${a.description ? `<div class="ad">${esc(a.description.slice(0, 400))}</div>` : ''}</div>`).join('')}
    <div class="sect"><span>Notifications (${ev.deliveries.length})</span></div>
    ${ev.deliveries.length ? ev.deliveries.map((d: any) => `<div class="am dim" style="font-size:12px;padding:2px 0">${esc(d.kind)} · ${esc(d.status)} · ${fmtAbs(d.sent_at || d.created_at)} · ${esc(d.device)}${d.error ? ` · <span class="err">${esc(d.error)}</span>` : ''}</div>`).join('') : `<div class="dim" style="font-size:12px">${ev.suppress_push ? 'push suppressed (created by split/merge)' : 'none sent'}</div>`}
  </div>`;
}

// ---------- sources / settings / status / help views ----------
async function renderSources() {
  const el = $('#main');
  const srcs: any[] = S.boot.sources; const ws: any[] = S.boot.watches;
  if (!S.presets.length) S.presets = await api.presets().catch(() => []);
  const group = (t: string) => srcs.filter((s) => s.type === t);
  const row = (s: any) => `<div class="src" data-source="${s.id}"><span class="name">${esc(s.name)}</span><span><span class="status-badge ${s.status}">${esc(s.status.replace('_', ' '))}</span> <span class="fresh ${s.freshness}" style="font-size:11px">${s.freshness}</span></span>
    <span class="sub">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url.length > 90 ? s.url.slice(0, 90) + '…' : s.url)}</a> · ` : ''}${s.watch_labels?.length ? `for ${esc(s.watch_labels.join(', '))} · ` : s.type !== 'link' ? 'all watches (keyword match) · ' : ''}${s.type !== 'link' ? `every ${Math.round(s.interval_sec / 60)} min · last checked ${s.last_checked_at ? fmtAbs(s.last_checked_at) : 'never'} · last item published ${s.last_item_published_at ? fmtAbs(s.last_item_published_at) : '—'} · ` : ''}${esc(s.detail || s.config?.note || '')}</span>
    <span class="sub actions">${s.type !== 'link' ? `<button class="btn btn-sm" data-act="src-refresh" data-id="${s.id}">poll now</button><button class="btn btn-sm" data-act="src-toggle" data-id="${s.id}">${s.enabled ? 'disable' : 'enable'}</button><select class="chip" data-act="src-interval" data-id="${s.id}" aria-label="Interval">${[5, 10, 15, 30, 60, 180].map((m) => `<option value="${m * 60}" ${s.interval_sec === m * 60 ? 'selected' : ''}>${m} min</option>`).join('')}</select><select class="chip" data-act="src-watch" data-id="${s.id}" aria-label="Map to watch"><option value="">map to watch…</option>${ws.map((w) => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}</select>` : ''}<button class="btn btn-sm btn-danger" data-act="src-delete" data-id="${s.id}">remove</button></span></div>`;
  el.innerHTML = `<div class="feed-head"><span class="title">SOURCES</span><span class="dim">${srcs.filter((s) => s.type !== 'link' && s.enabled).length} feeds polling · ${srcs.filter((s) => s.type === 'link').length} external links</span></div>
    <div class="card"><h3>Add an RSS / Atom feed</h3><div class="row"><input class="field" id="feedurl" placeholder="https://www.google.com/alerts/feeds/… or an investor-relations RSS URL" inputmode="url"><button class="btn btn-accent" data-act="feed-validate">check</button></div>
      <div class="row"><input class="field" id="feedname" placeholder="name (optional)"><select class="field" id="feedwatch"><option value="">map to: all watches (keyword match)</option>${ws.map((w) => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}</select><select class="field" id="feedcat"><option value="news">news</option><option value="release">company release</option></select><button class="btn" data-act="feed-add" disabled id="feedadd">add feed</button></div>
      <div id="feedpreview" class="dim" style="font-size:12px"></div>
      <div class="dim" style="font-size:12px;margin-top:6px"><b class="accent">Google Alerts (one-time manual step per alert):</b> go to <a href="https://www.google.com/alerts" target="_blank" rel="noopener noreferrer">google.com/alerts</a>, create an alert for the company or topic, set <i>Deliver to: RSS feed</i>, copy the feed URL from the RSS icon, paste it above and map it to a watch. This app cannot create Google Alerts for you.</div></div>
    <div class="card"><h3>Public feeds you can enable</h3><div class="dim" style="font-size:12px">Official regulator/central-bank feeds and publisher headline feeds. Items are matched to your watches by ticker notation, issuer name and topic keywords. Publisher feeds carry headlines and links only; check each publisher's terms for your use.</div>
      ${S.presets.map((p, i) => `<div class="row"><button class="btn btn-sm" data-act="preset-add" data-i="${i}" ${srcs.some((s) => s.url === p.url) ? 'disabled' : ''}>${srcs.some((s) => s.url === p.url) ? 'added' : 'add'}</button><span>${esc(p.name)}</span><span class="dim" style="font-size:11px">${esc(p.note)}</span></div>`).join('')}</div>
    <div class="sect"><span>SEC EDGAR (official API)</span></div>${group('sec_submissions').map(row).join('') || '<div class="empty">Watch a US-listed ticker (e.g. NASDAQ:NVDA) to connect its filings.</div>'}
    <div class="sect"><span>RSS / Atom feeds</span></div>${group('rss').map(row).join('') || '<div class="empty">No feeds yet.</div>'}
    <div class="sect"><span>External links (no automated ingestion)</span></div>${group('link').map(row).join('') || '<div class="empty">None.</div>'}`;
  el.classList.add('show');
}

async function renderSettings() {
  const el = $('#main'); const p = S.boot.prefs; const ws: any[] = S.boot.watches;
  S.push = await pushState(S.boot.push.configured).catch(() => null);
  const ps = S.push;
  const pushBlock = !ps ? '<div class="err">push state unavailable</div>' : !ps.serverConfigured ? '<div class="warn">Server has no VAPID keys. Run <code>npm run vapid</code> and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT, then restart.</div>'
    : ps.support === 'insecure' ? '<div class="warn">Push needs HTTPS (or localhost).</div>'
    : ps.support === 'needs-homescreen' ? '<div class="warn">iPhone/iPad: add this site to the Home Screen (Share → Add to Home Screen), open it from the icon, then enable notifications here. Requires iOS 16.4+.</div>'
    : ps.support === 'unsupported' ? '<div class="warn">This browser does not support Web Push.</div>'
    : ps.permission === 'denied' ? '<div class="err">Notification permission is denied for this site. Re-enable it in the browser/site settings, then return here.</div>'
    : ps.subscribed ? `<div class="row"><span class="ok">Enabled on this device.</span><button class="btn" data-act="push-test">send test notification</button><button class="btn btn-ghost" data-act="push-disable">disable on this device</button></div>`
    : `<div class="row"><span class="dim">Not enabled on this device.</span><button class="btn btn-accent" data-act="push-enable">enable notifications</button></div>${pushHints.isIOS() && !pushHints.isStandalone() ? '<div class="warn" style="font-size:12px">On iPhone, notifications only work after adding to the Home Screen and opening the app from its icon.</div>' : ''}`;
  el.innerHTML = `<div class="feed-head"><span class="title">SETTINGS</span></div>
    <div class="card"><h3>Push notifications</h3>${pushBlock}<div class="dim" style="font-size:12px;margin-top:6px">Devices registered on the server: ${S.boot.push.subscriptions.length ? S.boot.push.subscriptions.map((s: any) => `${esc(s.label || 'device')} (${esc(s.endpointHost)}, ${fmtAbs(s.created_at)})`).join('; ') : 'none'}. Closed-app delivery needs an always-on HTTPS server polling sources; see README.</div></div>
    <div class="card"><h3>Delivery</h3>
      <div class="row"><label><input type="checkbox" data-pref="global_mute" ${p.global_mute ? 'checked' : ''}> mute all notifications</label></div>
      <div class="row"><label>mode <select class="field" data-pref="mode"><option value="immediate" ${p.mode === 'immediate' ? 'selected' : ''}>immediate (one per new event)</option><option value="digest" ${p.mode === 'digest' ? 'selected' : ''}>digest</option></select></label><label>digest every <select class="field" data-pref="digest_interval_min">${[15, 30, 60, 120, 240, 480, 1440].map((m) => `<option value="${m}" ${p.digest_interval_min === m ? 'selected' : ''}>${m >= 60 ? `${m / 60}h` : `${m}m`}</option>`).join('')}</select></label></div>
      <div class="row"><label>quiet hours (${esc(S.boot.tz)}) from <input class="field" type="time" data-pref="quiet_start" value="${esc(p.quiet_start || '')}" style="flex:0"></label><label>to <input class="field" type="time" data-pref="quiet_end" value="${esc(p.quiet_end || '')}" style="flex:0"></label><button class="btn btn-sm btn-ghost" data-act="quiet-clear">clear</button></div>
      <div class="row"><label><input type="checkbox" data-pref="updates_enabled" ${p.updates_enabled ? 'checked' : ''}> also notify on material developments of an already-notified event (opt-in)</label></div></div>
    <div class="card"><h3>Per-watch push scope</h3>${ws.length ? ws.map((w) => `<div class="row"><span class="tag ${w.kind}" style="min-width:160px">${esc(w.label)}</span><select class="field" data-watch-scope="${w.id}"><option value="all" ${w.notify_scope === 'all' ? 'selected' : ''}>all new events</option><option value="material" ${w.notify_scope === 'material' ? 'selected' : ''}>material only</option><option value="none" ${w.notify_scope === 'none' ? 'selected' : ''}>never</option></select><label><input type="checkbox" data-watch-mute="${w.id}" ${w.muted ? 'checked' : ''}> muted</label><button class="btn btn-sm btn-ghost" data-act="watch-edit" data-id="${w.id}">terms & aliases</button><button class="btn btn-sm btn-danger" data-act="unwatch" data-id="${w.id}">unwatch</button></div>`).join('') : '<div class="dim">no watches</div>'}<div id="watchedit"></div></div>
    <div class="card"><h3>Display</h3><div class="row"><span>time zone:</span><button class="btn btn-sm ${S.tzMode === 'local' ? 'btn-accent' : ''}" data-act="tz" data-v="local">${esc(S.boot.tz)}</button><button class="btn btn-sm ${S.tzMode === 'utc' ? 'btn-accent' : ''}" data-act="tz" data-v="utc">UTC</button><span class="dim">all timestamps are stored in UTC</span></div></div>
    <div class="card"><h3>Data</h3><div class="row"><a class="btn" href="/api/export" download>export JSON</a><button class="btn btn-danger" data-act="delete-all">delete all data…</button>${S.boot.auth.required ? '<button class="btn btn-ghost" data-act="logout">log out</button>' : ''}</div><div class="dim" style="font-size:12px">Export includes watches, sources (without feed credentials), events, article metadata and read state. Delete removes everything including push registrations; uninstall by removing the Home Screen icon / deleting the database file.</div></div>`;
  el.classList.add('show');
}
async function renderWatchEdit(id: string) {
  const w = watchById(id); if (!w) return;
  const ids = await api.identities(id).catch(() => []);
  $('#watchedit').innerHTML = `<div class="card" style="margin:8px 0"><h3>${esc(w.label)}</h3>
    <div class="row"><span style="min-width:110px">include terms</span><input class="field" id="incl" value="${esc(w.include_terms.join(', '))}" placeholder="comma separated; any of these matches"></div>
    <div class="row"><span style="min-width:110px">exclude terms</span><input class="field" id="excl" value="${esc(w.exclude_terms.join(', '))}" placeholder="comma separated; any of these vetoes"></div>
    <div class="row"><button class="btn btn-accent" data-act="watch-save-terms" data-id="${id}">save terms</button><span class="dim" style="font-size:12px">${w.kind === 'ticker' ? 'Ticker watches match on $SYM / EXCH:SYM notation, issuer name and aliases; bare symbols only when ≥4 letters and not a common word.' : 'Topic watches match when the phrase or all significant words appear.'}</span></div>
    <div class="row"><span style="min-width:110px">aliases</span><span>${ids.map((i: any) => `<span class="chip">${esc(i.kind)}: ${esc(i.value)} ${i.kind !== 'cik' ? `<button class="btn btn-sm btn-ghost" data-act="ident-del" data-id="${i.id}">×</button>` : ''}</span> `).join('') || '<span class="dim">none</span>'}</span></div>
    <div class="row"><input class="field" id="alias" placeholder="add alias (e.g. Naspers, Prosus)"><button class="btn" data-act="ident-add" data-id="${id}">add alias</button></div></div>`;
}
async function renderStatus() {
  const el = $('#main'); el.innerHTML = '<div class="loading">loading…</div>'; el.classList.add('show');
  const st = await api.status();
  el.innerHTML = `<div class="feed-head"><span class="title">DIAGNOSTICS</span><span class="dim">db ${esc(st.db)} · server ${esc(st.nowLocal)} ${esc(st.tz)}</span></div>
    <div class="card"><h3>Counts</h3><div class="row">${Object.entries(st.counts || {}).map(([k, v]) => `<span><b>${v}</b> ${esc(k)}</span>`).join('')}<span class="dim">retention ${st.retentionDays}d</span><span class="${st.push.configured ? 'ok' : 'warn'}">push ${st.push.configured ? 'configured' : 'not configured'}</span></div></div>
    <div class="card"><h3>Poll job</h3><div class="dim" style="font-size:12px">last run ${st.job?.last_run_at ? fmtAbs(st.job.last_run_at, true) : 'never'} · finished ${st.job?.last_finished_at ? fmtAbs(st.job.last_finished_at, true) : '—'} · status ${esc(st.job?.last_status || '—')} · lock ${st.job?.locked_until && st.job.locked_until > Date.now() ? 'held' : 'free'}</div><pre>${esc(st.job?.last_summary || '')}</pre><button class="btn" data-act="refresh">run poll now</button></div>
    <div class="card"><h3>Sources</h3>${st.sources.map((s: any) => `<div class="row" style="font-size:12px"><span class="status-badge ${s.status}">${esc(s.status)}</span><span class="fresh ${s.freshness}" style="font-size:11px">${s.freshness}</span><span>${esc(s.name)}</span><span class="dim">checked ${s.last_checked_at ? fmtAbs(s.last_checked_at, true) : 'never'} · ok ${s.last_success_at ? fmtAbs(s.last_success_at, true) : 'never'} · fails ${s.fail_count}${s.last_error ? ` · <span class="err">${esc(s.last_error)}</span>` : ''}</span></div>`).join('')}</div>
    <div class="card"><h3>Recent deliveries</h3>${st.deliveries.length ? st.deliveries.map((d: any) => `<div class="row" style="font-size:12px"><span>${esc(d.kind)}</span><span class="${d.status === 'sent' ? 'ok' : d.status === 'queued' ? 'warn' : 'err'}">${esc(d.status)}</span><span class="dim">${fmtAbs(d.created_at, true)} · attempts ${d.attempts}${d.error ? ` · ${esc(d.error)}` : ''}</span></div>`).join('') : '<div class="dim">none</div>'}</div>`;
}
function renderHelp() {
  const el = $('#main');
  el.innerHTML = `<div class="feed-head"><span class="title">HELP</span></div><div class="card help">
    <h3>Commands (type in the bar, or press <kbd>/</kbd>)</h3><dl>
    <dt>watch NASDAQ:NVDA · watch JSE:NPN · watch AI export controls</dt><dd>Save a ticker (exchange:symbol) or a free-text topic. A bare symbol like <b>NVDA</b> asks you to confirm the exchange; ambiguous words offer a topic instead.</dd>
    <dt>unwatch &lt;label&gt;</dt><dd>Remove a watch and its watch-specific sources.</dd>
    <dt>open &lt;n&gt; · read &lt;n&gt; · read all</dt><dd>Open / mark the n-th event in the current list.</dd>
    <dt>mute &lt;label&gt; · unmute &lt;label&gt; · mute all · unmute all</dt><dd>Silence notifications per watch or globally.</dd>
    <dt>refresh</dt><dd>Poll the current watch's sources now (or everything).</dd>
    <dt>filter &lt;text&gt; · clear</dt><dd>Full-text search over stored headlines; clear all filters.</dd>
    <dt>sources · settings · status · help</dt><dd>Open a section.</dd>
    <dt>anything else</dt><dd>Resolves to a ticker or topic suggestion you can save, or searches the feed.</dd></dl>
    <h3>Keyboard</h3><dl><dt><kbd>/</kbd></dt><dd>focus the command bar</dd><dt><kbd>↓</kbd> <kbd>↑</kbd> or <kbd>j</kbd> <kbd>k</kbd></dt><dd>move through events</dd><dt><kbd>Enter</kbd></dt><dd>open the selected event (details pane)</dd><dt><kbd>o</kbd></dt><dd>open the original article</dd><dt><kbd>m</kbd></dt><dd>toggle read on the selected event</dd><dt><kbd>u</kbd></dt><dd>toggle the unread filter</dd><dt><kbd>r</kbd></dt><dd>refresh</dd><dt><kbd>Esc</kbd></dt><dd>close the details pane / menu</dd><dt><kbd>?</kbd></dt><dd>this help</dd></dl>
    <h3>Freshness labels</h3><dl><dt>POLLING</dt><dd>source checked successfully within its interval</dd><dt>DELAYED</dt><dd>last success older than 1.5× the interval</dd><dt>STALE</dt><dd>older than 3× the interval</dd><dt>OFFLINE</dt><dd>last check failed / in cooldown</dd><dt>LINK</dt><dd>external page only, nothing is ingested</dd></dl>
    <div class="dim" style="font-size:12px">Nothing here is real-time: feeds are polled on a schedule and publishers add their own delays. LIVE is never claimed. This app is not affiliated with Bloomberg or any data vendor.</div>
    <h3>Install as an app</h3><dd class="dim">iPhone: Safari → Share → Add to Home Screen, then open from the icon and enable notifications in Settings. Android/Chrome: menu → Install app. Desktop Chrome/Edge: install icon in the address bar.</dd></div>`;
  el.classList.add('show');
}
function renderLogin() {
  $('#main').innerHTML = `<div class="card" style="max-width:420px;margin:40px auto"><h3>Sign in</h3><div class="dim" style="font-size:12px">This deployment requires the APP_TOKEN configured on the server.</div><div class="row"><input class="field" id="tok" type="password" placeholder="access token" autocomplete="current-password"><button class="btn btn-accent" data-act="login">enter</button></div><div id="loginerr" class="err"></div></div>`;
  $('#main').classList.add('show'); $('#watches').innerHTML = '';
}

// ---------- freshness / clock ----------
function renderTop() {
  if (!S.boot) return;
  const pollable = S.boot.sources.filter((s: any) => s.type !== 'link' && s.enabled);
  const f = $('#fresh');
  const order = ['POLLING', 'DELAYED', 'STALE', 'OFFLINE'];
  const label = !pollable.length ? 'NO FEEDS' : order.find((l) => pollable.some((s: any) => s.freshness === l)) || 'POLLING';
  f.textContent = label; f.className = `fresh ${label}`;
  const lastOk = Math.max(0, ...pollable.map((s: any) => s.last_success_at || 0)); const lastChecked = Math.max(0, ...pollable.map((s: any) => s.last_checked_at || 0));
  f.title = `${pollable.length} feeds: ${order.map((l) => `${pollable.filter((s: any) => s.freshness === l).length} ${l}`).join(', ')}\nlast checked ${lastChecked ? fmtAbs(lastChecked, true) : 'never'}\nlast success ${lastOk ? fmtAbs(lastOk, true) : 'never'}`;
  $('#tzbtn').textContent = tzLabel();
}
setInterval(() => { $('#clock').textContent = fmtClock(Date.now()); }, 1000);

// ---------- command bar ----------
const COMMANDS = [['watch', 'save a ticker (EXCH:SYM) or topic'], ['unwatch', 'remove a watch'], ['open', 'open event n / original'], ['read', 'mark event n (or all) read'], ['mute', 'mute a watch or all'], ['unmute', 'unmute a watch or all'], ['refresh', 'poll sources now'], ['filter', 'search stored headlines'], ['clear', 'clear filters'], ['sources', 'manage feeds'], ['settings', 'notifications & display'], ['status', 'diagnostics'], ['help', 'commands and keys']];
let menuItems: { k: string; d: string; n?: string; run: () => void }[] = []; let menuSel = -1; let resolveTimer: any = null;
function showMenu(items: typeof menuItems) { menuItems = items; menuSel = items.length ? 0 : -1; const m = $('#cmdmenu'); if (!items.length) { m.hidden = true; return; } m.innerHTML = items.map((it, i) => `<div class="cmd-item ${i === menuSel ? 'sel' : ''}" data-i="${i}" role="option"><span class="k">${esc(it.k)}</span><span class="d">${esc(it.d)}</span>${it.n ? `<span class="n">${esc(it.n)}</span>` : ''}</div>`).join(''); m.hidden = false; }
function hideMenu() { $('#cmdmenu').hidden = true; menuItems = []; menuSel = -1; }
function onCmdInput() {
  const v = $('#cmdinput').value; const t = v.trim();
  clearTimeout(resolveTimer);
  if (!t) return hideMenu();
  const [head, ...rest] = t.split(/\s+/); const arg = rest.join(' ');
  const cmd = COMMANDS.find(([c]) => c === head.toLowerCase());
  if (cmd && (cmd[0] === 'watch') && arg) { resolveTimer = setTimeout(() => resolveMenu(arg), 300); return; }
  if (!cmd && !/\s/.test(t) && rest.length === 0) { const pref = COMMANDS.filter(([c]) => c.startsWith(head.toLowerCase())); if (pref.length && head.length >= 2 && head === head.toLowerCase()) { showMenu(pref.map(([k, d]) => ({ k, d, run: () => { $('#cmdinput').value = `${k} `; onCmdInput(); } }))); return; } }
  if (!cmd) { resolveTimer = setTimeout(() => resolveMenu(t, true), 300); return; }
  if (cmd[0] === 'unwatch' || cmd[0] === 'mute' || cmd[0] === 'unmute') { const ws = S.boot.watches.filter((w: any) => w.label.toLowerCase().includes(arg.toLowerCase())); showMenu(ws.slice(0, 8).map((w: any) => ({ k: `${cmd[0]} ${w.label}`, d: w.kind, run: () => runCommand(`${cmd[0]} ${w.label}`) }))); return; }
  hideMenu();
}
async function resolveMenu(q: string, plain = false) {
  try {
    const r = await api.resolve(q);
    if ($('#cmdinput').value.trim() !== (plain ? q : `watch ${q}`) && !$('#cmdinput').value.trim().endsWith(q)) return;
    const items = r.interpretations.map((it: any) => ({ k: `watch ${it.label}`, d: it.kind === 'ticker' ? `${it.name || 'ticker'}${it.cik ? ' · SEC filings available' : ''}` : 'topic (keyword matching + Google Alert RSS)', n: it.note || '', run: () => createWatch(it) }));
    if (plain) items.push({ k: `filter ${q}`, d: 'search stored headlines', run: () => runCommand(`filter ${q}`) });
    if (r.secError) items.push({ k: 'note', d: `SEC ticker lookup unavailable: ${r.secError}`, n: 'use EXCH:SYM', run: () => {} });
    showMenu(items);
  } catch (e) { showMenu([{ k: 'error', d: (e as Error).message, run: () => {} }]); }
}
async function createWatch(it: any) {
  hideMenu(); $('#cmdinput').value = '';
  try {
    const r = await api.createWatch({ kind: it.kind, symbol: it.symbol, exchange: it.exchange, query: it.query, name: it.name, cik: it.cik });
    banner(`${r.created ? 'Watching' : 'Already watching'} ${r.watch.label}. ${r.notes.join(' ')}`, 'ok', 9000);
    await reloadBoot(); go(`feed?watch=${r.watch.id}`);
    if (r.created) api.refresh(r.watch.id).then(() => reloadBoot().then(() => { if (S.route.view === 'feed') refreshFeed(); })).catch(() => {});
  } catch (e) { banner((e as Error).message, 'err'); }
}
async function runCommand(raw: string) {
  const t = raw.trim(); if (!t) return;
  const [head, ...rest] = t.split(/\s+/); const arg = rest.join(' ').trim(); const cmd = head.toLowerCase();
  const findWatch = (s: string) => S.boot.watches.find((w: any) => w.label.toLowerCase() === s.toLowerCase() || w.id === s) || S.boot.watches.find((w: any) => w.label.toLowerCase().includes(s.toLowerCase()));
  try {
    switch (cmd) {
      case 'watch': { if (!arg) return banner('watch <EXCH:SYM or topic>', 'err'); const r = await api.resolve(arg); const tickers = r.interpretations.filter((i: any) => i.kind === 'ticker'); if (!r.needsChoice && r.interpretations.length === 1) return createWatch(r.interpretations[0]); if (!r.needsChoice && tickers.length === 1) return createWatch(tickers[0]); showMenu(r.interpretations.map((it: any) => ({ k: `watch ${it.label}`, d: it.kind === 'ticker' ? it.name || 'ticker' : 'topic', n: it.note || (it.kind === 'ticker' ? 'confirm exchange' : ''), run: () => createWatch(it) }))); banner('Choose an interpretation', '', 3000); return; }
      case 'unwatch': { const w = findWatch(arg); if (!w) return banner(`no watch matching "${arg}"`, 'err'); if (!confirm(`Remove watch ${w.label}?`)) return; await api.deleteWatch(w.id); await reloadBoot(); go('feed'); return banner(`Removed ${w.label}`, 'ok'); }
      case 'open': { if (!arg && S.sel >= 0) { const e = S.feed[S.sel]; if (e?.lead_url) window.open(e.lead_url, '_blank', 'noopener'); return; } const n = Number(arg); const e = S.feed[n - 1]; if (!e) return banner('no such event number', 'err'); S.sel = n - 1; go(`event/${e.id}`); return; }
      case 'read': { if (arg === 'all') { await api.markAllRead(S.route.params.get('watch') || undefined); await reloadBoot(); await refreshFeed(); return banner('All marked read', 'ok'); } const n = Number(arg); const e = S.feed[n - 1]; if (!e) return banner('read <n> or read all', 'err'); await api.markRead([e.id]); e.read_at = Date.now(); await reloadBoot(); renderFeed(); return; }
      case 'mute': case 'unmute': { if (arg === 'all' || !arg) { await api.updatePrefs({ global_mute: cmd === 'mute' }); await reloadBoot(); return banner(cmd === 'mute' ? 'All notifications muted' : 'Notifications unmuted', 'ok'); } const w = findWatch(arg); if (!w) return banner(`no watch matching "${arg}"`, 'err'); await api.updateWatch(w.id, { muted: cmd === 'mute' }); await reloadBoot(); return banner(`${w.label} ${cmd}d`, 'ok'); }
      case 'refresh': return doRefresh();
      case 'filter': case 'search': { S.filters.q = arg; go(feedPath({ q: arg })); return; }
      case 'clear': { S.filters = { sort: 'first', unread: false, category: '', window: '', source: '', all: false, q: '' }; go(feedPath({ q: '', unread: false, category: '', window: '', source: '', all: false })); return; }
      case 'sources': case 'settings': case 'status': case 'help': case 'feed': case 'watches': return go(cmd);
      default: { const r = await api.resolve(t); showMenu([...r.interpretations.map((it: any) => ({ k: `watch ${it.label}`, d: it.kind === 'ticker' ? it.name || 'ticker' : 'topic', n: it.note || '', run: () => createWatch(it) })), { k: `filter ${t}`, d: 'search stored headlines', run: () => runCommand(`filter ${t}`) }]); }
    }
  } catch (e) { banner((e as Error).message, 'err'); }
}
async function doRefresh() {
  banner('Polling sources…', '', 60000);
  try { const r = await api.refresh(S.route.params.get('watch') || undefined); await reloadBoot(); if (S.route.view === 'feed') await refreshFeed(); if (!r.ran) banner('A poll is already running; try again shortly.', '', 4000); else banner(`Polled ${r.poll.sources} source${r.poll.sources === 1 ? '' : 's'}: ${r.poll.newArticles} new article${r.poll.newArticles === 1 ? '' : 's'}, ${r.poll.newEvents} new event${r.poll.newEvents === 1 ? '' : 's'}${r.poll.errors.length ? `, ${r.poll.errors.length} source error${r.poll.errors.length === 1 ? '' : 's'} (see Sources)` : ''}${r.deliveries.sent ? `, ${r.deliveries.sent} push sent` : ''}`, r.poll.errors.length ? '' : 'ok', 7000); }
  catch (e) { banner((e as Error).message, 'err'); }
}

// ---------- data plumbing ----------
async function reloadBoot() { S.boot = await api.bootstrap(); renderWatches(); renderTop(); }
async function refreshFeed() { const selId = S.feed[S.sel]?.id; await loadFeed(false); S.sel = selId ? S.feed.findIndex((e) => e.id === selId) : -1; if (S.route.view === 'feed') renderFeed(); }
async function render() {
  S.route = parseRoute();
  document.querySelectorAll('.mobile-nav a').forEach((a) => a.classList.toggle('active', (a.getAttribute('href') || '').replace('#/', '') === S.route.view));
  if (S.loginRequired) return renderLogin();
  if (!S.boot) return;
  const main = $('#main'), left = $('#watches'), right = $('#detail');
  left.classList.remove('show'); main.classList.remove('show'); if (S.route.view !== 'event') right.classList.remove('show');
  renderWatches();
  switch (S.route.view) {
    case 'feed': { filtersFromRoute(); main.innerHTML = '<div class="loading">loading…</div>'; main.classList.add('show'); await loadFeed(false); if (S.sel >= S.feed.length) S.sel = -1; renderFeed(); break; }
    case 'event': { if (!S.feed.length) { filtersFromRoute(); await loadFeed(false).catch(() => {}); } renderFeed(); if (!isMobile()) main.classList.add('show'); else main.classList.remove('show'); const i = S.feed.findIndex((e) => e.id === S.route.id); if (i >= 0) { S.sel = i; renderFeed(); } await openEvent(S.route.id!); break; }
    case 'watches': { if (isMobile()) left.classList.add('show'); else { main.classList.add('show'); renderFeed(); } break; }
    case 'search': { main.classList.add('show'); renderFeed(); $('#cmdinput').focus(); break; }
    case 'sources': await renderSources(); break;
    case 'settings': await renderSettings(); break;
    case 'status': await renderStatus(); break;
    case 'help': renderHelp(); break;
    default: go('feed');
  }
}

// ---------- events ----------
function selectRow(i: number, scroll = true) { if (!S.feed.length) return; S.sel = Math.max(0, Math.min(S.feed.length - 1, i)); document.querySelectorAll('.ev.sel').forEach((e) => e.classList.remove('sel')); const row = document.querySelector(`.ev[data-i="${S.sel}"]`); row?.classList.add('sel'); if (scroll) row?.scrollIntoView({ block: 'nearest' }); }
document.addEventListener('click', async (e) => {
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  const row = (e.target as HTMLElement).closest('.ev') as HTMLElement | null;
  const item = (e.target as HTMLElement).closest('.cmd-item') as HTMLElement | null;
  if (item) { e.preventDefault(); menuItems[Number(item.dataset.i)]?.run(); return; }
  if (row && !t) { S.sel = Number(row.dataset.i); go(`event/${row.dataset.id}`); return; }
  if (!t) return;
  const act = t.dataset.act!; const id = t.dataset.id || '';
  try {
    switch (act) {
      case 'banner-close': $('#banner').hidden = true; break;
      case 'focus-cmd': $('#cmdinput').focus(); break;
      case 'sort': go(feedPath({ sort: t.dataset.v as any })); break;
      case 'unread': go(feedPath({ unread: !S.filters.unread })); break;
      case 'all': go(feedPath({ all: !S.filters.all })); break;
      case 'clear': runCommand('clear'); break;
      case 'refresh': doRefresh(); break;
      case 'read-all': runCommand('read all'); break;
      case 'more': await loadFeed(true); renderFeed(); break;
      case 'close-detail': $('#detail').classList.remove('show'); if (S.route.view === 'event') history.back(); break;
      case 'toggle-read': { const ev = S.detail; await api.markRead([ev.id], !ev.read_at); await reloadBoot(); await openEvent(ev.id, false); const r = S.feed.find((x) => x.id === ev.id); if (r) { r.read_at = ev.read_at ? null : Date.now(); renderFeed(); } break; }
      case 'merge-into': { const into = prompt('Merge this event into event id:'); if (into) { await api.merge(S.detail.id, into.trim()); banner('Merged', 'ok'); go(`event/${into.trim()}`); await refreshFeed(); } break; }
      case 'split': { if (confirm('Move this article to its own event? (No push will be sent.)')) { const ev = await api.split(t.dataset.article!); banner('Split into a new event', 'ok'); await refreshFeed(); go(`event/${ev.id}`); } break; }
      case 'tz': S.tzMode = t.dataset.v as any; localStorage.setItem('inv.tz', S.tzMode); renderTop(); render(); break;
      case 'login': { try { await api.login(($('#tok') as HTMLInputElement).value); S.loginRequired = false; await boot(); } catch (err) { $('#loginerr').textContent = (err as Error).message; } break; }
      case 'logout': await api.logout(); location.reload(); break;
      case 'delete-all': if (prompt('Type DELETE to erase all watches, sources, events and push registrations:') === 'DELETE') { await api.deleteAll(); await disablePush().catch(() => {}); location.hash = '#/feed'; location.reload(); } break;
      case 'push-enable': { t.setAttribute('disabled', ''); try { S.push = await enablePush(`${pushHints.isIOS() ? 'iPhone' : navigator.platform || 'device'} ${new Date().toISOString().slice(0, 10)}`); banner('Notifications enabled on this device', 'ok'); await reloadBoot(); await renderSettings(); } catch (err) { banner((err as Error).message, 'err', 9000); t.removeAttribute('disabled'); } break; }
      case 'push-disable': await disablePush(); await reloadBoot(); await renderSettings(); break;
      case 'push-test': { const r = await api.pushTest(S.push?.endpoint); banner(r.ok ? 'Test notification sent (check this device)' : `Test failed: ${r.deliveries?.map((d: any) => d.error).filter(Boolean).join('; ') || 'not sent'}`, r.ok ? 'ok' : 'err', 9000); break; }
      case 'quiet-clear': await api.updatePrefs({ quiet_start: null, quiet_end: null }); await reloadBoot(); await renderSettings(); break;
      case 'watch-edit': await renderWatchEdit(id); break;
      case 'watch-save-terms': { const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean); await api.updateWatch(id, { include_terms: split(($('#incl') as HTMLInputElement).value), exclude_terms: split(($('#excl') as HTMLInputElement).value) }); await reloadBoot(); banner('Terms saved', 'ok'); await renderSettings(); await renderWatchEdit(id); break; }
      case 'ident-add': { const v = ($('#alias') as HTMLInputElement).value.trim(); if (v) { await api.addIdentity(id, 'alias', v); await renderWatchEdit(id); } break; }
      case 'ident-del': await api.deleteIdentity(Number(id)); await renderWatchEdit(S.boot.watches.find((w: any) => $('#watchedit h3')?.textContent === w.label)?.id || ''); break;
      case 'unwatch': { const w = watchById(id); if (w && confirm(`Remove watch ${w.label}?`)) { await api.deleteWatch(id); await reloadBoot(); await renderSettings(); } break; }
      case 'feed-validate': { const url = ($('#feedurl') as HTMLInputElement).value.trim(); $('#feedpreview').textContent = 'checking…'; try { const r = await api.validateFeed(url); $('#feedpreview').innerHTML = `<span class="ok">OK</span> ${esc(r.title || '(untitled)')} · ${r.kind}${r.googleAlert ? ' · Google Alerts feed' : ''}<br>${r.sample.map((s: any) => `• ${esc(s.title)}`).join('<br>')}`; ($('#feedadd') as HTMLButtonElement).disabled = false; if (!($('#feedname') as HTMLInputElement).value) ($('#feedname') as HTMLInputElement).value = r.title || ''; } catch (err) { $('#feedpreview').innerHTML = `<span class="err">${esc((err as Error).message)}</span>`; } break; }
      case 'feed-add': { const url = ($('#feedurl') as HTMLInputElement).value.trim(); const w = ($('#feedwatch') as HTMLSelectElement).value; await api.createSource({ url, name: ($('#feedname') as HTMLInputElement).value.trim(), watchIds: w ? [w] : [], category: ($('#feedcat') as HTMLSelectElement).value }); banner('Feed added; polling now…', 'ok'); await reloadBoot(); await renderSources(); api.refresh().then(() => reloadBoot()).catch(() => {}); break; }
      case 'preset-add': { const p = S.presets[Number(t.dataset.i)]; await api.createSource({ url: p.url, name: p.name }); banner(`Added ${p.name}`, 'ok'); await reloadBoot(); await renderSources(); break; }
      case 'src-refresh': { t.setAttribute('disabled', ''); const r = await api.refreshSource(id); banner(r.error ? `Poll failed: ${r.error}` : `Polled: ${r.newArticles} new article${r.newArticles === 1 ? '' : 's'}`, r.error ? 'err' : 'ok'); await reloadBoot(); await renderSources(); break; }
      case 'src-toggle': { const s = sourceById(id); await api.updateSource(id, { enabled: !s.enabled }); await reloadBoot(); await renderSources(); break; }
      case 'src-delete': { const s = sourceById(id); if (confirm(`Remove source "${s.name}"? Its stored articles are removed too.`)) { await api.deleteSource(id); await reloadBoot(); await renderSources(); } break; }
    }
  } catch (err) { banner((err as Error).message, 'err'); }
});
document.addEventListener('change', async (e) => {
  const t = e.target as HTMLElement; const act = t.dataset.act; const pref = t.dataset.pref;
  try {
    if (act === 'category') go(feedPath({ category: (t as HTMLSelectElement).value }));
    else if (act === 'window') go(feedPath({ window: (t as HTMLSelectElement).value }));
    else if (act === 'source') go(feedPath({ source: (t as HTMLSelectElement).value }));
    else if (act === 'src-interval') { await api.updateSource(t.dataset.id!, { interval_sec: Number((t as HTMLSelectElement).value) }); await reloadBoot(); }
    else if (act === 'src-watch') { const v = (t as HTMLSelectElement).value; if (v) { const s = sourceById(t.dataset.id!); await api.updateSource(s.id, { watchIds: [...new Set([...(s.watch_ids || []), v])] }); await reloadBoot(); await renderSources(); banner('Feed mapped to watch', 'ok'); } }
    else if (pref) { const v = (t as HTMLInputElement).type === 'checkbox' ? (t as HTMLInputElement).checked : (t as HTMLInputElement).value; await api.updatePrefs({ [pref]: v === '' ? null : v }); await reloadBoot(); banner('Saved', 'ok', 1500); }
    else if (t.dataset.watchScope) { await api.updateWatch(t.dataset.watchScope, { notify_scope: (t as HTMLSelectElement).value }); await reloadBoot(); banner('Saved', 'ok', 1500); }
    else if (t.dataset.watchMute) { await api.updateWatch(t.dataset.watchMute, { muted: (t as HTMLInputElement).checked }); await reloadBoot(); banner('Saved', 'ok', 1500); }
  } catch (err) { banner((err as Error).message, 'err'); }
});
$('#cmd').addEventListener('submit', (e) => { e.preventDefault(); if (menuSel >= 0 && menuItems[menuSel] && !$('#cmdmenu').hidden) { menuItems[menuSel].run(); return; } const v = $('#cmdinput').value; $('#cmdinput').value = ''; hideMenu(); runCommand(v); });
$('#cmdinput').addEventListener('input', onCmdInput);
$('#cmdinput').addEventListener('keydown', (e) => { if ($('#cmdmenu').hidden) { if (e.key === 'Escape') ($('#cmdinput') as HTMLInputElement).blur(); return; } if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); menuSel = (menuSel + (e.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length; document.querySelectorAll('.cmd-item').forEach((el, i) => el.classList.toggle('sel', i === menuSel)); } else if (e.key === 'Escape') { hideMenu(); } });
$('#cmdinput').addEventListener('blur', () => setTimeout(hideMenu, 200));
$('#tzbtn').addEventListener('click', () => { S.tzMode = S.tzMode === 'utc' ? 'local' : 'utc'; localStorage.setItem('inv.tz', S.tzMode); renderTop(); render(); });
document.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
  if (inField) return;
  if (e.key === '/') { e.preventDefault(); $('#cmdinput').focus(); return; }
  if (e.key === '?') { go('help'); return; }
  if (e.key === 'Escape') { $('#detail').classList.remove('show'); if (S.route.view === 'event') go(feedPath()); return; }
  if (S.route.view !== 'feed' && S.route.view !== 'event') return;
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); selectRow(S.sel + 1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); selectRow(S.sel - 1); }
  else if (e.key === 'Enter' && S.sel >= 0) go(`event/${S.feed[S.sel].id}`);
  else if (e.key === 'o' && S.sel >= 0) { const u = S.feed[S.sel].lead_url; if (u) window.open(u, '_blank', 'noopener'); }
  else if (e.key === 'm' && S.sel >= 0) { const ev = S.feed[S.sel]; api.markRead([ev.id], !ev.read_at).then(() => { ev.read_at = ev.read_at ? null : Date.now(); renderFeed(); reloadBoot(); }); }
  else if (e.key === 'u') go(feedPath({ unread: !S.filters.unread }));
  else if (e.key === 'r') doRefresh();
});
window.addEventListener('hashchange', () => render());
window.addEventListener('resize', () => { if (S.route.view === 'feed' || S.route.view === 'event') render(); });

// ---------- boot ----------
async function boot() {
  setUnauthorizedHandler(() => { S.loginRequired = true; renderLogin(); });
  try { const a = await api.authStatus(); if (a.required && !a.authenticated) { S.loginRequired = true; renderLogin(); return; } } catch { /* fall through; bootstrap will 401 if needed */ }
  try { await reloadBoot(); } catch (e) { if ((e as ApiError).status !== 401) $('#main').innerHTML = `<div class="empty err">Cannot reach the API: ${esc((e as Error).message)}. Is the server running?</div>`; return; }
  registerSw();
  await render();
  setInterval(async () => { if (document.hidden || S.loginRequired) return; try { await reloadBoot(); if (S.route.view === 'feed' && Date.now() - S.lastRefresh > 45_000) { S.lastRefresh = Date.now(); await refreshFeed(); } } catch { /* offline */ } }, 60_000);
  window.addEventListener('online', () => banner('Back online', 'ok', 2000));
  window.addEventListener('offline', () => banner('Offline: showing cached shell; data reloads when the network returns', 'err', 6000));
}
boot();
