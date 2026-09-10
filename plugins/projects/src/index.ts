import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { ProjectsView } from './ProjectsView';
import { initSchema, searchProjects } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.projects',
    name: '项目',
    version: '0.2.0',
    author: 'ModuDesk',
    description: '科研项目管理:把文献、笔记、文档、任务通过稳定资源链接组织为一个课题。',
    icon: 'grid',
    minCoreVersion: '^0.1.0',
    permissions: ['storage'],
    contributions: {
      widgets: [{ id: 'board', title: '项目', icon: 'grid', defaultArea: 'center', minW: 320 }],
      routes: [{ id: 'main', title: '项目', icon: 'grid', showInSidebar: true, order: 60 }],
      searchProviders: [
        {
          id: 'projects',
          label: '项目',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchProjects(ctxRef, q, limit);
            return rows.map((p) => ({
              id: `mpw.projects:project:${p.id}`,
              pluginId: 'mpw.projects',
              type: 'project',
              title: p.name,
              snippet: p.description,
              icon: 'grid',
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
    ctx.ui.registerWidget('board', () => React.createElement(ProjectsView, { ctx, key: 'w' }));
    ctx.ui.registerRoute('main', () => React.createElement(ProjectsView, { ctx, key: 'r' }));
    ctx.log.info('项目插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
  },
});
