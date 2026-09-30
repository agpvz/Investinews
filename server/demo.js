// Offline demo providers. Enabled with DEMO=1. Generates deterministic,
// plausible-looking data so the terminal UI can be exercised without network.
import { toHeadline, mergeHeadlines } from './lib/news.js';
import { CATEGORIES, resolveCategory } from './sources/feeds.js';
import { resolveSymbol } from './sources/market.js';

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const NAMES = { AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.', AMZN: 'Amazon.com Inc.', GOOGL: 'Alphabet Inc.', META: 'Meta Platforms', JPM: 'JPMorgan Chase', XOM: 'Exxon Mobil', '^GSPC': 'S&P 500', '^DJI': 'Dow Jones Industrial Average', '^IXIC': 'NASDAQ Composite', '^RUT': 'Russell 2000', '^VIX': 'CBOE Volatility Index', '^FTSE': 'FTSE 100', '^GDAXI': 'DAX', '^N225': 'Nikkei 225', '^HSI': 'Hang Seng', '^STOXX50E': 'Euro Stoxx 50', '^FCHI': 'CAC 40', '^KS11': 'KOSPI', '^AXJO': 'S&P/ASX 200', '^BSESN': 'BSE Sensex', '^GSPTSE': 'S&P/TSX', '^BVSP': 'Ibovespa', '000001.SS': 'Shanghai Composite', 'EURUSD=X': 'EUR/USD', 'JPY=X': 'USD/JPY', 'GBPUSD=X': 'GBP/USD', 'CHF=X': 'USD/CHF', 'AUDUSD=X': 'AUD/USD', 'CAD=X': 'USD/CAD', 'CNY=X': 'USD/CNY', 'MXN=X': 'USD/MXN', 'NZDUSD=X': 'NZD/USD', 'INR=X': 'USD/INR', 'BRL=X': 'USD/BRL', 'KRW=X': 'USD/KRW', TLT: 'iShares 20+ Year Treasury ETF', IEF: 'iShares 7-10 Year Treasury ETF', SHY: 'iShares 1-3 Year Treasury ETF', LQD: 'iShares IG Corporate Bond ETF', HYG: 'iShares High Yield Bond ETF', TIP: 'iShares TIPS ETF', AMD: 'Advanced Micro Devices', PLTR: 'Palantir Technologies', SMCI: 'Super Micro Computer', COIN: 'Coinbase Global', MSTR: 'MicroStrategy', INTC: 'Intel Corp.', BA: 'Boeing Co.', NFLX: 'Netflix Inc.', DIS: 'Walt Disney Co.', '^TNX': 'US 10Y Yield', '^TYX': 'US 30Y Yield', '^FVX': 'US 5Y Yield', '^IRX': 'US 13W Bill', 'CL=F': 'WTI Crude', 'BZ=F': 'Brent Crude', 'GC=F': 'Gold', 'SI=F': 'Silver', 'NG=F': 'Natural Gas', 'HG=F': 'Copper', 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'SOL-USD': 'Solana', 'DX-Y.NYB': 'US Dollar Index' };
const BASE = { AAPL: 231.4, MSFT: 428.9, NVDA: 118.2, TSLA: 249.7, AMZN: 186.1, GOOGL: 166.4, META: 563.2, JPM: 211.5, XOM: 117.3, '^GSPC': 5721.1, '^DJI': 42313.0, '^IXIC': 18119.6, '^RUT': 2224.7, '^VIX': 16.9, '^FTSE': 8320.8, '^GDAXI': 19473.6, '^N225': 39829.6, '^HSI': 21133.7, '^STOXX50E': 5067.5, '^FCHI': 7791.8, '^KS11': 2649.8, '^AXJO': 8269.8, '^BSESN': 85571.9, '^GSPTSE': 24033.8, '^BVSP': 133074.9, '000001.SS': 3087.5, 'EURUSD=X': 1.1163, 'JPY=X': 142.21, 'GBPUSD=X': 1.3374, 'CHF=X': 0.8412, 'AUDUSD=X': 0.6895, 'CAD=X': 1.3512, 'CNY=X': 7.0113, 'MXN=X': 19.66, '^TNX': 3.757, '^TYX': 4.107, '^FVX': 3.548, '^IRX': 4.61, 'CL=F': 68.18, 'BZ=F': 71.98, 'GC=F': 2668.1, 'SI=F': 31.68, 'NG=F': 2.90, 'HG=F': 4.61, 'BTC-USD': 65634.0, 'ETH-USD': 2654.5, 'SOL-USD': 156.3, 'DX-Y.NYB': 100.38 };

const SOURCES = ['Reuters', 'Bloomberg', 'CNBC', 'MarketWatch', 'WSJ', 'Financial Times', 'Yahoo Finance', 'AP', 'Barron\'s', 'Seeking Alpha', 'Benzinga', 'The Verge'];
const TEMPLATES = [
  '{N} shares {dir} after {ev}', '{N} {ev2}, analysts weigh in', 'What {N}\'s {ev3} means for investors', '{N} to {act} amid {macro}', 'Wall Street reacts as {N} {ev2}',
  'Why {N} stock is {dir2} today', '{N} CEO says {quote}', 'Analysts raise {N} price target after {ev}', '{N} faces {risk} as {macro}', 'Breaking: {N} {ev2}',
];
const FILL = {
  dir: ['jump', 'slide', 'rally', 'dip', 'edge higher', 'tumble'], dir2: ['up', 'down', 'surging', 'falling', 'moving'],
  ev: ['earnings beat', 'guidance cut', 'new product launch', 'regulatory review', 'analyst upgrade', 'buyback announcement', 'supply-chain update'],
  ev2: ['reports record quarter', 'expands AI push', 'announces layoffs', 'raises dividend', 'unveils new strategy', 'wins major contract'],
  ev3: ['earnings call', 'restructuring', 'new roadmap', 'antitrust case'], act: ['cut costs', 'expand in Asia', 'boost capex', 'spin off unit', 'issue debt'],
  macro: ['rate uncertainty', 'tariff fears', 'strong dollar', 'slowing demand', 'AI spending boom'], quote: ['demand remains resilient', 'we see margin expansion ahead', 'the pipeline is the strongest ever'],
  risk: ['margin pressure', 'regulatory scrutiny', 'rising competition'],
};
const TOPIC_TEMPLATES = ['{T}: {sub} in focus this week', 'Investors eye {sub} as {T} markets brace for data', '{sub} debate heats up ahead of Fed decision', 'Global {T} outlook shifts as {sub} slows', 'The {sub} trade is back, {T} strategists say', 'Five charts explaining the {sub} story', '{T} sentiment hits multi-month high on {sub}', 'Opinion: the {sub} risk nobody is pricing', '{sub}: what {T} desks are watching', 'Breaking: {sub} headline moves {T} markets'];
const SUBJECTS = ['rate cuts', 'tariffs', 'AI capex', 'oil supply', 'jobs data', 'inflation', 'earnings season', 'chip demand', 'dollar strength', 'China stimulus', 'bond yields', 'housing', 'consumer spending', 'bank lending', 'EV demand', 'crypto flows', 'gold rally', 'shipping costs', 'labor strikes', 'M&A revival', 'IPO pipeline', 'buybacks', 'hedge fund positioning', 'retail traders', 'private credit', 'commercial real estate', 'defense spending', 'semiconductor exports', 'cloud growth', 'ad spending'];

function fill(tpl, name, r, topic) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k === 'N' ? name : k === 'T' ? topic : k === 'sub' ? SUBJECTS[Math.floor(r() * SUBJECTS.length)] : FILL[k][Math.floor(r() * FILL[k].length)]));
}

