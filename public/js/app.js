import { parseCommand, suggest } from './command.js';
import * as S from './screens.js';
import { api } from './api.js';
import { clockIn, fmtNum, fmtPct, esc, cls, priceDp, pad } from './format.js';

const LS = { settings: 'investinews.settings', read: 'investinews.read', alerts: 'investinews.alertlog', fired: 'investinews.fired', history: 'investinews.history' };
const loadLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const state = {
  settings: { tickers: [], topics: [], alerts: [], layout: 4, tape: [], updatedAt: 0 },
  readSet: new Set(loadLS(LS.read, [])),
  alertLog: loadLS(LS.alerts, []),
  fired: new Set(loadLS(LS.fired, [])),
  demo: false, panels: [], active: 0, lastUpdate: 0, sourceHealth: {},
};

// ---------------- panels ----------------
class Panel {
  constructor(idx, el) {
    this.idx = idx; this.el = el; this.stack = []; this.timer = null; this.newSet = new Set();
    this.input = el.querySelector('input.cmd'); this.ac = el.querySelector('.ac'); this.titleEl = el.querySelector('.screen-title'); this.toolbarEl = el.querySelector('.toolbar'); this.body = el.querySelector('.screen'); this.statusEl = el.querySelector('.panel-status');
    this.history = loadLS(`${LS.history}.${idx}`, []); this.hIdx = this.history.length; this.acSel = -1; this.acItems = [];
    this.bindInput();
    el.addEventListener('mousedown', () => setActive(idx));
    this.body.addEventListener('click', (e) => this.onBodyClick(e));
    this.toolbarEl.addEventListener('click', (e) => { const b = e.target.closest('.tb'); if (b) this.runToolbar(Number(b.dataset.i)); });
  }
  get screen() { return this.stack[this.stack.length - 1]; }
  get ctx() {
    return {
      exec: (c) => exec(c, this), openStory: (h) => this.openStory(h), readSet: state.readSet, newSet: this.newSet, shareUrl, alertLog: () => state.alertLog, refreshPanel: () => this.show(true),
    };
  }
  bindInput() {
    const inp = this.input;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (this.acSel >= 0 && this.acItems[this.acSel]) { const it = this.acItems[this.acSel]; this.hideAc(); if (/\s$/.test(it.cmd)) { inp.value = it.cmd; return; } inp.value = ''; this.run(it.cmd); return; } const v = inp.value; inp.value = ''; this.hideAc(); this.run(v); }
      else if (e.key === 'Escape') { e.preventDefault(); if (this.ac.classList.contains('hidden')) { if (inp.value) inp.value = ''; else this.back(); } else this.hideAc(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (this.acItems.length) this.moveAc(1); else this.histNav(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (this.acItems.length) this.moveAc(-1); else this.histNav(-1); }
      else if (e.key === 'Tab') { /* handled globally */ }
    });
    inp.addEventListener('input', () => this.updateAc());
    inp.addEventListener('blur', () => setTimeout(() => this.hideAc(), 150));
  }
  histNav(d) { if (!this.history.length) return; this.hIdx = Math.max(0, Math.min(this.history.length, this.hIdx + d)); this.input.value = this.history[this.hIdx] || ''; }
  updateAc() {
    const v = this.input.value; const items = suggest(v);
    this.acItems = items; this.acSel = items.length ? 0 : -1; this.renderAc();
    const toks = v.trim().split(/\s+/);
    if (v.trim().length >= 2 && toks.length <= 3 && !/^\d+$/.test(v.trim())) {
      clearTimeout(this.acTimer);
      this.acTimer = setTimeout(async () => {
        if (this.input.value !== v) return;
        try { const rows = await api.findSecurity(v.trim()); if (this.input.value !== v) return; const extra = rows.slice(0, 6).map((r) => ({ cmd: r.symbol, desc: `${r.name} · ${r.exchange} ${r.type}`.trim(), sec: true })); this.acItems = [...items, ...extra.filter((x) => !items.some((i) => i.cmd === x.cmd))]; if (this.acSel < 0 && this.acItems.length) this.acSel = 0; this.renderAc(); } catch { /* ignore */ }
      }, 280);
    }
  }
  renderAc() {
    if (!this.acItems.length) return this.hideAc();
    this.ac.innerHTML = this.acItems.map((it, i) => `<div class="aci${i === this.acSel ? ' sel' : ''}" data-i="${i}"><span class="fn">${esc(it.cmd)}</span><span class="d">${esc(it.desc)}</span></div>`).join('');
    this.ac.classList.remove('hidden');
    this.ac.querySelectorAll('.aci').forEach((d) => { d.onmousedown = (e) => { e.preventDefault(); const it = this.acItems[Number(d.dataset.i)]; this.hideAc(); if (/\s$/.test(it.cmd)) { this.input.value = it.cmd; this.input.focus(); return; } this.input.value = ''; this.run(it.cmd); }; });
  }
  moveAc(d) { this.acSel = (this.acSel + d + this.acItems.length) % this.acItems.length; this.renderAc(); }
  hideAc() { this.ac.classList.add('hidden'); this.acItems = []; this.acSel = -1; }
  run(text) {
    const t = text.trim(); if (!t) return;
    if (this.history[this.history.length - 1] !== t) { this.history.push(t); if (this.history.length > 50) this.history.shift(); saveLS(`${LS.history}.${this.idx}`, this.history); }
    this.hIdx = this.history.length;
    exec(t, this);
  }
  flash(msg, kind = 'info') { this.statusEl.innerHTML = `<span class="${kind}">${esc(msg)}</span>`; clearTimeout(this.flashTimer); this.flashTimer = setTimeout(() => this.renderStatus(), 4000); }
  async push(screen) {
    if (this.screen && this.screen.key === screen.key && !screen.isStory) return this.show(true);
    this.stack.push(screen); if (this.stack.length > 40) this.stack.shift();
    this.newSet = new Set();
    await this.show();
  }
  back() { if (this.stack.length > 1) { this.stack.pop(); this.newSet = new Set(); this.show(); } else this.flash('AT TOP LEVEL — nothing to go back to', 'warn'); }
  async show(refresh = false) {
    const sc = this.screen; if (!sc) return;
    clearTimeout(this.timer);
    sc.reload = () => this.show(true);
    this.renderTitle(); this.renderToolbar();
    if (!refresh) { this.body.innerHTML = '<div class="loading">LOADING…</div>'; this.body.scrollTop = 0; }
    this.statusEl.innerHTML = '<span class="info">LOADING…</span>';
    const prevIds = refresh && sc.ids ? new Set(sc.ids()) : null;
    const scrollTop = this.body.scrollTop;
    try {
      await sc.load();
      if (this.screen !== sc) return;
      if (prevIds) { const cur = sc.ids ? sc.ids() : []; this.newSet = new Set(cur.filter((id) => !prevIds.has(id))); if (this.newSet.size) setTimeout(() => { this.newSet.clear(); }, 90_000); }
      sc.render(this.body, this.ctx);
      if (refresh) this.body.scrollTop = scrollTop;
      this.renderTitle(); this.renderToolbar(); this.renderStatus();
      state.lastUpdate = Date.now(); updateGlobalStatus(sc);
      if (sc.data?.items) checkAlerts(sc.data.items, this);
      if (sc.full?.items) checkAlerts(sc.full.items, this);
    } catch (err) {
      if (this.screen !== sc) return;
      this.body.innerHTML = `<div class="error">ERROR: ${esc(err.message || err)}<br><span class="dim">Source may be unreachable. Press &lt;GO&gt; on REFRESH to retry, or &lt;MENU&gt; to go back.</span></div>`;
      this.statusEl.innerHTML = `<span class="err">FAILED ${new Date().toTimeString().slice(0, 8)}</span>`;
    }
    if (sc.refreshMs > 0) this.timer = setTimeout(() => { if (document.hidden) { this.timer = setTimeout(() => this.show(true), 15_000); } else this.show(true); }, sc.refreshMs);
  }
  renderTitle() { const sc = this.screen; const rest = sc.cmd.startsWith(sc.title) ? sc.cmd.slice(sc.title.length).trim() : sc.cmd; this.titleEl.innerHTML = `<span class="pn">${this.idx + 1}</span><span class="tsec">${esc(sc.title)}</span>${rest ? `<span class="tcmd">${esc(rest)}</span>` : ''}<span class="tdesc">${esc(sc.subtitle || '')}</span><span class="tright">${this.stack.length > 1 ? `<span class="crumb">${this.stack.length - 1} back</span>` : ''}</span>`; }
  renderToolbar() { const tb = this.screen.toolbar || []; this.toolbarEl.innerHTML = tb.map((b, i) => `<span class="tb" data-i="${i}"><b>${91 + i})</b> ${esc(b.label)}</span>`).join(''); this.toolbarEl.classList.toggle('hidden', !tb.length); }
  renderStatus() { const sc = this.screen; const h = sc.statusHtml ? sc.statusHtml() : ''; this.statusEl.innerHTML = `<span class="dim">${esc(sc.cmd)}</span> · <span class="dim">upd ${new Date().toTimeString().slice(0, 8)}</span>${h ? ' · ' + h : ''}${sc.refreshMs ? ` · <span class="dim">auto ${Math.round(sc.refreshMs / 1000)}s</span>` : ''}${sc.items?.length ? ` · <span class="dim">${sc.items.length} items</span>` : ''}`; }
  runToolbar(i) { const b = this.screen.toolbar?.[i]; if (!b) return this.flash('NO SUCH BUTTON', 'warn'); if (b.action) b.action(); else if (/\s$/.test(b.cmd)) { this.input.value = b.cmd; this.input.focus(); } else exec(b.cmd, this); }
  onNumber(n) {
    if (n >= 91) return this.runToolbar(n - 91);
    const fn = this.screen?.items?.[n - 1];
    if (!fn) return this.flash(`NO ITEM ${n} ON THIS SCREEN`, 'warn');
    fn();
  }
  onBodyClick(e) {
    const tab = e.target.closest('.tab[data-cmd]'); if (tab && !tab.dataset.cmd.startsWith('__')) { exec(tab.dataset.cmd, this); return; }
    const row = e.target.closest('.row[data-n]'); if (row) { const n = Number(row.dataset.n); if (n) this.onNumber(n); }
  }
  openStory(h) {
    state.readSet.add(h.id); if (state.readSet.size > 2000) state.readSet = new Set([...state.readSet].slice(-1500)); saveLS(LS.read, [...state.readSet]);
    this.body.querySelectorAll(`.row[data-id="${CSS.escape(h.id)}"]`).forEach((r) => r.classList.add('read'));
    this.push(S.storyScreen(h));
  }
  scroll(dir) { this.body.scrollBy({ top: dir * (this.body.clientHeight - 30), behavior: 'smooth' }); }
  clear() { this.stack = []; this.body.innerHTML = '<div class="empty">Panel cleared. Enter a function, e.g. TOP, WEI, AAPL CN.</div>'; this.titleEl.innerHTML = `<span class="pn">${this.idx + 1}</span>`; this.toolbarEl.innerHTML = ''; this.statusEl.innerHTML = ''; clearTimeout(this.timer); }
}

