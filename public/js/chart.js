// Canvas renderers: Bloomberg GP-style price chart and tiny sparklines.
import { fmtNum, priceDp } from './format.js';

const C = { bg: '#000', grid: '#1e232b', axis: '#8a94a6', line: '#ffa028', fill: 'rgba(255,160,40,0.10)', up: '#2ec27e', dn: '#ff4d4d', text: '#e6e6e6', cross: '#5f6b7a', label: '#ffd54a' };

function niceTicks(min, max, n = 5) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

export function drawChart(canvas, data, { range = '1d', cursor = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600; const H = canvas.clientHeight || 300;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const pts = (data?.series || []).filter((p) => p.c != null);
  ctx.font = '11px "IBM Plex Mono","Consolas","DejaVu Sans Mono",monospace';
  if (pts.length < 2) { ctx.fillStyle = C.axis; ctx.fillText('NO CHART DATA', 12, 20); return null; }
  const padL = 8, padR = 66, padT = 14, padB = 22;
  const volH = Math.min(60, Math.floor(H * 0.18));
  const plotH = H - padT - padB - volH - 6;
  const plotW = W - padL - padR;
  const closes = pts.map((p) => p.c);
  let min = Math.min(...closes), max = Math.max(...closes);
  if (min === max) { min -= 1; max += 1; }
  const spanPad = (max - min) * 0.06; min -= spanPad; max += spanPad;
  const x = (i) => padL + (i / (pts.length - 1)) * plotW;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * plotH;
  const dp = priceDp(data.symbol, data.last);

  // grid + y labels
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.axis; ctx.textAlign = 'left';
  for (const t of niceTicks(min, max, 5)) { const yy = y(t); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke(); ctx.fillText(fmtNum(t, dp), padL + plotW + 6, yy + 4); }
  // x labels
  const n = Math.min(6, pts.length);
  ctx.textAlign = 'center';
  for (let k = 0; k < n; k++) {
    const i = Math.round((k / (n - 1)) * (pts.length - 1));
    const d = new Date(pts[i].t);
    const lbl = range === '1d' ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : range === '5d' ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h` : ['1y', '2y', '5y', 'max'].includes(range) ? `${d.toLocaleString('en', { month: 'short' })} ${String(d.getFullYear()).slice(2)}` : `${d.getMonth() + 1}/${d.getDate()}`;
    ctx.fillStyle = C.axis; ctx.fillText(lbl, x(i), H - 6);
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x(i), padT); ctx.lineTo(x(i), padT + plotH + 6 + volH); ctx.stroke();
  }
  // previous close reference
  if (data.prev != null && data.prev > min && data.prev < max) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#4a5568'; ctx.beginPath(); ctx.moveTo(padL, y(data.prev)); ctx.lineTo(padL + plotW, y(data.prev)); ctx.stroke(); ctx.setLineDash([]); }
  // volume
  const vols = pts.map((p) => p.v || 0); const vmax = Math.max(...vols) || 1;
  const vTop = padT + plotH + 6;
  const bw = Math.max(1, plotW / pts.length - 0.5);
  for (let i = 0; i < pts.length; i++) { const h = (vols[i] / vmax) * volH; ctx.fillStyle = pts[i].c >= (pts[i].o ?? pts[i].c) ? C.up : C.dn; ctx.globalAlpha = 0.75; ctx.fillRect(x(i) - bw / 2, vTop + volH - h, bw, h); }
  ctx.globalAlpha = 1;
  // area fill + line
  ctx.beginPath(); ctx.moveTo(x(0), y(closes[0]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(closes[i]));
  ctx.lineTo(x(pts.length - 1), padT + plotH); ctx.lineTo(x(0), padT + plotH); ctx.closePath(); ctx.fillStyle = C.fill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x(0), y(closes[0]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(closes[i]));
  ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.stroke();
  // last price tag
  const last = closes[closes.length - 1]; const ly = y(last);
  ctx.fillStyle = (data.chg ?? 0) >= 0 ? C.up : C.dn; ctx.fillRect(padL + plotW + 2, ly - 8, padR - 4, 16);
  ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(fmtNum(last, dp), padL + plotW + 6, ly + 4);
  // high / low markers
  const hi = closes.indexOf(Math.max(...closes)); const lo = closes.indexOf(Math.min(...closes));
  ctx.fillStyle = C.label; ctx.textAlign = 'center';
  ctx.fillText(`H ${fmtNum(closes[hi], dp)}`, Math.min(Math.max(x(hi), 40), W - padR - 40), y(closes[hi]) - 4);
  ctx.fillText(`L ${fmtNum(closes[lo], dp)}`, Math.min(Math.max(x(lo), 40), W - padR - 40), y(closes[lo]) + 12);
  // crosshair
  let info = null;
  if (cursor && cursor.x >= padL && cursor.x <= padL + plotW) {
    const i = Math.round(((cursor.x - padL) / plotW) * (pts.length - 1));
    const p = pts[i];
    ctx.strokeStyle = C.cross; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x(i), padT); ctx.lineTo(x(i), vTop + volH); ctx.stroke(); ctx.beginPath(); ctx.moveTo(padL, y(p.c)); ctx.lineTo(padL + plotW, y(p.c)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(x(i), y(p.c), 3, 0, Math.PI * 2); ctx.fill();
    info = p;
  }
  return { info, dp };
}

export function drawSpark(canvas, values, { up = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 70, H = canvas.clientHeight || 18;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return;
  const min = Math.min(...v), max = Math.max(...v); const span = max - min || 1;
  const dir = up ?? v[v.length - 1] >= v[0];
  ctx.strokeStyle = dir ? C.up : C.dn; ctx.lineWidth = 1;
  ctx.beginPath();
  v.forEach((val, i) => { const xx = (i / (v.length - 1)) * (W - 2) + 1; const yy = H - 2 - ((val - min) / span) * (H - 4); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
  ctx.stroke();
}
