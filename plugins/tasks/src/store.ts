import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface TaskRecord {
  id: string;
  title: string;
  done: number; // 0 | 1
  priority: string; // 'low' | 'normal' | 'high'
  due: string; // '' | 'YYYY-MM-DD'
  link_uri: string; // mpw:// resource link (optional)
  created_at: number;
  updated_at: number;
}

const T = 'p_tasks_tasks';

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 1) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${T} (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'normal', due TEXT NOT NULL DEFAULT '',
    link_uri TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.set('__schema_version', 1);
}

export async function addTask(ctx: PluginContext, title: string, opts?: { priority?: string; due?: string; linkUri?: string }): Promise<TaskRecord> {
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${T} (id, title, done, priority, due, link_uri, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
    [id, title, opts?.priority ?? 'normal', opts?.due ?? '', opts?.linkUri ?? '', nowMs(), nowMs()]
  );
  return {
    id, title, done: 0, priority: opts?.priority ?? 'normal', due: opts?.due ?? '',
    link_uri: opts?.linkUri ?? '', created_at: nowMs(), updated_at: nowMs(),
  };
}

export async function listTasks(ctx: PluginContext, includeDone = true): Promise<TaskRecord[]> {
  const where = includeDone ? '' : 'AND done = 0';
  return await ctx.storage.sql.all<TaskRecord>(
    `SELECT * FROM ${T} WHERE deleted_at IS NULL ${where} ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due, created_at`
  );
}

export async function setDone(ctx: PluginContext, id: string, done: boolean): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${T} SET done = ?, updated_at = ? WHERE id = ?`, [done ? 1 : 0, nowMs(), id]);
}

export async function removeTask(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${T} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
}

export async function searchTasks(ctx: PluginContext, q: string, limit: number): Promise<TaskRecord[]> {
  return await ctx.storage.sql.all<TaskRecord>(
    `SELECT * FROM ${T} WHERE deleted_at IS NULL AND title LIKE ? ORDER BY done, created_at DESC LIMIT ?`,
    [`%${q}%`, limit]
  );
}
