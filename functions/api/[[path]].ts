// Cloudflare Pages Function: every /api/* request runs the same Hono app against D1.
import { createApp } from '../../src/server/app.ts';
import { D1Db, type D1Like } from '../../src/server/db.ts';
import { configFromEnv, makeLogger, type AppCtx } from '../../src/server/env.ts';

const app = createApp();
interface PagesEnv { DB: D1Like; [k: string]: unknown }
interface PagesContext { request: Request; env: PagesEnv; waitUntil(p: Promise<unknown>): void }

export const onRequest = async (c: PagesContext): Promise<Response> => {
  if (!c.env.DB) return new Response(JSON.stringify({ error: 'D1 binding "DB" missing: create the database and set database_id in wrangler.toml' }), { status: 500, headers: { 'content-type': 'application/json' } });
  const ctx: AppCtx = { db: new D1Db(c.env.DB), cfg: configFromEnv(c.env as Record<string, string | undefined>), log: makeLogger() };
  return app.fetch(c.request, ctx);
};
