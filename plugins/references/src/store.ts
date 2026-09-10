import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7, type AuthorRef } from '@mpw/shared';
import type { RawReference } from './parsers';

export interface RefRecord {
  id: string;
  citation_key: string;
  entry_type: string;
  title: string;
  authors: string; // JSON AuthorRef[]
  venue: string;
  year: number | null;
  doi: string;
  abstract: string;
  keywords: string; // JSON string[]
  tags: string; // JSON string[]
  notes: string;
  volume: string;
  number: string;
  pages: string;
  publisher: string;
  blob_ref: string;
  file_name: string;
  created_at: number;
  updated_at: number;
}

export interface CollectionRecord {
  id: string;
  name: string;
}

const T = 'p_references_references';
const C = 'p_references_collections';
const CI = 'p_references_collection_items';
const AN = 'p_references_annotations';

export interface AnnotationRecord {
  id: string;
  reference_id: string;
  page: number;
  kind: string; // 'highlight'
  rects: string; // JSON [{x,y,w,h}] 比例坐标(相对页面宽高)
  text: string;
  color: string;
  created_at: number;
}

export async function addAnnotation(ctx: PluginContext, a: Omit<AnnotationRecord, 'id' | 'created_at'>): Promise<AnnotationRecord> {
  const id = uuidv7();
  const created = nowMs();
  await ctx.storage.sql.exec(
    `INSERT INTO ${AN} (id, reference_id, page, kind, rects, text, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, a.reference_id, a.page, a.kind, a.rects, a.text, a.color, created]
  );
  return { id, created_at: created, ...a };
}

export async function listAnnotations(ctx: PluginContext, referenceId: string): Promise<AnnotationRecord[]> {
  return await ctx.storage.sql.all<AnnotationRecord>(
    `SELECT * FROM ${AN} WHERE reference_id = ? ORDER BY page, created_at`,
    [referenceId]
  );
}

export async function deleteAnnotation(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`DELETE FROM ${AN} WHERE id = ?`, [id]);
}

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 1) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${T} (
    id TEXT PRIMARY KEY, citation_key TEXT, entry_type TEXT NOT NULL DEFAULT 'article',
    title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '[]', venue TEXT, year INTEGER,
    doi TEXT, abstract TEXT, keywords TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '', volume TEXT DEFAULT '', number TEXT DEFAULT '',
    pages TEXT DEFAULT '', publisher TEXT DEFAULT '', blob_ref TEXT DEFAULT '', file_name TEXT DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${C} (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${CI} (
    collection_id TEXT NOT NULL, reference_id TEXT NOT NULL, PRIMARY KEY (collection_id, reference_id))`);
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${AN} (
    id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, page INTEGER NOT NULL,
    kind TEXT NOT NULL, rects TEXT NOT NULL, text TEXT DEFAULT '', color TEXT DEFAULT '#ffe066',
    created_at INTEGER NOT NULL)`);
  await ctx.storage.set('__schema_version', 1);
}

export function refFromRaw(raw: RawReference): Omit<RefRecord, 'id' | 'created_at' | 'updated_at'> {
  return {
    citation_key: raw.citationKey,
    entry_type: raw.entryType,
    title: raw.title,
    authors: JSON.stringify(raw.authors),
    venue: raw.venue,
    year: raw.year,
    doi: raw.doi,
    abstract: raw.abstract,
    keywords: JSON.stringify(raw.keywords),
    tags: '[]',
    notes: '',
    volume: raw.volume,
    number: raw.number,
    pages: raw.pages,
    publisher: raw.publisher,
    blob_ref: '',
    file_name: '',
  };
}

export async function insertRef(ctx: PluginContext, raw: RawReference): Promise<RefRecord> {
  const r = refFromRaw(raw);
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${T} (id, citation_key, entry_type, title, authors, venue, year, doi, abstract, keywords, tags, notes, volume, number, pages, publisher, blob_ref, file_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`,
    [id, r.citation_key, r.entry_type, r.title, r.authors, r.venue, r.year, r.doi, r.abstract, r.keywords, r.tags, r.notes, r.volume, r.number, r.pages, r.publisher, nowMs(), nowMs()]
  );
  return { id, ...r, created_at: nowMs(), updated_at: nowMs() };
}

export async function updateRef(ctx: PluginContext, id: string, fields: Partial<RefRecord>): Promise<void> {
  const allowed = ['citation_key', 'entry_type', 'title', 'authors', 'venue', 'year', 'doi', 'abstract', 'keywords', 'tags', 'notes', 'volume', 'number', 'pages', 'publisher', 'blob_ref', 'file_name'];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
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

export async function listRefs(ctx: PluginContext, collectionId?: string): Promise<RefRecord[]> {
  if (collectionId) {
    return await ctx.storage.sql.all<RefRecord>(
      `SELECT r.* FROM ${T} r JOIN ${CI} ci ON ci.reference_id = r.id
       WHERE ci.collection_id = ? AND r.deleted_at IS NULL ORDER BY r.updated_at DESC`,
      [collectionId]
    );
  }
  return await ctx.storage.sql.all<RefRecord>(`SELECT * FROM ${T} WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
}

export async function getRef(ctx: PluginContext, id: string): Promise<RefRecord | null> {
  return (await ctx.storage.sql.one<RefRecord>(`SELECT * FROM ${T} WHERE id = ? AND deleted_at IS NULL`, [id])) ?? null;
}

export async function softDeleteRef(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${T} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
}

export async function searchRefs(ctx: PluginContext, q: string, limit: number): Promise<RefRecord[]> {
  const like = `%${q}%`;
  return await ctx.storage.sql.all<RefRecord>(
    `SELECT * FROM ${T}
     WHERE deleted_at IS NULL AND (title LIKE ? OR authors LIKE ? OR abstract LIKE ? OR keywords LIKE ? OR doi LIKE ?)
     ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, updated_at DESC LIMIT ?`,
    [like, like, like, like, like, like, limit]
  );
}

export async function listCollections(ctx: PluginContext): Promise<CollectionRecord[]> {
  return await ctx.storage.sql.all<CollectionRecord>(`SELECT id, name FROM ${C} WHERE deleted_at IS NULL ORDER BY name`);
}

export async function createCollection(ctx: PluginContext, name: string): Promise<CollectionRecord> {
  const id = uuidv7();
  await ctx.storage.sql.exec(`INSERT INTO ${C} (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`, [id, name, nowMs(), nowMs()]);
  return { id, name };
}

export async function addToCollection(ctx: PluginContext, collectionId: string, refId: string): Promise<void> {
  await ctx.storage.sql.exec(`INSERT OR IGNORE INTO ${CI} (collection_id, reference_id) VALUES (?, ?)`, [collectionId, refId]);
}

export function parseAuthors(json: string): AuthorRef[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as AuthorRef[]) : [];
  } catch {
    return [];
  }
}

export function parseStringArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
