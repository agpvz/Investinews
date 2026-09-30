// Screen factories. Each returns { key, cmd, title, subtitle, refreshMs, toolbar, load(), render(el), items[] }.
import { api } from './api.js';
import { fmtNum, fmtChg, fmtPct, fmtVol, fmtTime, fmtDateTime, ago, esc, cls, priceDp } from './format.js';
import { drawChart, drawSpark } from './chart.js';
import { FUNCTIONS, SECURITY_FUNCTIONS } from './command.js';

export const TOPIC_EXPAND = {
  AI: 'artificial intelligence', EV: 'electric vehicles', SEMI: 'semiconductors', CHIPS: 'semiconductor chips', RATES: 'interest rates', INFL: 'inflation', JOBS: 'jobs report employment', HOUSING: 'housing market',
  CHINA: 'China economy', JAPAN: 'Japan economy', INDIA: 'India economy markets', UK: 'UK economy', GOLD: 'gold prices', OIL: 'oil prices', GAS: 'natural gas prices', PHARMA: 'pharmaceutical', BIO: 'biotech', AUTO: 'automakers',
  RETAIL: 'retail sales', AIRLINE: 'airlines', DEFENSE: 'defense contractors', TRADE: 'tariffs trade', TARIFF: 'tariffs', CLIMATE: 'climate policy', ESG: 'ESG investing', PE: 'private equity', HEDGE: 'hedge funds',
  ETF: 'ETF flows', OPTIONS: 'options trading', BONDS: 'bond market', MUNI: 'municipal bonds', FX: 'currency markets forex', EM: 'emerging markets', LATAM: 'Latin America economy', AFRICA: 'Africa economy', MIDEAST: 'Middle East',
  GEOPOL: 'geopolitics', RECESSION: 'recession', DEBT: 'debt ceiling deficit', TSY: 'Treasury yields', BANK: 'banks', CREDIT: 'credit markets', MORTGAGE: 'mortgage rates', SPACE: 'space industry', CLOUD: 'cloud computing',
  CYBER: 'cybersecurity', ROBOT: 'robotics', QUANTUM: 'quantum computing', LITHIUM: 'lithium', URANIUM: 'uranium', COPPER: 'copper prices', WHEAT: 'wheat prices', SHIPPING: 'shipping freight', HOTEL: 'hotels travel',
  GAMING: 'video games', MEDIA: 'media companies', STREAMING: 'streaming', ADS: 'advertising', LUXURY: 'luxury goods', FOOD: 'food prices', SOLAR: 'solar energy', WIND: 'wind energy', NUKE: 'nuclear energy', HYDROGEN: 'hydrogen',
  BATTERY: 'batteries', TAX: 'tax policy', ELECTION: 'election markets', FEDSPEAK: 'Federal Reserve officials', ECB: 'European Central Bank', BOJ: 'Bank of Japan', BOE: 'Bank of England', OPEC: 'OPEC', SPAC: 'SPAC', DIV: 'dividends', BUYBACK: 'share buybacks', SHORT: 'short sellers', ACTIVIST: 'activist investor', LAYOFF: 'layoffs', STRIKE: 'labor strike', UNION: 'labor union',
};
const TOPIC_CATS = ['TOP', 'MKT', 'ECO', 'CEN', 'TECH', 'ENR', 'CRYPTO', 'POL', 'WLD', 'ASIA', 'EUR', 'EARN', 'CORP', 'MNA', 'IPO', 'FIN', 'HLTH', 'REAL'];
const CAT_LABEL = { TOP: 'Top News', MKT: 'Markets', ECO: 'Economy', CEN: 'Central Banks', TECH: 'Technology', ENR: 'Energy & Commodities', CRYPTO: 'Crypto', POL: 'Politics', WLD: 'World', ASIA: 'Asia', EUR: 'Europe', EARN: 'Earnings', CORP: 'Corporate Releases', MNA: 'M&A', IPO: 'IPOs', FIN: 'Financials', HLTH: 'Health Care', REAL: 'Real Estate' };
const CAT_ALIAS = { N: 'TOP', NEWS: 'TOP', MARKETS: 'MKT', MARKET: 'MKT', ECON: 'ECO', ECONOMY: 'ECO', FED: 'CEN', CB: 'CEN', TECHNOLOGY: 'TECH', ENERGY: 'ENR', CMD: 'ENR', COMMODITIES: 'ENR', CRYP: 'CRYPTO', POLITICS: 'POL', WORLD: 'WLD', EUROPE: 'EUR', EARNINGS: 'EARN', PR: 'CORP', WIRE: 'CORP', 'M&A': 'MNA', MA: 'MNA', BANKS: 'FIN', HEALTH: 'HLTH', ESTATE: 'REAL' };
export const catOf = (code = '') => { const c = code.toUpperCase(); return CAT_LABEL[c] ? c : CAT_ALIAS[c] || null; };

// ---------- shared renderers ----------
const healthLine = (h = {}) => { const e = Object.entries(h); const ok = e.filter(([, v]) => v.ok).length; return e.length ? `<span class="${ok === e.length ? 'ok' : ok ? 'warn' : 'err'}">sources ${ok}/${e.length}</span>` : ''; };

export function headlineRows(items, { start = 1, showTicker = true, showTopic = true, readSet, newSet } = {}) {
  if (!items?.length) return '<div class="empty">NO HEADLINES. Sources may be unreachable, or nothing matched.</div>';
  return items.map((h, i) => {
    const n = start + i; const isNew = newSet?.has(h.id); const isRead = readSet?.has(h.id);
    const tk = showTicker && h.tickers?.length ? `<span class="tk">${esc(h.tickers.slice(0, 3).join(' '))}</span>` : showTopic && h.topic ? `<span class="tk topic">${esc(String(h.topic).toUpperCase().slice(0, 12))}</span>` : '';
    return `<div class="row hl${isNew ? ' new' : ''}${isRead ? ' read' : ''}" data-n="${n}" data-id="${esc(h.id)}" title="${esc(h.sourceName || '')} — ${fmtDateTime(h.ts)}"><span class="n">${n})</span><span class="t">${fmtTime(h.ts)}</span><span class="src">${esc(h.source)}</span><span class="h">${esc(h.headline)}</span>${isNew ? '<span class="newtag">NEW</span>' : ''}${tk}</div>`;
  }).join('');
}