function genHeadlines(seed, name, n = 40, { topic, tickers = [], category = '' } = {}) {
  const r = rng(`${seed}:${Math.floor(Date.now() / 600_000)}`);
  const now = Date.now();
  const out = [];
  for (let i = 0; i < n; i++) {
    const tpl = topic ? TOPIC_TEMPLATES[Math.floor(r() * TOPIC_TEMPLATES.length)] : TEMPLATES[Math.floor(r() * TEMPLATES.length)];
    const title = fill(tpl, name, r, topic || name);
    const src = SOURCES[Math.floor(r() * SOURCES.length)];
    const ts = now - Math.floor(r() * 36 * 3600_000) - i * 90_000;
    out.push(toHeadline({ title, link: `https://example.com/${encodeURIComponent(name)}/${i}-${seed}`, ts, description: `${title}. This is demo content generated offline; run without DEMO=1 to pull live headlines from free sources.`, source: src }, { source: src, topic, tickers, category }));
  }
  return out;
}

const health = (keys) => Object.fromEntries(keys.map((k) => [k, { ok: true, n: 20 }]));

export const demoProviders = {
  async categoryNews(code) {
    const cat = resolveCategory(code);
    if (!cat) return null;
    const lists = CATEGORIES[cat].feeds.map((f) => genHeadlines(`${cat}:${f}`, CATEGORIES[cat].label, 15, { topic: CATEGORIES[cat].label, category: f }));
    return { category: cat, label: CATEGORIES[cat].label, items: mergeHeadlines(lists, 150).map((h) => ({ ...h, topic: cat })), health: health(CATEGORIES[cat].feeds) };
  },
  async searchNews(q) { return { items: genHeadlines(`q:${q}`, q, 60, { topic: q }), health: health(['google', 'bing', 'gdelt', 'reddit', 'hn']) }; },
  async tickerNews(sym, name) { const s = resolveSymbol(sym); return { items: genHeadlines(`t:${s}`, name || NAMES[s] || s, 60, { tickers: [s] }), health: health(['yahoo', 'google', 'bing', 'gdelt', 'reddit']) }; },
  async chart(sym, range = '1d') {
    const s = resolveSymbol(sym);
    const base = BASE[s] || 50 + (rng(s)() * 400);
    const r = rng(`${s}:${range}`);
    const n = { '1d': 78, '5d': 130, '1mo': 22, '3mo': 66, '6mo': 130, '1y': 252, '2y': 104, '5y': 260, max: 240 }[range] || 78;
    const step = { '1d': 5 * 60_000, '5d': 15 * 60_000, '1mo': 86400_000, '3mo': 86400_000, '6mo': 86400_000, '1y': 86400_000, '2y': 7 * 86400_000, '5y': 7 * 86400_000, max: 30 * 86400_000 }[range] || 5 * 60_000;
    const vol = s.includes('=X') ? 0.0008 : s.startsWith('^T') || s.startsWith('^I') || s.startsWith('^F') ? 0.004 : 0.006;
    let p = base * (1 - vol * 10 * (r() - 0.5));
    const now = Date.now();
    const series = [];
    for (let i = 0; i < n; i++) {
      const o = p; const c = p * (1 + (r() - 0.49) * vol * 2);
      series.push({ t: now - (n - i) * step, o, h: Math.max(o, c) * (1 + r() * vol), l: Math.min(o, c) * (1 - r() * vol), c, v: Math.floor(1e6 + r() * 5e6) });
      p = c;
    }
    const last = series[series.length - 1].c; const prev = range === '1d' ? series[0].o : series[Math.max(0, series.length - 2)].c;
    return { symbol: s, name: NAMES[s] || s, exchange: s.startsWith('^') ? 'INDEX' : s.includes('=X') ? 'CCY' : s.includes('-USD') ? 'CCC' : 'NMS', currency: 'USD', type: s.startsWith('^') ? 'INDEX' : 'EQUITY', last, prev, chg: last - prev, pct: ((last - prev) / prev) * 100, dayHigh: Math.max(...series.map((x) => x.h)), dayLow: Math.min(...series.map((x) => x.l)), volume: series.reduce((a, x) => a + x.v, 0), high52: base * 1.25, low52: base * 0.7, marketTime: now, marketState: 'REGULAR', tz: 'America/New_York', range, series };
  },
  async quotes(symbols) { return Promise.all(symbols.map(async (s) => { const { series, ...q } = await demoProviders.chart(s, '1d'); q.spark = series.map((p) => p.c); return q; })); },
  async trending() { return ['NVDA', 'TSLA', 'AAPL', 'AMD', 'PLTR', 'MSFT', 'AMZN', 'META', 'GOOGL', 'SMCI', 'COIN', 'MSTR', 'INTC', 'BA', 'NFLX', 'DIS']; },
  async findSecurity(q) { const Q = q.toUpperCase(); return Object.entries(NAMES).filter(([s, n]) => s.includes(Q) || n.toUpperCase().includes(Q)).slice(0, 10).map(([symbol, name]) => ({ symbol, name, exchange: 'DEMO', type: symbol.startsWith('^') ? 'INDEX' : 'EQUITY' })); },
  async secFilings(sym) {
    const s = sym.toUpperCase(); const r = rng(`sec:${s}`); const forms = ['8-K', '10-Q', '4', '4', '4', 'SC 13G', '10-K', 'DEF 14A', '8-K', 'S-8'];
    const filings = forms.map((form, i) => { const d = new Date(Date.now() - (i * 9 + Math.floor(r() * 5)) * 86400_000); return { form, date: d.toISOString().slice(0, 10), ts: d.getTime(), description: `${form} filing (demo)`, items: form === '8-K' ? '2.02,9.01' : '', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(NAMES[s] || s)}` }; });
    return { symbol: s, cik: '0000000000', name: NAMES[s] || s, sic: 'DEMO INDUSTRY', state: 'DE', fiscalYearEnd: '0930', website: '', filings };
  },
  async wikiSummary(name) { return { title: name, description: 'Company (demo)', extract: `${name} is a company. This description is demo placeholder text. In live mode the DES screen pulls the summary paragraph from Wikipedia and reference data from SEC EDGAR and Yahoo Finance.`, url: 'https://en.wikipedia.org' }; },
  async cryptoMarkets() { const r = rng(`crypto:${Math.floor(Date.now() / 300_000)}`); return [['BTC', 'Bitcoin', 65634], ['ETH', 'Ethereum', 2654], ['USDT', 'Tether', 1], ['BNB', 'BNB', 592], ['SOL', 'Solana', 156], ['XRP', 'XRP', 0.59], ['DOGE', 'Dogecoin', 0.12], ['ADA', 'Cardano', 0.38], ['TRX', 'TRON', 0.15], ['AVAX', 'Avalanche', 28]].map(([symbol, name, p], i) => ({ symbol, name, last: p * (1 + (r() - 0.5) * 0.04), pct1h: (r() - 0.5) * 2, pct: (r() - 0.5) * 8, pct7d: (r() - 0.5) * 20, mcap: p * 1e6 * (200 - i * 15), volume: p * 1e5 * (50 - i), high24: p * 1.03, low24: p * 0.97, spark: Array.from({ length: 40 }, () => p * (1 + (r() - 0.5) * 0.05)) })); },
  async fxRates() { return { base: 'USD', date: new Date().toISOString().slice(0, 10), rates: { EUR: 0.8958, GBP: 0.7478, JPY: 142.21, CHF: 0.8412, AUD: 1.4503, CAD: 1.3512, CNY: 7.0113, HKD: 7.79, SGD: 1.286, INR: 83.7, MXN: 19.66, BRL: 5.45, KRW: 1318, SEK: 10.16, NOK: 10.49, ZAR: 17.28, NZD: 1.585, TRY: 34.1 } }; },
  async readArticle(url) { return { url, title: 'Demo article', description: '', canonical: url, paragraphs: ['This is demo mode: article bodies are not fetched. Start the server without DEMO=1 to read live stories inside the terminal.', 'In live mode the reader fetches the page, extracts the main paragraphs, and shows them here with the original link.'] }; },
};
