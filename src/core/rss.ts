// Tolerant, dependency-free RSS 2.0 / Atom / RDF parser working on text (no XML entity expansion => no XXE).
import { decodeEntities, stripHtml } from './text.ts';

export interface FeedItem { title: string; link: string; guid: string; ts: number | null; updated: number | null; description: string; source: string; author: string; categories: string[] }
export interface ParsedFeed { title: string; items: FeedItem[]; kind: 'rss' | 'atom' | 'rdf' | 'unknown' }

const unwrapCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function rawTag(block: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i');
  const m = block.match(re);
  return m ? unwrapCdata(m[1]).trim() : '';
}
function textTag(block: string, ...names: string[]): string {
  for (const n of names) { const raw = rawTag(block, n); if (raw) return stripHtml(decodeEntities(raw)); }
  return '';
}
function attr(block: string, tagName: string, attrName: string, filter?: { name: string; value: string }): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let m: RegExpExecArray | null; let fallback = '';
  while ((m = re.exec(block))) {
    const t = m[0];
    const a = t.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (!a) continue;
    if (filter) {
      const f = t.match(new RegExp(`${filter.name}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (f && f[1].toLowerCase() === filter.value) return decodeEntities(a[1]);
      if (!f && !fallback) fallback = decodeEntities(a[1]);
    } else return decodeEntities(a[1]);
  }
  return fallback;
}
function linkOf(block: string): string {
  const rss = rawTag(block, 'link');
  if (rss && /^https?:\/\//i.test(rss)) return decodeEntities(rss);
  const atom = attr(block, 'link', 'href', { name: 'rel', value: 'alternate' });
  if (atom) return atom;
  const selfClosed = block.match(/<link\s*\/>\s*(https?:\/\/[^\s<]+)/i);
  if (selfClosed) return decodeEntities(selfClosed[1]);
  const guid = rawTag(block, 'guid');
  if (/^https?:\/\//i.test(guid)) return decodeEntities(guid);
  return '';
}
function parseDate(raw: string): number | null { if (!raw) return null; const t = Date.parse(raw); return Number.isFinite(t) ? t : null; }

export function parseFeed(xml: string, opts: { maxItems?: number } = {}): ParsedFeed {
  if (!xml || typeof xml !== 'string') return { title: '', items: [], kind: 'unknown' };
  const kind: ParsedFeed['kind'] = /<feed[\s>]/i.test(xml.slice(0, 2000)) ? 'atom' : /<rdf:RDF/i.test(xml.slice(0, 2000)) ? 'rdf' : /<rss[\s>]/i.test(xml.slice(0, 2000)) ? 'rss' : 'unknown';
  const head = xml.slice(0, 5000).replace(/<item[\s\S]*$/i, '').replace(/<entry[\s\S]*$/i, '');
  const title = textTag(head, 'title');
  const blocks: string[] = [];
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && blocks.length < (opts.maxItems ?? 500)) blocks.push(m[2]);
  const items = blocks.map((b): FeedItem => {
    const categories: string[] = [];
    const catRe = /<category\b([^>]*)>([\s\S]*?)<\/category>|<category\b([^>]*)\/>/gi;
    let c: RegExpExecArray | null;
    while ((c = catRe.exec(b))) {
      const attrs = c[1] || c[3] || '';
      const term = attrs.match(/(?:term|label)\s*=\s*["']([^"']+)["']/i)?.[1];
      const v = stripHtml(term || c[2] || '');
      if (v) categories.push(v);
    }
    return {
      title: textTag(b, 'title'),
      link: linkOf(b),
      guid: textTag(b, 'guid', 'id'),
      ts: parseDate(rawTag(b, 'pubDate') || rawTag(b, 'dc:date') || rawTag(b, 'published') || rawTag(b, 'issued')),
      updated: parseDate(rawTag(b, 'updated') || rawTag(b, 'a10:updated') || rawTag(b, 'atom:updated')),
      description: textTag(b, 'description', 'summary', 'content:encoded', 'content', 'media:description').slice(0, 1000),
      source: textTag(b, 'source', 'News:Source', 'dc:publisher'),
      author: textTag(b, 'dc:creator', 'author', 'name'),
      categories,
    };
  }).filter((i) => i.title || i.link);
  return { title, items, kind };
}