function setActive(i) { state.active = i; state.panels.forEach((p, k) => p.el.classList.toggle('active', k === i)); }
const activePanel = () => state.panels[state.active];
const shareUrl = () => { const u = new URL(location.href); u.search = ''; const s = state.settings; if (s.tickers.length) u.searchParams.set('t', s.tickers.join(',')); if (s.topics.length) u.searchParams.set('topics', s.topics.join(',')); if (s.alerts.length) u.searchParams.set('alerts', s.alerts.join(',')); return u.toString(); };

// ---------------- command execution ----------------
export function exec(text, panel = activePanel()) {
  const c = parseCommand(text);
  const s = state.settings;
  if (c.type === 'empty') return;
  if (c.type === 'number') return panel.onNumber(c.n);
  if (c.type === 'security') {
    const sym = c.symbol;
    const map = { MENU: () => S.securityMenu(sym), QR: () => S.securityMenu(sym), CN: () => S.cnScreen(sym), DES: () => S.desScreen(sym), GP: () => S.gpScreen(sym, false), GIP: () => S.gpScreen(sym, true), CF: () => S.cfScreen(sym) };
    return panel.push(map[c.fn]());
  }
  const a = c.args; const raw = c.argsRaw;
  switch (c.fn) {
    case 'N': return panel.push(S.myNewsScreen(s, raw));
    case 'TOP': return panel.push(S.topScreen(a[0] || 'TOP'));
    case 'NI': return raw ? panel.push(S.niScreen(raw)) : panel.push(S.topScreen('TOP'));
    case 'NSE': return raw ? panel.push(S.nseScreen(raw)) : panel.flash('NSE <text> — enter search terms', 'warn');
    case 'MON': return panel.push(S.monScreen(s));
    case 'W': return watchlistCmd(a, raw, panel);
    case 'ALRT': return alertCmd(a, raw, panel);
    case 'WEI': return panel.push(S.weiScreen());
    case 'FXC': return panel.push(S.fxcScreen());
    case 'WB': return panel.push(S.wbScreen());
    case 'CRYP': return panel.push(S.crypScreen());
    case 'MOST': return panel.push(S.mostScreen());
    case 'ECO': return panel.push(S.ecoScreen('ECO'));
    case 'CEN': return panel.push(S.ecoScreen('CEN'));
    case 'SECF': return raw ? panel.push(S.secfScreen(raw)) : panel.flash('SECF <name> — enter a company name', 'warn');
    case 'HELP': return panel.push(S.helpScreen());
    case 'LAYOUT': return setLayout(Number(a[0]) || 4, panel);
    case 'REFRESH': return panel.show(true);
    case 'MENU': return panel.back();
    case 'CLR': return panel.clear();
    case 'PGUP': return panel.scroll(-1);
    case 'PGDN': return panel.scroll(1);
    case 'TAPE': return updateTape(true);
    default: return panel.flash(`UNKNOWN FUNCTION ${c.fn}`, 'warn');
  }
}

