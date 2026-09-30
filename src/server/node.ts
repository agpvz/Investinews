// Local / self-hosted entry: Node 22+, SQLite file, built-in scheduler, serves the built frontend from dist/.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openNodeDb, migrateNode } from './db.ts';
import { configFromEnv, makeLogger, type AppCtx } from './env.ts';
import { runPollJob } from './jobs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadDotEnv(path.join(root, '.env'));

const cfg = configFromEnv(process.env);
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'investinews.sqlite');
const db = await openNodeDb(dbPath);
const applied = await migrateNode(db, path.join(root, 'migrations'));
const log = makeLogger();
const ctx: AppCtx = { db, cfg, log, resolveHost: async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address) };
log('startup', { dbPath, migrationsApplied: applied, pollIntervalSec: cfg.pollIntervalSec, pushConfigured: !!(cfg.vapidPublicKey && cfg.vapidPrivateKey), authRequired: !!cfg.appToken });
if (!cfg.appToken) log('startup.warning', { note: 'APP_TOKEN not set: API is open. Fine on localhost, never expose this to the internet.' });

const api = createApp();
const app = new Hono();
app.all('/api/*', (c) => api.fetch(c.req.raw, ctx));
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), dist) || '.' }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
} else {
  app.get('*', (c) => c.text('Frontend not built. Run `npm run build` (or `npm run dev` for the Vite dev server on :5173).', 200));
}

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => log('listening', { port: info.port, dist: fs.existsSync(dist) }));

// Background scheduler (local mode). On Cloudflare Pages use external cron -> POST /api/jobs/poll instead.
const tick = () => runPollJob(ctx).catch((e) => log('job.error', { error: String(e.message) }));
setTimeout(tick, 3000);
setInterval(tick, cfg.pollIntervalSec * 1000);

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/\s+#.*$/, '');
  }
}
