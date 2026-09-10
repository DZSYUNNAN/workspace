import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { backlinks, createNote, extractLinks, listNotes, searchNotes } from './store';
import { NotesView } from './NotesView';

let ctxRef: PluginContext | null = null;
let activeNoteId: string | null = null;
let activeNoteLabel = '';
let noteCount = 0;

async function emitStats(ctx: PluginContext): Promise<void> {
  const notes = await listNotes(ctx);
  noteCount = notes.length;
  const links = notes.reduce((n, x) => n + extractLinks(x.body_md).length, 0);
  ctx.events.emit('plugin:stats', {
    pluginId: 'mpw.notes',
    name: 'Notes',
    stats: [
      { label: '笔记', count: notes.length, icon: 'note' },
      { label: '双向链接', count: links, icon: 'link' },
    ],
  });
}

export default definePlugin({
  manifest: {
    id: 'mpw.notes',
    name: 'Notes',
    version: '0.1.0',
    author: 'MPW',
    description: 'Markdown 知识库:文件夹、标签、[[双向链接]]、反向链接、数学公式、全文检索,可链接文献 / 邮件 / 文档。',
    icon: 'note',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'ai:invoke'],
    contributions: {
      widgets: [{ id: 'list', title: '笔记', icon: 'note', defaultArea: 'left', minW: 180, minH: 160 }],
      routes: [{ id: 'main', title: '笔记', icon: 'note', showInSidebar: true, order: 30 }],
      commands: [
        { id: 'newNote', title: '笔记: 新建笔记', category: '笔记', shortcut: 'Ctrl+Alt+N' },
      ],
      searchProviders: [
        {
          id: 'notes',
          label: '笔记',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchNotes(ctxRef, q, limit);
            return rows.map((n) => ({
              id: `mpw.notes:note:${n.id}`,
              pluginId: 'mpw.notes',
              type: 'note',
              title: n.title,
              snippet: truncate(n.body_md.replace(/[#*`>\[\]]/g, ' ').replace(/\s+/g, ' '), 80),
              icon: 'note',
              score: n.title.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
            }));
          },
        },
      ],
      contextProviders: [
        {
          id: 'current',
          label: '当前笔记',
          getContext: async () => {
            if (!ctxRef || !activeNoteId) return null;
            const note = (await listNotes(ctxRef)).find((n) => n.id === activeNoteId);
            if (!note) return null;
            return {
              id: 'current',
              label: `Note: ${note.title}`,
              kind: 'text' as const,
              content: `# ${note.title}\n\n${note.body_md.slice(0, 4000)}`,
              source: 'mpw.notes',
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

    ctx.ui.registerWidget('list', (props) => React.createElement(NotesView, { ctx, activeId: activeNoteId, setActiveId: (id: string | null) => { activeNoteId = id; activeNoteLabel = ''; }, compact: true, key: `${props.instanceId}-w` }));
    ctx.ui.registerRoute('main', () => React.createElement(NotesView, { ctx, activeId: activeNoteId, setActiveId: (id: string | null) => { activeNoteId = id; activeNoteLabel = ''; }, key: 'route' }));

    ctx.commands.register('mpw.notes.newNote', async () => {
      const note = await createNote(ctx, 'Untitled note');
      activeNoteId = note.id;
      ctx.events.emit('notes:changed', { id: note.id });
      ctx.ui.notify('笔记已创建', 'success');
      return note.id;
    });

    ctx.events.on('notes:changed', () => {
      void emitStats(ctx);
    });
    await emitStats(ctx);
    ctx.log.info('笔记插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
    activeNoteId = null;
  },
});
