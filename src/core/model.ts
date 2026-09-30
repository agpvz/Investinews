// Shared types for the normalized item model and persisted entities.

export type WatchKind = 'ticker' | 'topic';
export type NotifyScope = 'all' | 'material' | 'none';
export type SourceType = 'sec_submissions' | 'rss' | 'link';
export type Category = 'news' | 'filing' | 'release';

export interface Watch {
  id: string;
  kind: WatchKind;
  label: string;
  symbol: string | null;
  exchange: string | null;
  query: string | null;
  include_terms: string; // JSON string[]
  exclude_terms: string; // JSON string[]
  muted: number;
  notify_scope: NotifyScope;
  notify_from: number;
  created_at: number;
  updated_at: number;
}

export interface Identity { id?: number; watch_id: string; kind: 'cik' | 'issuer_name' | 'alias' | 'isin'; value: string }

export interface Source {
  id: string;
  type: SourceType;
  name: string;
  url: string | null;
  enabled: number;
  interval_sec: number;
  config: string; // JSON
  etag: string | null;
  last_modified: string | null;
  last_checked_at: number | null;
  last_success_at: number | null;
  last_item_published_at: number | null;
  last_error: string | null;
  fail_count: number;
  cooldown_until: number | null;
  next_due_at: number;
  created_at: number;
}

/** What every adapter produces: the common normalized item model. */
export interface NormalizedItem {
  sourceItemId: string;
  url: string;
  headline: string;
  publisher: string;
  description?: string;
  publishedAt?: number | null; // ms UTC; undefined/null => unknown
  updatedAt?: number | null;
  category?: Category;
  eventType?: string | null;
  filingAccession?: string | null;
  filingForm?: string | null;
  symbol?: string | null;
  exchange?: string | null;
  query?: string | null;
  flags?: string[];
  raw?: Record<string, unknown>;
}

export interface Article {
  id: string;
  source_id: string;
  source_item_id: string;
  url: string;
  canonical_url: string;
  url_key: string;
  headline: string;
  title_key: string;
  publisher: string;
  description: string;
  published_at: number | null;
  published_known: number;
  updated_at: number | null;
  fetched_at: number;
  first_seen_at: number;
  category: Category;
  event_type: string | null;
  filing_accession: string | null;
  filing_form: string | null;
  symbol: string | null;
  exchange: string | null;
  query: string | null;
  flags: string;
  raw: string;
}

export interface EventRow {
  id: string;
  lead_article_id: string;
  lead_headline: string;
  category: Category;
  event_type: string | null;
  filing_accession: string | null;
  first_published_at: number | null;
  published_known: number;
  sort_time: number;
  last_updated_at: number;
  first_seen_at: number;
  source_count: number;
  article_count: number;
  material: number;
  flags: string;
  version: number;
  suppress_push: number;
  created_at: number;
  updated_at: number;
}

export interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string; user_agent: string; label: string; created_at: number; last_seen_at: number; expired: number }

export interface NotificationPrefs { id: string; quiet_start: string | null; quiet_end: string | null; mode: 'immediate' | 'digest'; digest_interval_min: number; updates_enabled: number; global_mute: number; updated_at: number }

export interface FetchResult { items: NormalizedItem[]; etag?: string | null; lastModified?: string | null; notModified?: boolean; note?: string }

export type SourceStatus = 'connected' | 'external_link' | 'needs_setup' | 'rate_limited' | 'error' | 'disabled' | 'polling' | 'stale';
export type Freshness = 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'POLLING' | 'LINK';
