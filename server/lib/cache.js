// In-memory TTL cache with in-flight de-duplication and stale-on-error fallback.
const store = new Map();
const inflight = new Map();

export async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      store.set(key, { value, ts: Date.now() });
      return value;
    } catch (err) {
      if (hit) return hit.value; // serve stale rather than fail
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function cacheStats() {
  return { keys: store.size, inflight: inflight.size };
}

// Evict very old entries occasionally so memory stays bounded.
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [k, v] of store) if (v.ts < cutoff) store.delete(k);
}, 10 * 60 * 1000).unref();