export function quoteBox(q, { compact = false } = {}) {
  if (!q || q.error) return `<div class="qbox err">QUOTE UNAVAILABLE${q?.error ? ` (${esc(q.error)})` : ''}</div>`;
  const dp = priceDp(q.symbol, q.last); const c = cls(q.chg);
  const main = `<span class="sym">${esc(q.symbol)}</span> <span class="nm">${esc(q.name || '')}</span> <span class="ex">${esc(q.exchange || '')}${q.currency ? ' ' + esc(q.currency) : ''}</span>
    <span class="px ${c}">${fmtNum(q.last, dp)}</span> <span class="chg ${c}">${fmtChg(q.chg, dp)} (${fmtPct(q.pct)})</span>`;
  if (compact) return `<div class="qbox compact">${main}</div>`;
  return `<div class="qbox">${main}<div class="qmeta">
    <span>PREV <b>${fmtNum(q.prev, dp)}</b></span><span>DAY RNG <b>${fmtNum(q.dayLow, dp)} – ${fmtNum(q.dayHigh, dp)}</b></span><span>52W <b>${fmtNum(q.low52, dp)} – ${fmtNum(q.high52, dp)}</b></span><span>VOL <b>${fmtVol(q.volume)}</b></span><span>${esc(q.marketState || '')} ${q.marketTime ? fmtTime(q.marketTime) : ''}</span></div></div>`;
}

const tabsHtml = (tabs) => `<div class="tabs">${tabs.map((t) => `<span class="tab${t.active ? ' active' : ''}" data-cmd="${esc(t.cmd)}">${esc(t.label)}</span>`).join('')}</div>`;
const tableHead = (cols) => `<div class="row th">${cols.map((c) => `<span class="${c.cls || ''}">${esc(c.label)}</span>`).join('')}</div>`;

function quoteRow(q, n, { spark = true, nameCol = true } = {}) {
  if (!q || q.error) return `<div class="row qr" data-n="${n}"><span class="n">${n})</span><span class="sym">${esc(q?.symbol || '?')}</span><span class="err">${esc(q?.error || 'n/a')}</span></div>`;
  const dp = priceDp(q.symbol, q.last); const c = cls(q.chg);
  return `<div class="row qr" data-n="${n}" data-sym="${esc(q.symbol)}"><span class="n">${n})</span><span class="sym">${esc(q.symbol)}</span>${nameCol ? `<span class="nm">${esc(q.name || '')}</span>` : ''}<span class="num ${c}">${fmtNum(q.last, dp)}</span><span class="num ${c}">${fmtChg(q.chg, dp)}</span><span class="num ${c}">${fmtPct(q.pct)}</span><span class="num dim">${fmtVol(q.volume)}</span><span class="t dim">${q.marketTime ? fmtTime(q.marketTime) : ''}</span>${spark ? `<canvas class="spark" data-spark="${esc(JSON.stringify((q.spark || []).slice(-60)))}" data-up="${q.chg >= 0}"></canvas>` : ''}</div>`;
}

function drawSparks(el) { el.querySelectorAll('canvas.spark').forEach((c) => { try { drawSpark(c, JSON.parse(c.dataset.spark), { up: c.dataset.up === 'true' }); } catch { /* ignore */ } }); }

// ---------- news screens ----------
function newsScreen({ key, cmd, title, subtitle, fetcher, tabs = [], toolbar = [], header = () => '', showTicker = true, showTopic = true }) {
  return {
    key, cmd, title, subtitle, refreshMs: 60_000, toolbar, items: [], data: null, health: {},
    async load() { const d = await fetcher(); this.data = d; this.health = d.health || {}; this.subtitle = this.subtitle || d.label || ''; return d; },
    ids() { return (this.data?.items || []).map((h) => h.id); },
    render(el, ctx) {
      const items = this.data?.items || [];
      this.items = items.map((h) => () => ctx.openStory(h));
      el.innerHTML = `${header(this.data, ctx)}${tabs.length ? tabsHtml(tabs) : ''}<div class="list">${headlineRows(items, { showTicker, showTopic, readSet: ctx.readSet, newSet: ctx.newSet })}</div>`;
    },
    statusHtml() { return healthLine(this.health); },
  };
}

export function topScreen(cat = 'TOP') {
  const c = catOf(cat) || 'TOP';
  return newsScreen({ key: `TOP:${c}`, cmd: c === 'TOP' ? 'TOP' : `TOP ${c}`, title: 'TOP', subtitle: CAT_LABEL[c], fetcher: () => api.top(c), showTicker: false, showTopic: false,
    tabs: TOPIC_CATS.map((k) => ({ label: k, cmd: `TOP ${k}`, active: k === c })),
    toolbar: [{ label: 'My News', cmd: 'N' }, { label: 'Search', cmd: 'NSE ' }, { label: 'Alerts', cmd: 'ALRT' }] });
}

export function niScreen(codeRaw = '') {
  const code = codeRaw.trim(); const cat = catOf(code);
  if (cat) { const s = topScreen(cat); s.cmd = `NI ${cat}`; s.title = 'NI'; return s; }
  const up = code.toUpperCase(); const topic = TOPIC_EXPAND[up] || code;
  return newsScreen({ key: `NI:${up}`, cmd: `NI ${up}`, title: 'NI', subtitle: `${up}${topic !== code ? ` — ${topic}` : ''}`, fetcher: () => api.news({ topic }), showTicker: false, showTopic: false,
    toolbar: [{ label: 'Save topic', cmd: `W ADD NI ${up}` }, { label: 'Alert on it', cmd: `ALRT ADD ${topic}` }, { label: 'Top News', cmd: 'TOP' }] });
}

