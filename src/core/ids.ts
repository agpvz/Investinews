const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** Time-prefixed, URL-safe, sortable id (Crockford base32 time + random). Stable once persisted. */
export function newId(prefix = ''): string {
  let t = Date.now(); let ts = '';
  for (let i = 0; i < 9; i++) { ts = ALPHABET[t % 32] + ts; t = Math.floor(t / 32); }
  const rnd = new Uint8Array(10); crypto.getRandomValues(rnd);
  let r = ''; for (const b of rnd) r += ALPHABET[b % 32];
  return `${prefix}${ts}${r}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const b64url = {
  encode(bytes: ArrayBuffer | Uint8Array): string {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = ''; for (const b of u8) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array<ArrayBuffer> {
    const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
