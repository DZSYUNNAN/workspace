import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { listRefs, parseAuthors } from './store';
import { LibraryView } from './LibraryView';

let ctxRef: PluginContext | null = null;
let selectedId: string | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.references',
    name: 'References',
    version: '0.1.0',
    author: 'MPW',
    description: 'Literature management: BibTeX/RIS/DOI import, collections, tags, PDF reader, citations in BibTeX/IEEE/APA/GB-T 7714.',
    icon: 'book',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'blobs', 'network'],
    contributions: {
      widgets: [{ id: 'library', title: 'Reference Library', icon: 'book', defaultArea: 'center', minW: 300 }],
      routes: [{ id: 'main', title: 'References', icon: 'book', showInSidebar: true, order: 20 }],
      commands: [{ id: 'import', title: 'References: Import…', category: 'References' }],
      searchProviders: [
        {
          id: 'references',
          label: 'References',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const { searchRefs } = await import('./store');
            const rows = await searchRefs(ctxRef, q, limit);
            return rows.map((r) => ({
              id: `mpw.references:reference:${r.id}`,
              pluginId: 'mpw.references',
              type: 'reference',
              title: r.title,
              snippet: truncate(`${parseAuthors(r.authors).map((a) => a.family ?? a.literal ?? '').join(', ')} ${r.venue} ${r.year ?? ''}`.trim(), 80),
              icon: 'book',
              score: r.title.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
            }));
          },
        },
      ],
      contextProviders: [
        {
          id: 'selected',
          label: 'Selected reference',
          getContext: async () => {
            if (!ctxRef || !selectedId) return null;
            const { getRef } = await import('./store');
            const r = await getRef(ctxRef, selectedId);
            if (!r) return null;
            return {
              id: 'selected',
              label: `Reference: ${truncate(r.title, 40)}`,
              kind: 'metadata' as const,
              content: `Title: ${r.title}\nAuthors: ${parseAuthors(r.authors)
                .map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim())
                .join('; ')}\nVenue: ${r.venue}\nYear: ${r.year ?? ''}\nDOI: ${r.doi}\n\nAbstract: ${r.abstract}`,
              source: 'mpw.references',
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

    const viewProps = {
      ctx,
      onSelectedChange: (id: string | null) => {
        selectedId = id;
      },
    };
    ctx.ui.registerWidget('library', () => React.createElement(LibraryView, { ...viewProps, compact: true }));
    ctx.ui.registerRoute('main', () => React.createElement(LibraryView, { ...viewProps }));

    ctx.commands.register('mpw.references.import', () => {
      ctx.events.emit('refs:openImport', {});
    });

    const emitStats = async (): Promise<void> => {
      const refs = await listRefs(ctx);
      ctx.events.emit('plugin:stats', {
        pluginId: 'mpw.references',
        name: 'References',
        stats: [
          { label: 'references', count: refs.length, icon: 'book' },
          { label: 'PDFs', count: refs.filter((r) => r.blob_ref).length, icon: 'pdf' },
        ],
      });
    };
    ctx.events.on('refs:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('references plugin ready');
  },

  async deactivate() {
    ctxRef = null;
    selectedId = null;
  },
});
