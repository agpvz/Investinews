import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, stripHtml, decodeEntities } from '../server/lib/rss.js';

test('parses RSS 2.0 with CDATA, entities and source tag', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed &amp; Co</title>
  <item><title><![CDATA[AT&T shares jump]]></title><link>https://x.com/a?b=1&amp;c=2</link><pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
  <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description><source url="https://x.com">Example News</source><category>Markets</category></item>
  <item><title>Second</title><guid>https://x.com/2</guid></item>
  </channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.title, 'Feed & Co');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'AT&T shares jump');
  assert.equal(f.items[0].link, 'https://x.com/a?b=1&c=2');
  assert.equal(f.items[0].description, 'Hello world');
  assert.equal(f.items[0].source, 'Example News');
  assert.deepEqual(f.items[0].categories, ['Markets']);
  assert.equal(f.items[0].ts, Date.parse('2024-01-01T12:00:00Z'));
  assert.equal(f.items[1].link, 'https://x.com/2');
});

test('parses Atom entries with rel=alternate links', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>SEC</title>
  <entry><title>8-K - ACME CORP</title><link rel="self" href="https://sec.gov/self"/><link rel="alternate" type="text/html" href="https://sec.gov/doc.htm"/><updated>2024-05-01T10:00:00-04:00</updated><summary>Form 8-K</summary></entry></feed>`;
  const f = parseFeed(xml);
  assert.equal(f.items[0].link, 'https://sec.gov/doc.htm');
  assert.equal(f.items[0].title, '8-K - ACME CORP');
  assert.equal(f.items[0].description, 'Form 8-K');
});

test('handles Google News style self-closed link', () => {
  const xml = `<rss><channel><item><title>Headline - Reuters</title><link/>https://news.google.com/rss/articles/abc<pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate></item></channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.items[0].link, 'https://news.google.com/rss/articles/abc');
});

test('stripHtml and decodeEntities', () => {
  assert.equal(stripHtml('<p>a &amp; b</p><script>x()</script>'), 'a & b');
  assert.equal(decodeEntities('&#8217;s &#x27;'), '’s \'');
  assert.equal(parseFeed('').items.length, 0);
});
