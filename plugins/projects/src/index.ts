import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { ProjectsView } from './ProjectsView';
import { initSchema, listLinks, listProjects, searchProjects } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.projects',
    name: '项目',
    version: '0.3.0',
    author: 'ModuDesk',
    description: '科研项目管理:把文献、笔记、文档、任务通过稳定资源链接组织为一个课题。',
    icon: 'grid',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'ai:invoke'],
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
      contextProviders: [{
        id: 'portfolio',
        label: '当前项目列表',
        getContext: async () => {
          if (!ctxRef) return null;
          const projects = await listProjects(ctxRef);
          if (projects.length === 0) return null;
          const sections = await Promise.all(projects.slice(0, 30).map(async (project) => {
            const links = await listLinks(ctxRef!, project.id);
            return `## ${project.name}\n${project.description || '（无项目说明）'}${links.length ? `\n关联资源:\n${links.slice(0, 30).map((link) => `- ${link.label || link.resource_uri}`).join('\n')}` : ''}`;
          }));
          return { id: 'portfolio', label: '当前项目列表', kind: 'text' as const, source: 'mpw.projects', content: sections.join('\n\n').slice(0, 30_000) };
        },
      }],
      aiActions: [
        { id: 'next-steps', label: '规划项目下一步', icon: 'grid', insert: 'none', prompt: (_selection, context = '') => `根据项目说明和关联资源，给出下一步行动、依赖关系和可验证的里程碑。不要臆测未提供的进展。\n\n${context}` },
        { id: 'risks', label: '检查项目风险', icon: 'search', insert: 'none', prompt: (_selection, context = '') => `检查这些项目可能存在的范围、资源、进度和证据风险，按优先级给出缓解建议。\n\n${context}` },
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
