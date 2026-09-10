import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface NoteRecord {
  id: string;
  title: string;
  body_md: string;
  folder: string;
  tags: string; // JSON array
  created_at: number;
  updated_at: number;
}

const TABLE = 'p_notes_notes';

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 1) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
    folder TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.set('__schema_version', 1);
}

export async function createNote(ctx: PluginContext, title: string, body = ''): Promise<NoteRecord> {
  const id = uuidv7();
  const now = nowMs();
  await ctx.storage.sql.exec(
    `INSERT INTO ${TABLE} (id, title, body_md, folder, tags, created_at, updated_at) VALUES (?, ?, ?, '', '[]', ?, ?)`,
    [id, title, body, now, now]
  );
  return {
    id,
    title,
    body_md: body,
    folder: '',
    tags: '[]',
    created_at: now,
    updated_at: now,
  };
}

export async function updateNote(ctx: PluginContext, id: string, fields: Partial<Pick<NoteRecord, 'title' | 'body_md' | 'folder' | 'tags'>>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(nowMs(), id);
  await ctx.storage.sql.exec(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function softDeleteNote(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
}

export async function listNotes(ctx: PluginContext): Promise<NoteRecord[]> {
  return await ctx.storage.sql.all<NoteRecord>(
    `SELECT * FROM ${TABLE} WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  );
}

export async function getNote(ctx: PluginContext, id: string): Promise<NoteRecord | null> {
  return (await ctx.storage.sql.one<NoteRecord>(`SELECT * FROM ${TABLE} WHERE id = ? AND deleted_at IS NULL`, [id])) ?? null;
}

export async function searchNotes(ctx: PluginContext, q: string, limit: number): Promise<NoteRecord[]> {
  const like = `%${q}%`;
  return await ctx.storage.sql.all<NoteRecord>(
    `SELECT * FROM ${TABLE}
     WHERE deleted_at IS NULL AND (title LIKE ? OR body_md LIKE ? OR tags LIKE ?)
     ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, updated_at DESC
     LIMIT ?`,
    [like, like, like, like, limit]
  );
}

/** Extract [[WikiLinks]] from markdown body. */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push((m[1] as string).trim());
  return [...new Set(out)];
}

export function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** Notes that link to `title` (for the backlinks panel / future knowledge graph). */
export async function backlinks(ctx: PluginContext, title: string): Promise<NoteRecord[]> {
  const all = await listNotes(ctx);
  return all.filter((n) => extractLinks(n.body_md).some((l) => l.toLowerCase() === title.toLowerCase()));
}
