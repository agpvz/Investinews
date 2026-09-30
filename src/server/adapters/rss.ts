// Generic RSS/Atom adapter: Google Alerts RSS, investor-relations feeds, publisher feeds — anything the user supplies.
import type { Adapter } from './types.ts';
import type { FetchResult, NormalizedItem, Source } from '../../core/model.ts';
import type { AppCtx } from '../env.ts';
import { parseFeed } from '../../core/rss.ts';
import { hostOf, urlKey } from '../../core/url.ts';
import { safeFetch, FetchError } from '../fetch.ts';
import { safeJson } from './types.ts';
import { correctionFlags } from '../../core/text.ts';

/** Google Alerts wraps article links: https://www.google.com/url?...&url=<real>&... */
export function unwrapRedirect(link: string): string {
  try {
    const u = new URL(link);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') {
      const real = u.searchParams.get('url') || u.searchParams.get('q');
      if (real && /^https?:\/\//.test(real)) return real;
    }
  } catch { /* ignore */ }
  return link;
}

export function isGoogleAlertsFeed(url: string): boolean { try { const u = new URL(url); return u.hostname === 'www.google.com' && u.pathname.startsWith('/alerts/feeds/'); } catch { return false; } }

export const rssAdapter: Adapter = {
  type: 'rss',
  async fetch(ctx: AppCtx, source: Source): Promise<FetchResult> {
    if (!source.url) throw new FetchError('feed has no url');
    const cfg = safeJson(source.config);
    const headers: Record<string, string> = { 'User-Agent': 'investinews/2.0 (+personal news reader; RSS)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' };
    if (source.etag) headers['If-None-Match'] = source.etag;
    if (source.last_modified) headers['If-Modified-Since'] = source.last_modified;
    const res = await safeFetch(source.url, { headers, userSupplied: !ctx.cfg.allowPrivateFeeds, resolveHost: ctx.resolveHost, maxBytes: 3_000_000 });
    if (res.status === 304) return { items: [], notModified: true, etag: source.etag, lastModified: source.last_modified };
    if (res.status === 429) throw new FetchError('rate limited (HTTP 429)', 429);
    if (res.status !== 200) throw new FetchError(`HTTP ${res.status}`, res.status);
    const feed = parseFeed(res.text, { maxItems: Number(cfg.maxItems) || 200 });
    if (feed.kind === 'unknown' && !feed.items.length) throw new FetchError('not a recognizable RSS/Atom feed');
    const feedHost = hostOf(source.url);
    const items: NormalizedItem[] = [];
    for (const it of feed.items) {
      const link = unwrapRedirect(it.link);
      if (!link || !/^https?:\/\//i.test(link) || !it.title) continue;
      // Aggregator feeds (Google Alerts and similar) link out to many publishers: attribute by link host. Single-publisher feeds keep the feed title.
      const linkHost = hostOf(link);
      const publisher = it.source || (linkHost && linkHost !== feedHost && !feedHost.endsWith(`.${linkHost}`) && !linkHost.endsWith(`.${feedHost}`) ? linkHost : feed.title || feedHost) || linkHost;
      items.push({
        sourceItemId: it.guid || urlKey(link),
        url: link, headline: it.title, publisher, description: it.description,
        publishedAt: it.ts ?? it.updated ?? null, updatedAt: it.updated ?? null,
        category: cfg.category === 'release' ? 'release' : 'news',
        symbol: cfg.symbol || null, exchange: cfg.exchange || null, query: cfg.query || null,
        flags: correctionFlags(it.title, it.description),
        raw: { author: it.author, categories: it.categories, feedTitle: feed.title },
      });
    }
    return { items, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  },
};
