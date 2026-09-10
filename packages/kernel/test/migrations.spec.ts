import { describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type DbAdapter, type Migration } from '@mpw/kernel';

function sampleMigration(n: number, sql: string): Migration {
  return {
    version: n,
    name: `m${n}`,
    up(db: DbAdapter) {
      db.exec(sql);
    },
  };
}

describe('migration runner', () => {
  it('applies pending migrations in order and records them', async () => {
    const db = await openMemoryDb();
    const res = migrate(db, [sampleMigration(1, 'CREATE TABLE a (x TEXT)'), sampleMigration(2, 'CREATE TABLE b (y TEXT)')]);
    expect(res.applied).toEqual([1, 2]);
    expect(db.one("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeTruthy();
  });

  it('is idempotent on re-run', async () => {
    const db = await openMemoryDb();
    const ms = [sampleMigration(1, 'CREATE TABLE a (x TEXT)')];
    migrate(db, ms);
    const second = migrate(db, ms);
    expect(second.applied).toEqual([]);
    expect(second.current).toBe(1);
  });

  it('detects edited migration history via checksum and fails hard', async () => {
    const db = await openMemoryDb();
    const original: Migration = {
      version: 1,
      name: 'm1',
      up(db: DbAdapter) {
        db.exec('CREATE TABLE a (x TEXT)');
      },
    };
    migrate(db, [original]);
    const tampered: Migration = {
      version: 1,
      name: 'm1',
      up(db: DbAdapter) {
        db.exec('CREATE TABLE a (x TEXT, extra TEXT)');
      },
    };
    expect(() => migrate(db, [tampered])).toThrow(/checksum mismatch/);
    // same body → accepted (idempotent)
    expect(() => migrate(db, [original])).not.toThrow();
  });

  it('rolls back a failing migration transaction', async () => {
    const db = await openMemoryDb();
    const bad: Migration = {
      version: 1,
      name: 'bad',
      up(d) {
        d.exec('CREATE TABLE ok (x TEXT)');
        throw new Error('explosion mid-migration');
      },
    };
    expect(() => migrate(db, [bad])).toThrow('explosion mid-migration');
    expect(db.one("SELECT name FROM sqlite_master WHERE name = 'ok'")).toBeNull();
    expect(db.one('SELECT COUNT(*) AS n FROM schema_migrations')?.['n']).toBe(0);
  });
});
