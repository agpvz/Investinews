// Guarded outbound fetch: timeouts, byte limits, manual redirects with SSRF checks on every hop.
import { isPrivateHost } from '../core/url.ts';

export interface SafeFetchOpts { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; userSupplied?: boolean; resolveHost?: (host: string) => Promise<string[]>; maxRedirects?: number }
export interface SafeFetchResult { status: number; headers: Headers; text: string; finalUrl: string; truncated: boolean }

export class FetchError extends Error { status: number; constructor(msg: string, status = 0) { super(msg); this.status = status; } }

async function assertAllowed(url: URL, opts: SafeFetchOpts): Promise<void> {
  if (!/^https?:$/.test(url.protocol)) throw new FetchError(`blocked scheme ${url.protocol}`);
  if (url.username || url.password) throw new FetchError('credentials in url not allowed');
  if (!opts.userSupplied) return;
  if (isPrivateHost(url.hostname)) throw new FetchError(`blocked host ${url.hostname}`);
  if (opts.resolveHost) {
    const ips = await opts.resolveHost(url.hostname).catch(() => [] as string[]);
    if (!ips.length) throw new FetchError(`unresolvable host ${url.hostname}`);
    if (ips.some(isPrivateHost)) throw new FetchError(`blocked host ${url.hostname} (private address)`);
  }
}

export async function safeFetch(input: string, opts: SafeFetchOpts = {}): Promise<SafeFetchResult> {
  let url = new URL(input);
  const max = opts.maxBytes ?? 3_000_000;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    await assertAllowed(url, opts);
    const res = await fetch(url.toString(), { headers: opts.headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      await res.body?.cancel().catch(() => {});
      continue;
    }
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > max) { await res.body?.cancel().catch(() => {}); throw new FetchError(`response too large (${len} bytes)`, res.status); }
    let truncated = false; let text = '';
    if (res.body) {
      const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > max) { truncated = true; chunks.push(value.slice(0, value.length - (total - max))); await reader.cancel().catch(() => {}); break; }
        chunks.push(value);
      }
      const buf = new Uint8Array(total > max ? max : total); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    return { status: res.status, headers: res.headers, text, finalUrl: url.toString(), truncated };
  }
  throw new FetchError('too many redirects');
}
