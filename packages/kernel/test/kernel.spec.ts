import { describe, expect, it } from 'vitest';
import { Kernel, PermissionError, MemorySecretStore, MemoryBlobStore } from '@mpw/kernel';
import { openMemoryDb } from '@mpw/kernel';
import { definePlugin, type PluginContext, type WorkspacePlugin } from '@mpw/kernel';
import { emptyLayout } from '@mpw/shared';

async function makeKernel(): Promise<Kernel> {
  const db = await openMemoryDb();
  return new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
}

function demoPlugin(id: string, over: Partial<WorkspacePlugin['manifest']> = {}): WorkspacePlugin {
  return definePlugin({
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      author: 'test',
      description: 'demo',
      icon: 'puzzle',
      minCoreVersion: '^0.1.0',
      permissions: ['storage'],
      contributions: { widgets: [{ id: 'w1', title: 'W1' }] },
      ...over,
    },
    activate(ctx: PluginContext) {
      ctx.ui.registerWidget('w1', () => null as never);
    },
  });
}

describe('kernel boot & plugin lifecycle', () => {
  it('boots, migrates schema, creates default workspace and seeds builtin presets', async () => {
    const k = await makeKernel();
    k.registerBuiltins([demoPlugin('mpw.demo')]);
    const report = await k.boot();
    expect(report.failed).toEqual([]);
    expect(report.loaded).toContain('mpw.demo');
    expect(k.workspaces.list().length).toBeGreaterThanOrEqual(1);
    const presets = k.workspaces.listPresets();
    expect(presets.map((p) => p.name)).toEqual(expect.arrayContaining(['Daily Work', 'Research Mode', 'Paper Writing', 'Teaching Mode']));
  });

  it('disabling a plugin unloads contributions; re-enabling reloads them', async () => {
    const k = await makeKernel();
    k.registerBuiltins([demoPlugin('mpw.demo')]);
    await k.boot();
    expect(k.isLoaded('mpw.demo')).toBe(true);
    expect(k.enabledWidgets().map((w) => w.key)).toContain('mpw.demo/w1');

    await k.disablePlugin('mpw.demo');
    expect(k.isLoaded('mpw.demo')).toBe(false);
    expect(k.enabledWidgets()).toEqual([]);

    await k.enablePlugin('mpw.demo');
    expect(k.isLoaded('mpw.demo')).toBe(true);
    expect(k.enabledWidgets().map((w) => w.key)).toContain('mpw.demo/w1');
  });

  it('quarantines plugins whose activate() throws without breaking others', async () => {
    const k = await makeKernel();
    k.registerBuiltins([
      definePlugin({
        manifest: { ...demoPlugin('mpw.bad').manifest, id: 'mpw.bad', name: 'Bad' },
        activate() {
          throw new Error('boom');
        },
      }),
      demoPlugin('mpw.good'),
    ]);
    const report = await k.boot();
    expect(report.failed.map((f) => f.id)).toEqual(['mpw.bad']);
    expect(report.loaded).toContain('mpw.good');
    expect(k.isLoaded('mpw.bad')).toBe(false);
    expect(k.listPlugins().find((p) => p.id === 'mpw.bad')?.state).toBe('error');
  });

  it('uninstall with deleteData wipes the plugin namespace', async () => {
    const k = await makeKernel();
    let ctxRef: PluginContext | null = null;
    k.registerBuiltins([
      definePlugin({
        manifest: demoPlugin('mpw.demo').manifest,
        activate(ctx) {
          ctxRef = ctx;
        },
      }),
    ]);
    await k.boot();
    const ctx = (() => ctxRef)() as PluginContext | null;
    await ctx!.storage.sql.exec('CREATE TABLE IF NOT EXISTS p_demo_t (a TEXT)');
    await ctx!.storage.set('k', 'v');
    await k.uninstallPlugin('mpw.demo', { deleteData: true });
    await expect(ctx!.storage.get('k', 'sentinel')).resolves.toBe('sentinel');
    const info = k.listPlugins().find((p) => p.id === 'mpw.demo');
    expect(info?.state).toBe('uninstalled');
  });
});

