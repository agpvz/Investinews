// Small fetch helpers with timeouts and browser-like headers.
// Many free feeds refuse requests without a User-Agent.
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const SEC_UA = process.env.SEC_USER_AGENT || 'Investinews open-source terminal (github.com/agpvz/investinews)';

export async function getText(url, { headers = {}, timeout = 9000, ua = DEFAULT_UA } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getJSON(url, opts = {}) {
  const txt = await getText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return JSON.parse(txt);
}

/** Run a list of async thunks; return fulfilled values plus a health summary. */
export async function settleAll(named) {
  const entries = Object.entries(named);
  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));
  const ok = [];
  const health = {};
  results.forEach((r, i) => {
    const name = entries[i][0];
    if (r.status === 'fulfilled') {
      ok.push(...(Array.isArray(r.value) ? r.value : [r.value]));
      health[name] = { ok: true, n: Array.isArray(r.value) ? r.value.length : 1 };
    } else {
      health[name] = { ok: false, error: String(r.reason?.message || r.reason).slice(0, 160) };
    }
  });
  return { items: ok, health };
}
