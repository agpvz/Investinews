// Free news search providers used for ticker / topic queries.
import { getText, getJSON, settleAll } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseFeed } from '../lib/rss.js';
import { toHeadline, mergeHeadlines, domainOf } from '../lib/news.js';

const enc = encodeURIComponent;

export async function googleNews(q) {
  return cached(`gn:${q}`, 60_000, async () => {
    const xml = await getText(`https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`);
    return parseFeed(xml).items.map((it) => toHeadline(it));
  });
}

export async function bingNews(q) {
  return cached(`bing:${q}`, 60_000, async () => {
    const xml = await getText(`https://www.bing.com/news/search?q=${enc(q)}&format=rss`);
    return parseFeed(xml).items.map((it) => toHeadline(it));
  });
}

export async function yahooTickerNews(symbol) {
  return cached(`ynews:${symbol}`, 60_000, async () => {
    const xml = await getText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${enc(symbol)}&region=US&lang=en-US`);
    return parseFeed(xml).items.map((it) => toHeadline(it, { source: it.source || domainOf(it.link) || 'Yahoo Finance', tickers: [symbol] }));
  });
}

export async function gdelt(q) {
  return cached(`gdelt:${q}`, 120_000, async () => {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(`${q} sourcelang:english`)}&mode=artlist&format=json&maxrecords=50&timespan=3d&sort=datedesc`;
    const txt = await getText(url);
    let data;
    try { data = JSON.parse(txt); } catch { return []; }
    return (data.articles || []).map((a) => {
      const d = a.seendate || '';
      const ts = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
      return toHeadline({ title: a.title, link: a.url, ts: Number.isFinite(ts) ? ts : Date.now(), description: '', source: a.domain }, { source: a.domain });
    });
  });
}

export async function reddit(q) {
  return cached(`reddit:${q}`, 120_000, async () => {
    const xml = await getText(`https://www.reddit.com/search.rss?q=${enc(q)}&sort=new&t=week`, { ua: 'investinews:terminal:1.0 (open source news reader)' });
    return parseFeed(xml).items.map((it) => toHeadline(it, { source: 'Reddit' }));
  });
}

export async function hackerNews(q) {
  return cached(`hn:${q}`, 120_000, async () => {
    const data = await getJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${enc(q)}&tags=story&hitsPerPage=20`);
    return (data.hits || []).map((h) =>
      toHeadline({ title: h.title, link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, ts: Date.parse(h.created_at), description: `${h.points || 0} points, ${h.num_comments || 0} comments` }, { source: 'Hacker News' })
    );
  });
}

/** Free-text / topic search across providers. */
export async function searchNews(q, { social = true, limit = 150 } = {}) {
  const jobs = { google: () => googleNews(q), bing: () => bingNews(q), gdelt: () => gdelt(q) };
  if (social) { jobs.reddit = () => reddit(q); jobs.hn = () => hackerNews(q); }
  const { items, health } = await settleAll(jobs);
  return { items: mergeHeadlines([items], limit), health };
}

/** Ticker-focused news: Yahoo ticker feed + searches on the symbol and company name. */
export async function tickerNews(symbol, name, { limit = 150 } = {}) {
  const sym = symbol.toUpperCase();
  const base = sym.replace(/[-=.^].*$/, '');
  const q = name ? `"${name}" OR ${base} stock` : `${base} stock`;
  const jobs = {
    yahoo: () => yahooTickerNews(sym),
    google: () => googleNews(q),
    bing: () => bingNews(name ? `${name} ${base}` : `${base} stock`),
    gdelt: () => gdelt(name ? `"${name}"` : `"${base}"`),
    reddit: () => reddit(base),
  };
  const { items, health } = await settleAll(jobs);
  const tagged = items.map((h) => ({ ...h, tickers: h.tickers.includes(sym) ? h.tickers : [sym, ...h.tickers] }));
  return { items: mergeHeadlines([tagged], limit), health };
}