function persistSettings() {
  state.settings.updatedAt = Date.now();
  saveLS(LS.settings, state.settings);
  api.saveSettings(state.settings).catch(() => { /* server persistence optional */ });
  updateTape(true);
}
function refreshSettingsScreens() { for (const p of state.panels) { const k = p.screen?.key || ''; if (/^(W|ALRT|MON|N:|N$)/.test(k)) { if (k === 'W') p.stack[p.stack.length - 1] = S.wScreen(state.settings, p.ctx); else if (k === 'ALRT') p.stack[p.stack.length - 1] = S.alrtScreen(state.settings, p.ctx); else if (k === 'MON') p.stack[p.stack.length - 1] = S.monScreen(state.settings); else p.stack[p.stack.length - 1] = S.myNewsScreen(state.settings); p.show(); } } }

function watchlistCmd(a, raw, panel) {
  const s = state.settings; const sub = a[0];
  if (!sub) return panel.push(S.wScreen(s, panel.ctx));
  const rest = raw.replace(/^\w+\s*/, '').trim();
  const isTopic = /^(NI|TOPIC)\s+/i.test(rest);
  const val = rest.replace(/^(NI|TOPIC)\s+/i, '').trim();
  const list = val.split(/\s*,\s*/).filter(Boolean);
  if (sub === 'ADD') {
    if (!list.length) return panel.flash('W ADD <ticker> or W ADD NI <topic>', 'warn');
    if (isTopic) list.forEach((t) => { if (!s.topics.some((x) => x.toLowerCase() === t.toLowerCase())) s.topics.push(t); });
    else list.forEach((t) => { const T = t.toUpperCase(); if (!s.tickers.includes(T)) s.tickers.push(T); });
    persistSettings(); panel.flash(`SAVED ${isTopic ? 'TOPIC' : 'TICKER'}: ${list.join(', ').toUpperCase()}`, 'ok'); refreshSettingsScreens();
    if (!/^(W|MON|N)/.test(panel.screen?.key || '')) return;
    return;
  }
  if (sub === 'DEL' || sub === 'DELETE' || sub === 'REMOVE') {
    if (isTopic) s.topics = s.topics.filter((x) => !list.some((t) => t.toLowerCase() === x.toLowerCase())); else s.tickers = s.tickers.filter((x) => !list.map((t) => t.toUpperCase()).includes(x));
    persistSettings(); panel.flash(`REMOVED ${list.join(', ').toUpperCase()}`, 'ok'); return refreshSettingsScreens();
  }
  if (sub === 'CLR' || sub === 'CLEAR') { s.tickers = []; s.topics = []; persistSettings(); panel.flash('WATCHLIST CLEARED', 'ok'); return refreshSettingsScreens(); }
  return panel.flash('W ADD | W DEL | W CLR', 'warn');
}

