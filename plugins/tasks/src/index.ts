import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { TasksView } from './TasksView';
import { initSchema, searchTasks } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.tasks',
    name: '任务',
    version: '0.1.0',
    author: 'ModuDesk',
    description: '待办与日程:任务清单、优先级、截止日,可关联文献 / 笔记 / 邮件等资源。',
    icon: 'check',
    minCoreVersion: '^0.1.0',
    permissions: ['storage'],
    contributions: {
      widgets: [{ id: 'list', title: '任务', icon: 'check', defaultArea: 'right', minW: 220 }],
      routes: [{ id: 'main', title: '任务', icon: 'check', showInSidebar: true, order: 55 }],
      commands: [{ id: 'quickAdd', title: '任务: 快速添加…', category: '任务' }],
      searchProviders: [
        {
          id: 'tasks',
          label: '任务',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchTasks(ctxRef, q, limit);
            return rows.map((t) => ({
              id: `mpw.tasks:task:${t.id}`,
              pluginId: 'mpw.tasks',
              type: 'task',
              title: t.title,
              snippet: t.done ? '已完成' : '待办',
              icon: 'check',
              score: 0.5,
            }));
          },
        },
      ],
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    await initSchema(ctx);
    ctx.ui.registerWidget('list', () => React.createElement(TasksView, { ctx, compact: true, key: 'w' }));
    ctx.ui.registerRoute('main', () => React.createElement(TasksView, { ctx, key: 'r' }));
    ctx.commands.register('mpw.tasks.quickAdd', async (args) => {
      const { addTask } = await import('./store');
      const title = typeof args === 'string' ? args : ((args as { title?: string })?.title ?? '');
      if (!title) {
        ctx.ui.openWidget('mpw.tasks/list');
        return null;
      }
      const t = await addTask(ctx, title);
      ctx.events.emit('tasks:changed', { id: t.id });
      ctx.ui.notify(`已添加任务「${truncate(title, 24)}」`, 'success');
      return t.id;
    });
    ctx.log.info('任务插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
  },
});
