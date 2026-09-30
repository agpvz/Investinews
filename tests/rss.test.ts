import { describe, it, expect } from 'vitest';
import { parseFeed } from '../src/core/rss.ts';
import { unwrapRedirect, isGoogleAlertsFeed } from '../src/server/adapters/rss.ts';

describe('feed parsing', () => {
  it('parses RSS with CDATA and entities', () => {
    const f = parseFeed('<rss><channel><title>T &amp; U</title><item><title><![CDATA[AT&T rallies]]></title><link>https://x.com/a?b=1&amp;c=2</link><pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate><description>&lt;p&gt;hi&lt;/p&gt;</description></item></channel></rss>');
    expect(f.kind).toBe('rss'); expect(f.title).toBe('T & U');
    expect(f.items[0]).toMatchObject({ title: 'AT&T rallies', link: 'https://x.com/a?b=1&c=2', description: 'hi', ts: Date.parse('2024-01-01T12:00:00Z') });
  });
  it('parses Google Alerts Atom entries and unwraps redirect links', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Google Alert - AI export controls</title><entry><id>tag:google.com,2013:googlealerts/feed:123</id><title type="html">US tightens &lt;b&gt;AI export controls&lt;/b&gt;</title><link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://news.example.com/story-1&amp;ct=ga&amp;cd=x"/><published>2024-05-01T10:00:00Z</published><content type="html">Some &lt;b&gt;summary&lt;/b&gt;</content></entry></feed>`;
    const f = parseFeed(xml);
    expect(f.kind).toBe('atom'); expect(f.items[0].title).toBe('US tightens AI export controls');
    expect(unwrapRedirect(f.items[0].link)).toBe('https://news.example.com/story-1');
    expect(f.items[0].guid).toBe('tag:google.com,2013:googlealerts/feed:123');
    expect(isGoogleAlertsFeed('https://www.google.com/alerts/feeds/1234/5678')).toBe(true);
  });
  it('does not expand XML entities (no XXE)', () => {
    const f = parseFeed('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&xxe;</title><link>https://a.com</link></item></channel></rss>');
    expect(f.items[0].title).toBe('&xxe;');
  });
  it('handles empty / garbage input', () => { expect(parseFeed('').items).toEqual([]); expect(parseFeed('<html>nope</html>').kind).toBe('unknown'); });
});