function alertCmd(a, raw, panel) {
  const s = state.settings; const sub = a[0]; const val = raw.replace(/^\w+\s*/, '').trim();
  if (!sub) return panel.push(S.alrtScreen(s, panel.ctx));
  if (sub === 'ADD') { if (!val) return panel.flash('ALRT ADD <keyword>', 'warn'); if (!s.alerts.some((x) => x.toLowerCase() === val.toLowerCase())) s.alerts.push(val); persistSettings(); panel.flash(`ALERT ADDED: ${val}`, 'ok'); return refreshSettingsScreens(); }
  if (sub === 'DEL' || sub === 'DELETE') { const n = Number(val); if (n && s.alerts[n - 1]) s.alerts.splice(n - 1, 1); else s.alerts = s.alerts.filter((x) => x.toLowerCase() !== val.toLowerCase()); persistSettings(); panel.flash('ALERT REMOVED', 'ok'); return refreshSettingsScreens(); }
  if (sub === 'CLR') { s.alerts = []; persistSettings(); panel.flash('ALERTS CLEARED', 'ok'); return refreshSettingsScreens(); }
  if (sub === 'CLRLOG') { state.alertLog = []; saveLS(LS.alerts, []); return refreshSettingsScreens(); }
  return panel.flash('ALRT ADD | ALRT DEL | ALRT CLR', 'warn');
}

