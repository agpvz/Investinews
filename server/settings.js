// Persisted terminal settings: saved tickers, topics, alerts and layout.
import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = process.env.SETTINGS_FILE || path.join(process.cwd(), 'data', 'settings.json');

const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

export const DEFAULTS = () => ({
  tickers: list(process.env.TICKERS).map((t) => t.toUpperCase()),
  topics: list(process.env.TOPICS),
  alerts: list(process.env.ALERTS),
  layout: 4,
  tape: ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX', 'EURUSD=X', 'JPY=X', 'GBPUSD=X', '^TNX', 'CL=F', 'BZ=F', 'GC=F', 'BTC-USD', 'ETH-USD'],
  updatedAt: 0,
});

export async function loadSettings() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return { ...DEFAULTS(), ...JSON.parse(raw) };
  } catch {
    return DEFAULTS();
  }
}

export function sanitize(input = {}) {
  const clean = (arr, upper) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).map((x) => (upper ? x.toUpperCase() : x)))].slice(0, 100);
  return {
    tickers: clean(input.tickers, true),
    topics: clean(input.topics, false),
    alerts: clean(input.alerts, false),
    layout: [1, 2, 3, 4].includes(Number(input.layout)) ? Number(input.layout) : 4,
    tape: clean(input.tape, true).length ? clean(input.tape, true) : DEFAULTS().tape,
    updatedAt: Date.now(),
  };
}

export async function saveSettings(input) {
  const s = sanitize(input);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2));
  return s;
}
