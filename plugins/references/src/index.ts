import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { listRefs, parseAuthors } from './store';
import { LibraryView } from './LibraryView';
import { formatCitation } from './citations';

let ctxRef: PluginContext | null = null;
let selectedId: string | null = null;
let lastHighlight = ''; // 最近一次高亮的原文(AI「翻译高亮段落」上下文)

export default definePlugin({
  manifest: {
    id: 'mpw.references',
    name: '文献',
    version: '0.2.0',
    author: 'ModuDesk',
    description: '科研文献管理:BibTeX / RIS / DOI 导入、集合、标签、PDF 阅读与高亮批注持久化,引文输出 IEEE / APA / GB-T 7714 / BibTeX。',
    icon: 'book',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'blobs', 'network'],
    contributions: {
      widgets: [{ id: 'library', title: '文献库', icon: 'book', defaultArea: 'center', minW: 300 }],
      routes: [{ id: 'main', title: '文献', icon: 'book', showInSidebar: true, order: 20 }],
      commands: [{ id: 'import', title: '文献: 导入…', category: '文献' }, { id: 'citations', title: '文献: 引用数据', category: '文献' }],
      searchProviders: [
        {
          id: 'references',
          label: '文献',
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
          label: '当前文献',
          getContext: async () => {
            if (!ctxRef || !selectedId) return null;
            const { getRef } = await import('./store');
            const r = await getRef(ctxRef, selectedId);
            if (!r) return null;
            return {
              id: 'selected',
              label: `文献: ${truncate(r.title, 40)}`,
              kind: 'metadata' as const,
              content: `标题: ${r.title}\n作者: ${parseAuthors(r.authors).map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim()).join('; ')}\n期刊/会议: ${r.venue}\n年份: ${r.year ?? ''}\nDOI: ${r.doi}\n\n摘要: ${r.abstract}`,
              source: 'mpw.references',
            };
          },
        },
        {
          id: 'highlight',
          label: 'PDF 高亮段落',
          getContext: async () => {
            if (!lastHighlight) return null;
            return {
              id: 'highlight',
              label: '高亮段落',
              kind: 'selection' as const,
              content: lastHighlight,
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
    ctx.commands.register('mpw.references.citations', async () => (await listRefs(ctx)).map((r) => {
      const record = { citationKey: r.citation_key, entryType: r.entry_type, title: r.title, authors: parseAuthors(r.authors), venue: r.venue, year: r.year, doi: r.doi, volume: r.volume, number: r.number, pages: r.pages, publisher: r.publisher };
      return { id: r.id, title: r.title, key: r.citation_key, text: formatCitation('apa', record), bib: formatCitation('bibtex', record) };
    }));

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

    ctx.events.on('refs:annotationMade', (payload) => {
      lastHighlight = (payload as { text?: string })?.text ?? '';
    });

    const emitStats = async (): Promise<void> => {
      const refs = await listRefs(ctx);
      ctx.events.emit('plugin:stats', {
        pluginId: 'mpw.references',
        name: '文献',
        stats: [
          { label: '文献', count: refs.length, icon: 'book' },
          { label: 'PDF 附件', count: refs.filter((r) => r.blob_ref).length, icon: 'pdf' },
        ],
      });
    };
    ctx.events.on('refs:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('文献插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
    selectedId = null;
  },
});
