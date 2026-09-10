import type { DbAdapter, DbRow } from './db';
import { nowMs, uuidv7 } from '@mpw/shared';

/** Physical SQL table prefix for a plugin namespace: 'mpw.notes' → 'p_notes_'. */
export function tablePrefix(pluginId: string): string {
  const last = pluginId.split('.').pop() ?? pluginId;
  return `p_${last.replace(/[^a-z0-9_]/gi, '')}_`;
}

const TABLE_REF_RE = /\b(?:from|into|update|join|table|index|trigger|view)\s+(?:if\s+(?:not\s+)?exists\s+)?["'`]?([a-zA-Z_][\w]*)/gi;

/**
 * Validates that every table referenced by a plugin statement lives in the
 * plugin's own namespace. In-process trust tier for v1; full worker sandbox is
 * Phase 7 (PLUGIN_SPEC §5). Fail loud on cross-namespace access.
 */
export function assertTablesInNamespace(sql: string, prefix: string): void {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((m = TABLE_REF_RE.exec(sql)) !== null) {
    refs.push(m[1] as string);
  }
  for (const t of refs) {
    if (t.startsWith(prefix)) continue;
    if (t === 'sqlite_sequence' || t.startsWith('temp_') || t.startsWith('cte_')) continue;
    throw new Error(
      `storage namespace violation: table "${t}" is outside this plugin's namespace (${prefix}*)`
    );
  }
}

/** JSON KV store namespaced per plugin (plugin_kv table). */
export class PluginKv {
  constructor(private db: DbAdapter, private pluginId: string) {}

  get<T>(key: string, defaultValue: T): T {
    const row = this.db.one('SELECT value FROM plugin_kv WHERE plugin_id = ? AND key = ?', [
      this.pluginId,
      key,
    ]);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row['value'] as string) as T;
    } catch {
      return defaultValue;
    }
  }

  set<T>(key: string, value: T): void {
    this.db.run(
      `INSERT INTO plugin_kv (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.pluginId, key, JSON.stringify(value), nowMs()]
    );
  }

  delete(key: string): void {
    this.db.run('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?', [this.pluginId, key]);
  }
}

export class SettingsService {
  private cache = new Map<string, unknown>();
  private hydrated = false;

  constructor(private db: DbAdapter) {}

  /** Loads persisted settings; called by Kernel.boot() after migrations. */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const row of this.db.all('SELECT key, value FROM settings')) {
      try {
        this.cache.set(row['key'] as string, JSON.parse(row['value'] as string));
      } catch {
        /* corrupted value — ignore, default wins */
      }
    }
  }

  get<T>(key: string, defaultValue: T): T {
    if (!this.hydrated) this.hydrate();
    return (this.cache.has(key) ? (this.cache.get(key) as T) : defaultValue);
  }

  set(key: string, value: unknown): void {
    if (!this.hydrated) this.hydrate();
    this.cache.set(key, value);
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowMs()]
    );
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  icon: string;
  isDefault: boolean;
  sortOrder: number;
}

/** Workspaces + layout persistence + presets (ARCHITECTURE §5, DATABASE §2). */
export class WorkspaceStore {
  constructor(private db: DbAdapter) {}

  list(): WorkspaceInfo[] {
    return this.db
      .all('SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY sort_order, created_at')
      .map((r) => ({
        id: r['id'] as string,
        name: r['name'] as string,
        icon: (r['icon'] as string) ?? 'grid',
        isDefault: r['is_default'] === 1,
        sortOrder: r['sort_order'] as number,
      }));
  }

  create(name: string, icon = 'grid'): WorkspaceInfo {
    const id = uuidv7();
    const order = (this.one('SELECT MAX(sort_order) AS m FROM workspaces')?.['m'] as number ?? -1) + 1;
    this.db.run(
      'INSERT INTO workspaces (id, name, icon, is_default, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      [id, name, icon, order, nowMs(), nowMs()]
    );
    return { id, name, icon, isDefault: false, sortOrder: order };
  }

  ensureDefault(name = 'Personal'): WorkspaceInfo {
    const existing = this.one('SELECT * FROM workspaces WHERE deleted_at IS NULL LIMIT 1');
    if (existing) return this.toInfo(existing);
    const id = uuidv7();
    this.db.run(
      'INSERT INTO workspaces (id, name, icon, is_default, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)',
      [id, name, 'home', nowMs(), nowMs()]
    );
    return { id, name, icon: 'home', isDefault: true, sortOrder: 0 };
  }

  rename(id: string, name: string): void {
    this.db.run('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?', [name, nowMs(), id]);
  }

  remove(id: string): void {
    const ws = this.list();
    if (ws.length <= 1) throw new Error('cannot delete the last workspace');
    this.db.run('UPDATE workspaces SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      nowMs(),
      nowMs(),
      id,
    ]);
    if (ws.find((w) => w.isDefault && w.id === id)) {
      const next = ws.find((w) => w.id !== id);
      if (next) this.db.run('UPDATE workspaces SET is_default = 1 WHERE id = ?', [next.id]);
    }
  }

  getLayout(workspaceId: string): string | null {
    const row = this.db.one('SELECT state FROM layouts WHERE workspace_id = ?', [workspaceId]);
    return row ? (row['state'] as string) : null;
  }

  saveLayout(workspaceId: string, stateJson: string): void {
    this.db.run(
      `INSERT INTO layouts (workspace_id, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      [workspaceId, stateJson, nowMs()]
    );
  }

  listPresets(workspaceId?: string | null): { id: string; name: string; state: string; isBuiltin: boolean }[] {
    const rows = workspaceId
      ? this.db.all(
          'SELECT * FROM layout_presets WHERE deleted_at IS NULL AND (workspace_id IS NULL OR workspace_id = ?)',
          [workspaceId]
        )
      : this.db.all('SELECT * FROM layout_presets WHERE deleted_at IS NULL');
    return rows.map((r) => ({
      id: r['id'] as string,
      name: r['name'] as string,
      state: r['state'] as string,
      isBuiltin: r['is_builtin'] === 1,
    }));
  }

  savePreset(name: string, stateJson: string, workspaceId: string | null, builtin = false): string {
    const id = uuidv7();
    this.db.run(
      'INSERT INTO layout_presets (id, workspace_id, name, state, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, workspaceId, name, stateJson, builtin ? 1 : 0, nowMs(), nowMs()]
    );
    return id;
  }

  deletePreset(id: string): void {
    this.db.run('UPDATE layout_presets SET deleted_at = ?, updated_at = ? WHERE id = ? AND is_builtin = 0', [
      nowMs(),
      nowMs(),
      id,
    ]);
  }

  private one(sql: string): DbRow | null {
    return this.db.one(sql);
  }

  private toInfo(r: DbRow): WorkspaceInfo {
    return {
      id: r['id'] as string,
      name: r['name'] as string,
      icon: (r['icon'] as string) ?? 'grid',
      isDefault: r['is_default'] === 1,
      sortOrder: r['sort_order'] as number,
    };
  }
}