function setLayout(n, panel) {
  const L = [1, 2, 3, 4].includes(n) ? n : 4;
  state.settings.layout = L; document.getElementById('panels').className = `layout-${L}`; persistSettings();
  if (state.active >= L) setActive(0);
  state.panels.forEach((p) => p.screen?.redraw?.());
  panel?.flash(`LAYOUT ${L}`, 'ok');
}

// ---------------- alerts ----------------
function checkAlerts(items, panel) {
  const kws = state.settings.alerts; if (!kws?.length || !items?.length) return;
  for (const h of items) {
    if (state.fired.has(h.id)) continue;
    const text = `${h.headline} ${h.summary || ''}`.toLowerCase();
    const kw = kws.find((k) => text.includes(k.toLowerCase()));
    if (!kw) continue;
    state.fired.add(h.id); if (state.fired.size > 3000) state.fired = new Set([...state.fired].slice(-2000)); saveLS(LS.fired, [...state.fired]);
    const entry = { at: Date.now(), keyword: kw, headline: h };
    state.alertLog.unshift(entry); state.alertLog = state.alertLog.slice(0, 100); saveLS(LS.alerts, state.alertLog);
    showAlertBar(entry, panel);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && Date.now() - h.ts < 6 * 3600_000) { try { new Notification(`ALERT [${kw}] ${h.source}`, { body: h.headline, tag: h.id }); } catch { /* ignore */ } }
  }
}
const alertQueue = [];
function showAlertBar(entry, panel) {
  alertQueue.unshift(entry); if (alertQueue.length > 5) alertQueue.pop();
  const bar = document.getElementById('alertbar');
  bar.innerHTML = alertQueue.map((e, i) => `<span class="al" data-i="${i}"><b>ALERT</b> <span class="kw">${esc(e.keyword.toUpperCase())}</span> <span class="src">${esc(e.headline.source)}</span> ${esc(e.headline.headline)}</span>`).join('');
  bar.classList.remove('hidden'); bar.classList.add('flash'); setTimeout(() => bar.classList.remove('flash'), 3000);
  bar.querySelectorAll('.al').forEach((el) => { el.onclick = () => activePanel().openStory(alertQueue[Number(el.dataset.i)].headline); });
  document.getElementById('alertclose').classList.remove('hidden');
}
async function backgroundAlertPoll() {
  if (document.hidden || !state.settings.alerts.length) return;
  try { const s = state.settings; const [top, mine] = await Promise.all([api.top('TOP'), s.tickers.length || s.topics.length ? api.myNews(s.tickers, s.topics) : { items: [] }]); checkAlerts([...(top.items || []), ...(mine.items || [])]); } catch { /* ignore */ }
}

