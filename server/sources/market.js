// Market data from Yahoo Finance's public chart/search endpoints (no key, no crumb)
// with Stooq as a quote fallback.
import { getJSON, getText } from '../lib/http.js';
import { cached } from '../lib/cache.js';

const enc = encodeURIComponent;
const Y1 = 'https://query1.finance.yahoo.com';
const Y2 = 'https://query2.finance.yahoo.com';

// Bloomberg-style mnemonics -> Yahoo symbols
export const SYMBOL_ALIASES = {
  SPX: '^GSPC', SPY: 'SPY', INDU: '^DJI', DJI: '^DJI', DOW: '^DJI', CCMP: '^IXIC', NDX: '^NDX', COMP: '^IXIC', NASDAQ: '^IXIC', RTY: '^RUT', RUT: '^RUT',
  VIX: '^VIX', UKX: '^FTSE', FTSE: '^FTSE', DAX: '^GDAXI', CAC: '^FCHI', SX5E: '^STOXX50E', STOXX: '^STOXX50E', NKY: '^N225', NIKKEI: '^N225',
  HSI: '^HSI', SHCOMP: '000001.SS', KOSPI: '^KS11', ASX: '^AXJO', AS51: '^AXJO', SENSEX: '^BSESN', NIFTY: '^NSEI', TSX: '^GSPTSE', SPTSX: '^GSPTSE',
  IBOV: '^BVSP', MEXBOL: '^MXX', SMI: '^SSMI', AEX: '^AEX', IBEX: '^IBEX', FTSEMIB: 'FTSEMIB.MI', TWSE: '^TWII', STI: '^STI',
  CL1: 'CL=F', CO1: 'BZ=F', BRENT: 'BZ=F', WTI: 'CL=F', NG1: 'NG=F', NATGAS: 'NG=F', GC1: 'GC=F', GOLD: 'GC=F', SI1: 'SI=F', SILVER: 'SI=F',
  HG1: 'HG=F', COPPER: 'HG=F', PL1: 'PL=F', C1: 'ZC=F', CORN: 'ZC=F', W1: 'ZW=F', WHEAT: 'ZW=F', S1: 'ZS=F', SOYBEANS: 'ZS=F',
  XBT: 'BTC-USD', BTC: 'BTC-USD', BITCOIN: 'BTC-USD', ETH: 'ETH-USD', XET: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD', DOGE: 'DOGE-USD',
  USGG10YR: '^TNX', USGG30YR: '^TYX', USGG5YR: '^FVX', USGG3M: '^IRX', TNX: '^TNX', DXY: 'DX-Y.NYB', BBDXY: 'DX-Y.NYB',
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'JPY=X', USDCHF: 'CHF=X', AUDUSD: 'AUDUSD=X', USDCAD: 'CAD=X', NZDUSD: 'NZDUSD=X',
  USDCNY: 'CNY=X', USDCNH: 'CNH=X', USDMXN: 'MXN=X', USDINR: 'INR=X', USDBRL: 'BRL=X', USDKRW: 'KRW=X', USDZAR: 'ZAR=X', USDSEK: 'SEK=X', USDNOK: 'NOK=X',
  EURGBP: 'EURGBP=X', EURJPY: 'EURJPY=X', GBPJPY: 'GBPJPY=X', EURCHF: 'EURCHF=X',
};

const FX_CODES = /^[A-Z]{3}$/;

/** Map "AAPL US EQUITY", "SPX INDEX", "EURUSD CURNCY", "CL1 COMDTY" and plain mnemonics to Yahoo symbols. */
export function resolveSymbol(input = '') {
  const toks = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return '';
  const last = toks[toks.length - 1];
  const sector = ['EQUITY', 'INDEX', 'CURNCY', 'CRNCY', 'COMDTY', 'GOVT', 'CORP', 'CRYPTO'].includes(last) ? toks.pop() : '';
  let sym = toks[0];
  const market = toks[1]; // e.g. US, LN, GY, JP
  if (SYMBOL_ALIASES[sym]) return SYMBOL_ALIASES[sym];
  if (sector === 'CURNCY' || sector === 'CRNCY') {
    if (/^[A-Z]{6}$/.test(sym)) return sym.startsWith('USD') ? `${sym.slice(3)}=X` : `${sym}=X`;
    if (FX_CODES.test(sym)) return sym === 'USD' ? 'DX-Y.NYB' : `${sym}=X`;
  }
  if (sector === 'CRYPTO' && FX_CODES.test(sym)) return `${sym}-USD`;
  if (sector === 'INDEX' && !sym.startsWith('^')) return `^${sym}`;
  if (sector === 'COMDTY' && !sym.includes('=')) return `${sym.replace(/\d+$/, '')}=F`;
  const SUFFIX = { LN: '.L', GY: '.DE', GR: '.DE', FP: '.PA', JP: '.T', JT: '.T', HK: '.HK', CN: '.TO', CT: '.TO', AU: '.AX', IN: '.NS', SW: '.SW', IM: '.MI', SM: '.MC', NA: '.AS', SS: '.ST', KS: '.KS', TT: '.TW', SP: '.SI', CH: '.SS', BZ: '.SA', MM: '.MX' };
  if (market && SUFFIX[market] && !sym.includes('.')) sym = `${sym}${SUFFIX[market]}`;
  return sym;
}

