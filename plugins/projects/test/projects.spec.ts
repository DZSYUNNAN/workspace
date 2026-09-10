import { describe, expect, it } from 'vitest';
import { Kernel, MemoryBlobStore, MemorySecretStore, openMemoryDb, type PluginContext } from '@mpw/kernel';
import plugin from '@mpw/plugin-projects';
import { addLink, createProject, initSchema, listLinks, listProjects, removeLink } from '../src/store';

async function makeCtx(): Promise<{ ctx: PluginContext; rawDb: Awaited<ReturnType<typeof openMemoryDb>> }> {
  const rawDb = await openMemoryDb();
  const kernel = new Kernel({ db: rawDb, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
  kernel.registerBuiltins([plugin]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.projects');
  return { ctx, rawDb };
}

describe('项目插件(跨插件资源链接)', () => {
  it('建表使用 p_projects_ 命名空间', async () => {
    const { ctx, rawDb } = await makeCtx();
    await initSchema(ctx);
    const names = (rawDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'p_projects_%'") as { name: string }[]).map((t) => t.name);
    expect(names).toContain('p_projects_projects');
    expect(names).toContain('p_projects_links');
    // 命名空间之外只允许内核自建表(用未装插件的纯净库对比)
    const bareDb = await openMemoryDb();
    await new Kernel({ db: bareDb, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() }).boot();
    const coreTables = new Set(
      (bareDb.all("SELECT name FROM sqlite_master WHERE type='table'") as { name: string }[]).map((t) => t.name)
    );
    const all = (rawDb.all("SELECT name FROM sqlite_master WHERE type='table'") as { name: string }[]).map((t) => t.name);
    const foreign = all.filter((n) => !n.startsWith('p_projects_') && !coreTables.has(n) && n !== 'sqlite_sequence');
    expect(foreign).toEqual([]);
  });

  it('项目 + 资源链接的增删查', async () => {
    const { ctx } = await makeCtx();
    const p = await createProject(ctx, '多模态图像融合', '2026 年度课题');
    await addLink(ctx, p.id, 'mpw://note/abc', '笔记');
    await addLink(ctx, p.id, 'mpw://reference/def', '文献');
    expect(await listProjects(ctx)).toHaveLength(1);
    let links = await listLinks(ctx, p.id);
    expect(links.map((l) => l.resource_uri)).toEqual(['mpw://note/abc', 'mpw://reference/def']);
    await removeLink(ctx, links[0]!.id);
    links = await listLinks(ctx, p.id);
    expect(links).toHaveLength(1);
  });

  it('全局搜索能找到项目', async () => {
    const db = await openMemoryDb();
    const kernel = new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
    kernel.registerBuiltins([plugin]);
    await kernel.boot();
    const c = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.projects');
    await createProject(c, '知识蒸馏综述');
    const groups = await kernel.search.searchAll('蒸馏');
    expect(groups.map((g) => g.label)).toContain('项目');
  });
});
