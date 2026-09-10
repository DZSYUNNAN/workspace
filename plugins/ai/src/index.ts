import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';

let ctxRef: PluginContext | null = null;

/**
 * AI plugin — contributes the selection AI action library consumed by every
 * editor surface (PRODUCT_SPEC §4.5, §9). Providers themselves are kernel
 * infrastructure (AiGateway); this plugin owns the *actions* and the in-canvas
 * chat widget.
 */
export default definePlugin({
  manifest: {
    id: 'mpw.ai',
    name: 'AI Assistant',
    version: '0.1.0',
    author: 'MPW',
    description: 'Provider-agnostic AI: chat widget, selection actions (polish, rewrite, translate, summarize, generate LaTeX/tables/citations) with workspace context.',
    icon: 'sparkles',
    minCoreVersion: '^0.1.0',
    permissions: ['storage', 'network', 'credentials', 'ai:invoke'],
    contributions: {
      widgets: [{ id: 'chat', title: 'AI Chat', icon: 'sparkles', defaultArea: 'right', minW: 260 }],
      commands: [
        { id: 'summarizeSelection', title: 'AI: Summarize selection', category: 'AI' },
      ],
      settings: [
        {
          key: 'temperature',
          label: 'Creativity (temperature)',
          type: 'number',
          default: 0.7,
          hint: '0 = deterministic, 1 = creative',
        },
      ],
      aiActions: [
        { id: 'polish', label: 'Polish', prompt: (s) => `Polish this text.\n\n${s}`, insert: 'replace' },
        { id: 'academic-rewrite', label: 'Academic Rewrite', prompt: (s) => `Rewrite in formal academic style this text.\n\n${s}`, insert: 'replace' },
        { id: 'rewrite', label: 'Rewrite', prompt: (s) => `Rewrite this text.\n\n${s}`, insert: 'replace' },
        { id: 'expand', label: 'Expand', prompt: (s) => `Expand this text.\n\n${s}`, insert: 'replace' },
        { id: 'shorten', label: 'Shorten', prompt: (s) => `Shorten this text.\n\n${s}`, insert: 'replace' },
        { id: 'zh2en', label: '中文→English', prompt: (s) => `Translate to english this text.\n\n${s}`, insert: 'replace' },
        { id: 'en2zh', label: 'English→中文', prompt: (s) => `Translate to chinese this text.\n\n${s}`, insert: 'replace' },
        { id: 'summarize', label: 'Summarize', prompt: (s) => `Summarize this text.\n\n${s}`, insert: 'below' },
        { id: 'keywords', label: 'Extract Keywords', prompt: (s) => `Extract keywords this text.\n\n${s}`, insert: 'below' },
        { id: 'explain-equation', label: 'Explain Equation', prompt: (s) => `Explain this equation in plain language.\n\n${s}`, insert: 'below' },
        { id: 'logic-check', label: 'Logical Consistency Check', prompt: (s) => `Check the logical consistency of this text and list issues.\n\n${s}`, insert: 'below' },
        { id: 'grammar', label: 'Grammar Check', prompt: (s) => `Polish and grammar check this text.\n\n${s}`, insert: 'replace' },
        { id: 'academic', label: 'Academic Writing', prompt: (s) => `Rewrite in formal academic style this text.\n\n${s}`, insert: 'replace' },
        { id: 'gen-latex', label: 'Generate LaTeX', prompt: (s) => `Generate latex this text.\n\n${s}`, insert: 'below' },
        { id: 'gen-table', label: 'Generate Table', prompt: (s) => `Convert this text into a markdown table.\n\n${s}`, insert: 'below' },
      ],
    },
  },

  async activate(ctx) {
    ctxRef = ctx;
    const { ChatWidget } = await import('./ChatWidget');
    ctx.ui.registerWidget('chat', () => React.createElement(ChatWidget, { ctx, key: 'ai-chat' }));

    ctx.commands.register('mpw.ai.summarizeSelection', async () => {
      const sel = window.getSelection()?.toString() ?? '';
      if (!sel.trim()) {
        ctx.ui.notify('Select some text first', 'warn');
        return;
      }
      const result = await ctx.ai.run(sel, { system: 'Summarize this text.' });
      ctx.ui.notify('Summary ready — see AI panel', 'success');
      ctx.events.emit('ai:result', { action: 'summarize', text: result.text });
      return result.text;
    });

    ctx.log.info('ai plugin ready');
  },

  async deactivate() {
    ctxRef = null;
  },
});
