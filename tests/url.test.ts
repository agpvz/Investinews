import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, urlKey, isPrivateHost } from '../src/core/url.ts';

describe('url normalization', () => {
  it('strips tracking params, fragments and sorts the rest', () => {
    expect(canonicalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1&fbclid=zz#frag')).toBe('https://www.example.com/a?a=1&b=2');
  });
  it('drops default ports, amp and mobile hosts', () => {
    expect(canonicalizeUrl('https://amp.site.com:443/story/amp/')).toBe('https://site.com/story');
    expect(canonicalizeUrl('http://m.site.com:80/x')).toBe('http://site.com/x');
  });
  it('urlKey ignores scheme and www', () => {
    expect(urlKey('https://www.site.com/x?utm_medium=1')).toBe(urlKey('http://site.com/x/'));
  });
  it('leaves non-http inputs alone', () => { expect(canonicalizeUrl('not a url')).toBe('not a url'); });
  it('detects private hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.5.5', '192.168.0.1', '169.254.169.254', '::1', 'fd00::1', 'foo.local', '0.0.0.0', '100.64.1.1']) expect(isPrivateHost(h), h).toBe(true);
    for (const h of ['sec.gov', '8.8.8.8', '172.32.0.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false);
  });
});
