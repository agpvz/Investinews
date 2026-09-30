// Deterministic, layered event clustering. Pure functions; the DB layer supplies candidates.
import { jaccard, periodMarkers, tokens } from './text.ts';

export interface ClusterArticle { id: string; eventId: string; urlKey: string; titleKey: string; publisher: string; publishedAt: number | null; firstSeenAt: number; accession: string | null; category: string; flags: string[]; symbol: string | null; watchIds: string[] }
export interface ClusterInput { urlKey: string; titleKey: string; headline: string; publisher: string; publishedAt: number | null; firstSeenAt: number; accession: string | null; category: string; flags: string[]; symbol: string | null; watchIds: string[] }

export const SYNDICATION_WINDOW_MS = 7 * 24 * 3600_000;
export const FUZZY_WINDOW_MS = 48 * 3600_000;
export const FUZZY_THRESHOLD = 0.6;

export type ClusterDecision = { eventId: string; layer: 'accession' | 'url' | 'title' | 'fuzzy' } | null;

const timeOf = (a: { publishedAt: number | null; firstSeenAt: number }) => a.publishedAt ?? a.firstSeenAt;
const hasCorrection = (f: string[]) => f.includes('correction') || f.includes('retraction') || f.includes('clarification');

/**
 * Returns the event the new article should join, or null for a new event.
 * Layers: SEC accession; exact url key; exact title key + publisher syndication window; bounded fuzzy similarity with shared context.
 */
export function decideCluster(input: ClusterInput, candidates: ClusterArticle[]): ClusterDecision {
  // Filings only ever cluster by accession number. Different accessions are always different events.
  if (input.accession) {
    const hit = candidates.find((c) => c.accession === input.accession);
    return hit ? { eventId: hit.eventId, layer: 'accession' } : null;
  }
  const t = timeOf(input);
  const newCorr = hasCorrection(input.flags);
  const compatible = (c: ClusterArticle) => !c.accession && c.category !== 'filing' && hasCorrection(c.flags) === newCorr;

  const byUrl = candidates.find((c) => compatible(c) && c.urlKey && c.urlKey === input.urlKey);
  if (byUrl) return { eventId: byUrl.eventId, layer: 'url' };

  const byTitle = candidates.find((c) => compatible(c) && c.titleKey && c.titleKey === input.titleKey && Math.abs(timeOf(c) - t) <= SYNDICATION_WINDOW_MS);
  if (byTitle) return { eventId: byTitle.eventId, layer: 'title' };

  const newTok = tokens(input.headline);
  if (newTok.length < 3) return null; // too little signal for fuzzy grouping
  const newPeriods = periodMarkers(input.headline);
  let best: { c: ClusterArticle; score: number } | null = null;
  for (const c of candidates) {
    if (!compatible(c) || Math.abs(timeOf(c) - t) > FUZZY_WINDOW_MS) continue;
    const shareContext = (input.symbol && c.symbol && input.symbol === c.symbol) || input.watchIds.some((w) => c.watchIds.includes(w));
    if (!shareContext) continue;
    const cp = periodMarkers(c.titleKey);
    let conflict = false;
    for (const p of newPeriods) if (!cp.has(p) && [...cp].some((x) => x[0] === p[0])) conflict = true; // q1 vs q2, 2024 vs 2025
    if (conflict) continue;
    const score = jaccard(newTok, tokens(c.titleKey));
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { c, score };
  }
  return best ? { eventId: best.c.eventId, layer: 'fuzzy' } : null;
}
