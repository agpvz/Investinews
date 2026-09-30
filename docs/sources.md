# Source matrix

Every adapter is honest about what it can and cannot do. Status values shown in the UI: **connected**, **external link only**, **needs setup**, **rate limited**, **error**, **disabled**, **polling** (not checked yet), **stale**. Freshness labels are measured, never assumed: **POLLING** (checked successfully within its interval), **DELAYED** (older than 1.5× interval), **STALE** (older than 3×), **OFFLINE** (last check failed / cooldown), **LINK** (nothing is ingested). **LIVE** is never shown: no source here streams in real time.

| Source | Adapter | Status | Endpoint | Fields ingested | Auth | Poll interval | Freshness | Failure mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC EDGAR filings | `sec_submissions` | connected (US-listed issuers with a CIK) | `https://data.sec.gov/submissions/CIK##########.json` (official); ticker→CIK from `https://www.sec.gov/files/company_tickers_exchange.json` | accession number, form type, filing date, acceptance datetime, report period, items, primary document URL, filing index URL, issuer name | none; declared `User-Agent` with contact (`SEC_USER_AGENT`) | 10 min default (5–180 configurable); ETag `If-None-Match` | minutes after acceptance (EDGAR publishes near real time) | HTTP 403/429 → cooldown with exponential backoff; per-source error shown; other sources unaffected |
| Google Alerts (RSS delivery) | `rss` | connected after one manual step | user pastes `https://www.google.com/alerts/feeds/…` | title, real article URL (unwrapped from Google redirect), publisher host, published time, short snippet | none (feed URL is a private token: stored server-side only, never sent to the client) | 15 min default | Google batches alerts (minutes to hours) | parse error / HTTP error → cooldown; feed removed by user → 404 → error state |
| Investor-relations / publisher RSS or Atom | `rss` | connected | any public `http(s)` feed the user supplies | title, link, guid, published/updated, description (plain text), categories | none | 15 min default | depends on publisher | same as above; SSRF guard blocks private/local hosts and redirects into them |
| JSE SENS | `link` | **external link only** | `https://clientportal.jse.co.za/communication/sens-announcements` | nothing ingested | — | — | LINK | JSE market announcements are subject to JSE distribution terms; no scraping. Attach the issuer's official RSS feed or a licensed SENS distributor adapter (implement `Adapter` in `src/server/adapters/`) |
| Google News | `link` | **external link only** | `https://news.google.com/search?q=…` | nothing ingested | — | — | LINK | no permitted machine-readable API for this use; use Google Alerts RSS instead |
| Yahoo Finance | `link` | **external link only** | `https://finance.yahoo.com/quote/SYMBOL/news` | nothing ingested | — | — | LINK | unofficial endpoints are deliberately not used |
| Public presets (SEC current 8-K Atom, Federal Reserve, BoE, ECB, BLS, CNBC, MarketWatch, BBC, Moneyweb) | `rss` | connected once enabled (Sources → public feeds) | official/publisher RSS URLs listed in `src/server/watches.ts` | headlines, links, times | none | 15 min | depends on publisher | as RSS |

## What is stored

Headlines, canonical links, publisher, publish/update/fetch timestamps, a short plain-text description (≤1000 chars, HTML stripped, never rendered as HTML), filing identifiers, and raw adapter metadata for debugging. Full article bodies are never fetched or stored. Every article links to its original publisher.

## SEC fair access

- `SEC_USER_AGENT` must identify the application and a contact address (SEC requires it; requests without it are blocked).
- Requests are serialized with a 200 ms minimum spacing (≤5 req/s, below SEC's 10 req/s guidance) and cached with ETags.
- The ticker/exchange mapping is cached in memory for 24 h.
- Docs: <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>, <https://www.sec.gov/about/developer-resources>.

## Google Alerts

Create the alert at <https://www.google.com/alerts>, choose *Deliver to: RSS feed*, copy the feed URL (RSS icon) and paste it under Sources, mapping it to a watch. The app cannot create alerts programmatically (Google offers no API). Docs: <https://support.google.com/websearch/answer/4815696>.

## JSE SENS

The JSE publishes SENS on its client portal and licenses redistribution; see <https://www.jse.co.za/market-data/market-announcements>. This app links to the official page and shows *automatic SENS ingestion unavailable*. Issuer-provided RSS/Atom feeds can be attached to a JSE ticker.

## Adding an adapter

Implement `Adapter` (`src/server/adapters/types.ts`): `fetch(ctx, source)` returns normalized items (`NormalizedItem`, see `src/core/model.ts`). Register it in `src/server/adapters/index.ts`. The pipeline handles dedupe, matching, clustering and notifications; the adapter never touches the event model.
