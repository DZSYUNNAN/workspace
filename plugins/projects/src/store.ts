import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectLinkRecord {
  id: string;
  project_id: string;
  resource_uri: string; // mpw://<kind>/<id>
  label: string;
  added_at: number;
}

const P = 'p_projects_projects';
const L = 'p_projects_links';

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 1) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${P} (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${L} (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    resource_uri TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL)`);
  await ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS p_projects_links_project ON ${L} (project_id)`);
  await ctx.storage.set('__schema_version', 1);
}

export async function createProject(ctx: PluginContext, name: string, description = ''): Promise<ProjectRecord> {
  const rec: ProjectRecord = { id: uuidv7(), name, description, created_at: nowMs(), updated_at: nowMs() };
  await ctx.storage.sql.exec(
    `INSERT INTO ${P} (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [rec.id, rec.name, rec.description, rec.created_at, rec.updated_at]
  );
  return rec;
}

export async function listProjects(ctx: PluginContext): Promise<ProjectRecord[]> {
  return await ctx.storage.sql.all<ProjectRecord>(
    `SELECT id, name, description, created_at, updated_at FROM ${P} WHERE deleted_at IS NULL ORDER BY created_at`
  );
}

export async function deleteProject(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${P} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
  await ctx.storage.sql.exec(`DELETE FROM ${L} WHERE project_id = ?`, [id]);
}

export async function addLink(ctx: PluginContext, projectId: string, resourceUri: string, label = ''): Promise<ProjectLinkRecord> {
  const existing = await ctx.storage.sql.one<ProjectLinkRecord>(`SELECT * FROM ${L} WHERE project_id = ? AND resource_uri = ?`, [projectId, resourceUri]);
  if (existing) return existing;
  const rec: ProjectLinkRecord = { id: uuidv7(), project_id: projectId, resource_uri: resourceUri, label, added_at: nowMs() };
  await ctx.storage.sql.exec(
    `INSERT INTO ${L} (id, project_id, resource_uri, label, added_at) VALUES (?, ?, ?, ?, ?)`,
    [rec.id, rec.project_id, rec.resource_uri, rec.label, rec.added_at]
  );
  return rec;
}

export async function listLinks(ctx: PluginContext, projectId: string): Promise<ProjectLinkRecord[]> {
  return await ctx.storage.sql.all<ProjectLinkRecord>(
    `SELECT id, project_id, resource_uri, label, added_at FROM ${L} WHERE project_id = ? ORDER BY added_at`,
    [projectId]
  );
}

export async function removeLink(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`DELETE FROM ${L} WHERE id = ?`, [id]);
}

export async function searchProjects(ctx: PluginContext, q: string, limit: number): Promise<ProjectRecord[]> {
  return await ctx.storage.sql.all<ProjectRecord>(
    `SELECT id, name, description, created_at, updated_at FROM ${P}
     WHERE deleted_at IS NULL AND (name LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
    [`%${q}%`, `%${q}%`, limit]
  );
}
