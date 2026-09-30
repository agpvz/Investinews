import type { FetchResult, Source, SourceStatus, Freshness } from '../../core/model.ts';
import type { AppCtx } from '../env.ts';

export interface Adapter {
  type: Source['type'];
  /** Fetch new items. Must be idempotent; the pipeline dedupes on (source_id, source_item_id). */
  fetch(ctx: AppCtx, source: Source): Promise<FetchResult>;
  /** Static status for sources that cannot be polled (external links, missing setup). */
  staticStatus?(source: Source): SourceStatus | null;
}

export function sourceStatus(s: Source, nowMs: number): { status: SourceStatus; freshness: Freshness; detail: string } {
  const cfg = safeJson(s.config);
  if (s.type === 'link') return { status: 'external_link', freshness: 'LINK', detail: 'Automatic ingestion is not available for this source; open the official page.' };
  if (!s.enabled) return { status: 'disabled', freshness: 'OFFLINE', detail: 'Disabled by user.' };
  if (s.type === 'rss' && !s.url) return { status: 'needs_setup', freshness: 'OFFLINE', detail: 'Paste a feed URL to start ingestion.' };
  if (s.type === 'sec_submissions' && !cfg.cik) return { status: 'needs_setup', freshness: 'OFFLINE', detail: 'No SEC CIK resolved for this ticker.' };
  if (s.cooldown_until && s.cooldown_until > nowMs) return { status: /429|rate/i.test(s.last_error || '') ? 'rate_limited' : 'error', freshness: 'OFFLINE', detail: `${s.last_error || 'cooldown'} — retry after ${new Date(s.cooldown_until).toISOString()}` };
  if (s.fail_count > 0 && s.last_error) return { status: 'error', freshness: 'OFFLINE', detail: s.last_error };
  if (!s.last_checked_at) return { status: 'polling', freshness: 'POLLING', detail: 'Not checked yet.' };
  const age = nowMs - (s.last_success_at || 0);
  if (age > 3 * s.interval_sec * 1000) return { status: 'stale', freshness: 'STALE', detail: `Last success ${Math.round(age / 60000)} min ago.` };
  if (age > 1.5 * s.interval_sec * 1000) return { status: 'connected', freshness: 'DELAYED', detail: `Last success ${Math.round(age / 60000)} min ago.` };
  return { status: 'connected', freshness: 'POLLING', detail: `Polled every ${Math.round(s.interval_sec / 60)} min.` };
}

export function safeJson(s: string | null | undefined): Record<string, any> { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
