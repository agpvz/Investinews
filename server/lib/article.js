// Fetch an article and extract readable paragraphs, so stories can be read
// inside the terminal. Includes a Google News redirect decoder and SSRF guards.
import dns from 'node:dns/promises';
import net from 'node:net';
import { getText } from './http.js';
import { cached } from './cache.js';
import { stripHtml, decodeEntities } from './rss.js';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('invalid url'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) urls allowed');
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked host');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('blocked host'); return u; }
  const addrs = await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('unresolvable host');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked host');
  return u;
}

/** Decode the older base64-style Google News RSS redirect links where possible. */
export function decodeGoogleNewsUrl(url) {
  try {
    const u = new URL(url);
    if (!/news\.google\.com$/.test(u.hostname)) return url;
    const m = u.pathname.match(/\/(?:rss\/)?articles\/([^/?]+)/);
    if (!m) return url;
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bytes = Buffer.from(b64, 'base64');
    const s = bytes.toString('latin1');
    const idx = s.indexOf('http');
    if (idx < 0) return url;
    // The URL is length-prefixed; take the run of printable URL characters.
    const cand = s.slice(idx).match(/^https?:\/\/[\x21-\x7e]+/);
    if (!cand) return url;
    const clean = cand[0].replace(/[\x00-\x1f].*$/, '').replace(/\xd2.*$/, '');
    return /^https?:\/\/[^\s]+\.[a-z]{2,}/i.test(clean) ? clean : url;
  } catch { return url; }
}

function extractParagraphs(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).replace(/\s+/g, ' ').trim();
  const og = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]) : ''; };
  const ogTitle = og(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || og(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogDesc = og(/<meta[^>]+(?:property|name)=["'](?:og:)?description["'][^>]+content=["']([^"']+)["']/i) || og(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:)?description["']/i);
  const canonical = og(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<aside[\s\S]*?<\/aside>/gi, '');
  const scope = (body.match(/<article[\s\S]*?<\/article>/i) || body.match(/<main[\s\S]*?<\/main>/i) || [body])[0];
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const t = stripHtml(m[1]);
    if (t.length >= 40 && !/cookie|subscribe|sign up|newsletter|all rights reserved/i.test(t.slice(0, 60))) paras.push(t);
  }
  return { title: ogTitle || title, description: ogDesc, canonical, paragraphs: paras.slice(0, 60) };
}

export async function readArticle(url) {
  const target = decodeGoogleNewsUrl(url);
  await assertPublicUrl(target);
  return cached(`article:${target}`, 30 * 60_000, async () => {
    const html = await getText(target, { timeout: 12_000, headers: { Accept: 'text/html,application/xhtml+xml' } });
    const ex = extractParagraphs(html.slice(0, 2_000_000));
    return { url: target, ...ex };
  });
}
