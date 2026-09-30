// SEC EDGAR: official submissions API (data.sec.gov) and the public ticker/exchange mapping.
// Fair access: declared User-Agent, <10 req/s (we serialize with 200ms spacing), cached ticker map, ETag.
import type { Adapter } from './types.ts';
import type { FetchResult, NormalizedItem, Source } from '../../core/model.ts';
import type { AppCtx } from '../env.ts';
import { safeFetch, FetchError } from '../fetch.ts';
import { safeJson } from './types.ts';

const TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;
export const SEC_MIN_SPACING_MS = 200; // 5 req/s ceiling, well under SEC's 10 req/s guidance

let lastRequestAt = 0;
async function secPace(): Promise<void> {
  const wait = lastRequestAt + SEC_MIN_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface SecCompany { cik: string; name: string; ticker: string; exchange: string }
let tickerCache: { at: number; byTicker: Map<string, SecCompany[]> } | null = null;

export async function secTickerMap(ctx: AppCtx, force = false): Promise<Map<string, SecCompany[]>> {
  if (!force && tickerCache && Date.now() - tickerCache.at < 24 * 3600_000) return tickerCache.byTicker;
  await secPace();
  const res = await safeFetch(TICKER_MAP_URL, { headers: { 'User-Agent': ctx.cfg.secUserAgent, Accept: 'application/json' }, maxBytes: 8_000_000, timeoutMs: 20_000 });
  if (res.status !== 200) throw new FetchError(`SEC ticker map HTTP ${res.status}`, res.status);
  const json = JSON.parse(res.text) as { fields: string[]; data: unknown[][] };
  const idx = Object.fromEntries(json.fields.map((f, i) => [f, i]));
  const byTicker = new Map<string, SecCompany[]>();
  for (const row of json.data) {
    const c: SecCompany = { cik: String(row[idx.cik]).padStart(10, '0'), name: String(row[idx.name]), ticker: String(row[idx.ticker]).toUpperCase(), exchange: String(row[idx.exchange] || '').toUpperCase() };
    const list = byTicker.get(c.ticker) || []; list.push(c); byTicker.set(c.ticker, list);
  }
  tickerCache = { at: Date.now(), byTicker };
  return byTicker;
}

export async function lookupSecTicker(ctx: AppCtx, ticker: string): Promise<SecCompany[]> {
  const map = await secTickerMap(ctx);
  return map.get(ticker.toUpperCase().replace(/\./g, '-')) || map.get(ticker.toUpperCase()) || [];
}

/** Map SEC exchange labels to the exchange codes used in watches. */
export function normalizeExchange(ex: string): string {
  const e = ex.toUpperCase();
  if (e === 'NASDAQ') return 'NASDAQ';
  if (e === 'NYSE') return 'NYSE';
  if (e === 'CBOE') return 'CBOE';
  if (e === 'OTC') return 'OTC';
  return e || 'US';
}

export const secAdapter: Adapter = {
  type: 'sec_submissions',
  async fetch(ctx: AppCtx, source: Source): Promise<FetchResult> {
    const cfg = safeJson(source.config);
    const cik: string = String(cfg.cik || '').padStart(10, '0');
    if (!/^\d{10}$/.test(cik)) throw new FetchError('SEC source has no CIK configured');
    await secPace();
    const headers: Record<string, string> = { 'User-Agent': ctx.cfg.secUserAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' };
    if (source.etag) headers['If-None-Match'] = source.etag;
    const res = await safeFetch(SUBMISSIONS_URL(cik), { headers, maxBytes: 6_000_000, timeoutMs: 20_000 });
    if (res.status === 304) return { items: [], notModified: true, etag: source.etag };
    if (res.status === 429 || res.status === 403) throw new FetchError(`SEC responded HTTP ${res.status} (rate limited or blocked; check SEC_USER_AGENT and fair-access limits)`, res.status);
    if (res.status !== 200) throw new FetchError(`SEC submissions HTTP ${res.status}`, res.status);
    const sub = JSON.parse(res.text);
    const r = sub?.filings?.recent || {};
    const n = Math.min(Number(cfg.maxItems) || 40, (r.accessionNumber || []).length);
    const name: string = sub.name || cfg.name || '';
    const cikNum = String(Number(cik));
    const items: NormalizedItem[] = [];
    for (let i = 0; i < n; i++) {
      const acc: string = r.accessionNumber[i];
      const accNoDash = acc.replace(/-/g, '');
      const form: string = r.form[i];
      const doc: string = r.primaryDocument?.[i] || '';
      const desc: string = r.primaryDocDescription?.[i] || '';
      const itemsCodes: string = r.items?.[i] || '';
      const accepted = r.acceptanceDateTime?.[i] ? Date.parse(r.acceptanceDateTime[i]) : NaN;
      const filed = r.filingDate?.[i] ? Date.parse(`${r.filingDate[i]}T00:00:00Z`) : NaN;
      const url = doc ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${doc}` : `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${acc}-index.htm`;
      items.push({
        sourceItemId: acc, url, publisher: 'SEC EDGAR',
        headline: `${form}: ${name}${desc && desc.toUpperCase() !== form ? ` — ${desc}` : ''}${itemsCodes ? ` (Items ${itemsCodes})` : ''}`,
        description: `Form ${form} filed ${r.filingDate?.[i] || ''}${r.reportDate?.[i] ? `, period ${r.reportDate[i]}` : ''}. Accession ${acc}.`,
        publishedAt: Number.isFinite(accepted) ? accepted : Number.isFinite(filed) ? filed : null,
        category: 'filing', eventType: form, filingAccession: acc, filingForm: form,
        symbol: cfg.symbol || null, exchange: cfg.exchange || null,
        raw: { accession: acc, form, filingDate: r.filingDate?.[i], reportDate: r.reportDate?.[i], items: itemsCodes, size: r.size?.[i], indexUrl: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${acc}-index.htm`, cik },
      });
    }
    return { items, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  },
};
