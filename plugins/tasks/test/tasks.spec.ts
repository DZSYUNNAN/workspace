import { describe, expect, it } from 'vitest';
import { Kernel, MemoryBlobStore, MemorySecretStore, openMemoryDb, type PluginContext } from '@mpw/kernel';
import plugin from '@mpw/plugin-tasks';
import { addTask, listTasks, removeTask, setDone } from '../src/store';

async function makeCtx(): Promise<PluginContext> {
  const db = await openMemoryDb();
  const kernel = new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
  kernel.registerBuiltins([plugin]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  return (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.tasks');
}

describe('任务插件', () => {
  it('添加 / 完成 / 删除任务(持久化于插件命名空间,高优先级在前)', async () => {
    const c = await makeCtx();
    const t = await addTask(c, '阅读 10 篇相关文献', { priority: 'high', due: '2026-09-20' });
    await addTask(c, '整理方法分类');
    let all = await listTasks(c);
    expect(all).toHaveLength(2);
    expect(all[0]?.title).toBe('阅读 10 篇相关文献');
    await setDone(c, t.id, true);
    all = await listTasks(c);
    expect(all.find((x) => x.id === t.id)?.done).toBe(1);
    const open = await listTasks(c, false);
    expect(open).toHaveLength(1);
    await removeTask(c, t.id);
    expect(await listTasks(c)).toHaveLength(1);
  });

  it('通过全局搜索暴露任务', async () => {
    const db = await openMemoryDb();
    const kernel = new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
    kernel.registerBuiltins([plugin]);
    await kernel.boot();
    const c = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.tasks');
    await addTask(c, '回复审稿意见');
    const groups = await kernel.search.searchAll('审稿');
    expect(groups.map((g) => g.label)).toContain('任务');
  });
});
