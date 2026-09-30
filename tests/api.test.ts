import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { makeCtx, rssXml } from './helpers.ts';
import { createApp } from '../src/server/app.ts';

async function serveFeed(xml: string): Promise<{ url: string; close: () => void }> {
  const srv = http.createServer((_req, res) => { res.setHeader('content-type', 'application/rss+xml'); res.end(xml); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/feed.xml`, close: () => srv.close() };
}

describe('HTTP API', () => {
  it('enforces the app token when configured', async () => {
    const ctx = await makeCtx({ cfg: { appToken: 'secret', jobToken: 'job' } });
    const app = createApp();
    expect((await app.fetch(new Request('http://x/api/watches'), ctx)).status).toBe(401);
    expect((await app.fetch(new Request('http://x/api/watches', { headers: { authorization: 'Bearer secret' } }), ctx)).status).toBe(200);
    expect((await app.fetch(new Request('http://x/api/jobs/poll', { method: 'POST', headers: { 'x-job-token': 'job' } }), ctx)).status).toBe(200);
    expect((await app.fetch(new Request('http://x/api/jobs/poll', { method: 'POST' }), ctx)).status).toBe(401);
    const login = await app.fetch(new Request('http://x/api/auth/login', { method: 'POST', body: JSON.stringify({ token: 'secret' }), headers: { 'content-type': 'application/json' } }), ctx);
    expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toContain('inv_session=');
  });

  it('creates watches, ingests a feed end to end and serves a grouped event', async () => {
    const ctx = await makeCtx();
    const app = createApp();
    const post = (p: string, body: unknown) => app.fetch(new Request(`http://x${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx);
    const get = (p: string) => app.fetch(new Request(`http://x${p}`), ctx);
    const w = await (await post('/api/watches', { kind: 'topic', query: 'AI export controls' })).json();
    expect(w.created).toBe(true);
    const feed = await serveFeed(rssXml([
      { title: 'US tightens AI export controls', link: 'https://pub1.example/s1', date: new Date(Date.now() - 3600e3).toUTCString() },
      { title: 'US Tightens AI Export Controls - Pub2', link: 'https://pub2.example/s1?utm_source=rss', date: new Date(Date.now() - 3500e3).toUTCString() },
      { title: 'Unrelated market wrap', link: 'https://pub1.example/s2', date: new Date().toUTCString() },
    ]));
    try {
      const v = await (await post('/api/sources/validate', { url: feed.url })).json();
      expect(v.ok).toBe(true); expect(v.sample.length).toBe(3);
      const s = await (await post('/api/sources', { url: feed.url, name: 'local alert', watchIds: [w.watch.id] })).json();
      expect(s.type).toBe('rss');
      const job = await (await post('/api/refresh', {})).json();
      expect(job.ran).toBe(true); expect(job.poll.newArticles).toBe(3); expect(job.poll.newEvents).toBe(2);
      const events = await (await get(`/api/feed?watch=${w.watch.id}`)).json();
      expect(events.length).toBe(2);
      const grouped = events.find((e: any) => e.source_count === 2);
      expect(grouped.lead_headline).toBe('US tightens AI export controls');
      const detail = await (await get(`/api/events/${grouped.id}`)).json();
      expect(detail.articles.length).toBe(2); expect(detail.articles.map((a: any) => a.publisher).sort()).toEqual(['pub1.example', 'pub2.example']);
      const boot = await (await get('/api/bootstrap')).json();
      expect(boot.watches[0].unread).toBe(2);
      const src = boot.sources.find((x: any) => x.id === s.id);
      expect(src.status).toBe('connected'); expect(src.freshness).toBe('POLLING'); expect(src.last_checked_at).toBeTruthy();
      await post('/api/events/read', { ids: [grouped.id] });
      expect((await (await get('/api/bootstrap')).json()).watches[0].unread).toBe(1);
      const search = await (await get('/api/feed?q=tightens')).json();
      expect(search.length).toBe(1);
      expect((await post('/api/sources/validate', { url: 'http://169.254.169.254/latest' })).status).toBe(400);
    } finally { feed.close(); }
  });

  it('rejects private feed hosts by default', async () => {
    const ctx = await makeCtx({ cfg: { allowPrivateFeeds: false } });
    const app = createApp();
    const r = await app.fetch(new Request('http://x/api/sources', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:9/feed' }), headers: { 'content-type': 'application/json' } }), ctx);
    expect(r.status).toBe(400);
  });
});