// ---------------- tape, clocks, status ----------------
async function updateTape(force = false) {
  const track = document.getElementById('tape-track');
  const syms = [...new Set([...(state.settings.tape || []), ...(state.settings.tickers || [])])].slice(0, 40);
  if (!syms.length) return;
  try {
    const qs = await api.quotes(syms);
    const html = qs.filter((q) => q && !q.error).map((q) => `<span class="ti" data-sym="${esc(q.symbol)}"><span class="s">${esc(q.symbol.replace(/=X$/, '').replace(/^\^/, ''))}</span> <span class="${cls(q.chg)}">${fmtNum(q.last, priceDp(q.symbol, q.last))} ${fmtPct(q.pct)}</span></span>`).join('<span class="sep">|</span>');
    if (html) { track.innerHTML = html + '<span class="sep">|</span>' + html; const dur = Math.max(30, track.scrollWidth / 60); track.style.animationDuration = `${dur}s`; track.querySelectorAll('.ti').forEach((t) => { t.onclick = () => exec(`${t.dataset.sym} GIP`); }); }
  } catch { if (force) track.innerHTML = '<span class="dim">tape unavailable</span>'; }
}
function tickClocks() {
  const z = [['NYC', 'America/New_York'], ['LDN', 'Europe/London'], ['FRA', 'Europe/Berlin'], ['TKO', 'Asia/Tokyo'], ['HKG', 'Asia/Hong_Kong']];
  document.getElementById('clocks').innerHTML = z.map(([n, tz]) => `<span class="clk"><span class="z">${n}</span> ${clockIn(tz)}</span>`).join('') + `<span class="clk local"><span class="z">LOC</span> ${new Date().toTimeString().slice(0, 8)}</span>`;
}
function updateGlobalStatus(sc) {
  const el = document.getElementById('gstatus');
  const h = sc?.health || {}; const e = Object.entries(h); const ok = e.filter(([, v]) => v.ok).length;
  const d = new Date(state.lastUpdate);
  el.innerHTML = `<span class="${state.demo ? 'warn' : 'ok'}">${state.demo ? 'DEMO DATA' : 'LIVE · FREE SOURCES'}</span> · <span class="dim">last upd ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span>${e.length ? ` · <span class="${ok === e.length ? 'ok' : ok ? 'warn' : 'err'}" title="${esc(e.filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`).join('\n'))}">src ${ok}/${e.length}</span>` : ''}`;
}

