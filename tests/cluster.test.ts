import { describe, it, expect } from 'vitest';
import { decideCluster, type ClusterArticle } from '../src/core/cluster.ts';
import { titleKey } from '../src/core/text.ts';
import { urlKey } from '../src/core/url.ts';

const T0 = Date.UTC(2026, 5, 1, 12, 0);
const cand = (h: string, over: Partial<ClusterArticle> = {}): ClusterArticle => ({ id: 'a', eventId: `e:${h}`, urlKey: urlKey(`https://pub.com/${encodeURIComponent(h)}`), titleKey: titleKey(h), publisher: 'Pub', publishedAt: T0, firstSeenAt: T0, accession: null, category: 'news', flags: [], symbol: 'NVDA', watchIds: ['w1'], ...over });
const input = (h: string, over: Partial<Parameters<typeof decideCluster>[0]> = {}) => ({ urlKey: urlKey(`https://other.com/${encodeURIComponent(h)}`), titleKey: titleKey(h), headline: h, publisher: 'Other', publishedAt: T0 + 3600e3, firstSeenAt: T0 + 3600e3, accession: null, category: 'news', flags: [], symbol: 'NVDA', watchIds: ['w1'], ...over });

describe('clustering layers', () => {
  it('groups by exact url', () => {
    const c = cand('Nvidia beats estimates');
    expect(decideCluster(input('Different title', { urlKey: c.urlKey }), [c])).toEqual({ eventId: c.eventId, layer: 'url' });
  });
  it('groups syndicated copies by normalized title', () => {
    const c = cand('Nvidia beats estimates');
    expect(decideCluster(input('Nvidia Beats Estimates - Bloomberg'), [c])?.layer).toBe('title');
  });
  it('groups fuzzy matches only with shared context', () => {
    const c = cand('Nvidia beats Wall Street estimates on data center demand');
    expect(decideCluster(input('Nvidia beats Wall Street estimates as data center demand soars'), [c])?.layer).toBe('fuzzy');
    expect(decideCluster(input('Nvidia beats Wall Street estimates as data center demand soars', { symbol: 'AMD', watchIds: ['w9'] }), [c])).toBeNull();
  });
  it('keeps distinct filings, quarters and corrections apart', () => {
    const f1 = cand('8-K: NVIDIA CORP', { accession: '0001-24-000001', category: 'filing' });
    expect(decideCluster(input('8-K: NVIDIA CORP', { accession: '0001-24-000002', category: 'filing' }), [f1])).toBeNull();
    expect(decideCluster(input('8-K: NVIDIA CORP', { accession: '0001-24-000001', category: 'filing' }), [f1])?.layer).toBe('accession');
    const q1 = cand('Nvidia reports first quarter revenue up 200% on AI demand');
    expect(decideCluster(input('Nvidia reports second quarter revenue up 200% on AI demand'), [q1])).toBeNull();
    const orig = cand('Nvidia to acquire chip startup for $2 billion');
    expect(decideCluster(input('CORRECTION: Nvidia to acquire chip startup for $2 billion', { flags: ['correction'] }), [orig])).toBeNull();
  });
  it('does not group across the time window or on thin headlines', () => {
    const c = cand('Nvidia beats estimates');
    expect(decideCluster(input('Nvidia beats estimates', { publishedAt: T0 + 30 * 86400e3, firstSeenAt: T0 + 30 * 86400e3 }), [c])).toBeNull();
    expect(decideCluster(input('Nvidia up'), [cand('Nvidia down')])).toBeNull();
  });
});
