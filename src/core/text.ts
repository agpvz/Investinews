// Text normalization helpers shared by adapters, matching and clustering.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥' };

export function decodeEntities(s = ''): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, c: string) => {
    if (c[0] === '#') {
      const n = /^#x/i.test(c) ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[c.toLowerCase()] ?? m;
  });
}

/** Strip HTML to plain text. Descriptions are always rendered as text, never as HTML. */
export function stripHtml(s = ''): string {
  return decodeEntities(
    s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|h\d|tr)>/gi, ' ').replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

export const STOPWORDS = new Set('a an and are as at be but by for from has have he her his if in into is it its of on or she that the their there these they this to was were will with you your not no yes new says said say after before over under amid about more than up down out off vs via per how why what when who which while also just here now still'.split(' '));

/** Lowercase, strip a trailing " - Publisher" suffix, punctuation and whitespace. */
export function titleKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '')
    .replace(/^(breaking|update|exclusive|watch|live|analysis|explainer|opinion)\s*:\s*/i, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9$%. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return titleKey(text).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a); const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Fiscal-period markers that must agree before two headlines can be merged. */
export function periodMarkers(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(q[1-4]|first|second|third|fourth)[ -]?(quarter)?\b/g)) {
    const q = m[1].startsWith('q') ? m[1] : { first: 'q1', second: 'q2', third: 'q3', fourth: 'q4' }[m[1]];
    if (q && (m[1].startsWith('q') || m[2])) out.add(q);
  }
  for (const m of t.matchAll(/\b(fy|fiscal|full[- ]year)?\s?(20\d{2})\b/g)) out.add(m[2]);
  for (const m of t.matchAll(/\b(h[12]|first half|second half)\b/g)) out.add(m[1].replace('first half', 'h1').replace('second half', 'h2'));
  return out;
}

export function correctionFlags(headline: string, description = ''): string[] {
  const t = `${headline} ${description.slice(0, 200)}`.toLowerCase();
  const flags: string[] = [];
  if (/\b(correction|corrected|corrects)\b/.test(t)) flags.push('correction');
  if (/\b(retraction|retracted|retracts|withdrawn|withdraws)\b/.test(t)) flags.push('retraction');
  if (/\b(clarification|clarifies)\b/.test(t)) flags.push('clarification');
  return flags;
}

export const MATERIAL_TERMS = /\b(earnings|results|guidance|outlook|profit warning|acqui(re|res|sition)|merger|takeover|buyout|bankrupt(cy)?|chapter 11|delist|recall|lawsuit|sues|settlement|indict|fraud|probe|investigation|resign(s|ed|ation)?|steps down|appoint(s|ed)?|new ceo|new cfo|dividend|buyback|split|offering|placement|rights issue|downgrade|upgrade|halt(ed)?|suspend(ed)?|layoffs|job cuts|strike|fda|approval|rejected|breach|hack|outage|sanction|tariff|ban)\b/i;

export const MATERIAL_FORMS = new Set(['8-K', '8-K/A', '10-K', '10-K/A', '10-Q', '10-Q/A', '6-K', '20-F', '40-F', 'S-1', 'F-1', 'SC 13D', 'SC 13D/A', 'SC TO-T', 'DEFM14A', '425', '8-K12B', 'NT 10-K', 'NT 10-Q']);

export function isMaterial(headline: string, form?: string | null): boolean {
  if (form && MATERIAL_FORMS.has(form.toUpperCase())) return true;
  if (form) return false; // other filings (Form 4, 144, 13G...) are routine
  return MATERIAL_TERMS.test(headline);
}

export function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }
