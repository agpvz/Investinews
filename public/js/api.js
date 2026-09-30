const cache = new Map();
async function get(path, params = {}, { ttl = 0 } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ''}`;
  const hit = cache.get(url);
  if (ttl && hit && Date.now() - hit.ts < ttl) return hit.value;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  if (ttl) cache.set(url, { value: body, ts: Date.now() });
  return body;
}
export const api = {
  health: () => get('health'),
  top: (cat) => get('top', { cat }),
  news: (p) => get('news', p),
  myNews: (tickers, topics) => get('mynews', { tickers: tickers.join(','), topics: topics.join(',') }),
  quotes: (symbols) => get('quotes', { symbols: symbols.join(',') }),
  chart: (symbol, range, interval) => get('chart', { symbol, range, interval }),
  des: (symbol) => get('des', { symbol }, { ttl: 60_000 }),
  filings: (symbol) => get('filings', { symbol }, { ttl: 300_000 }),
  trending: () => get('trending'),
  findSecurity: (q) => get('search-security', { q }, { ttl: 600_000 }),
  crypto: () => get('crypto'),
  fx: (base) => get('fx', { base }, { ttl: 300_000 }),
  article: (url) => get('article', { url }, { ttl: 900_000 }),
  getSettings: () => get('settings'),
  saveSettings: async (s) => { const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }); return r.json(); },
};
