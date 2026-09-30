// Relevance matching: does an article belong to a watch? Deterministic and explainable.
import type { Article, Identity, Watch } from './model.ts';
import { STOPWORDS } from './text.ts';

/** Tickers that are also ordinary words: never match on the bare symbol, require context. */
export const COMMON_WORD_TICKERS = new Set(['AI', 'ON', 'IT', 'ALL', 'ARE', 'BE', 'BIG', 'CAT', 'DAY', 'DO', 'FOR', 'GO', 'HAS', 'HD', 'LOW', 'MAN', 'NOW', 'ONE', 'OPEN', 'OUT', 'PAY', 'PLAY', 'RUN', 'SEE', 'SO', 'TV', 'UP', 'USA', 'WELL', 'YOU', 'NEW', 'CAR', 'KEY', 'ICE', 'GAS', 'OIL', 'BILL', 'JOB', 'LIFE', 'LOVE', 'MAIN', 'REAL', 'SAFE', 'STAY', 'TWO', 'TEN', 'FUN', 'FAST', 'FLOW', 'GOLD', 'GOOD', 'HOPE', 'HOME', 'AN', 'AS', 'AT', 'BY', 'IN', 'IS', 'OF', 'OR', 'TO', 'WE', 'NET', 'LINK', 'SNAP', 'RACE', 'CASH', 'ROCK', 'SAND', 'BOX', 'MAX', 'PLUS', 'CORE', 'EDGE', 'GAIN', 'GROW', 'LAND', 'PEAK', 'PATH', 'SITE', 'TEAM', 'TECH', 'TRUE', 'WORK']);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (term: string) => new RegExp(`(^|[^a-z0-9])${esc(term.toLowerCase())}(?=$|[^a-z0-9])`, 'i');

function parseTerms(json: string): string[] { try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; } }

export interface MatchResult { matched: boolean; reason: string }

/** Match on the article's own metadata (symbol/exchange attached by a ticker-bound source or SEC). */
function symbolMetaMatch(a: Pick<Article, 'symbol' | 'exchange'>, w: Watch): boolean {
  return !!(w.kind === 'ticker' && a.symbol && a.symbol.toUpperCase() === (w.symbol || '').toUpperCase() && (!a.exchange || !w.exchange || a.exchange.toUpperCase() === w.exchange.toUpperCase()));
}

export function matchArticleToWatch(a: Pick<Article, 'headline' | 'description' | 'symbol' | 'exchange' | 'query'>, w: Watch, identities: Identity[], boundSource: boolean): MatchResult {
  const text = `${a.headline} ${a.description || ''}`;
  const lower = text.toLowerCase();
  const exclude = parseTerms(w.exclude_terms);
  for (const x of exclude) if (wordRe(x).test(lower)) return { matched: false, reason: `excluded:${x}` };
  if (boundSource) return { matched: true, reason: 'source' };
  if (symbolMetaMatch(a, w)) return { matched: true, reason: 'symbol-meta' };
  const include = parseTerms(w.include_terms);
  for (const t of include) if (t.length >= 2 && wordRe(t).test(lower)) return { matched: true, reason: `include:${t}` };

  if (w.kind === 'ticker' && w.symbol) {
    const sym = w.symbol.toUpperCase();
    // Explicit ticker notation always matches: $NVDA, NASDAQ:NVDA, (NASDAQ: NVDA), NVDA.O, NYSE: NVDA
    const explicit = new RegExp(`(\\$${esc(sym)}\\b|\\b(?:NASDAQ|NYSE|AMEX|JSE|LSE|TSX|ASX|CBOE|NYSEARCA|OTC|OTCQX|OTCQB|XETRA|EURONEXT|SIX|HKEX|TSE|NSE|BSE)\\s*:\\s*${esc(sym)}\\b)`, 'i');
    if (explicit.test(text)) return { matched: true, reason: 'ticker-notation' };
    // Issuer name / aliases (from SEC or user)
    for (const id of identities) {
      if ((id.kind === 'issuer_name' || id.kind === 'alias') && id.value.length >= 3 && wordRe(id.value).test(lower)) return { matched: true, reason: `${id.kind}:${id.value}` };
    }
    // Bare symbol only when unambiguous: 4+ letters, not a common word, and not lowercase-in-prose
    if (sym.length >= 4 && !COMMON_WORD_TICKERS.has(sym) && !STOPWORDS.has(sym.toLowerCase())) {
      const bare = new RegExp(`(^|[^A-Za-z0-9])${esc(sym)}(?=$|[^A-Za-z0-9])`); // case-sensitive uppercase token
      if (bare.test(text)) return { matched: true, reason: 'symbol-upper' };
    }
    return { matched: false, reason: 'no-ticker-context' };
  }

  if (w.kind === 'topic' && w.query) {
    const terms = w.query.toLowerCase().split(/[^a-z0-9$%+#.-]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
    if (!terms.length) return { matched: false, reason: 'empty-query' };
    // Phrase match wins; otherwise every significant term must appear (AND), tolerating simple plurals.
    if (lower.includes(w.query.toLowerCase())) return { matched: true, reason: 'phrase' };
    const stem = (t: string) => (t.length > 3 ? t.replace(/(ies|es|s)$/, '') : t);
    const all = terms.every((t) => new RegExp(`(^|[^a-z0-9])${esc(stem(t))}(ies|es|s|ed|ing)?(?=$|[^a-z0-9])`, 'i').test(lower));
    return all ? { matched: true, reason: 'all-terms' } : { matched: false, reason: 'missing-terms' };
  }
  return { matched: false, reason: 'unsupported' };
}
