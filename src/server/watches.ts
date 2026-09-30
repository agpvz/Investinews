// Resolving user input into a ticker or topic watch, and wiring the sources each watch gets.
import type { AppCtx } from './env.ts';
import type { Watch } from '../core/model.ts';
import * as repo from './repo.ts';
import { lookupSecTicker, normalizeExchange } from './adapters/sec.ts';

export const EXCHANGES: Record<string, { name: string; yahooSuffix?: string; sec?: boolean }> = {
  NASDAQ: { name: 'Nasdaq', sec: true }, NYSE: { name: 'New York Stock Exchange', sec: true }, AMEX: { name: 'NYSE American', sec: true }, CBOE: { name: 'Cboe', sec: true }, OTC: { name: 'OTC Markets', sec: true },
  JSE: { name: 'Johannesburg Stock Exchange', yahooSuffix: '.JO' }, LSE: { name: 'London Stock Exchange', yahooSuffix: '.L' }, TSX: { name: 'Toronto Stock Exchange', yahooSuffix: '.TO' }, ASX: { name: 'Australian Securities Exchange', yahooSuffix: '.AX' },
  XETRA: { name: 'Xetra', yahooSuffix: '.DE' }, EURONEXT: { name: 'Euronext', yahooSuffix: '.PA' }, SIX: { name: 'SIX Swiss Exchange', yahooSuffix: '.SW' }, HKEX: { name: 'Hong Kong Exchanges', yahooSuffix: '.HK' }, TSE: { name: 'Tokyo Stock Exchange', yahooSuffix: '.T' }, NSE: { name: 'National Stock Exchange of India', yahooSuffix: '.NS' }, BSE: { name: 'BSE India', yahooSuffix: '.BO' },
};

export interface Interpretation { kind: 'ticker' | 'topic'; symbol?: string; exchange?: string; name?: string; cik?: string; query?: string; label: string; note?: string }

export async function resolveInput(ctx: AppCtx, raw: string): Promise<{ interpretations: Interpretation[]; needsChoice: boolean; secError?: string }> {
  const q = raw.trim().replace(/\s+/g, ' ');
  const out: Interpretation[] = [];
  let secError: string | undefined;
  const m = q.match(/^([A-Za-z]{2,8})\s*:\s*([A-Za-z0-9.\-]{1,10})$/);
  if (m) {
    const exchange = m[1].toUpperCase(); const symbol = m[2].toUpperCase();
    if (!EXCHANGES[exchange]) return { interpretations: [{ kind: 'topic', query: q, label: q, note: `Unknown exchange code ${exchange}` }], needsChoice: false };
    let name: string | undefined; let cik: string | undefined;
    if (EXCHANGES[exchange].sec) {
      try { const hits = await lookupSecTicker(ctx, symbol); const hit = hits.find((h) => normalizeExchange(h.exchange) === exchange) || hits[0]; if (hit) { name = hit.name; cik = hit.cik; } } catch (e) { secError = String((e as Error).message); }
    }
    out.push({ kind: 'ticker', symbol, exchange, name, cik, label: `${exchange}:${symbol}`, note: name ? undefined : EXCHANGES[exchange].sec ? 'Not found in the SEC ticker list; SEC filings will not be available.' : 'Non-US listing: add an official IR/RSS feed for automatic ingestion.' });
    return { interpretations: out, needsChoice: false };
  }
  const bare = q.match(/^[A-Za-z]{1,6}(?:[.-][A-Za-z]{1,2})?$/);
  if (bare) {
    const symbol = q.toUpperCase();
    try {
      const hits = await lookupSecTicker(ctx, symbol);
      const byEx = new Map<string, typeof hits[number]>();
      for (const h of hits) { const ex = normalizeExchange(h.exchange); if (!byEx.has(ex)) byEx.set(ex, h); }
      for (const [ex, h] of byEx) out.push({ kind: 'ticker', symbol, exchange: ex, name: h.name, cik: h.cik, label: `${ex}:${symbol}` });
    } catch (e) { secError = String((e as Error).message); }
    out.push({ kind: 'topic', query: q, label: q, note: 'Track as a free-text topic instead of a ticker' });
    const tickerHits = out.filter((i) => i.kind === 'ticker');
    return { interpretations: out, needsChoice: tickerHits.length !== 1 || symbol.length <= 2 || /^(AI|ON|IT|GO|UP|ALL)$/.test(symbol), secError };
  }
  out.push({ kind: 'topic', query: q, label: q });
  return { interpretations: out, needsChoice: false };
}

const shortName = (name: string) => name.replace(/[,.]?\s*\b(inc|corp|corporation|co|company|ltd|limited|plc|llc|holdings?|group|sa|nv|ag|se|lp|trust|plc\.?)\b\.?$/i, '').replace(/[,.]+$/, '').trim();

export interface CreateWatchInput { kind: 'ticker' | 'topic'; symbol?: string; exchange?: string; query?: string; name?: string; cik?: string; label?: string; history_hours?: number; notify_scope?: Watch['notify_scope'] }

