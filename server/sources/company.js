// Company reference data: SEC EDGAR filings and Wikipedia descriptions.
import { getJSON, SEC_UA } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { stripHtml } from '../lib/rss.js';

const enc = encodeURIComponent;
const secHeaders = { 'User-Agent': SEC_UA, 'Accept-Encoding': 'gzip, deflate' };

export async function secTickerMap() {
  return cached('sec:tickers', 24 * 3600_000, async () => {
    const data = await getJSON('https://www.sec.gov/files/company_tickers.json', { headers: secHeaders, ua: SEC_UA, timeout: 15_000 });
    const map = {};
    for (const row of Object.values(data)) map[String(row.ticker).toUpperCase()] = { cik: String(row.cik_str).padStart(10, '0'), name: row.title };
    return map;
  });
}

export async function secFilings(symbol, limit = 40) {
  const sym = symbol.toUpperCase().replace(/[-.].*$/, '');
  const map = await secTickerMap();
  const ent = map[sym];
  if (!ent) return { symbol: sym, filings: [], name: '' };
  return cached(`sec:filings:${ent.cik}`, 600_000, async () => {
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${ent.cik}.json`, { headers: secHeaders, ua: SEC_UA, timeout: 15_000 });
    const r = sub.filings?.recent || {};
    const n = Math.min(limit, (r.accessionNumber || []).length);
    const filings = [];
    for (let i = 0; i < n; i++) {
      const acc = r.accessionNumber[i];
      const accNoDash = acc.replace(/-/g, '');
      const doc = r.primaryDocument?.[i] || '';
      filings.push({
        form: r.form[i],
        date: r.filingDate[i],
        ts: Date.parse(r.filingDate[i]) || 0,
        description: r.primaryDocDescription?.[i] || '',
        items: r.items?.[i] || '',
        url: doc ? `https://www.sec.gov/Archives/edgar/data/${Number(ent.cik)}/${accNoDash}/${doc}` : `https://www.sec.gov/Archives/edgar/data/${Number(ent.cik)}/${accNoDash}/`,
      });
    }
    return { symbol: sym, cik: ent.cik, name: sub.name || ent.name, sic: sub.sicDescription || '', state: sub.stateOfIncorporation || '', fiscalYearEnd: sub.fiscalYearEnd || '', website: sub.website || '', filings };
  });
}

export async function wikiSummary(name) {
  if (!name) return null;
  return cached(`wiki:${name}`, 24 * 3600_000, async () => {
    const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(name)}&format=json&srlimit=1&origin=*`);
    const title = s?.query?.search?.[0]?.title;
    if (!title) return null;
    const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, '_'))}`);
    return { title: sum.title, description: sum.description || '', extract: stripHtml(sum.extract || ''), url: sum.content_urls?.desktop?.page || '' };
  });
}
