import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { TasksView } from './TasksView';
import { initSchema, listTasks, searchTasks } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.tasks',
    name: '任务',
    version: '0.2.0',
    author: 'ModuDesk',
    description: '待办与日程:任务清单、优先级、截止日,可关联文献 / 笔记 / 邮件等资源。',
    icon: 'check',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'ai:invoke'],
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
      contextProviders: [{
        id: 'list',
        label: '当前任务清单',
        getContext: async () => {
          if (!ctxRef) return null;
          const tasks = await listTasks(ctxRef);
          if (tasks.length === 0) return null;
          return {
            id: 'list', label: '当前任务清单', kind: 'text' as const, source: 'mpw.tasks',
            content: tasks.slice(0, 100).map((task) => `- [${task.done ? 'x' : ' '}] ${task.title} | 优先级: ${task.priority}${task.due ? ` | 截止: ${task.due}` : ''}${task.link_uri ? ` | 关联: ${task.link_uri}` : ''}`).join('\n'),
          };
        },
      }],
      aiActions: [
        { id: 'prioritize', label: '安排任务优先级', icon: 'check', insert: 'none', prompt: (_selection, context = '') => `根据重要性、紧急性、截止时间和依赖关系安排这些任务。说明排序理由，不要添加不存在的期限。\n\n${context}` },
        { id: 'plan-day', label: '制定执行计划', icon: 'calendar', insert: 'none', prompt: (_selection, context = '') => `把未完成任务整理为一份现实的执行计划，识别可并行项和阻塞项；缺少工期时明确说明假设。\n\n${context}` },
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
