import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { truncate } from '@mpw/shared';
import { initSchema, listAccounts, listMessages, searchMessages, seedDemoData } from './store';

let ctxRef: PluginContext | null = null;
let openMessageId: string | null = null;

export default definePlugin({
  manifest: {
    id: 'mpw.email',
    name: 'Email',
    version: '0.1.0',
    author: 'MPW',
    description: 'Unified work email: multiple accounts, folders, compose, star, labels, search. IMAP/SMTP + OAuth2 adapters land via the MailTransport interface.',
    icon: 'mail',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'network', 'credentials', 'ai:invoke'],
    contributions: {
      widgets: [{ id: 'client', title: 'Email', icon: 'mail', defaultArea: 'center', minW: 420 }],
      routes: [{ id: 'main', title: 'Email', icon: 'mail', showInSidebar: true, order: 10 }],
      commands: [{ id: 'compose', title: 'Email: Compose', category: 'Email' }],
      searchProviders: [
        {
          id: 'mail',
          label: 'Email',
          search: async (q, limit) => {
            if (!ctxRef) return [];
            const rows = await searchMessages(ctxRef, q, limit);
            return rows.map((m) => ({
              id: `mpw.email:mail:${m.id}`,
              pluginId: 'mpw.email',
              type: 'mail',
              title: m.subject || '(no subject)',
              snippet: truncate(`${m.from_name}: ${m.body_text}`, 80),
              icon: 'mail',
              score: m.subject.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
            }));
          },
        },
      ],
      contextProviders: [
        {
          id: 'open',
          label: 'Open email',
          getContext: async () => {
            if (!ctxRef || !openMessageId) return null;
            const { getMessage } = await import('./store');
            const m = await getMessage(ctxRef, openMessageId);
            if (!m) return null;
            return {
              id: 'open',
              label: `Email: ${truncate(m.subject, 40)}`,
              kind: 'text' as const,
              content: `Subject: ${m.subject}\nFrom: ${m.from_name} <${m.from_addr}>\nDate: ${new Date(m.date).toLocaleString()}\n\n${m.body_text.slice(0, 4000)}`,
              source: 'mpw.email',
            };
          },
        },
      ],
      // Phase 3 AI extension points (declared now, consumed by the AI plugin):
      // summarization, long-thread digest, task extraction, date extraction,
      // auto-classification, reply drafting, translation — all via ctx.ai.
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    await initSchema(ctx);
    await seedDemoData(ctx);

    ctx.ui.registerWidget('client', () => React.createElement(MailViewComp, { ctx, compact: true }));
    ctx.ui.registerRoute('main', () => React.createElement(MailViewComp, { ctx }));

    const { MailView } = await import('./MailView');
    function MailViewComp(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
      return React.createElement(MailView, { ...props, key: 'mail' });
    }

    ctx.commands.register('mpw.email.compose', () => {
      ctx.ui.openWidget('mpw.email/client');
      ctx.events.emit('mail:compose', {});
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
        name: 'Email',
        stats: [
          { label: 'accounts', count: accounts.length, icon: 'mail' },
          { label: 'inbox', count: total, icon: 'inbox' },
          { label: 'unread', count: unread, icon: 'zap' },
        ],
      });
    };
    ctx.events.on('mail:changed', () => void emitStats());
    await emitStats();
    ctx.log.info('email plugin ready (demo transport)');
  },

  async deactivate() {
    ctxRef = null;
    openMessageId = null;
  },
});