function pickLast(arr = []) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }

function summarizeChart(json, symbol) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`no chart data for ${symbol}`);
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const series = ts.map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] })).filter((p) => p.c != null);
  const last = meta.regularMarketPrice ?? pickLast(q.close);
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? series[0]?.c ?? last;
  const chg = last != null && prev != null ? last - prev : null;
  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    currency: meta.currency || '',
    type: meta.instrumentType || '',
    last,
    prev,
    chg,
    pct: chg != null && prev ? (chg / prev) * 100 : null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? pickLast(q.volume),
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    marketTime: (meta.regularMarketTime || 0) * 1000,
    marketState: meta.marketState || '',
    tz: meta.exchangeTimezoneName || '',
    range: meta.range || '',
    series,
  };
}

export async function chart(symbol, range = '1d', interval) {
  const sym = resolveSymbol(symbol);
  const iv = interval || { '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d', '6mo': '1d', '1y': '1d', '2y': '1wk', '5y': '1wk', max: '1mo' }[range] || '1d';
  return cached(`chart:${sym}:${range}:${iv}`, range === '1d' ? 30_000 : 120_000, async () => {
    const url = `${Y1}/v8/finance/chart/${enc(sym)}?range=${enc(range)}&interval=${enc(iv)}&includePrePost=false&events=div%2Csplit`;
    try {
      return summarizeChart(await getJSON(url), sym);
    } catch (e) {
      const alt = await getJSON(url.replace(Y1, Y2)).catch(() => null);
      if (alt) return summarizeChart(alt, sym);
      throw e;
    }
  });
}

export async function stooqQuote(symbol) {
  const s = symbol.toLowerCase().replace(/^\^/, '^').replace(/=x$/, '') + (/^[a-z.]+$/.test(symbol.toLowerCase()) && !symbol.includes('.') ? '.us' : '');
  const csv = await getText(`https://stooq.com/q/l/?s=${enc(s)}&f=sd2t2ohlcv&h&e=csv`);
  const [, row] = csv.trim().split('\n');
  if (!row) throw new Error('stooq empty');
  const [sym, date, time, o, h, l, c, v] = row.split(',');
  const last = parseFloat(c);
  const open = parseFloat(o);
  if (!Number.isFinite(last)) throw new Error('stooq n/a');
  return { symbol: symbol.toUpperCase(), name: sym, exchange: 'STOOQ', currency: '', last, prev: open, chg: last - open, pct: open ? ((last - open) / open) * 100 : null, dayHigh: parseFloat(h), dayLow: parseFloat(l), volume: parseFloat(v), marketTime: Date.parse(`${date}T${time}Z`) || Date.now(), series: [] };
}

/** Quote snapshot (no intraday series) for a list of symbols. */
export async function quotes(symbols) {
  const out = await Promise.all(
    symbols.map(async (s) => {
      try {
        const c = await chart(s, '1d');
        const { series, ...q } = c;
        q.spark = series.map((p) => p.c);
        return q;
      } catch (e) {
        try { return await cached(`stooq:${s}`, 60_000, () => stooqQuote(resolveSymbol(s))); } catch { return { symbol: resolveSymbol(s), error: String(e.message).slice(0, 80) }; }
      }
    })
  );
  return out;
}

export async function trending(region = 'US') {
  return cached(`trending:${region}`, 120_000, async () => {
    const data = await getJSON(`${Y1}/v1/finance/trending/${enc(region)}?count=25`);
    return (data?.finance?.result?.[0]?.quotes || []).map((q) => q.symbol);
  });
}

export async function findSecurity(q) {
  return cached(`secf:${q}`, 600_000, async () => {
    const data = await getJSON(`${Y2}/v1/finance/search?q=${enc(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false`);
    return (data.quotes || []).map((r) => ({ symbol: r.symbol, name: r.longname || r.shortname || '', exchange: r.exchDisp || r.exchange || '', type: r.quoteType || r.typeDisp || '' }));
  });
}
