import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface DocRecord {
  id: string;
  title: string;
  mode: 'rich' | 'latex'; // Mode A (Word-like) | Mode B (LaTeX)
  content: string; // HTML for rich, LaTeX source for latex
  folder: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

const T = 'p_writing_documents';

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 1) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${T} (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'rich',
    content TEXT NOT NULL DEFAULT '', folder TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.set('__schema_version', 1);
}

export async function createDoc(ctx: PluginContext, title: string, mode: 'rich' | 'latex'): Promise<DocRecord> {
  const id = uuidv7();
  const now = nowMs();
  const content =
    mode === 'latex'
      ? '\\title{Untitled}\n\\author{Author}\n\\maketitle\n\n\\section{Introduction}\nYour text here…\n'
      : '<h1>Untitled</h1><p></p>';
  await ctx.storage.sql.exec(
    `INSERT INTO ${T} (id, title, mode, content, folder, tags, created_at, updated_at) VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
    [id, title, mode, content, now, now]
  );
  return { id, title, mode, content, folder: '', tags: '[]', created_at: now, updated_at: now };
}

export async function listDocs(ctx: PluginContext): Promise<DocRecord[]> {
  return await ctx.storage.sql.all<DocRecord>(`SELECT * FROM ${T} WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
}

export async function getDoc(ctx: PluginContext, id: string): Promise<DocRecord | null> {
  return (await ctx.storage.sql.one<DocRecord>(`SELECT * FROM ${T} WHERE id = ? AND deleted_at IS NULL`, [id])) ?? null;
}

export async function updateDoc(ctx: PluginContext, id: string, fields: Partial<Pick<DocRecord, 'title' | 'content' | 'mode'>>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (sets.length === 0) return;
  await ctx.storage.sql.exec(`UPDATE ${T} SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`, [
    ...params,
    nowMs(),
    id,
  ]);
}

export async function softDeleteDoc(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${T} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
}

export async function searchDocs(ctx: PluginContext, q: string, limit: number): Promise<DocRecord[]> {
  const like = `%${q}%`;
  return await ctx.storage.sql.all<DocRecord>(
    `SELECT * FROM ${T} WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
    [like, like, limit]
  );
}