export async function createWatchWithSources(ctx: AppCtx, input: CreateWatchInput): Promise<{ watch: Watch; created: boolean; notes: string[] }> {
  const now = Date.now();
  const notes: string[] = [];
  const history = Math.max(0, Math.min(72, Number(input.history_hours) || 0));
  const notifyFrom = now - history * 3600_000;
  if (input.kind === 'ticker') {
    const symbol = (input.symbol || '').toUpperCase().trim(); const exchange = (input.exchange || '').toUpperCase().trim();
    if (!symbol || !exchange) throw new Error('ticker watches need symbol and exchange (e.g. NASDAQ:NVDA)');
    const existing = await repo.findWatch(ctx.db, { kind: 'ticker', exchange, symbol });
    if (existing) return { watch: existing, created: false, notes: ['already watched'] };
    let cik = input.cik; let name = input.name;
    if (!cik && EXCHANGES[exchange]?.sec) { try { const hits = await lookupSecTicker(ctx, symbol); const hit = hits.find((h) => normalizeExchange(h.exchange) === exchange) || hits[0]; if (hit) { cik = hit.cik; name = name || hit.name; } } catch (e) { notes.push(`SEC lookup failed: ${(e as Error).message}`); } }
    const identities: { kind: 'cik' | 'issuer_name' | 'alias'; value: string }[] = [];
    if (cik) identities.push({ kind: 'cik', value: cik });
    if (name) { identities.push({ kind: 'issuer_name', value: name }); const s = shortName(name); if (s && s.toLowerCase() !== name.toLowerCase() && s.length >= 3) identities.push({ kind: 'alias', value: s }); }
    const watch = await repo.createWatch(ctx.db, { kind: 'ticker', label: input.label || `${exchange}:${symbol}`, symbol, exchange, notify_from: notifyFrom, notify_scope: input.notify_scope }, identities);
    if (cik) {
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const src = (await repo.findSourceByUrl(ctx.db, 'sec_submissions', url)) || (await repo.createSource(ctx.db, { type: 'sec_submissions', name: `SEC EDGAR filings · ${symbol}`, url, interval_sec: 600, config: { cik, symbol, exchange, name } }));
      await repo.linkWatchSource(ctx.db, watch.id, src.id);
      notes.push('SEC EDGAR filings connected (official submissions API).');
    } else if (EXCHANGES[exchange]?.sec) notes.push('No SEC CIK found; SEC filings unavailable for this symbol.');
    const q = encodeURIComponent(`${symbol} ${name ? shortName(name) : ''}`.trim());
    const links: { name: string; url: string; note: string }[] = [
      { name: `Google News · ${symbol}`, url: `https://news.google.com/search?q=${q}`, note: 'External link only. Google News has no permitted machine-readable API for this use; create a Google Alert (RSS) to ingest automatically.' },
      { name: `Yahoo Finance · ${symbol}`, url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol + (EXCHANGES[exchange]?.yahooSuffix || ''))}/news`, note: 'External link only. Unofficial Yahoo endpoints are not used.' },
    ];
    if (exchange === 'JSE') links.push({ name: `JSE SENS · ${symbol}`, url: 'https://clientportal.jse.co.za/communication/sens-announcements', note: 'External link only: automatic SENS ingestion unavailable (JSE data terms). Add the issuer\'s official RSS feed if it publishes one, or plug in a licensed SENS distributor adapter.' });
    for (const l of links) { const src = (await repo.findSourceByUrl(ctx.db, 'link', l.url)) || (await repo.createSource(ctx.db, { type: 'link', name: l.name, url: l.url, config: { note: l.note, symbol, exchange } })); await repo.linkWatchSource(ctx.db, watch.id, src.id); }
    if (!EXCHANGES[exchange]?.sec) notes.push('Non-US listing: attach an official investor-relations RSS/Atom feed or a Google Alert RSS to get automatic headlines.');
    return { watch, created: true, notes };
  }
  const query = (input.query || '').trim();
  if (!query) throw new Error('topic watches need a query');
  const existing = await repo.findWatch(ctx.db, { kind: 'topic', query });
  if (existing) return { watch: existing, created: false, notes: ['already watched'] };
  const watch = await repo.createWatch(ctx.db, { kind: 'topic', label: input.label || query, query, notify_from: notifyFrom, notify_scope: input.notify_scope });
  const url = `https://news.google.com/search?q=${encodeURIComponent(query)}`;
  const src = (await repo.findSourceByUrl(ctx.db, 'link', url)) || (await repo.createSource(ctx.db, { type: 'link', name: `Google News · ${query}`, url, config: { note: 'External link only. To ingest automatically: create a Google Alert for this topic with RSS delivery and paste the feed URL into this watch.', query } }));
  await repo.linkWatchSource(ctx.db, watch.id, src.id);
  notes.push('Topic saved. Add a Google Alert RSS feed (one-time manual step) or any RSS/Atom feed to ingest headlines automatically; other enabled feeds are matched by keyword.');
  return { watch, created: true, notes };
}

export const PUBLISHER_PRESETS = [
  { name: 'SEC EDGAR · latest 8-K filings (all issuers)', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom&count=100', note: 'Official SEC Atom feed of current 8-K filings; matched to your tickers by issuer name.' },
  { name: 'Federal Reserve · press releases', url: 'https://www.federalreserve.gov/feeds/press_all.xml', note: 'Official Federal Reserve RSS.' },
  { name: 'Bank of England · news', url: 'https://www.bankofengland.co.uk/rss/news', note: 'Official BoE RSS.' },
  { name: 'ECB · press releases', url: 'https://www.ecb.europa.eu/rss/press.html', note: 'Official ECB RSS.' },
  { name: 'BLS · latest releases', url: 'https://www.bls.gov/feed/bls_latest.rss', note: 'Official US Bureau of Labor Statistics RSS.' },
  { name: 'CNBC · top news', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', note: 'Publisher RSS (headlines + links). Check the publisher\'s terms for your use.' },
  { name: 'MarketWatch · top stories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', note: 'Publisher RSS (headlines + links).' },
  { name: 'BBC · business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', note: 'Publisher RSS (headlines + links).' },
  { name: 'Moneyweb · South Africa', url: 'https://www.moneyweb.co.za/feed/', note: 'Publisher RSS (headlines + links); useful for JSE-listed companies.' },
];
