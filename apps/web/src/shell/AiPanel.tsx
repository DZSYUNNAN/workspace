import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon, ResizeHandle } from '@mpw/ui';
import type { AiActionContribution } from '@mpw/kernel';
import { applyLayoutSizeAction, type AiResult, type ContextChunk, type ModuleSizeKey } from '@mpw/shared';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  provider?: string;
  applyTarget?: string;
}

interface QuickAction {
  label: string;
  icon: string;
  /** 所需上下文来源插件;为空则不需要上下文 */
  source?: string;
  buildPrompt(ctx: ContextChunk[]): string;
}

export interface AiActionMaterial {
  primaryText: string;
  contextText: string;
  includeContext: boolean;
  hasRequiredInput: boolean;
}

export function resolveAiActionMaterial(mode: NonNullable<AiActionContribution['inputMode']>, typed: string, selection: string, contextText: string): AiActionMaterial {
  const input = typed.trim();
  const selected = selection.trim();
  const context = contextText.trim();
  if (mode === 'input-first') {
    const primaryText = input || selected;
    return { primaryText, contextText: '', includeContext: false, hasRequiredInput: Boolean(primaryText) };
  }
  if (mode === 'input-or-context') {
    const primaryText = input || selected;
    return { primaryText, contextText: primaryText ? '' : context, includeContext: !primaryText, hasRequiredInput: Boolean(primaryText || context) };
  }
  const combinedContext = selected ? `Current TeX selection:\n${selected}\n\nCurrent paper.tex:\n${context}` : context;
  return { primaryText: input, contextText: combinedContext, includeContext: true, hasRequiredInput: Boolean(combinedContext) };
}

export async function copyChatText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

