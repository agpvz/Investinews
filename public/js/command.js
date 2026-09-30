// Bloomberg-style command line parser. Pure module: no DOM, so it is unit-testable in Node.

export const FUNCTIONS = [
  { fn: 'N', desc: 'My News: headlines for saved tickers & topics' },
  { fn: 'TOP', desc: 'Top news (TOP <category>)' },
  { fn: 'NI', desc: 'News by topic code (NI TECH, NI AI, NI FED)' },
  { fn: 'NSE', desc: 'News search, free text (NSE rate cut)' },
  { fn: 'MON', desc: 'Watchlist monitor: quotes + latest headline' },
  { fn: 'W', desc: 'Watchlist editor (W ADD AAPL, W ADD NI AI, W DEL AAPL)' },
  { fn: 'ALRT', desc: 'Headline alerts (ALRT ADD earnings, ALRT DEL 1)' },
  { fn: 'WEI', desc: 'World equity indices' },
  { fn: 'FXC', desc: 'Currency rates & cross matrix' },
  { fn: 'WB', desc: 'World bonds: US Treasury yields' },
  { fn: 'CRYP', desc: 'Crypto markets' },
  { fn: 'MOST', desc: 'Most active / trending tickers' },
  { fn: 'ECO', desc: 'Economic releases & central banks' },
  { fn: 'SECF', desc: 'Security finder (SECF apple)' },
  { fn: 'HELP', desc: 'Function reference' },
  { fn: 'LAYOUT', desc: 'Panel layout (LAYOUT 1|2|4)' },
  { fn: 'REFRESH', desc: 'Reload the active panel' },
  { fn: 'MENU', desc: 'Go back one screen (Esc)' },
  { fn: 'CLR', desc: 'Clear the active panel' },
];

export const SECURITY_FUNCTIONS = [
  { fn: 'DES', desc: 'Description & reference data' },
  { fn: 'CN', desc: 'Company news' },
  { fn: 'GP', desc: 'Price chart (daily)' },
  { fn: 'GIP', desc: 'Intraday price chart' },
  { fn: 'CF', desc: 'SEC filings' },
  { fn: 'QR', desc: 'Quote recap' },
];

const GLOBAL = new Set(['N', 'NEWS', 'TOP', 'NI', 'NSE', 'MON', 'PORT', 'W', 'ALRT', 'WEI', 'FXC', 'WCRS', 'WB', 'CRYP', 'CRYPTO', 'MOST', 'ECO', 'CEN', 'FED', 'SECF', 'HELP', 'LAYOUT', 'REFRESH', 'MENU', 'BACK', 'CLR', 'PGUP', 'PGDN', 'TAPE']);
const SEC_FN = new Set(['DES', 'CN', 'GP', 'GIP', 'CF', 'FIL', 'QR', 'N']);
const SECTORS = new Set(['EQUITY', 'INDEX', 'CURNCY', 'CRNCY', 'COMDTY', 'GOVT', 'CORP', 'CRYPTO']);
const ALIAS = { NEWS: 'N', PORT: 'MON', WCRS: 'FXC', CRYPTO: 'CRYP', FED: 'CEN', BACK: 'MENU', FIL: 'CF' };
const SYMBOL_RE = /^[A-Z0-9^.=\-&]{1,15}$/;

export function parseCommand(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return { type: 'empty' };
  if (/^\d+$/.test(text)) return { type: 'number', n: parseInt(text, 10) };
  const upper = text.toUpperCase();
  const toks = upper.split(' ');
  const head = ALIAS[toks[0]] || toks[0];

  if (GLOBAL.has(toks[0]) && !(toks.length >= 2 && toks[0] === 'N' && SYMBOL_RE.test(toks[1]) && toks.length === 2 && !GLOBAL.has(toks[1]))) {
    const argsRaw = text.slice(toks[0].length).trim();
    return { type: 'func', fn: head, args: toks.slice(1), argsRaw };
  }

  // <security> <function>  e.g. "AAPL CN", "AAPL US EQUITY DES", "SPX INDEX GP", "EURUSD CURNCY GIP"
  if (toks.length >= 2 && SEC_FN.has(toks[toks.length - 1])) {
    const fn = ALIAS[toks[toks.length - 1]] || toks[toks.length - 1];
    const symToks = toks.slice(0, -1);
    return { type: 'security', fn: fn === 'N' ? 'CN' : fn, symbol: symToks.join(' '), ticker: symToks[0] };
  }
  // "N AAPL" form
  if (toks[0] === 'N' && toks.length === 2 && SYMBOL_RE.test(toks[1])) return { type: 'security', fn: 'CN', symbol: toks[1], ticker: toks[1] };

  // plain security -> security menu
  if (toks.length === 1 && SYMBOL_RE.test(toks[0])) return { type: 'security', fn: 'MENU', symbol: toks[0], ticker: toks[0] };
  if (toks.length <= 3 && SECTORS.has(toks[toks.length - 1]) && SYMBOL_RE.test(toks[0])) return { type: 'security', fn: 'MENU', symbol: upper, ticker: toks[0] };

  // Fallback: free-text news search
  return { type: 'func', fn: 'NSE', args: toks, argsRaw: text };
}

/** Command-line autocomplete suggestions for a partial input. */
export function suggest(partial) {
  const p = String(partial || '').trim().toUpperCase();
  if (!p) return [];
  const toks = p.split(/\s+/);
  const out = [];
  if (toks.length === 1) {
    for (const f of FUNCTIONS) if (f.fn.startsWith(p)) out.push({ cmd: f.fn, desc: f.desc });
  } else if (SYMBOL_RE.test(toks[0]) && !GLOBAL.has(toks[0])) {
    const last = toks[toks.length - 1];
    const sym = toks.slice(0, -1).join(' ');
    for (const f of SECURITY_FUNCTIONS) if (f.fn.startsWith(last)) out.push({ cmd: `${sym} ${f.fn}`, desc: f.desc });
  }
  return out.slice(0, 8);
}
