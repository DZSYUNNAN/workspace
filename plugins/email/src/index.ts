import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { initSchema, listAccounts, listMessages, searchMessages, seedDemoData } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.email',
    name: '邮箱',
    version: '0.2.0',
    author: 'ModuDesk',
    description: '统一工作邮箱:多账户、收件箱 / 已发送 / 草稿 / 星标 / 归档,IMAP·SMTP·OAuth2 传输层就绪,内置中文科研场景演示数据。',
    icon: 'mail',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'network', 'credentials', 'ai:invoke'],
    contributions: {
      widgets: [{ id: 'client', title: '邮箱', icon: 'mail', defaultArea: 'center', minW: 420 }],
      routes: [{ id: 'main', title: '邮箱', icon: 'mail', showInSidebar: true, order: 10 }],
      commands: [
        { id: 'compose', title: '邮箱: 写邮件', category: '邮箱' },
        { id: 'unreadCount', title: '邮箱: 获取未读数', category: '邮箱' },
      ],
      searchProviders: [
        {
          id: 'mail',
          label: '邮件',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchMessages(ctxRef, q, limit);
            return rows.map((m) => ({
              id: `mpw.email:mail:${m.id}`,
              pluginId: 'mpw.email',
              type: 'mail',
              title: m.subject || '(无主题)',
              snippet: truncate(`${m.from_name}:${m.body_text}`, 80),
              icon: 'mail',
              score: m.subject.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
            }));
          },
        },
      ],
      contextProviders: [
        {
          id: 'open',
          label: '当前邮件',
          getContext: async () => {
            if (!ctxRef) return null;
            const id = await ctxRef.storage.get<string | null>('ui.openMessageId', null);
            if (!id) return null;
            const { getMessage } = await import('./store');
            const m = await getMessage(ctxRef, id);
            if (!m) return null;
            return {
              id: 'open',
              label: `邮件: ${truncate(m.subject, 40)}`,
              kind: 'text' as const,
              content: `主题: ${m.subject}\n发件人: ${m.from_name} <${m.from_addr}>\n时间: ${new Date(m.date).toLocaleString('zh-CN')}\n\n${m.body_text.slice(0, 4000)}`,
              source: 'mpw.email',
            };
          },
        },
      ],
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    await initSchema(ctx);
    await seedDemoData(ctx);

    const { MailView } = await import('./MailView');
    const Comp = (props: { ctx: PluginContext; compact?: boolean }): React.ReactElement =>
      React.createElement(MailView, { ...props, key: 'mail' });
    ctx.ui.registerWidget('client', () => React.createElement(Comp, { ctx, compact: true }));
    ctx.ui.registerRoute('main', () => React.createElement(Comp, { ctx }));

    ctx.commands.register('mpw.email.compose', () => {
      ctx.ui.openWidget('mpw.email/client');
      ctx.events.emit('mail:compose', {});
    });

    // 未读计数(顶栏铃铛角标)
    ctx.commands.register('mpw.email.unreadCount', async () => {
      const accounts = await listAccounts(ctx);
      let n = 0;
      for (const a of accounts) {
        const msgs = await listMessages(ctx, a.id, 'inbox');
        n += msgs.filter((m) => !m.is_read).length;
      }
      return n;
    });

    // 邮件打开时记录上下文 ID
    ctx.events.on('ui:open:mpw.email', (p) => {
      const hit = (p as { hit?: { id: string } }).hit;
      const id = hit?.id.split(':').pop() ?? null;
      if (id) void ctx.storage.set('ui.openMessageId', id);
    });

    const emitStats = async (): Promise<void> => {
      const accounts = await listAccounts(ctx);
      let total = 0;
      let unread = 0;
      for (const a of accounts) {
        const msgs = await listMessages(ctx, a.id, 'inbox');
        total += msgs.length;
        unread += msgs.filter((m) => !m.is_read).length;
      }
      ctx.events.emit('plugin:stats', {
        pluginId: 'mpw.email',
        name: '邮箱',
        stats: [
          { label: '邮箱账户', count: accounts.length, icon: 'mail' },
          { label: '收件箱', count: total, icon: 'inbox' },
          { label: '未读', count: unread, icon: 'zap' },
        ],
      });
    };
    ctx.events.on('mail:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('邮箱插件已就绪(demo 传输)');
  },

  async deactivate() {
    ctxRef = null;
  },
});
