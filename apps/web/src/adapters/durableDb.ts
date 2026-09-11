import { SqlJsAdapter, type DbAdapter } from '@mpw/kernel';

export type SaveState = { phase: 'saved' | 'saving' | 'error'; error?: string };
/** Synchronous SQL with ordered, acknowledged snapshots. Never report saved before commit. */
export class DurableDb implements DbAdapter {
  private revision = 0;
  private committed = 0;
  private pending: Promise<void> | null = null;
  private depth = 0;
  private frozen = false;
  private listeners = new Set<() => void>();
  state: SaveState = { phase: 'saved' };
  constructor(protected inner: SqlJsAdapter, private write: (bytes: Uint8Array) => Promise<void>) {}
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private notify(state: SaveState): void { this.state = state; this.listeners.forEach((fn) => fn()); }
  private assertWritable(): void { if (this.frozen) throw new Error('正在备份或恢复，请稍后重试'); }
  private changed(): void {
    this.revision++;
    this.notify({ phase: 'saving' });
    if (!this.depth) void this.flush().catch(() => {});
  }
  run(sql: string, params?: unknown[]): void { this.assertWritable(); this.inner.run(sql, params); this.changed(); }
  exec(sql: string): void { this.assertWritable(); this.inner.exec(sql); this.changed(); }
  all(sql: string, params?: unknown[]): Record<string, unknown>[] { return this.inner.all(sql, params); }
  one(sql: string, params?: unknown[]): Record<string, unknown> | null { return this.inner.one(sql, params); }
  transaction<T>(fn: () => T): T {
    this.assertWritable(); this.depth++;
    try { return this.inner.transaction(fn); }
    finally { this.depth--; this.changed(); }
  }
  export(): Uint8Array { return this.inner.export(); }
  async flush(): Promise<void> {
    if (this.pending) { await this.pending; if (this.committed < this.revision) return this.flush(); return; }
    if (this.committed === this.revision) return;
    this.notify({ phase: 'saving' });
    this.pending = Promise.resolve().then(async () => {
      while (this.committed < this.revision) {
        const revision = this.revision;
        await this.write(this.inner.export());
        this.committed = revision;
      }
      this.notify({ phase: 'saved' });
    }).catch((error: unknown) => {
      this.notify({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }).finally(() => { this.pending = null; });
    await this.pending;
  }
  async exclusive<T>(operation: () => Promise<T>, keepFrozen = false): Promise<T> {
    this.assertWritable(); this.frozen = true;
    try { await this.flush(); const result = await operation(); if (!keepFrozen) this.frozen = false; return result; }
    catch (error) { this.frozen = false; throw error; }
  }
  close(): void {
    if (this.state.phase !== 'saved') throw new Error('数据库尚未保存，请先等待 flush() 完成');
    this.frozen = true; this.inner.close();
  }
}
