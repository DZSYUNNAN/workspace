import { describe, expect, it } from 'vitest';
import { CORE_MIGRATIONS, openMemoryDb, migrate, type DbAdapter, type Migration } from '@mpw/kernel';

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
  it('opens the shipped v0.1 database across dev and minified builds', async () => {
    const db = await openMemoryDb(); migrate(db, CORE_MIGRATIONS);
    db.run('UPDATE schema_migrations SET checksum = ? WHERE version = 1', ['2993013c']);
    db.run('UPDATE schema_migrations SET checksum = ? WHERE version = 2', ['2857382c']);
    expect(() => migrate(db, CORE_MIGRATIONS)).not.toThrow();
    expect(db.one('SELECT checksum FROM schema_migrations WHERE version = 1')?.checksum).toBe('cd891b90');
    const tampered = { ...CORE_MIGRATIONS[0], up(d: DbAdapter) { d.exec(`CREATE TABLE changed (x TEXT)`); } };
    expect(() => migrate(db, [tampered])).toThrow('checksum mismatch');
    db.close();
  });
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

  it('v2 迁移将项目域移交给插件(核心不再保留 projects 业务表)', async () => {
    const db = await openMemoryDb();
    const result = migrate(db, CORE_MIGRATIONS);
    expect(result.applied).toEqual([1, 2]);
    expect(db.one("SELECT name FROM sqlite_master WHERE name = 'projects'")).toBeNull();
    expect(db.one("SELECT name FROM sqlite_master WHERE name = 'project_links'")).toBeNull();
    // 幂等:重复执行同一迁移集不报错
    expect(() => migrate(db, CORE_MIGRATIONS)).not.toThrow();
  });
});
