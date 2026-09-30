import { describe, it, expect } from 'vitest';
import { matchArticleToWatch } from '../src/core/match.ts';
import type { Watch, Identity } from '../src/core/model.ts';

const w = (over: Partial<Watch>): Watch => ({ id: 'w1', kind: 'ticker', label: 'NASDAQ:NVDA', symbol: 'NVDA', exchange: 'NASDAQ', query: null, include_terms: '[]', exclude_terms: '[]', muted: 0, notify_scope: 'all', notify_from: 0, created_at: 0, updated_at: 0, ...over });
const a = (headline: string, over: Record<string, unknown> = {}) => ({ headline, description: '', symbol: null, exchange: null, query: null, ...over });
const nvda = w({}); const ids: Identity[] = [{ watch_id: 'w1', kind: 'cik', value: '0001045810' }, { watch_id: 'w1', kind: 'issuer_name', value: 'NVIDIA CORP' }, { watch_id: 'w1', kind: 'alias', value: 'Nvidia' }];

describe('ticker matching', () => {
  it('matches ticker notation, issuer name and aliases', () => {
    expect(matchArticleToWatch(a('$NVDA breaks out'), nvda, ids, false).matched).toBe(true);
    expect(matchArticleToWatch(a('Chipmaker (NASDAQ: NVDA) reports'), nvda, ids, false).reason).toBe('ticker-notation');
    expect(matchArticleToWatch(a('Nvidia unveils new GPU'), nvda, ids, false).reason).toBe('alias:Nvidia');
    expect(matchArticleToWatch(a('NVDA rallies'), nvda, ids, false).reason).toBe('symbol-upper');
  });
  it('does not match unrelated stories', () => {
    expect(matchArticleToWatch(a('Markets rally on Fed hopes'), nvda, ids, false).matched).toBe(false);
    expect(matchArticleToWatch(a('nvda lowercase in prose is not a ticker'), nvda, [], false).matched).toBe(false);
  });
  it('never matches common-word tickers on the bare word', () => {
    const ai = w({ id: 'w2', label: 'NYSE:AI', symbol: 'AI', exchange: 'NYSE' });
    expect(matchArticleToWatch(a('AI export controls tighten'), ai, [], false).matched).toBe(false);
    expect(matchArticleToWatch(a('The future of AI'), ai, [], false).matched).toBe(false);
    expect(matchArticleToWatch(a('C3.ai (NYSE: AI) reports results'), ai, [], false).matched).toBe(true);
    expect(matchArticleToWatch(a('$AI surges'), ai, [], false).matched).toBe(true);
    const on = w({ id: 'w3', label: 'NASDAQ:ON', symbol: 'ON', exchange: 'NASDAQ' });
    expect(matchArticleToWatch(a('Lights ON for the market'), on, [], false).matched).toBe(false);
  });
  it('honours exclude terms and source binding', () => {
    const ex = w({ exclude_terms: '["rumor"]' });
    expect(matchArticleToWatch(a('$NVDA rumor mill'), ex, ids, false).matched).toBe(false);
    expect(matchArticleToWatch(a('Anything at all'), nvda, ids, true).reason).toBe('source');
    expect(matchArticleToWatch(a('rumor from bound source'), ex, ids, true).matched).toBe(false);
  });
  it('uses symbol metadata from ticker-bound adapters', () => {
    expect(matchArticleToWatch(a('8-K: NVIDIA CORP', { symbol: 'NVDA', exchange: 'NASDAQ' }), nvda, [], false).reason).toBe('symbol-meta');
  });
});

describe('topic matching', () => {
  const topic = w({ id: 't1', kind: 'topic', label: 'AI export controls', symbol: null, exchange: null, query: 'AI export controls' });
  it('matches phrase or all significant terms', () => {
    expect(matchArticleToWatch(a('US tightens AI export controls on chips'), topic, [], false).reason).toBe('phrase');
    expect(matchArticleToWatch(a('Export control rules for AI chips expanded'), topic, [], false).reason).toBe('all-terms');
    expect(matchArticleToWatch(a('AI boom lifts chip stocks'), topic, [], false).matched).toBe(false);
  });
  it('include terms extend a topic', () => {
    const t2 = w({ ...topic, include_terms: '["BIS entity list"]' });
    expect(matchArticleToWatch(a('BIS entity list adds new firms'), t2, [], false).reason).toBe('include:BIS entity list');
  });
});