/** 全局 AI 侧栏 — 问候语 + 快捷指令 + 上下文许可芯片(ModuDesk 设计稿)。 */
export function AiPanel(): React.ReactElement {
  const { kernel, aiPanelOpen, refresh, navigate, route, setLayout } = useApp();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCtx, setShowCtx] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [ctxSig, setCtxSig] = useState(0);
  const msgsRef = useRef<HTMLDivElement>(null);
  const resize = (key: ModuleSizeKey, delta: number): void => setLayout((current) => applyLayoutSizeAction(current, { kind: 'modulePaneDelta', key, delta }));
  const version = useApp().version;
  void version;

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const c of kernel.context.list()) map[c.key] = c.enabled;
    setConsent(map);
  }, [kernel, version]);

  useEffect(() => {
    if (msgsRef.current && typeof msgsRef.current.scrollTo === 'function') {
      msgsRef.current.scrollTo({ top: msgsRef.current.scrollHeight });
    }
  }, [msgs]);

  if (!aiPanelOpen) return <></>;

  const providers = kernel.context.list();
  const activePlugin = route.type === 'pluginRoute' ? route.key.split('/')[0] : null;
  const providerLabel =
    kernel.ai.listProviders().find((p) => p.id === kernel.settings.get('ai.provider', 'demo'))?.label ?? '离线演示';

  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';

  const toggleProvider = (key: string): void => {
    const next = !consent[key];
    kernel.context.setEnabled(key, next);
    kernel.settings.set('ai.context.disabled', kernel.context.consentSnapshot());
    setConsent((c) => ({ ...c, [key]: next }));
  };

  const activeChunks = async (): Promise<ContextChunk[]> => {
    const chunks = await kernel.context.getActiveContext();
    const allowed = chunks.filter((c) => consent[`${c.source}/${c.id}`] !== false);
    return activePlugin ? allowed.filter((c) => c.source === activePlugin) : allowed;
  };

  const run = async (prompt: string, label: string, preparedChunks?: ContextChunk[], allowApply = false): Promise<void> => {
    setMsgs((m) => [...m, { role: 'user', text: label }]);
    setBusy(true);
    try {
      const chunks = preparedChunks ?? await activeChunks();
      const result: AiResult = await kernel.ai.run(prompt, { context: chunks });
      const localTex = chunks.find((chunk) => chunk.source === 'mpw.writing' && chunk.label.startsWith('本地 TeX:'));
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          text: result.text,
          provider: `${result.provider}${chunks.length > 0 ? ` · ${chunks.length} 个上下文来源` : ''}`,
          applyTarget: allowApply ? localTex?.label : undefined,
        },
      ]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'assistant', text: `⚠ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await run(text, text);
  };

  const QUICK: QuickAction[] = [
    {
      label: '总结这篇论文',
      icon: 'book',
      source: 'mpw.references',
      buildPrompt: (cs) => '请总结以下论文的摘要与要点,输出中文,分条列出核心贡献与方法:\n\n' + cs.filter((c) => c.source === 'mpw.references').map((c) => c.content).join('\n\n'),
    },
    {
      label: '翻译高亮段落',
      icon: 'link',
      source: 'mpw.references',
      buildPrompt: (cs) => '将以下英文段落翻译成学术中文,保留术语准确:\n\n' + cs.filter((c) => c.source === 'mpw.references' && c.kind === 'selection').map((c) => c.content).join('\n\n'),
    },
    {
      label: '生成LaTeX表格',
      icon: 'table',
      source: 'mpw.writing',
      buildPrompt: (cs) => '把下面的数据/文字转换成一个 booktabs 风格的 LaTeX 表格代码:\n\n' + cs.filter((c) => c.source === 'mpw.writing').map((c) => c.content.slice(0, 1500)).join('\n\n'),
    },
    {
      label: '分析这封邮件',
      icon: 'mail',
      source: 'mpw.email',
      buildPrompt: (cs) => '分析这封邮件:1) 需要我采取什么行动 2) 有没有截止日期 3) 用一句话总结。中文回答:\n\n' + cs.filter((c) => c.source === 'mpw.email').map((c) => c.content).join('\n\n'),
    },
  ];

  const contributedActions = activePlugin
    ? kernel.enabledAiActions().filter((action) => action.pluginId === activePlugin)
    : [];

  const quickAvailable = async (a: QuickAction): Promise<boolean> => {
    if (!a.source) return true;
    const chunks = await activeChunks();
    return chunks.some((c) => c.source === a.source);
  };
  void quickAvailable;
  void ctxSig;
  void setCtxSig;

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <Icon name="sparkles" size={15} />
        AI 助手
        <span className="badge gray" style={{ marginLeft: 4 }}>{providerLabel}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="配置 AI 服务" onClick={() => navigate({ type: 'settings' })}>
          <Icon name="settings" size={14} />
        </button>
        <button className="icon-btn" title="上下文来源" onClick={() => setShowCtx((v) => !v)}>
          <Icon name="link" size={14} />
        </button>
      </div>
      {showCtx && providers.length > 0 && (
        <div className="ai-chips" aria-label="AI 上下文来源">
          {activePlugin && <span className="badge gray">当前模块：{g_label(activePlugin)}</span>}
          {providers.map((p) => (
            <span key={p.key} className={`chip${consent[p.key] !== false ? ' on' : ''}`} onClick={() => toggleProvider(p.key)} title="切换是否允许 AI 读取该上下文">
              <Icon name={consent[p.key] !== false ? 'check' : 'x'} size={11} />
              {p.label}
            </span>
          ))}
        </div>
      )}
      {showCtx && providers.length > 0 && <ResizeHandle axis="y" onDelta={(delta) => resize('aiContextHeight', delta)} title="拖动调整 AI 上下文区高度" />}
      {contributedActions.length > 0 && (
        <div className="ai-module-actions" aria-label={`${g_label(activePlugin ?? '')} AI 功能`}>
          {contributedActions.map((action) => (
            <button key={action.globalId} className="quick-btn" disabled={busy} onClick={() => {
              void (async () => {
                const chunks = await activeChunks();
                const own = chunks.filter((chunk) => chunk.source === action.pluginId);
                const selection = own.filter((chunk) => chunk.kind === 'selection').map((chunk) => chunk.content).join('\n\n');
                const contextText = own.filter((chunk) => chunk.kind !== 'selection').map((chunk) => chunk.content).join('\n\n');
                if (action.inputMode) {
                  const material = resolveAiActionMaterial(action.inputMode, input, selection, contextText);
                  if (!material.hasRequiredInput) {
                    const message = action.inputMode === 'input-first'
                      ? `⚠ 请先在下方输入框粘贴需要处理的文本，或在 TeX 编辑器中选中文本。`
                      : `⚠ 请先在「${g_label(action.pluginId)}」模块打开内容，并确认上方上下文开关已启用。`;
                    setMsgs((m) => [...m, { role: 'assistant', text: message }]);
                    return;
                  }
                  const typed = input.trim();
                  if (typed) setInput('');
                  await run(
                    action.prompt(material.primaryText, material.contextText),
                    typed ? `${action.label}\n${typed}` : action.label,
                    material.includeContext ? chunks : [],
                    action.insert !== 'none',
                  );
                  return;
                }
                if (own.length === 0) {
                  setMsgs((m) => [...m, { role: 'assistant', text: `⚠ 请先在「${g_label(action.pluginId)}」模块打开内容，并确认上方上下文开关已启用。` }]);
                  return;
                }
                await run(action.prompt(selection, contextText), action.label, chunks);
              })();
            }} title={action.description}><Icon name={action.icon ?? 'sparkles'} size={13} /> {action.label}</button>
          ))}
        </div>
      )}
      {contributedActions.length > 0 && <ResizeHandle axis="y" onDelta={(delta) => resize('aiActionsHeight', delta)} title="拖动调整 AI 功能区高度" />}
      <div className="ai-msgs" ref={msgsRef} aria-label="AI 聊天内容">
        {msgs.length === 0 && (
          <div className="ai-greet">
            <div className="ai-greet-title">{greeting},有什么可以帮你的吗?</div>
            <div className="ai-greet-sub">助手会读取当前模块中打开的论文、笔记、邮件或文档；可在上方关闭任一上下文来源。</div>
            <div className="ai-quick">
              {(contributedActions.length === 0 ? QUICK : QUICK.filter((action) => action.source === activePlugin)).map((a) => (
                <button
                  key={a.label}
                  className="quick-btn"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      const chunks = await activeChunks();
                      if (a.source && !chunks.some((c) => c.source === a.source)) {
                        setMsgs((m) => [...m, { role: 'assistant', text: `⚠ 该指令需要「${a.source}」插件的上下文。请先打开相关论文/邮件/文档,并确认上方上下文开关已启用。` }]);
                        return;
                      }
                      await run(a.buildPrompt(chunks), a.label, chunks);
                    })();
                  }}
                >
                  <Icon name={a.icon} size={13} /> {a.label}
                </button>
              ))}
              <button
                className="quick-btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const chunks = await activeChunks();
                    const base = chunks.map((c) => c.content).join('\n').slice(0, 2000);
                    if (!base) {
                      setMsgs((m) => [...m, { role: 'assistant', text: '⚠ 请先打开一些内容(论文 / 笔记 / 邮件),我再帮你提取关键词。' }]);
                      return;
                    }
                    const kw = await kernel.ai.run('提取以下文本中的 3-6 个英文学术检索关键词,只输出逗号分隔的关键词:\n\n' + base);
                    const groups = await kernel.search.searchAll(kw.text.split(',')[0]?.trim() || base.slice(0, 20), 4);
                    const hits = groups.flatMap((g) => g.hits).slice(0, 8);
                    setMsgs((m) => [
                      ...m,
                      { role: 'user', text: '查找相关文献' },
                      { role: 'assistant', text: `关键词:${kw.text.trim()}\n\n${hits.map((h) => `• [${g_label(h.pluginId)}] ${h.title}`).join('\n') || '未找到相关内容'}` },
                    ]);
                  })();
                }}
              >
                <Icon name="search" size={13} /> 查找相关文献
              </button>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            <div className="ai-msg-text">{m.text}</div>
            {m.provider && <span className="ai-src">{m.provider}</span>}
            <button className="ai-copy" title="复制消息" onClick={() => void copyChatText(m.text).then(() => setCopied(i)).catch(() => setCopied(null))}>{copied === i ? '已复制' : '复制'}</button>
            {m.role === 'assistant' && m.applyTarget && (
              <button className="btn sm ai-apply" title="写入源码并自动保存；不会自动编译 PDF" onClick={() => kernel.events.emit('writing:apply-ai-output', { text: m.text, targetLabel: m.applyTarget })}>
                写入当前 TeX 选区
              </button>
            )}
          </div>
        ))}
        {busy && <div className="ai-msg assistant">生成中…</div>}
      </div>
      <ResizeHandle axis="y" direction={-1} onDelta={(delta) => resize('aiInputHeight', delta)} title="拖动调整 AI 输入区高度" />
      <div className="ai-input" aria-label="AI 指令输入区">
        <textarea
          className="input"
          placeholder="输入问题,或选择屏幕内容…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary send-btn" disabled={busy} onClick={() => void send()}>
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}

function g_label(pluginId: string): string {
  return { 'mpw.references': '文献', 'mpw.notes': '笔记', 'mpw.email': '邮件', 'mpw.writing': '文档', 'mpw.files': '文件', 'mpw.tasks': '任务' }[pluginId] ?? pluginId;
}
