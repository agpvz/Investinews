-- Investinews schema. All timestamps are INTEGER milliseconds since epoch, UTC.
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ticker','topic')),
  label TEXT NOT NULL,
  symbol TEXT,
  exchange TEXT,
  query TEXT,
  include_terms TEXT NOT NULL DEFAULT '[]',
  exclude_terms TEXT NOT NULL DEFAULT '[]',
  muted INTEGER NOT NULL DEFAULT 0,
  notify_scope TEXT NOT NULL DEFAULT 'all' CHECK (notify_scope IN ('all','material','none')),
  notify_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS watches_identity ON watches(kind, COALESCE(exchange,''), COALESCE(symbol,''), COALESCE(query,''));

CREATE TABLE IF NOT EXISTS identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- cik | issuer_name | alias | isin
  value TEXT NOT NULL,
  UNIQUE(watch_id, kind, value)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- sec_submissions | rss | link
  name TEXT NOT NULL,
  url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_sec INTEGER NOT NULL DEFAULT 600,
  config TEXT NOT NULL DEFAULT '{}',
  etag TEXT,
  last_modified TEXT,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  last_item_published_at INTEGER,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER,
  next_due_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(type, url)
);

CREATE TABLE IF NOT EXISTS watch_sources (
  watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (watch_id, source_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  title_key TEXT NOT NULL,
  publisher TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published_at INTEGER,
  published_known INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  fetched_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'news',   -- news | filing | release
  event_type TEXT,
  filing_accession TEXT,
  filing_form TEXT,
  symbol TEXT,
  exchange TEXT,
  query TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  raw TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_id, source_item_id)
);
CREATE INDEX IF NOT EXISTS articles_url_key ON articles(url_key);
CREATE INDEX IF NOT EXISTS articles_title_key ON articles(title_key);
CREATE INDEX IF NOT EXISTS articles_accession ON articles(filing_accession);
CREATE INDEX IF NOT EXISTS articles_first_seen ON articles(first_seen_at);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  lead_article_id TEXT NOT NULL,
  lead_headline TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'news',
  event_type TEXT,
  filing_accession TEXT,
  first_published_at INTEGER,
  published_known INTEGER NOT NULL DEFAULT 0,
  sort_time INTEGER NOT NULL,       -- first_published_at when known else first_seen_at
  last_updated_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 1,
  article_count INTEGER NOT NULL DEFAULT 1,
  material INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  suppress_push INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_sort ON events(sort_time DESC);
CREATE INDEX IF NOT EXISTS events_updated ON events(last_updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS events_accession ON events(filing_accession) WHERE filing_accession IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_articles (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, article_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_articles_article ON event_articles(article_id);

CREATE TABLE IF NOT EXISTS event_watches (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  matched_at INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, watch_id)
);
CREATE INDEX IF NOT EXISTS event_watches_watch ON event_watches(watch_id);

CREATE TABLE IF NOT EXISTS read_state (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- merge | split
  article_id TEXT,
  from_event_id TEXT,
  to_event_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expired INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_prefs (
  id TEXT PRIMARY KEY,
  quiet_start TEXT,                -- "22:00" local (APP_TZ)
  quiet_end TEXT,                  -- "07:00"
  mode TEXT NOT NULL DEFAULT 'immediate' CHECK (mode IN ('immediate','digest')),
  digest_interval_min INTEGER NOT NULL DEFAULT 60,
  updates_enabled INTEGER NOT NULL DEFAULT 0,
  global_mute INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO notification_prefs (id, mode, updated_at) VALUES ('default', 'immediate', 0);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idem_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,              -- initial | update | digest | test
  event_id TEXT,
  subscription_id TEXT NOT NULL,
  watch_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | sent | failed | expired | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL,
  not_before INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries(status, not_before);

CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  locked_until INTEGER,
  last_run_at INTEGER,
  last_finished_at INTEGER,
  last_status TEXT,
  last_summary TEXT
);
INSERT OR IGNORE INTO jobs (name) VALUES ('poll');

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