export function nseScreen(q) {
  return newsScreen({ key: `NSE:${q}`, cmd: `NSE ${q}`, title: 'NSE', subtitle: `Search: "${q}"`, fetcher: () => api.news({ q }), showTicker: false, showTopic: false,
    toolbar: [{ label: 'Save as topic', cmd: `W ADD NI ${q}` }, { label: 'Alert on it', cmd: `ALRT ADD ${q}` }] });
}

export function myNewsScreen(settings, filter = '') {
  const tickers = settings.tickers || []; const topics = settings.topics || [];
  if (!tickers.length && !topics.length) {
    return {
      key: 'N:empty', cmd: 'N', title: 'N', subtitle: 'My News — nothing saved yet', refreshMs: 0, items: [], toolbar: [{ label: 'Watchlist', cmd: 'W' }, { label: 'Top News', cmd: 'TOP' }],
      async load() {}, render(el, ctx) {
        const menu = [['W ADD AAPL', 'Save a ticker (example: AAPL)'], ['W ADD NI AI', 'Save a topic (example: AI)'], ['TOP', 'Top news'], ['TOP MKT', 'Markets'], ['TOP ECO', 'Economy'], ['TOP TECH', 'Technology'], ['WEI', 'World equity indices'], ['MOST', 'Trending tickers'], ['HELP', 'All functions']];
        this.items = menu.map(([c]) => () => ctx.exec(c));
        el.innerHTML = `<div class="menu"><div class="hint">No saved tickers or topics. Use <b>W ADD &lt;ticker&gt;</b> or <b>W ADD NI &lt;topic&gt;</b>, or open the app with <b>?t=AAPL,MSFT&amp;topics=AI</b>.</div>${menu.map(([c, d], i) => `<div class="row mi" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="fn">${esc(c)}</span><span class="h">${esc(d)}</span></div>`).join('')}</div>`;
      },
    };
  }
  const keys = ['ALL', ...tickers, ...topics.map((t) => t.toUpperCase())];
  const active = keys.includes(filter.toUpperCase()) ? filter.toUpperCase() : 'ALL';
  const s = newsScreen({ key: `N:${active}`, cmd: active === 'ALL' ? 'N' : `N ${active}`, title: 'N', subtitle: 'My News — saved tickers & topics', fetcher: () => api.myNews(tickers, topics),
    tabs: keys.map((k) => ({ label: k, cmd: k === 'ALL' ? 'N' : `N ${k}`, active: k === active })),
    toolbar: [{ label: 'Monitor', cmd: 'MON' }, { label: 'Watchlist', cmd: 'W' }, { label: 'Alerts', cmd: 'ALRT' }, { label: 'Top News', cmd: 'TOP' }] });
  const base = s.render.bind(s);
  s.render = (el, ctx) => {
    if (active !== 'ALL' && s.data) { const g = s.data.groups || {}; const k = Object.keys(g).find((x) => x.toUpperCase() === active); s.data = { ...s.data, items: k ? g[k] : [] }; }
    base(el, ctx);
  };
  const load = s.load.bind(s);
  s.load = async () => { const d = await load(); s.full = d; return d; };
  return s;
}

// ---------- security screens ----------
export function cnScreen(symbolRaw) {
  const s = newsScreen({ key: `CN:${symbolRaw}`, cmd: `${symbolRaw} CN`, title: symbolRaw, subtitle: 'Company News', fetcher: () => api.news({ ticker: symbolRaw }), showTicker: false,
    header: (d) => (d?.quote ? quoteBox(d.quote) : ''),
    toolbar: [{ label: 'DES', cmd: `${symbolRaw} DES` }, { label: 'GP', cmd: `${symbolRaw} GP` }, { label: 'GIP', cmd: `${symbolRaw} GIP` }, { label: 'Filings', cmd: `${symbolRaw} CF` }, { label: 'Save', cmd: `W ADD ${symbolRaw}` }] });
  const load = s.load.bind(s);
  s.load = async () => { const d = await load(); if (d.symbol) { s.title = d.symbol; s.cmd = `${d.symbol} CN`; s.subtitle = `${d.name || ''} — Company News`; s.symbol = d.symbol; } return d; };
  return s;
}

export function securityMenu(symbolRaw) {
  return {
    key: `MENU:${symbolRaw}`, cmd: symbolRaw, title: symbolRaw, subtitle: 'Security menu', refreshMs: 30_000, items: [], toolbar: [],
    async load() { const [q] = await api.quotes([symbolRaw]); this.q = q; if (q?.symbol) { this.title = q.symbol; this.cmd = q.symbol; this.subtitle = q.name || ''; } },
    render(el, ctx) {
      const sym = this.q?.symbol || symbolRaw;
      const menu = [...SECURITY_FUNCTIONS.map((f) => [`${sym} ${f.fn}`, f.desc]), [`W ADD ${sym}`, 'Add to watchlist'], [`ALRT ADD ${sym.replace(/[-=.^].*$/, '')}`, 'Alert on headlines mentioning this ticker'], [`NSE ${this.q?.name || sym}`, 'Search all news']];
      this.items = menu.map(([c]) => () => ctx.exec(c));
      el.innerHTML = `${quoteBox(this.q)}<div class="menu">${menu.map(([c, d], i) => `<div class="row mi" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="fn">${esc(c)}</span><span class="h">${esc(d)}</span></div>`).join('')}</div>`;
    },
  };
}

