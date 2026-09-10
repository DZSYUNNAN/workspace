import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

export type SqlParams = unknown[] | undefined;

export interface DbRow {
  [column: string]: unknown;
}

/**
 * Environment-agnostic synchronous SQLite adapter.
 * Web profile: sql.js WASM persisted to IndexedDB · Desktop: native (Tauri) · Mobile: native.
 */
export interface DbAdapter {
  run(sql: string, params?: SqlParams): void;
  all(sql: string, params?: SqlParams): DbRow[];
  one(sql: string, params?: SqlParams): DbRow | null;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  export(): Uint8Array;
  close(): void;
}

export class SqlJsAdapter implements DbAdapter {
  constructor(private db: Database) {}

  run(sql: string, params?: SqlParams): void {
    this.db.run(sql, params as never[]);
  }

  all(sql: string, params?: SqlParams): DbRow[] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(params as never[]);
      const rows: DbRow[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as DbRow);
      return rows;
    } finally {
      stmt.free();
    }
  }

  one(sql: string, params?: SqlParams): DbRow | null {
    return this.all(sql, params)[0] ?? null;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      return result;
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}

/** Factory: caller supplies the wasm locator (Vite `?url` on web, require.resolve in node). */
export async function openSqlJs(locateFile: (file: string) => string): Promise<SqlJsAdapter> {
  const SQL = await initSqlJs({ locateFile });
  return new SqlJsAdapter(new SQL.Database());
}

/** In-memory adapter for tests and ephemeral use (resolves wasm from node_modules). */
export async function openMemoryDb(): Promise<SqlJsAdapter> {
  let locate: ((file: string) => string) | undefined;
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    locate = (file: string) => req.resolve(`sql.js/dist/${file}`);
  }
  const SQL = await initSqlJs(locate ? { locateFile: locate } : undefined);
  return new SqlJsAdapter(new SQL.Database());
}
