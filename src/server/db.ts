// Minimal async DB interface implemented for node:sqlite (local) and Cloudflare D1 (Pages). Same SQLite dialect, shared migrations.
export type Param = string | number | null | Uint8Array | bigint;
export interface Stmt { sql: string; params?: Param[] }
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Atomic multi-statement write. */
  batch(stmts: Stmt[]): Promise<void>;
  exec(sql: string): Promise<void>;
  readonly kind: 'node' | 'd1';
}

const norm = (params?: Param[]): Param[] => (params || []).map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p) as Param);

// ---------- node:sqlite ----------
interface DatabaseSyncLike {
  prepare(sql: string): { all(...p: Param[]): unknown[]; get(...p: Param[]): unknown; run(...p: Param[]): { changes: number | bigint } };
  exec(sql: string): void;
}

export class NodeDb implements Db {
  readonly kind = 'node' as const;
  private inTx = false;
  private readonly db: DatabaseSyncLike;
  constructor(db: DatabaseSyncLike) { this.db = db; }
  async all<T>(sql: string, params?: Param[]) { return this.db.prepare(sql).all(...norm(params)) as T[]; }
  async get<T>(sql: string, params?: Param[]) { return this.db.prepare(sql).get(...norm(params)) as T | undefined; }
  async run(sql: string, params?: Param[]) { const r = this.db.prepare(sql).run(...norm(params)); return { changes: Number(r.changes) }; }
  async batch(stmts: Stmt[]) {
    if (!stmts.length) return;
    if (this.inTx) { for (const s of stmts) this.db.prepare(s.sql).run(...norm(s.params)); return; }
    this.inTx = true; this.db.exec('BEGIN');
    try { for (const s of stmts) this.db.prepare(s.sql).run(...norm(s.params)); this.db.exec('COMMIT'); }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    finally { this.inTx = false; }
  }
  async exec(sql: string) { this.db.exec(sql); }
}

export async function openNodeDb(path: string): Promise<NodeDb> {
  const mod = await import('node:sqlite');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  if (path !== ':memory:') fs.mkdirSync(nodePath.dirname(path), { recursive: true });
  const raw = new mod.DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return new NodeDb(raw as unknown as DatabaseSyncLike);
}

/** Apply migrations/*.sql in order (local mode). Cloudflare uses `wrangler d1 migrations apply`. */
export async function migrateNode(db: NodeDb, migrationsDir: string): Promise<string[]> {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set((await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(nodePath.join(migrationsDir, f), 'utf8');
    await db.exec('BEGIN');
    try { await db.exec(sql); await db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [f, Date.now()]); await db.exec('COMMIT'); applied.push(f); }
    catch (e) { await db.exec('ROLLBACK'); throw new Error(`migration ${f} failed: ${(e as Error).message}`); }
  }
  return applied;
}

// ---------- Cloudflare D1 ----------
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}
export interface D1Stmt { bind(...p: unknown[]): D1Stmt; all<T = unknown>(): Promise<{ results: T[] }>; first<T = unknown>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> }

export class D1Db implements Db {
  readonly kind = 'd1' as const;
  private readonly d1: D1Like;
  constructor(d1: D1Like) { this.d1 = d1; }
  async all<T>(sql: string, params?: Param[]) { return (await this.d1.prepare(sql).bind(...norm(params)).all<T>()).results; }
  async get<T>(sql: string, params?: Param[]) { return (await this.d1.prepare(sql).bind(...norm(params)).first<T>()) ?? undefined; }
  async run(sql: string, params?: Param[]) { const r = await this.d1.prepare(sql).bind(...norm(params)).run(); return { changes: r.meta?.changes ?? 0 }; }
  async batch(stmts: Stmt[]) { if (stmts.length) await this.d1.batch(stmts.map((s) => this.d1.prepare(s.sql).bind(...norm(s.params)))); }
  async exec(sql: string) { await this.d1.exec(sql); }
}
