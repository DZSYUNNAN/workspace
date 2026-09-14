import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate, type LocalDocumentSession } from '@mpw/shared';
import { listDocs, searchDocs } from './store';
import { WritingView } from './WritingView';
import { buildPaperActionPrompt, PAPER_AI_ACTIONS } from './paperAi';

let ctxRef: PluginContext | null = null;
let activeDocId: string | null = null;
let activeLocalSession: LocalDocumentSession | null = null;
let activeLocalSelection = '';

export default definePlugin({
  manifest: {
    id: 'mpw.writing',
    name: '写作',
    version: '0.7.1',
    author: 'ModuDesk',
    description: '富文本与本地论文写作：paper.tex/PDF 双栏、SyncTeX 反向定位，并接入统一右侧 AI 助手。',
    icon: 'pen',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'ai:invoke', 'native'],
    contributions: {
      widgets: [{ id: 'editor', title: '写作', icon: 'pen', defaultArea: 'center', minW: 340 }],
      routes: [{ id: 'main', title: '写作', icon: 'pen', showInSidebar: true, order: 40 }],
      commands: [
        { id: 'newRichDoc', title: '写作: 新建富文本文档', category: '写作' },
        { id: 'newLatexDoc', title: '写作: 新建 LaTeX 工程', category: '写作' },
      ],
      settings: [
        { key: 'engine', label: 'LaTeX 编译引擎', type: 'select', default: 'xelatex', options: [
          { value: 'xelatex', label: 'XeLaTeX(推荐中文)' },
          { value: 'lualatex', label: 'LuaLaTeX' },
          { value: 'pdflatex', label: 'pdfLaTeX' },
        ] },
      ],
      searchProviders: [
        {
          id: 'documents',
          label: '文档',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchDocs(ctxRef, q, limit);
            return rows.map((d) => ({
              id: `mpw.writing:doc:${d.id}`,
              pluginId: 'mpw.writing',
              type: d.mode === 'latex' ? 'latex' : 'document',
              title: d.title,
              snippet: truncate(d.content.replace(/<[^>]+>/g, ' ').replace(/\\[a-zA-Z]+\{?/g, ' '), 80),
              icon: d.mode === 'latex' ? 'code' : 'pen',
              score: d.title.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
            }));
          },
        },
      ],
      contextProviders: [
        {
          id: 'current',
          label: '当前文档',
          getContext: async () => {
            if (!ctxRef) return null;
            if (activeLocalSession) {
              const isTex = activeLocalSession.file.name.toLowerCase().endsWith('.tex');
              return {
                id: 'current',
                label: `${isTex ? '本地 TeX' : '本地文档'}: ${activeLocalSession.file.name}`,
                kind: 'text' as const,
                content: activeLocalSession.texts.join('\n\n').slice(0, 45_000),
                source: 'mpw.writing',
              };
            }
            if (!activeDocId) return null;
            const docs = await listDocs(ctxRef);
            const d = docs.find((x) => x.id === activeDocId);
            if (!d) return null;
            return {
              id: 'current',
              label: `Document: ${d.title}`,
              kind: 'text' as const,
              content:
                d.mode === 'latex'
                  ? d.content.slice(0, 4000)
                  : d.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000),
              source: 'mpw.writing',
            };
          },
        },
        {
          id: 'selection',
          label: 'TeX 当前选区',
          getContext: async () => activeLocalSession && activeLocalSelection.trim() ? {
            id: 'selection',
            label: `TeX 选区: ${activeLocalSession.file.name}`,
            kind: 'selection' as const,
            content: activeLocalSelection.slice(0, 16_000),
            source: 'mpw.writing',
          } : null,
        },
      ],
      aiActions: PAPER_AI_ACTIONS.map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        appliesTo: ['text', 'selection'],
        insert: action.id === 'review' || action.id === 'structure' ? 'none' as const : 'replace' as const,
        prompt: (selection: string, contextText = '') => buildPaperActionPrompt(action.id, selection, contextText),
      })),
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    const { initSchema } = await import('./store');
    await initSchema(ctx);

    const selectionProps = {
      onSelectedChange: (id: string | null) => { activeDocId = id; if (id) { activeLocalSession = null; activeLocalSelection = ''; } },
      onLocalSessionChange: (session: LocalDocumentSession | null) => { activeLocalSession = session; if (session) activeDocId = null; },
      onLocalSelectionChange: (text: string) => { activeLocalSelection = text; },
    };
    ctx.ui.registerWidget('editor', () => React.createElement(WritingView, { ctx, compact: true, ...selectionProps }));
    ctx.ui.registerRoute('main', () => React.createElement(WritingView, { ctx, ...selectionProps }));

    ctx.commands.register('mpw.writing.newRichDoc', async () => {
      const { createDoc } = await import('./store');
      const d = await createDoc(ctx, '未命名文档', 'rich');
      ctx.events.emit('docs:changed', { id: d.id });
      ctx.ui.openWidget('mpw.writing/editor');
      return d.id;
    });
    ctx.commands.register('mpw.writing.newLatexDoc', async () => {
      const { createDoc } = await import('./store');
      const d = await createDoc(ctx, '未命名.tex', 'latex');
      ctx.events.emit('docs:changed', { id: d.id });
      ctx.ui.openWidget('mpw.writing/editor');
      return d.id;
    });

    const emitStats = async (): Promise<void> => {
      const docs = await listDocs(ctx);
      ctx.events.emit('plugin:stats', {
        pluginId: 'mpw.writing',
        name: 'Writing',
        stats: [
          { label: '文档', count: docs.length, icon: 'pen' },
          { label: 'LaTeX 工程', count: docs.filter((d) => d.mode === 'latex').length, icon: 'code' },
        ],
      });
    };
    ctx.events.on('docs:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('写作插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
    activeDocId = null;
    activeLocalSession = null;
    activeLocalSelection = '';
  },
});