export function desScreen(symbolRaw) {
  return {
    key: `DES:${symbolRaw}`, cmd: `${symbolRaw} DES`, title: symbolRaw, subtitle: 'Description', refreshMs: 120_000, items: [], toolbar: [{ label: 'CN', cmd: `${symbolRaw} CN` }, { label: 'GP', cmd: `${symbolRaw} GP` }, { label: 'Filings', cmd: `${symbolRaw} CF` }, { label: 'Save', cmd: `W ADD ${symbolRaw}` }],
    async load() { const d = await api.des(symbolRaw); this.d = d; this.title = d.symbol; this.cmd = `${d.symbol} DES`; this.subtitle = `${d.name || ''} — Description`; this.toolbar = this.toolbar.map((t) => ({ ...t, cmd: t.cmd.replace(symbolRaw, d.symbol) })); },
    render(el, ctx) {
      const d = this.d; const q = d.quote; const dp = q ? priceDp(q.symbol, q.last) : 2;
      const kv = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${v ?? '--'}</span></div>`;
      const filings = d.sec?.recent || [];
      this.items = filings.map((f) => () => window.open(f.url, '_blank', 'noopener'));
      el.innerHTML = `${quoteBox(q)}
      <div class="cols"><div class="col">
        ${kv('NAME', esc(d.name))}${kv('TICKER', esc(d.symbol))}${kv('EXCHANGE', esc(q?.exchange || '--'))}${kv('CURRENCY', esc(q?.currency || '--'))}${kv('TYPE', esc(q?.type || '--'))}
        ${kv('52W HIGH', fmtNum(q?.high52, dp))}${kv('52W LOW', fmtNum(q?.low52, dp))}${kv('YTD CHG', `<span class="${cls(q?.ytdPct)}">${fmtPct(q?.ytdPct)}</span>`)}${kv('VOLUME', fmtVol(q?.volume))}
      </div><div class="col">
        ${kv('INDUSTRY (SIC)', esc(d.sec?.sic || '--'))}${kv('INC. STATE', esc(d.sec?.state || '--'))}${kv('FISCAL YE', esc(d.sec?.fiscalYearEnd || '--'))}${kv('CIK', esc(d.sec?.cik || '--'))}${kv('WEBSITE', d.sec?.website ? `<a href="${esc(d.sec.website)}" target="_blank" rel="noopener">${esc(d.sec.website)}</a>` : '--')}
        <div class="kv"><span class="k">1Y</span><span class="v"><canvas class="spark wide" data-spark="${esc(JSON.stringify((q?.yearSpark || []).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0)))}" data-up="${(q?.ytdPct ?? 0) >= 0}"></canvas></span></div>
      </div></div>
      <div class="sect">PROFILE ${d.wiki?.url ? `<a class="dim" href="${esc(d.wiki.url)}" target="_blank" rel="noopener">wikipedia</a>` : ''}</div><div class="para">${esc(d.wiki?.extract || 'No description available.')}</div>
      <div class="sect">RECENT SEC FILINGS</div><div class="list">${filings.length ? filings.map((f, i) => `<div class="row fl" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="t">${esc(f.date)}</span><span class="src">${esc(f.form)}</span><span class="h">${esc(f.description || f.items || '')}</span></div>`).join('') : '<div class="empty">No filings (not an SEC registrant or EDGAR unreachable).</div>'}</div>`;
      drawSparks(el);
    },
  };
}

export function cfScreen(symbolRaw) {
  return {
    key: `CF:${symbolRaw}`, cmd: `${symbolRaw} CF`, title: symbolRaw, subtitle: 'SEC Filings', refreshMs: 300_000, items: [], toolbar: [{ label: 'CN', cmd: `${symbolRaw} CN` }, { label: 'DES', cmd: `${symbolRaw} DES` }],
    async load() { const d = await api.filings(symbolRaw); this.d = d; this.title = d.symbol; this.cmd = `${d.symbol} CF`; this.subtitle = `${d.name || ''} — SEC Filings (EDGAR)`; },
    render(el) {
      const f = this.d?.filings || [];
      this.items = f.map((x) => () => window.open(x.url, '_blank', 'noopener'));
      el.innerHTML = `${tableHead([{ label: '', cls: 'n' }, { label: 'DATE', cls: 't' }, { label: 'FORM', cls: 'src' }, { label: 'DESCRIPTION', cls: 'h' }])}<div class="list">${f.length ? f.map((x, i) => `<div class="row fl" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="t">${esc(x.date)}</span><span class="src">${esc(x.form)}</span><span class="h">${esc(x.description || '')}${x.items ? ` <span class="dim">items ${esc(x.items)}</span>` : ''}</span></div>`).join('') : '<div class="empty">No filings found. Non-US or non-SEC registrants have no EDGAR record.</div>'}</div>`;
    },
  };
}

export function gpScreen(symbolRaw, intraday = false, range) {
  const r = range || (intraday ? '1d' : '1y');
  const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'];
  return {
    key: `GP:${symbolRaw}:${r}`, cmd: `${symbolRaw} ${intraday ? 'GIP' : 'GP'}`, title: symbolRaw, subtitle: intraday ? 'Intraday Chart' : 'Price Chart', refreshMs: r === '1d' ? 30_000 : 120_000, items: [], range: r,
    toolbar: [{ label: 'CN', cmd: `${symbolRaw} CN` }, { label: 'DES', cmd: `${symbolRaw} DES` }, { label: 'Save', cmd: `W ADD ${symbolRaw}` }],
    async load() { const d = await api.chart(symbolRaw, this.range); this.d = d; this.title = d.symbol; this.cmd = `${d.symbol} ${intraday ? 'GIP' : 'GP'}`; this.subtitle = `${d.name || ''} — ${this.range.toUpperCase()} chart`; this.toolbar = this.toolbar.map((t) => ({ ...t, cmd: t.cmd.replace(symbolRaw, d.symbol) })); },
    render(el) {
      const d = this.d;
      const dp = priceDp(d.symbol, d.last);
      const { series, ...q } = d;
      el.innerHTML = `${quoteBox(q, { compact: true })}${tabsHtml(RANGES.map((x) => ({ label: x.toUpperCase(), cmd: `__range:${x}`, active: x === this.range })))}<div class="chartwrap"><canvas class="chart"></canvas><div class="readout dim"></div></div>`;
      const canvas = el.querySelector('canvas.chart'); const readout = el.querySelector('.readout');
      const draw = (cursor) => { const res = drawChart(canvas, d, { range: this.range, cursor }); if (res?.info) { const p = res.info; readout.textContent = `${fmtDateTime(p.t)}  O ${fmtNum(p.o, dp)}  H ${fmtNum(p.h, dp)}  L ${fmtNum(p.l, dp)}  C ${fmtNum(p.c, dp)}  V ${fmtVol(p.v)}`; } else readout.textContent = `${series.length} bars · hover for OHLC`; };
      draw(null);
      canvas.onmousemove = (e) => { const rect = canvas.getBoundingClientRect(); draw({ x: e.clientX - rect.left, y: e.clientY - rect.top }); };
      canvas.onmouseleave = () => draw(null);
      this.redraw = () => draw(null);
      el.querySelectorAll('.tab').forEach((t) => { t.onclick = (e) => { e.stopPropagation(); this.range = t.dataset.cmd.replace('__range:', ''); this.key = `GP:${symbolRaw}:${this.range}`; this.refreshMs = this.range === '1d' ? 30_000 : 120_000; this.reload?.(); }; });
    },
  };
}

// ---------- monitors ----------
const WEI_GROUPS = [
  ['AMERICAS', ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX', '^GSPTSE', '^BVSP', '^MXX']],
  ['EMEA', ['^STOXX50E', '^FTSE', '^GDAXI', '^FCHI', '^IBEX', 'FTSEMIB.MI', '^SSMI', '^AEX']],
  ['APAC', ['^N225', '^HSI', '000001.SS', '^KS11', '^TWII', '^AXJO', '^BSESN', '^STI']],
];
function quoteTableScreen({ key, cmd, title, subtitle, groups, refreshMs = 30_000, toolbar = [] }) {
  return {
    key, cmd, title, subtitle, refreshMs, items: [], toolbar,
    async load() { const syms = groups.flatMap(([, s]) => s); const qs = await api.quotes(syms); this.map = Object.fromEntries(qs.map((q, i) => [syms[i], q])); },
    render(el, ctx) {
      let n = 0; this.items = [];
      const head = tableHead([{ label: '', cls: 'n' }, { label: 'SYMBOL', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'LAST', cls: 'num' }, { label: 'CHG', cls: 'num' }, { label: '%CHG', cls: 'num' }, { label: 'VOL', cls: 'num' }, { label: 'TIME', cls: 't' }, { label: '5D', cls: 'spark' }]);
      el.innerHTML = head + groups.map(([g, syms]) => `<div class="sect">${esc(g)}</div>${syms.map((s) => { n++; const q = this.map[s]; this.items.push(() => ctx.exec(`${q?.symbol || s} GP`)); return quoteRow(q || { symbol: s, error: 'n/a' }, n); }).join('')}`).join('');
      drawSparks(el);
    },
  };
}
export const weiScreen = () => quoteTableScreen({ key: 'WEI', cmd: 'WEI', title: 'WEI', subtitle: 'World Equity Indices', groups: WEI_GROUPS, toolbar: [{ label: 'FX', cmd: 'FXC' }, { label: 'Bonds', cmd: 'WB' }, { label: 'Crypto', cmd: 'CRYP' }, { label: 'Top News', cmd: 'TOP' }] });
export const wbScreen = () => quoteTableScreen({ key: 'WB', cmd: 'WB', title: 'WB', subtitle: 'World Bonds — US Treasury yields & dollar', groups: [['US TREASURY YIELDS (%)', ['^IRX', '^FVX', '^TNX', '^TYX']], ['DOLLAR & RATE-SENSITIVE', ['DX-Y.NYB', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP']]], toolbar: [{ label: 'Central banks', cmd: 'TOP CEN' }, { label: 'Economy', cmd: 'ECO' }, { label: 'WEI', cmd: 'WEI' }] });

export function fxcScreen() {
  const MAJORS = ['EURUSD=X', 'GBPUSD=X', 'JPY=X', 'CHF=X', 'AUDUSD=X', 'CAD=X', 'NZDUSD=X', 'CNY=X', 'MXN=X', 'INR=X', 'BRL=X', 'KRW=X', 'DX-Y.NYB'];
  const CROSS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY'];
  return {
    key: 'FXC', cmd: 'FXC', title: 'FXC', subtitle: 'Currency Rates & Cross Matrix', refreshMs: 30_000, items: [], toolbar: [{ label: 'WEI', cmd: 'WEI' }, { label: 'Bonds', cmd: 'WB' }, { label: 'FX news', cmd: 'NI FX' }],
    async load() { const [qs, fx] = await Promise.all([api.quotes(MAJORS), api.fx('USD').catch(() => null)]); this.qs = qs; this.fx = fx; },
    render(el, ctx) {
      this.items = this.qs.map((q) => () => ctx.exec(`${q.symbol} GIP`));
      const rates = this.fx ? { USD: 1, ...this.fx.rates } : null;
      const matrix = rates ? `<div class="sect">CROSS RATES (ECB reference, ${esc(this.fx.date)}) — row currency priced in column currency</div><table class="matrix"><tr><th></th>${CROSS.map((c) => `<th>${c}</th>`).join('')}</tr>${CROSS.map((r) => `<tr><th>${r}</th>${CROSS.map((c) => { const v = rates[c] != null && rates[r] ? rates[c] / rates[r] : null; return `<td class="${r === c ? 'diag' : ''}">${r === c ? '—' : v == null ? '--' : fmtNum(v, v >= 100 ? 2 : 4)}</td>`; }).join('')}</tr>`).join('')}</table>` : '<div class="empty">Cross-rate matrix unavailable (ECB feed unreachable).</div>';
      el.innerHTML = tableHead([{ label: '', cls: 'n' }, { label: 'PAIR', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'LAST', cls: 'num' }, { label: 'CHG', cls: 'num' }, { label: '%CHG', cls: 'num' }, { label: '', cls: 'num' }, { label: 'TIME', cls: 't' }, { label: '1D', cls: 'spark' }]) + this.qs.map((q, i) => quoteRow(q, i + 1)).join('') + matrix;
      drawSparks(el);
    },
  };
}

export function crypScreen() {
  return {
    key: 'CRYP', cmd: 'CRYP', title: 'CRYP', subtitle: 'Crypto Markets (CoinGecko)', refreshMs: 60_000, items: [], toolbar: [{ label: 'Crypto news', cmd: 'TOP CRYPTO' }, { label: 'BTC chart', cmd: 'BTC-USD GIP' }, { label: 'WEI', cmd: 'WEI' }],
    async load() { this.rows = await api.crypto(); },
    render(el, ctx) {
      this.items = this.rows.map((c) => () => ctx.exec(`${c.symbol}-USD GIP`));
      el.innerHTML = tableHead([{ label: '', cls: 'n' }, { label: 'COIN', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'PRICE', cls: 'num' }, { label: '1H%', cls: 'num' }, { label: '24H%', cls: 'num' }, { label: '7D%', cls: 'num' }, { label: 'MKT CAP', cls: 'num' }, { label: 'VOL 24H', cls: 'num' }, { label: '7D', cls: 'spark' }]) +
        this.rows.map((c, i) => `<div class="row qr" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="sym">${esc(c.symbol)}</span><span class="nm">${esc(c.name)}</span><span class="num ${cls(c.pct)}">${fmtNum(c.last, c.last < 2 ? 4 : 2)}</span><span class="num ${cls(c.pct1h)}">${fmtPct(c.pct1h)}</span><span class="num ${cls(c.pct)}">${fmtPct(c.pct)}</span><span class="num ${cls(c.pct7d)}">${fmtPct(c.pct7d)}</span><span class="num dim">${fmtVol(c.mcap)}</span><span class="num dim">${fmtVol(c.volume)}</span><canvas class="spark" data-spark="${esc(JSON.stringify((c.spark || []).filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 60)) === 0)))}" data-up="${(c.pct7d ?? 0) >= 0}"></canvas></div>`).join('');
      drawSparks(el);
    },
  };
}

export function mostScreen() {
  return {
    key: 'MOST', cmd: 'MOST', title: 'MOST', subtitle: 'Trending Tickers (Yahoo Finance)', refreshMs: 60_000, items: [], toolbar: [{ label: 'WEI', cmd: 'WEI' }, { label: 'Markets news', cmd: 'TOP MKT' }],
    async load() { this.d = await api.trending(); },
    render(el, ctx) {
      const qs = this.d?.quotes || [];
      this.items = qs.map((q) => () => ctx.exec(`${q.symbol} CN`));
      el.innerHTML = tableHead([{ label: '', cls: 'n' }, { label: 'SYMBOL', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'LAST', cls: 'num' }, { label: 'CHG', cls: 'num' }, { label: '%CHG', cls: 'num' }, { label: 'VOL', cls: 'num' }, { label: 'TIME', cls: 't' }, { label: '1D', cls: 'spark' }]) + (qs.length ? qs.map((q, i) => quoteRow(q, i + 1)).join('') : '<div class="empty">Trending list unavailable.</div>');
      drawSparks(el);
    },
  };
}

export function ecoScreen(tab = 'ECO') {
  const s = topScreen(tab === 'CEN' ? 'CEN' : 'ECO');
  s.key = `ECO:${tab}`; s.cmd = 'ECO'; s.title = 'ECO'; s.subtitle = tab === 'CEN' ? 'Central Banks' : 'Economic Releases & Data';
  s.toolbar = [{ label: 'Releases', cmd: 'ECO' }, { label: 'Central banks', cmd: 'CEN' }, { label: 'Bonds', cmd: 'WB' }, { label: 'Rates news', cmd: 'NI RATES' }, { label: 'Inflation', cmd: 'NI INFL' }];
  const base = s.render.bind(s);
  s.render = (el, ctx) => { base(el, ctx); const t = el.querySelector('.tabs'); if (t) t.remove(); };
  return s;
}

export function monScreen(settings) {
  const tickers = settings.tickers || []; const topics = settings.topics || [];
  return {
    key: 'MON', cmd: 'MON', title: 'MON', subtitle: 'Watchlist Monitor', refreshMs: 30_000, items: [], toolbar: [{ label: 'My News', cmd: 'N' }, { label: 'Edit list', cmd: 'W' }, { label: 'Alerts', cmd: 'ALRT' }],
    async load() { if (!tickers.length && !topics.length) return; const [qs, news] = await Promise.all([tickers.length ? api.quotes(tickers) : [], api.myNews(tickers, topics).catch(() => ({ groups: {} }))]); this.qs = qs; this.groups = news.groups || {}; },
    render(el, ctx) {
      if (!tickers.length && !topics.length) { el.innerHTML = '<div class="empty">Watchlist is empty. Use <b>W ADD AAPL</b> or <b>W ADD NI AI</b>.</div>'; this.items = []; return; }
      let n = 0; this.items = []; this.storyByN = {};
      const rows = (this.qs || []).map((q, i) => { n++; const sym = q?.symbol || tickers[i]; const g = this.groups[sym] || this.groups[tickers[i]] || []; const h = g[0]; this.items.push(() => ctx.exec(`${sym} CN`)); return `${quoteRow(q || { symbol: sym, error: 'n/a' }, n, { nameCol: true })}${h ? `<div class="row sub hl" data-story="${esc(h.id)}"><span class="n"></span><span class="t">${fmtTime(h.ts)}</span><span class="src">${esc(h.source)}</span><span class="h">${esc(h.headline)}</span></div>` : ''}`; }).join('');
      const tRows = topics.map((t) => { n++; const g = this.groups[t] || []; const h = g[0]; this.items.push(() => ctx.exec(`NI ${t}`)); return `<div class="row qr" data-n="${n}"><span class="n">${n})</span><span class="sym topic">NI ${esc(t.toUpperCase())}</span><span class="nm">${esc(TOPIC_EXPAND[t.toUpperCase()] || t)}</span><span class="num dim">${g.length} hl</span></div>${h ? `<div class="row sub hl" data-story="${esc(h.id)}"><span class="n"></span><span class="t">${fmtTime(h.ts)}</span><span class="src">${esc(h.source)}</span><span class="h">${esc(h.headline)}</span></div>` : ''}`; }).join('');
      el.innerHTML = `${tickers.length ? tableHead([{ label: '', cls: 'n' }, { label: 'SYMBOL', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'LAST', cls: 'num' }, { label: 'CHG', cls: 'num' }, { label: '%CHG', cls: 'num' }, { label: 'VOL', cls: 'num' }, { label: 'TIME', cls: 't' }, { label: '1D', cls: 'spark' }]) + rows : ''}${topics.length ? `<div class="sect">SAVED TOPICS</div>${tRows}` : ''}`;
      drawSparks(el);
      const all = Object.values(this.groups).flat();
      el.querySelectorAll('[data-story]').forEach((r) => { r.onclick = (e) => { e.stopPropagation(); const h = all.find((x) => x.id === r.dataset.story); if (h) ctx.openStory(h); }; });
    },
  };
}

// ---------- settings screens ----------
export function wScreen(settings, ctx) {
  return {
    key: 'W', cmd: 'W', title: 'W', subtitle: 'Watchlist — saved tickers & topics', refreshMs: 0, items: [], toolbar: [{ label: 'Monitor', cmd: 'MON' }, { label: 'My News', cmd: 'N' }, { label: 'Clear all', cmd: 'W CLR' }],
    async load() {},
    render(el) {
      const t = settings.tickers || [], tp = settings.topics || [];
      this.items = [...t.map((x) => () => ctx.exec(`${x} CN`)), ...tp.map((x) => () => ctx.exec(`NI ${x}`))];
      let n = 0;
      el.innerHTML = `<div class="form"><label>ADD TICKER <input class="fld" data-add="ticker" placeholder="AAPL, MSFT, SPX INDEX, EURUSD CURNCY"></label><label>ADD TOPIC <input class="fld" data-add="topic" placeholder="AI, FED, TECH, tariffs"></label><span class="dim">press &lt;GO&gt; / Enter in a field · commands: W ADD AAPL · W ADD NI AI · W DEL AAPL · W DEL NI AI · W CLR</span></div>
        <div class="sect">TICKERS (${t.length})</div><div class="list">${t.length ? t.map((x) => { n++; return `<div class="row mi" data-n="${n}"><span class="n">${n})</span><span class="fn">${esc(x)}</span><span class="h">Company news</span><span class="del" data-del="${esc(x)}" data-kind="ticker" title="remove">✕</span></div>`; }).join('') : '<div class="empty">none</div>'}</div>
        <div class="sect">TOPICS (${tp.length})</div><div class="list">${tp.length ? tp.map((x) => { n++; return `<div class="row mi" data-n="${n}"><span class="n">${n})</span><span class="fn">NI ${esc(x.toUpperCase())}</span><span class="h">${esc(catOf(x) ? CAT_LABEL[catOf(x)] : TOPIC_EXPAND[x.toUpperCase()] || x)}</span><span class="del" data-del="${esc(x)}" data-kind="topic" title="remove">✕</span></div>`; }).join('') : '<div class="empty">none</div>'}</div>
        <div class="sect">SHARE</div><div class="para dim">Open this list on another device: <a href="${esc(ctx.shareUrl())}">${esc(ctx.shareUrl())}</a></div>`;
      el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); ctx.exec(b.dataset.kind === 'ticker' ? `W DEL ${b.dataset.del}` : `W DEL NI ${b.dataset.del}`); }; });
      el.querySelectorAll('input.fld').forEach((inp) => { inp.onkeydown = (e) => { if (e.key === 'Enter') { const v = inp.value.trim(); if (v) ctx.exec(inp.dataset.add === 'ticker' ? `W ADD ${v}` : `W ADD NI ${v}`); inp.value = ''; } e.stopPropagation(); }; inp.onclick = (e) => e.stopPropagation(); });
    },
  };
}

export function alrtScreen(settings, ctx) {
  return {
    key: 'ALRT', cmd: 'ALRT', title: 'ALRT', subtitle: 'Headline Alerts', refreshMs: 0, items: [], toolbar: [{ label: 'My News', cmd: 'N' }, { label: 'Clear log', cmd: 'ALRT CLRLOG' }, { label: 'Clear all', cmd: 'ALRT CLR' }],
    async load() {},
    render(el) {
      const a = settings.alerts || []; const log = ctx.alertLog();
      this.items = log.map((x) => () => ctx.openStory(x.headline));
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
      el.innerHTML = `<div class="form"><label>ADD KEYWORD <input class="fld" data-add="alert" placeholder="earnings, rate cut, AAPL, tariff"></label><button class="btn" data-notif>${perm === 'granted' ? 'DESKTOP NOTIFICATIONS ON' : 'ENABLE DESKTOP NOTIFICATIONS'}</button><span class="dim">Alerts fire when a headline in any watched feed contains a keyword (case-insensitive). ALRT ADD x · ALRT DEL x · ALRT CLR</span></div>
        <div class="sect">KEYWORDS (${a.length})</div><div class="list">${a.length ? a.map((k, i) => `<div class="row mi"><span class="n">${i + 1})</span><span class="fn">${esc(k)}</span><span class="h"></span><span class="del" data-del="${esc(k)}" title="remove">✕</span></div>`).join('') : '<div class="empty">no alert keywords</div>'}</div>
        <div class="sect">RECENT ALERTS (${log.length})</div><div class="list">${log.length ? log.map((x, i) => `<div class="row hl alert" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="t">${fmtTime(x.at)}</span><span class="src">${esc(x.keyword.toUpperCase().slice(0, 6))}</span><span class="h">${esc(x.headline.headline)}</span><span class="tk">${esc(x.headline.source)}</span></div>`).join('') : '<div class="empty">nothing triggered yet</div>'}</div>`;
      el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); ctx.exec(`ALRT DEL ${b.dataset.del}`); }; });
      const inp = el.querySelector('input.fld'); inp.onkeydown = (e) => { if (e.key === 'Enter') { const v = inp.value.trim(); if (v) ctx.exec(`ALRT ADD ${v}`); inp.value = ''; } e.stopPropagation(); }; inp.onclick = (e) => e.stopPropagation();
      el.querySelector('[data-notif]').onclick = async (e) => { e.stopPropagation(); if (typeof Notification !== 'undefined') { await Notification.requestPermission(); ctx.refreshPanel(); } };
    },
  };
}

export function secfScreen(q) {
  return {
    key: `SECF:${q}`, cmd: `SECF ${q}`, title: 'SECF', subtitle: `Security Finder: "${q}"`, refreshMs: 0, items: [], toolbar: [],
    async load() { this.rows = await api.findSecurity(q); },
    render(el, ctx) {
      this.items = this.rows.map((r) => () => ctx.exec(r.symbol));
      el.innerHTML = tableHead([{ label: '', cls: 'n' }, { label: 'SYMBOL', cls: 'sym' }, { label: 'NAME', cls: 'nm' }, { label: 'EXCH', cls: 'src' }, { label: 'TYPE', cls: 'src' }]) + (this.rows.length ? this.rows.map((r, i) => `<div class="row qr" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span><span class="src">${esc(r.exchange)}</span><span class="src">${esc(r.type)}</span></div>`).join('') : '<div class="empty">No matches.</div>');
    },
  };
}

export function helpScreen() {
  return {
    key: 'HELP', cmd: 'HELP', title: 'HELP', subtitle: 'Function reference — type a mnemonic and press <GO> (Enter)', refreshMs: 0, items: [], toolbar: [{ label: 'Top News', cmd: 'TOP' }, { label: 'WEI', cmd: 'WEI' }],
    async load() {},
    render(el, ctx) {
      const cmds = [...FUNCTIONS.map((f) => [f.fn, f.desc]), ...SECURITY_FUNCTIONS.map((f) => [`<TICKER> ${f.fn}`, f.desc])];
      this.items = cmds.map(([c]) => () => ctx.exec(c.replace('<TICKER>', 'AAPL')));
      el.innerHTML = `<div class="menu">${cmds.map(([c, d], i) => `<div class="row mi" data-n="${i + 1}"><span class="n">${i + 1})</span><span class="fn">${esc(c)}</span><span class="h">${esc(d)}</span></div>`).join('')}</div>
      <div class="sect">SECURITY SYNTAX</div><div class="para">Bloomberg-style: <b>AAPL US EQUITY CN</b>, <b>SPX INDEX GP</b>, <b>EURUSD CURNCY GIP</b>, <b>CL1 COMDTY GP</b>, <b>XBT CRYPTO GP</b>. Mnemonics like SPX, INDU, CCMP, UKX, DAX, NKY, HSI, VIX, CL1, CO1, GC1, XBT, USGG10YR map to free-data symbols. Yahoo symbols (^GSPC, BTC-USD, EURUSD=X, 7203.T) work directly.</div>
      <div class="sect">KEYBOARD</div><div class="para"><b>Enter</b> = &lt;GO&gt; · <b>Esc</b> = &lt;MENU&gt; (back) · <b>Tab</b> = next panel · <b>Alt+1..4</b> = jump to panel · <b>PgUp/PgDn</b> = scroll · <b>↑/↓</b> = command history · type a row <b>number</b> + &lt;GO&gt; to open it · click a headline to read it in-terminal.</div>
      <div class="sect">TOPIC CODES (NI)</div><div class="para dim">${Object.keys(CAT_LABEL).join(' ')} — ${Object.keys(TOPIC_EXPAND).join(' ')} — any other word is searched as free text.</div>
      <div class="sect">DATA SOURCES (ALL FREE)</div><div class="para dim">Google News RSS, Bing News RSS, Yahoo Finance RSS/charts/trending/search, GDELT, Reddit, Hacker News, CNBC, MarketWatch, WSJ &amp; Dow Jones headline feeds, FT, BBC, Reuters &amp; AP (via Google News), Federal Reserve, ECB, Bank of England, BLS, BEA, SEC EDGAR, Wikipedia, CoinGecko, Frankfurter (ECB FX), OilPrice, CoinDesk, Cointelegraph, TechCrunch, The Verge, Ars Technica, Politico, PR Newswire, GlobeNewswire, Nikkei Asia, SCMP, Guardian, Al Jazeera, Stooq.</div>`;
    },
  };
}

export function storyScreen(h) {
  return {
    key: `STORY:${h.id}`, cmd: 'READ', title: h.tickers?.[0] || h.topic?.toUpperCase() || 'NEWS', subtitle: `${h.sourceName || h.source} — story`, refreshMs: 0, items: [], isStory: true,
    toolbar: [{ label: 'Open in browser', action: () => window.open(h.url, '_blank', 'noopener') }, { label: 'Related', cmd: `NSE ${h.headline.split(/\s+/).slice(0, 6).join(' ')}` }, ...(h.tickers?.[0] ? [{ label: `${h.tickers[0]} CN`, cmd: `${h.tickers[0]} CN` }] : [])],
    async load() { this.a = h.url ? await api.article(h.url).catch((e) => ({ error: e.message })) : { error: 'no url' }; },
    render(el) {
      const a = this.a || {};
      this.items = [() => window.open(h.url, '_blank', 'noopener')];
      el.innerHTML = `<div class="story"><h1>${esc(a.title || h.headline)}</h1><div class="meta"><span class="src">${esc(h.sourceName || h.source)}</span> · <span>${fmtDateTime(h.ts)}</span> · <span class="dim">${ago(h.ts)} ago</span>${h.tickers?.length ? ` · <span class="tk">${esc(h.tickers.join(' '))}</span>` : ''}</div>
        ${h.summary && !(a.paragraphs || []).length ? `<p class="lead">${esc(h.summary)}</p>` : a.description ? `<p class="lead">${esc(a.description)}</p>` : ''}
        ${(a.paragraphs || []).length ? a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('') : `<p class="dim">${a.error ? `Full text unavailable (${esc(a.error)}).` : 'No extractable article body.'} </p>`}
        <p class="link">1) <a href="${esc(a.url || h.url)}" target="_blank" rel="noopener">${esc(a.url || h.url)}</a></p></div>`;
    },
  };
}
