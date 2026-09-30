import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHeadline, dedupe, mergeHeadlines, shortSource, normTitle } from '../server/lib/news.js';
import { resolveSymbol } from '../server/sources/market.js';
import { resolveCategory } from '../server/sources/feeds.js';
import { decodeGoogleNewsUrl } from '../server/lib/article.js';

test('toHeadline splits Google News "Headline - Publisher" and codes the source', () => {
  const h = toHeadline({ title: 'Apple beats estimates - Reuters', link: 'https://r.com/1', ts: 5, description: 'x' });
  assert.equal(h.headline, 'Apple beats estimates');
  assert.equal(h.source, 'RTRS');
  assert.equal(h.sourceName, 'Reuters');
  assert.equal(h.id.length, 12);
});

test('shortSource codes known and unknown publishers', () => {
  assert.equal(shortSource('The Wall Street Journal'), 'WSJ');
  assert.equal(shortSource('', 'https://www.example-times.com/x'), 'EXAMP');
  assert.equal(shortSource('Some Random Publisher'), 'SRP');
});

test('dedupe removes url and near-title duplicates, merge sorts by time', () => {
  const a = toHeadline({ title: 'Fed holds rates steady', link: 'https://a.com/1', ts: 100 });
  const b = toHeadline({ title: 'Fed holds rates steady - CNBC', link: 'https://b.com/2', ts: 200 });
  const c = toHeadline({ title: 'Different story', link: 'https://a.com/1?utm=x', ts: 300 });
  const d = toHeadline({ title: 'Another', link: 'https://d.com', ts: 400 });
  const out = mergeHeadlines([[a, b], [c, d]]);
  assert.deepEqual(out.map((x) => x.headline), ['Another', 'Fed holds rates steady']);
  assert.equal(dedupe([a, a]).length, 1);
  assert.equal(normTitle('Hello, World! - Bloomberg'), 'hello world');
});

test('resolveSymbol maps Bloomberg mnemonics and sector suffixes', () => {
  assert.equal(resolveSymbol('AAPL US EQUITY'), 'AAPL');
  assert.equal(resolveSymbol('SPX INDEX'), '^GSPC');
  assert.equal(resolveSymbol('EURUSD CURNCY'), 'EURUSD=X');
  assert.equal(resolveSymbol('USDJPY CURNCY'), 'JPY=X');
  assert.equal(resolveSymbol('CL1 COMDTY'), 'CL=F');
  assert.equal(resolveSymbol('XBT CRYPTO'), 'BTC-USD');
  assert.equal(resolveSymbol('VOD LN EQUITY'), 'VOD.L');
  assert.equal(resolveSymbol('7203 JP EQUITY'), '7203.T');
  assert.equal(resolveSymbol('btc-usd'), 'BTC-USD');
  assert.equal(resolveSymbol('FOO INDEX'), '^FOO');
});

test('resolveCategory handles codes and aliases', () => {
  assert.equal(resolveCategory('tech'), 'TECH');
  assert.equal(resolveCategory('FED'), 'CEN');
  assert.equal(resolveCategory('nonsense'), null);
});

test('decodeGoogleNewsUrl leaves non-google and undecodable urls alone', () => {
  assert.equal(decodeGoogleNewsUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(decodeGoogleNewsUrl('https://news.google.com/rss/articles/zzzz'), 'https://news.google.com/rss/articles/zzzz');
  const payload = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, 0x1a]), Buffer.from('https://example.com/story'), Buffer.from([0xd2, 0x01, 0x00])]).toString('base64url');
  assert.equal(decodeGoogleNewsUrl(`https://news.google.com/rss/articles/${payload}?oc=5`), 'https://example.com/story');
});
