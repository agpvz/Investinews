import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openNodeDb, migrateNode, type NodeDb } from '../src/server/db.ts';
import { configFromEnv, type AppCtx, type Config } from '../src/server/env.ts';
import type { Source } from '../src/core/model.ts';

export const MIGRATIONS = path.resolve(process.cwd(), 'migrations');

export async function makeCtx(opts: { file?: string; cfg?: Partial<Config> } = {}): Promise<AppCtx & { db: NodeDb; file: string }> {
  const file = opts.file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-test-')), 'db.sqlite');
  const db = await openNodeDb(file);
  await migrateNode(db, MIGRATIONS);
  const cfg = { ...configFromEnv({ SEC_USER_AGENT: 'test agent test@example.com', ALLOW_PRIVATE_FEEDS: '1' }), ...(opts.cfg || {}) };
  return { db, cfg, log: () => {}, file };
}

export const fakeSource = (over: Partial<Source> = {}): Source => ({ id: 's_fake', type: 'rss', name: 'fake', url: 'https://example.com/feed', enabled: 1, interval_sec: 600, config: '{}', etag: null, last_modified: null, last_checked_at: null, last_success_at: null, last_item_published_at: null, last_error: null, fail_count: 0, cooldown_until: null, next_due_at: 0, created_at: Date.now(), ...over });

export const rssXml = (items: { title: string; link: string; date?: string; guid?: string; desc?: string }[], title = 'Test Feed') => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link>${i.guid ? `<guid>${i.guid}</guid>` : ''}${i.date ? `<pubDate>${i.date}</pubDate>` : ''}${i.desc ? `<description><![CDATA[${i.desc}]]></description>` : ''}</item>`).join('')}</channel></rss>`;
