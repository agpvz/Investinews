import express from 'express';
import { categoryNews as liveCategoryNews, CATEGORIES, resolveCategory } from './sources/feeds.js';
import { searchNews as liveSearch, tickerNews as liveTickerNews } from './sources/search.js';
import { chart as liveChart, quotes as liveQuotes, trending as liveTrending, findSecurity as liveFind, resolveSymbol } from './sources/market.js';
import { secFilings as liveSec, wikiSummary as liveWiki } from './sources/company.js';
import { cryptoMarkets as liveCrypto, fxRates as liveFx } from './sources/misc.js';
import { readArticle as liveArticle } from './lib/article.js';
import { demoProviders } from './demo.js';
import { loadSettings, saveSettings } from './settings.js';
import { cacheStats } from './lib/cache.js';
import { mergeHeadlines } from './lib/news.js';

const DEMO = /^(1|true|yes)$/i.test(process.env.DEMO || '');

const P = DEMO
  ? demoProviders
  : { categoryNews: liveCategoryNews, searchNews: liveSearch, tickerNews: liveTickerNews, chart: liveChart, quotes: liveQuotes, trending: liveTrending, findSecurity: liveFind, secFilings: liveSec, wikiSummary: liveWiki, cryptoMarkets: liveCrypto, fxRates: liveFx, readArticle: liveArticle };

export { DEMO };

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => { res.status(err.status || 502).json({ error: String(err.message || err) }); });
const listParam = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);

async function nameFor(symbol) {
  try { const q = await P.chart(symbol, '1d'); return { name: q.name, quote: q }; } catch { return { name: '', quote: null }; }
}

export function buildRouter() {
  const r = express.Router();

  r.get('/health', (_req, res) => res.json({ ok: true, demo: DEMO, cache: cacheStats(), time: Date.now() }));
  r.get('/categories', (_req, res) => res.json(Object.entries(CATEGORIES).map(([code, c]) => ({ code, label: c.label, feeds: c.feeds.length }))));

  r.get('/top', wrap(async (req, res) => {
    const cat = resolveCategory(req.query.cat || 'TOP') || 'TOP';
    res.json(await P.categoryNews(cat));
  }));

  r.get('/news', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 120);
    const ticker = String(req.query.ticker || '').trim().slice(0, 20);
    const topic = String(req.query.topic || '').trim().slice(0, 60);
    if (ticker) {
      const sym = resolveSymbol(ticker);
      const { name, quote } = await nameFor(sym);
      const out = await P.tickerNews(sym, name);
      const { series, ...q2 } = quote || {};
      return res.json({ kind: 'ticker', symbol: sym, name, quote: quote ? q2 : null, ...out });
    }
    if (topic) {
      const cat = resolveCategory(topic);
      if (cat) return res.json({ kind: 'category', ...(await P.categoryNews(cat)) });
      const out = await P.searchNews(topic);
      return res.json({ kind: 'topic', topic, items: out.items.map((h) => ({ ...h, topic })), health: out.health });
    }
    if (!q) return res.status(400).json({ error: 'q, ticker or topic required' });
    res.json({ kind: 'search', q, ...(await P.searchNews(q)) });
  }));

  // Merged "my news" for a set of saved tickers and topics.
  r.get('/mynews', wrap(async (req, res) => {
    const tickers = listParam(req.query.tickers).map(resolveSymbol);
    const topics = listParam(req.query.topics);
    const jobs = [
      ...tickers.map(async (t) => { const { name } = await nameFor(t); const o = await P.tickerNews(t, name); return { key: t, items: o.items.slice(0, 40), health: o.health }; }),
      ...topics.map(async (tp) => { const cat = resolveCategory(tp); const o = cat ? await P.categoryNews(cat) : await P.searchNews(tp); return { key: tp, items: o.items.slice(0, 40).map((h) => ({ ...h, topic: tp })), health: o.health }; }),
    ];
    const settled = await Promise.allSettled(jobs);
    const groups = {}; const health = {};
    for (const s of settled) {
      if (s.status === 'fulfilled') { groups[s.value.key] = s.value.items; health[s.value.key] = { ok: true, n: s.value.items.length }; }
      else health[String(s.reason?.key || 'job')] = { ok: false, error: String(s.reason?.message || s.reason).slice(0, 120) };
    }
    res.json({ items: mergeHeadlines(Object.values(groups), 250), groups, health });
  }));

  r.get('/quotes', wrap(async (req, res) => {
    const syms = listParam(req.query.symbols);
    if (!syms.length) return res.json([]);
    res.json(await P.quotes(syms));
  }));

  r.get('/chart', wrap(async (req, res) => {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const range = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'].includes(req.query.range) ? req.query.range : '1d';
    res.json(await P.chart(symbol, range, req.query.interval ? String(req.query.interval) : undefined));
  }));

  r.get('/des', wrap(async (req, res) => {
    const symbol = resolveSymbol(String(req.query.symbol || ''));
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const [chartRes, secRes] = await Promise.allSettled([P.chart(symbol, '1y'), P.secFilings(symbol)]);
    const quote = chartRes.status === 'fulfilled' ? chartRes.value : null;
    const sec = secRes.status === 'fulfilled' ? secRes.value : null;
    const name = sec?.name || quote?.name || symbol;
    const wiki = await P.wikiSummary(quote?.name || sec?.name || symbol.replace(/[-=.^].*$/, '')).catch(() => null);
    const series = quote?.series || [];
    const ytdStart = series.find((p) => new Date(p.t).getFullYear() === new Date().getFullYear());
    const { series: _s, ...q } = quote || {};
    res.json({ symbol, name, quote: quote ? { ...q, ytdPct: ytdStart && q.last ? ((q.last - ytdStart.c) / ytdStart.c) * 100 : null, yearSpark: series.map((p) => p.c) } : null, sec: sec ? { cik: sec.cik, sic: sec.sic, state: sec.state, fiscalYearEnd: sec.fiscalYearEnd, website: sec.website, recent: sec.filings.slice(0, 6) } : null, wiki });
  }));

  r.get('/filings', wrap(async (req, res) => {
    const symbol = resolveSymbol(String(req.query.symbol || ''));
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    res.json(await P.secFilings(symbol));
  }));

  r.get('/trending', wrap(async (req, res) => {
    const syms = await P.trending(String(req.query.region || 'US'));
    res.json({ symbols: syms, quotes: await P.quotes(syms.slice(0, 20)) });
  }));

  r.get('/search-security', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!q) return res.json([]);
    res.json(await P.findSecurity(q));
  }));

  r.get('/crypto', wrap(async (_req, res) => res.json(await P.cryptoMarkets())));
  r.get('/fx', wrap(async (req, res) => res.json(await P.fxRates(String(req.query.base || 'USD').toUpperCase().slice(0, 3)))));

  r.get('/article', wrap(async (req, res) => {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ error: 'url required' });
    res.json(await P.readArticle(url));
  }));

  r.get('/settings', wrap(async (_req, res) => res.json(await loadSettings())));
  r.put('/settings', wrap(async (req, res) => res.json(await saveSettings(req.body || {}))));

  return r;
}
