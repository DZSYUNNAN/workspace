import type { DbAdapter } from './db';

export interface Migration {
  version: number;
  name: string;
  up(db: DbAdapter): void;
}

function checksum(up: (db: DbAdapter) => void): string {
  // Stable content hash of the migration body — detects edited history (DATABASE.md §5).
  const src = up.toString();
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export interface MigrationResult {
  applied: number[];
  current: number;
}

/**
 * Ordered, transactional, checksummed migration runner.
 * Failures are hard errors — never silently skipped (ROADMAP guardrail).
 */
export function migrate(db: DbAdapter, migrations: Migration[]): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const appliedRows = db.all('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const appliedMap = new Map<number, string>();
  for (const row of appliedRows) {
    appliedMap.set(row['version'] as number, row['checksum'] as string);
  }
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    const known = appliedMap.get(m.version);
    if (known !== undefined) {
      const expected = checksum(m.up);
      if (known !== expected) {
        throw new Error(
          `migration ${m.version} (${m.name}) checksum mismatch — history was edited. ` +
            `Expected ${expected}, recorded ${known}.`
        );
      }
      continue;
    }
    db.transaction(() => {
      m.up(db);
      db.run(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        [m.version, m.name, checksum(m.up), Date.now()]
      );
    });
    applied.push(m.version);
  }
  const current = appliedMap.size + applied.length;
  return { applied, current };
}

/** Core schema (DATABASE.md §2). Versioned; append-only from here on. */
export const CORE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core-tables',
    up(db) {
      db.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
          is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
          layout_version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

        CREATE TABLE layouts (
          workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
          state TEXT NOT NULL,
          updated_at INTEGER NOT NULL);

        CREATE TABLE layout_presets (
          id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT NOT NULL, state TEXT NOT NULL,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL, version TEXT NOT NULL, author TEXT, description TEXT,
          icon TEXT, permissions TEXT NOT NULL, manifest TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 1,
          state TEXT NOT NULL DEFAULT 'installed', settings TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

        CREATE TABLE blob_meta (
          ref TEXT PRIMARY KEY, path TEXT NOT NULL, mime TEXT NOT NULL,
          size INTEGER NOT NULL, created_at INTEGER NOT NULL);

        CREATE TABLE plugin_kv (
          plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
          updated_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, key));

        CREATE TABLE settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT, icon TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

        CREATE TABLE project_links (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
          resource_uri TEXT NOT NULL, label TEXT, added_at INTEGER NOT NULL);

        CREATE TABLE search_index (
          id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, type TEXT NOT NULL,
          title TEXT NOT NULL, body TEXT NOT NULL, icon TEXT, updated_at INTEGER NOT NULL);
        CREATE INDEX idx_search_body ON search_index(plugin_id, type);

        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL,
          action TEXT NOT NULL, detail TEXT);
      `);
    },
  },
];
