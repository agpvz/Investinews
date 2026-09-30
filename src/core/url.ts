// URL normalization for canonical identity and grouping.
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|ref|ref_src|source|cmpid|cmp|ncid|ocid|spm|_ga|_gl|guccounter|guce_referrer|guce_referrer_sig|oc|sfnsn|feedType|feedName|rss|s|share|smid|ito|amp|outputType|__twitter_impression|partner|ns_campaign|ns_mchannel|ns_source|ns_linkname|ns_fee|CMP|at_medium|at_campaign|xtor|ftag|srnd|sref|taid|cid|mod|link_source)$/i;

export function canonicalizeUrl(input: string): string {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return input.trim(); }
  if (!/^https?:$/.test(u.protocol)) return input.trim();
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) if (!TRACKING.test(k)) keep.push([k, v]);
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  u.search = keep.length ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  // Google AMP / mobile variants
  u.pathname = u.pathname.replace(/\/amp\/?$/, '/').replace(/\/+$/, '') || '/';
  if (u.hostname.startsWith('amp.')) u.hostname = u.hostname.slice(4);
  if (u.hostname.startsWith('m.')) u.hostname = u.hostname.slice(2);
  return u.toString();
}

/** Scheme-less, www-less key used for exact duplicate detection. */
export function urlKey(input: string): string {
  const c = canonicalizeUrl(input);
  return c.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function isHttpUrl(s: string): boolean { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } }

/** Hostnames / IPs we refuse to fetch for user-supplied feeds (SSRF guard). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) return h === '::' || h === '::1' || /^(fc|fd|fe[89ab])/i.test(h) || h.startsWith('::ffff:');
  return false;
}
