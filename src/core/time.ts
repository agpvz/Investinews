export const now = () => Date.now();

const DTF_CACHE = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = DTF_CACHE.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }); DTF_CACHE.set(tz, f); }
  return f;
}

/** Minutes since local midnight in the given IANA zone. */
export function localMinutes(ts: number, tz: string): number {
  try {
    const parts = dtf(tz).formatToParts(new Date(ts));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch { const d = new Date(ts); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
}

const hm = (s: string): number | null => { const m = s?.match(/^(\d{1,2}):(\d{2})$/); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); return h > 23 || mi > 59 ? null : h * 60 + mi; };

/** Whether ts falls inside quiet hours [start, end) in tz. Handles ranges crossing midnight. */
export function inQuietHours(ts: number, start: string | null, end: string | null, tz: string): boolean {
  const s = start ? hm(start) : null; const e = end ? hm(end) : null;
  if (s == null || e == null || s === e) return false;
  const cur = localMinutes(ts, tz);
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** Next instant (ms) at which quiet hours end, searching forward minute by minute (bounded to 25h). */
export function quietHoursEnd(ts: number, start: string | null, end: string | null, tz: string): number {
  let t = ts;
  for (let i = 0; i < 25 * 60 && inQuietHours(t, start, end, tz); i++) t += 60_000;
  return t;
}

export function formatInZone(ts: number, tz: string, withSeconds = false): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: false }).format(new Date(ts)).replace(',', '');
  } catch { return new Date(ts).toISOString(); }
}
