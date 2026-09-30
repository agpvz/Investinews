export const pad = (n) => String(n).padStart(2, '0');

export function fmtNum(x, dp) {
  if (x == null || !Number.isFinite(x)) return '--';
  const d = dp ?? (Math.abs(x) >= 1000 ? 2 : Math.abs(x) >= 10 ? 2 : 4);
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtChg(x, dp) { if (x == null || !Number.isFinite(x)) return '--'; return (x > 0 ? '+' : '') + fmtNum(x, dp); }
export function fmtPct(x, dp = 2) { if (x == null || !Number.isFinite(x)) return '--'; return (x > 0 ? '+' : '') + x.toFixed(dp) + '%'; }
export function fmtVol(x) {
  if (x == null || !Number.isFinite(x)) return '--';
  const a = Math.abs(x);
  if (a >= 1e12) return (x / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (x / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (x / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (x / 1e3).toFixed(1) + 'K';
  return String(Math.round(x));
}
export function fmtTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts); const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (now - d < 7 * 86400_000) return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)}`;
}
export function fmtDateTime(ts) { if (!ts) return '--'; const d = new Date(ts); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
}
export function clockIn(tz) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()); } catch { return '--:--:--'; }
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'dn' : 'flat');
export const priceDp = (sym = '', x) => (/=X$/.test(sym) ? 4 : /^\^(TNX|TYX|FVX|IRX)/.test(sym) ? 3 : Math.abs(x || 0) < 2 ? 4 : 2);
