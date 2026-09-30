// Dependency-free RSS 2.0 / Atom / RDF parser. It is deliberately tolerant:
// feeds in the wild are frequently malformed, so we work on the raw text
// rather than requiring well-formed XML.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, c) => {
    if (c[0] === '#') {
      const n = /^#x/i.test(c) ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[c.toLowerCase()] ?? m;
  });
}

export function stripHtml(s = '') {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const unwrapCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function rawTag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i');
  const m = block.match(re);
  return m ? unwrapCdata(m[1]).trim() : '';
}

function textTag(block, ...names) {
  for (const n of names) {
    const raw = rawTag(block, n);
    if (raw) return stripHtml(decodeEntities(raw));
  }
  return '';
}

function attr(block, tagName, attrName, filterAttr) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let m;
  let fallback = '';
  while ((m = re.exec(block))) {
    const t = m[0];
    const a = t.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (!a) continue;
    if (filterAttr) {
      const f = t.match(new RegExp(`${filterAttr.name}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (f && f[1].toLowerCase() === filterAttr.value) return decodeEntities(a[1]);
      if (!f && !fallback) fallback = decodeEntities(a[1]);
    } else return decodeEntities(a[1]);
  }
  return fallback;
}

function linkOf(block) {
  // RSS: <link>url</link>. Google News sometimes emits <link/>url (self-closed) — handle that too.
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

function dateOf(block) {
  const raw =
    rawTag(block, 'pubDate') || rawTag(block, 'dc:date') || rawTag(block, 'published') || rawTag(block, 'updated') || rawTag(block, 'a10:updated') || rawTag(block, 'lastBuildDate');
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function parseFeed(xml, { feedTitle: forcedTitle } = {}) {
  if (!xml || typeof xml !== 'string') return { title: forcedTitle || '', items: [] };
  const head = xml.slice(0, 4000);
  const feedTitle = forcedTitle || textTag(head.replace(/<item[\s\S]*$/i, '').replace(/<entry[\s\S]*$/i, ''), 'title');
  const blocks = [];
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = itemRe.exec(xml))) blocks.push(m[2]);
  const items = blocks.map((b) => {
    const title = textTag(b, 'title');
    const link = linkOf(b);
    const description = textTag(b, 'description', 'summary', 'content:encoded', 'content', 'media:description');
    let source = textTag(b, 'source', 'News:Source', 'dc:publisher');
    const author = textTag(b, 'dc:creator', 'author', 'name');
    const categories = [];
    const catRe = /<category(?:\s[^>]*?(?:term|label)\s*=\s*["']([^"']+)["'][^>]*)?>([\s\S]*?)<\/category>|<category\s[^>]*?(?:term|label)\s*=\s*["']([^"']+)["'][^>]*\/>/gi;
    let c;
    while ((c = catRe.exec(b))) {
      const v = stripHtml(c[1] || c[3] || c[2] || '');
      if (v) categories.push(v);
    }
    return { title, link, ts: dateOf(b), description, source, author, categories, feedTitle };
  });
  return { title: feedTitle, items: items.filter((i) => i.title) };
}
