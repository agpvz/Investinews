import { createHash } from 'node:crypto';

const SOURCE_ALIASES = [
  [/reuters/i, 'RTRS'], [/bloomberg/i, 'BBG'], [/cnbc/i, 'CNBC'], [/marketwatch/i, 'MW'], [/wall street journal|wsj/i, 'WSJ'],
  [/financial times|ft\.com/i, 'FT'], [/yahoo/i, 'YHOO'], [/bbc/i, 'BBC'], [/associated press|apnews|\bAP\b/i, 'AP'],
  [/new york times|nytimes/i, 'NYT'], [/barron/i, 'BARR'], [/seeking ?alpha/i, 'SA'], [/motley fool/i, 'FOOL'],
  [/benzinga/i, 'BZ'], [/investing\.com/i, 'INV'], [/techcrunch/i, 'TC'], [/the verge/i, 'VERGE'], [/ars ?technica/i, 'ARS'],
  [/coindesk/i, 'CDSK'], [/cointelegraph/i, 'CTEL'], [/politico/i, 'POL'], [/federal reserve/i, 'FED'], [/european central bank|ecb/i, 'ECB'],
  [/bank of england/i, 'BOE'], [/bureau of labor|bls/i, 'BLS'], [/bureau of economic|bea/i, 'BEA'], [/sec\.gov|edgar/i, 'SEC'],
  [/reddit/i, 'RDDT'], [/hacker ?news/i, 'HN'], [/pr ?newswire/i, 'PRN'], [/business ?wire/i, 'BW'], [/globe ?newswire/i, 'GNW'],
  [/nikkei/i, 'NIKK'], [/south china morning|scmp/i, 'SCMP'], [/oilprice/i, 'OILP'], [/guardian/i, 'GRDN'], [/forbes/i, 'FRBS'],
  [/fortune/i, 'FRTN'], [/business insider/i, 'BI'], [/the economist/i, 'ECON'], [/investor'?s business daily|ibd/i, 'IBD'], [/zacks/i, 'ZACK'],
  [/tipranks/i, 'TIPR'], [/gdelt/i, 'GDLT'], [/google/i, 'GOOG'], [/bing/i, 'BING'],
];

export function shortSource(name = '', url = '') {
  const n = name || domainOf(url);
  for (const [re, code] of SOURCE_ALIASES) if (re.test(n)) return code;
  const clean = n.replace(/^www\./i, '').replace(/\.(com|net|org|co\.uk|io)$/i, '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return 'WEB';
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 5).toUpperCase();
}

export function domainOf(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function normTitle(t = '') {
  return t.toLowerCase().replace(/\s+-\s+[^-]{2,40}$/, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function makeId(item) {
  const basis = item.url || normTitle(item.headline);
  return createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

/** Convert a parsed feed item into the terminal's canonical headline shape. */
export function toHeadline(fi, { source, topic, tickers = [], category } = {}) {
  let headline = fi.title || '';
  let src = source || fi.source || '';
  // Google News style "Headline - Publisher"
  const m = headline.match(/^(.*)\s+-\s+([^-]{2,40})$/);
  if (m && !fi.source && !source) { headline = m[1]; src = m[2]; }
  if (m && fi.source && m[2].trim().toLowerCase() === fi.source.trim().toLowerCase()) headline = m[1];
  const url = fi.link || '';
  const h = {
    headline: headline.trim(),
    url,
    ts: fi.ts || Date.now(),
    source: shortSource(src, url),
    sourceName: src || domainOf(url),
    summary: (fi.description || '').slice(0, 600),
    tickers: [...tickers],
    topic: topic || '',
    category: category || '',
  };
  h.id = makeId(h);
  return h;
}

export function dedupe(items) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const it of items) {
    if (!it.headline) continue;
    const u = (it.url || '').replace(/[?#].*$/, '');
    const t = normTitle(it.headline).slice(0, 70);
    if (u && seenUrl.has(u)) continue;
    if (t && seenTitle.has(t)) continue;
    if (u) seenUrl.add(u);
    if (t) seenTitle.add(t);
    out.push(it);
  }
  return out;
}

export function sortByTime(items) {
  return [...items].sort((a, b) => b.ts - a.ts);
}

export function mergeHeadlines(lists, limit = 200) {
  return sortByTime(dedupe(lists.flat())).slice(0, limit);
}
