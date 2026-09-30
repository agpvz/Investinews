import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DEMO = '1';
process.env.SETTINGS_FILE = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'investinews-')), 'settings.json');
const { buildRouter } = await import('../server/routes.js');

let server, base;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', buildRouter());
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

test('health reports demo mode', async () => { const { body } = await get('/health'); assert.equal(body.ok, true); assert.equal(body.demo, true); });
test('top news by category', async () => { const { body } = await get('/top?cat=tech'); assert.equal(body.category, 'TECH'); assert.ok(body.items.length > 10); assert.ok(body.items.every((h) => h.id && h.headline && h.ts)); });
test('ticker news resolves Bloomberg syntax and includes quote', async () => { const { body } = await get('/news?ticker=AAPL+US+EQUITY'); assert.equal(body.symbol, 'AAPL'); assert.equal(body.kind, 'ticker'); assert.ok(body.quote.last > 0); assert.ok(body.items[0].tickers.includes('AAPL')); });
test('topic news: category code vs free topic', async () => { assert.equal((await get('/news?topic=FED')).body.kind, 'category'); assert.equal((await get('/news?topic=lithium')).body.kind, 'topic'); });
test('news requires a query', async () => { assert.equal((await get('/news')).status, 400); });
test('mynews merges groups sorted by time', async () => { const { body } = await get('/mynews?tickers=AAPL,MSFT&topics=AI'); assert.deepEqual(Object.keys(body.groups).sort(), ['AAPL', 'AI', 'MSFT']); for (let i = 1; i < body.items.length; i++) assert.ok(body.items[i - 1].ts >= body.items[i].ts); });
test('quotes and chart', async () => { const { body } = await get('/quotes?symbols=SPX+INDEX,EURUSD+CURNCY'); assert.equal(body[0].symbol, '^GSPC'); assert.equal(body[1].symbol, 'EURUSD=X'); assert.ok(Array.isArray(body[0].spark)); const c = (await get('/chart?symbol=AAPL&range=5d')).body; assert.ok(c.series.length > 50); assert.equal((await get('/chart')).status, 400); });
test('des, filings, trending, finder, crypto, fx, article', async () => {
  const des = (await get('/des?symbol=AAPL')).body; assert.equal(des.symbol, 'AAPL'); assert.ok(des.wiki.extract); assert.ok(des.sec.recent.length);
  assert.ok((await get('/filings?symbol=AAPL')).body.filings.length);
  assert.ok((await get('/trending')).body.quotes.length);
  assert.ok((await get('/search-security?q=apple')).body.some((r) => r.symbol === 'AAPL'));
  assert.ok((await get('/crypto')).body.length);
  assert.ok((await get('/fx')).body.rates.EUR);
  assert.ok((await get('/article?url=https://example.com/x')).body.paragraphs.length);
  assert.equal((await get('/article')).status, 400);
});
test('settings round-trip sanitises input', async () => {
  const r = await fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: ['aapl', 'aapl', ' msft '], topics: ['AI'], alerts: ['x'], layout: 9 }) });
  const s = await r.json(); assert.deepEqual(s.tickers, ['AAPL', 'MSFT']); assert.equal(s.layout, 4); assert.ok(s.tape.length);
  assert.deepEqual((await get('/settings')).body.tickers, ['AAPL', 'MSFT']);
});