// ---------------- keyboard ----------------
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const isCmd = e.target.classList?.contains('cmd');
    if (e.key === 'Tab' && !(inField && !isCmd)) { e.preventDefault(); const L = state.settings.layout || 4; setActive((state.active + (e.shiftKey ? L - 1 : 1)) % L); activePanel().input.focus(); return; }
    if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); const n = Number(e.key) - 1; if (n < (state.settings.layout || 4)) { setActive(n); activePanel().input.focus(); } return; }
    if (e.key === 'PageDown' || e.key === 'PageUp') { if (!inField || isCmd) { e.preventDefault(); activePanel().scroll(e.key === 'PageDown' ? 1 : -1); } return; }
    if (e.key === 'Escape' && !inField) { activePanel().back(); return; }
    if (!inField && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { activePanel().input.focus(); }
  });
  document.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.key; const p = activePanel(); if (k === 'GO') { const v = p.input.value; p.input.value = ''; if (v) p.run(v); else p.show(true); } else if (k === 'MENU') p.back(); else if (k === 'PGUP') p.scroll(-1); else if (k === 'PGDN') p.scroll(1); else if (k.startsWith('LAYOUT')) setLayout(Number(k.split(' ')[1]), p); else exec(k, p); p.input.focus(); }));
  document.getElementById('alertclose').onclick = () => { document.getElementById('alertbar').classList.add('hidden'); document.getElementById('alertclose').classList.add('hidden'); alertQueue.length = 0; };
}

// ---------------- settings bootstrap ----------------
async function loadSettings() {
  const local = loadLS(LS.settings, null);
  const server = await api.getSettings().catch(() => null);
  let s = server && local ? (server.updatedAt >= local.updatedAt ? server : local) : server || local || state.settings;
  s = { tickers: [], topics: [], alerts: [], layout: 4, tape: [], ...s };
  const u = new URL(location.href); let changed = false;
  const add = (param, key, upper) => { const v = u.searchParams.get(param); if (!v) return; for (const x of v.split(',').map((t) => t.trim()).filter(Boolean)) { const val = upper ? x.toUpperCase() : x; if (!s[key].some((y) => y.toLowerCase() === val.toLowerCase())) { s[key].push(val); changed = true; } } };
  add('t', 'tickers', true); add('tickers', 'tickers', true); add('topics', 'topics', false); add('topic', 'topics', false); add('alerts', 'alerts', false);
  if (u.searchParams.get('layout')) { s.layout = Number(u.searchParams.get('layout')) || 4; changed = true; }
  state.settings = s;
  if (changed || (server && !local) || (!server && local)) persistSettings(); else saveLS(LS.settings, s);
  return u.searchParams.get('cmd');
}

async function main() {
  state.panels = [...document.querySelectorAll('.panel')].map((el, i) => new Panel(i, el));
  bindKeys(); tickClocks(); setInterval(tickClocks, 1000);
  const health = await api.health().catch(() => ({}));
  state.demo = !!health.demo; document.getElementById('brand-mode').textContent = state.demo ? 'DEMO' : 'FREE';
  const cmd = await loadSettings();
  document.getElementById('panels').className = `layout-${state.settings.layout || 4}`;
  setActive(0);
  const s = state.settings; const saved = s.tickers.length || s.topics.length;
  const defaults = [cmd || (saved ? 'N' : 'TOP'), cmd || saved ? 'TOP' : 'TOP MKT', 'WEI', saved ? 'MON' : 'MOST'];
  defaults.forEach((c, i) => setTimeout(() => exec(c, state.panels[i]), i * 150));
  updateTape(true); setInterval(() => updateTape(), 30_000);
  setInterval(backgroundAlertPoll, 60_000);
  window.addEventListener('resize', () => state.panels.forEach((p) => p.screen?.redraw?.()));
  state.panels[0].input.focus();
  window.investinews = { exec, state };
}
main();
