import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { initSchema, listAccounts, listMessages, searchMessages, seedDemoData } from './store';

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.email',
    name: '邮箱',
    version: '0.3.2',
    author: 'ModuDesk',
    description: '多账户邮箱：桌面 IMAP/SMTP 加密直连、连接测试、收件缓存与文本发送，支持账户设置和删除；内置离线演示。',
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
      aiActions: [
        { id: 'summarize', label: '总结邮件', icon: 'mail', insert: 'none', prompt: (_selection, context = '') => `请用中文概括这封邮件的核心信息、发件人诉求和背景。\n\n${context}` },
        { id: 'actions', label: '提取待办和期限', icon: 'check', insert: 'none', prompt: (_selection, context = '') => `分析这封邮件，列出需要采取的行动、负责人、明确或隐含的截止时间；没有的信息请标明未提及。\n\n${context}` },
        { id: 'reply', label: '起草回复', icon: 'send', insert: 'none', prompt: (_selection, context = '') => `根据这封邮件起草一封简洁、礼貌、可直接修改的回复。不要虚构事实，缺少的信息用方括号占位。\n\n${context}` },
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
    ctx.log.info('邮箱插件已就绪');
  },

  async deactivate() {
    ctxRef = null;
  },
});
