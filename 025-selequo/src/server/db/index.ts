// Database abstraction: PostgreSQL in production (node-postgres), PGlite (embedded Postgres/WASM)
// for local development and tests. Only parameterized queries are exposed.

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const pg = new PGlite({ dataDir, extensions: { pg_trgm } });
  await pg.waitReady;
  type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (s: string) => Promise<unknown> };
  const wrap = (q: Q, inTx: boolean): Db => ({
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return ((await q.query(sql, params)).rows[0] as T) ?? null;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(this);
      return pg.transaction(async (t) => fn(wrap(t as unknown as Q, true)));
    },
    async close() {
      await pg.close();
    },
  });
  return wrap(pg as unknown as Q, false);
}

export async function createPostgresDb(connectionString: string): Promise<Db> {
  const { default: pgmod } = await import('pg');
  // numeric → JS number (amounts/weights are well within double precision)
  pgmod.types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new pgmod.Pool({ connectionString, max: 10 });
  const fromClient = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, inTx: boolean): Db => ({
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return ((await c.query(sql, params)).rows[0] as T) ?? null;
    },
    async exec(sql: string) {
      await c.query(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(this);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(fromClient(client, true));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  });
  return fromClient(pool, false);
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
  await db.query(`INSERT INTO schema_meta(key, value) VALUES ('schemaVersion', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(SCHEMA_VERSION)]);
}

export async function openDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Db> {
  const db = opts.databaseUrl ? await createPostgresDb(opts.databaseUrl) : await createPgliteDb(opts.pgliteDir);
  await migrate(db);
  return db;
}

export const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
export const num = (v: unknown): number | null => (v == null ? null : Number(v));
