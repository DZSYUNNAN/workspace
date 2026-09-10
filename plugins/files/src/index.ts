import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.files',
    name: 'Files',
    version: '0.1.0',
    author: 'MPW',
    description: '虚拟文件管理:上传、文件夹、下载、删除。文件内容存于本地文件库,元数据存于本地数据库。',
    icon: 'folder',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'blobs'],
    contributions: {
      widgets: [{ id: 'browser', title: '文件', icon: 'folder', defaultArea: 'left', minW: 220 }],
      routes: [{ id: 'main', title: '文件', icon: 'folder', showInSidebar: true, order: 50 }],
      commands: [{ id: 'upload', title: '文件: 上传文件…', category: '文件' }],
      searchProviders: [
        {
          id: 'files',
          label: '文件',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await ctxRef.storage.sql.all<{ id: string; name: string; kind: string; mime: string; size: number }>(
              'SELECT * FROM p_files_entries WHERE deleted_at IS NULL AND kind = ? AND name LIKE ? LIMIT ?',
              ['file', `%${q}%`, limit]
            );
            return rows.map((f) => ({
              id: `mpw.files:file:${f.id}`,
              pluginId: 'mpw.files',
              type: 'file',
              title: f.name,
              snippet: `${(f.size / 1024).toFixed(1)} KB`,
              icon: 'file',
              score: 0.5,
            }));
          },
        },
      ],
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    const version = await ctx.storage.get<number>('__schema_version', 0);
    if (version < 1) {
      await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS p_files_entries (
        id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
        mime TEXT, size INTEGER NOT NULL DEFAULT 0, blob_ref TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
      await ctx.storage.set('__schema_version', 1);
    }

    const { FilesView } = await import('./FilesView');
    ctx.ui.registerWidget('browser', () => React.createElement(FilesView, { ctx, compact: true }));
    ctx.ui.registerRoute('main', () => React.createElement(FilesView, { ctx }));

    const emitStats = async (): Promise<void> => {
      const files = await ctx.storage.sql.all<{ size: number }>('SELECT size FROM p_files_entries WHERE deleted_at IS NULL AND kind = ?', ['file']);
      const bytes = files.reduce((s, f) => s + (f.size ?? 0), 0);
      ctx.events.emit('plugin:stats', {
        pluginId: 'mpw.files',
        name: '文件',
        stats: [
          { label: '文件', count: files.length, icon: 'file' },
          { label: '已存 MB', count: Math.round(bytes / 1024 / 1024), icon: 'folder' },
        ],
      });
    };
    ctx.events.on('files:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('文件插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
  },
});

export function fileHitLabel(name: string): string {
  return truncate(name, 40);
}
