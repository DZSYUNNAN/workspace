import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { listDocs, searchDocs } from './store';
import { WritingView } from './WritingView';

let ctxRef: PluginContext | null = null;
let activeDocId: string | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.writing',
    name: 'Writing',
    version: '0.1.0',
    author: 'MPW',
    description: 'Two writing environments: Mode A (Word-like rich text, .docx export) and Mode B (LaTeX with live preview).',
    icon: 'pen',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'ai:invoke'],
    contributions: {
      widgets: [{ id: 'editor', title: 'Writing', icon: 'pen', defaultArea: 'center', minW: 340 }],
      routes: [{ id: 'main', title: 'Writing', icon: 'pen', showInSidebar: true, order: 40 }],
      commands: [
        { id: 'newRichDoc', title: 'Writing: New rich document', category: 'Writing' },
        { id: 'newLatexDoc', title: 'Writing: New LaTeX document', category: 'Writing' },
      ],
      searchProviders: [
        {
          id: 'documents',
          label: 'Documents',
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
          label: 'Current document',
          getContext: async () => {
            if (!ctxRef || !activeDocId) return null;
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
      ],
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    const { initSchema } = await import('./store');
    await initSchema(ctx);

    ctx.ui.registerWidget('editor', () => React.createElement(WritingView, { ctx, compact: true }));
    ctx.ui.registerRoute('main', () => React.createElement(WritingView, { ctx }));

    ctx.commands.register('mpw.writing.newRichDoc', async () => {
      const { createDoc } = await import('./store');
      const d = await createDoc(ctx, 'Untitled document', 'rich');
      ctx.events.emit('docs:changed', { id: d.id });
      ctx.ui.openWidget('mpw.writing/editor');
      return d.id;
    });
    ctx.commands.register('mpw.writing.newLatexDoc', async () => {
      const { createDoc } = await import('./store');
      const d = await createDoc(ctx, 'Untitled.tex', 'latex');
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
          { label: 'documents', count: docs.length, icon: 'pen' },
          { label: 'LaTeX', count: docs.filter((d) => d.mode === 'latex').length, icon: 'code' },
        ],
      });
    };
    ctx.events.on('docs:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('writing plugin ready');
  },

  async deactivate() {
    ctxRef = null;
    activeDocId = null;
  },
});