describe('permission gate & storage namespacing', () => {
  it('rejects undeclared capability use', async () => {
    const k = await makeKernel();
    k.registerBuiltins([demoPlugin('mpw.demo')]); // no 'credentials'
    await k.boot();
    const ctx = (k as unknown as { createContext(id: string): PluginContext }).createContext('mpw.demo');
    await expect(ctx.secrets.set('x', 'y')).rejects.toThrow(PermissionError);
    await expect(ctx.secrets.get('x')).rejects.toThrow(PermissionError);
  });

  it('blocks SQL that touches tables outside the plugin namespace', async () => {
    const k = await makeKernel();
    k.registerBuiltins([
      definePlugin({
        manifest: demoPlugin('mpw.demo').manifest,
        async activate(ctx) {
          await ctx.storage.sql.exec('SELECT * FROM p_other_plugin_data');
        },
      }),
    ]);
    const report = await k.boot();
    // activation must fail loudly (namespace violation) and quarantine the plugin
    expect(report.failed.map((f) => f.id)).toContain('mpw.demo');
  });

  it('allows plugin-owned tables and rejects cross-namespace reads via all()', async () => {
    const k = await makeKernel();
    let ctxRef: PluginContext | null = null;
    k.registerBuiltins([
      definePlugin({
        manifest: demoPlugin('mpw.demo').manifest,
        activate(ctx) {
          ctxRef = ctx;
        },
      }),
    ]);
    await k.boot();
    const ctx = (() => ctxRef)() as unknown as PluginContext;
    await ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS p_demo_items (id TEXT)');
    await ctx.storage.sql.exec("INSERT INTO p_demo_items (id) VALUES ('a')");
    const rows = await ctx.storage.sql.all('SELECT * FROM p_demo_items');
    expect(rows).toHaveLength(1);
    await expect(ctx.storage.sql.all('SELECT * FROM p_notes_notes')).rejects.toThrow(/namespace violation/);
    await expect(ctx.storage.sql.all('SELECT id FROM workspaces')).rejects.toThrow(/namespace violation/);
  });
});

describe('buses', () => {
  it('event bus delivers to direct and wildcard subscribers with unsubscribe', async () => {
    const k = await makeKernel();
    const seen: string[] = [];
    const off = k.events.on('demo:x', (p) => seen.push(`direct:${String(p)}`));
    const offAll = k.events.on('*', (e) => seen.push(`wild:${(e as { type: string }).type}`));
    k.events.emit('demo:x', 1);
    off();
    k.events.emit('demo:x', 2);
    offAll();
    k.events.emit('demo:x', 3);
    expect(seen).toEqual(['direct:1', 'wild:demo:x', 'wild:demo:x']);
  });

  it('command bus executes registered namespaced commands', async () => {
    const k = await makeKernel();
    let ctxRef: PluginContext | null = null;
    k.registerBuiltins([
      definePlugin({
        manifest: demoPlugin('mpw.demo', {
          contributions: { widgets: [{ id: 'w1', title: 'W' }], commands: [{ id: 'hello', title: 'Say hello' }] },
        }).manifest,
        activate(ctx) {
          ctxRef = ctx;
          ctx.commands.register('mpw.demo.hello', (args) => `hi ${(args as { who: string }).who}`);
        },
      }),
    ]);
    await k.boot();
    await expect(k.commands.execute('mpw.demo.hello', { who: 'world' })).resolves.toBe('hi world');
    await expect(k.commands.execute('mpw.demo.missing')).rejects.toThrow(/unknown command/);
    // undeclared command registration must fail
    expect(() => ctxRef?.commands.register('mpw.demo.undeclared', () => 1)).toThrow(/not declared/);
  });
});

describe('layout persistence via WorkspaceStore', () => {
  it('saves and restores a layout round-trip', async () => {
    const k = await makeKernel();
    await k.boot();
    const ws = k.workspaces.list()[0];
    const layout = emptyLayout();
    layout.areas.center = { kind: 'tabs', items: ['mpw.notes/list', 'mpw.ai/chat'], active: 0 };
    layout.areas.left = { kind: 'leaf', widgetId: 'mpw.files/browser' };
    layout.floats = [{ id: 'f1', widgetId: 'mpw.writing/editor', x: 40, y: 60, w: 500, h: 380, z: 11 }];
    k.workspaces.saveLayout(ws.id, JSON.stringify(layout));
    const restored = JSON.parse(k.workspaces.getLayout(ws.id) as string);
    expect(restored.areas.left.widgetId).toBe('mpw.files/browser');
    expect(restored.areas.center.items).toHaveLength(2);
    expect(restored.floats[0].widgetId).toBe('mpw.writing/editor');
  });

  it('applies builtin presets and protects the last workspace from deletion', async () => {
    const k = await makeKernel();
    await k.boot();
    const preset = k.workspaces.listPresets().find((p) => p.name === 'Research Mode');
    expect(preset).toBeDefined();
    const ws = k.workspaces.list()[0];
    k.workspaces.saveLayout(ws.id, preset!.state);
    const state = JSON.parse(k.workspaces.getLayout(ws.id) as string);
    expect(state.areas.center.items).toContain('mpw.references/library');
    expect(() => k.workspaces.remove(ws.id)).toThrow(/last workspace/);
  });
});
