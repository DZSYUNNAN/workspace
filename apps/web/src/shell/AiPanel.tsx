import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon } from '@mpw/ui';
import type { AiResult, ContextChunk } from '@mpw/shared';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  provider?: string;
}

interface QuickAction {
  label: string;
  icon: string;
  /** 所需上下文来源插件;为空则不需要上下文 */
  source?: string;
  buildPrompt(ctx: ContextChunk[]): string;
}

/** 全局 AI 侧栏 — 问候语 + 快捷指令 + 上下文许可芯片(ModuDesk 设计稿)。 */
export function AiPanel(): React.ReactElement {
  const { kernel, aiPanelOpen, refresh } = useApp();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCtx, setShowCtx] = useState(true);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [ctxSig, setCtxSig] = useState(0);
  const msgsRef = useRef<HTMLDivElement>(null);
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
    return chunks.filter((c) => consent[`${c.source}/${c.id}`] !== false);
  };

  const run = async (prompt: string, label: string): Promise<void> => {
    setMsgs((m) => [...m, { role: 'user', text: label }]);
    setBusy(true);
    try {
      const chunks = await activeChunks();
      const result: AiResult = await kernel.ai.run(prompt, { context: chunks });
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          text: result.text,
          provider: `${result.provider}${chunks.length > 0 ? ` · ${chunks.length} 个上下文来源` : ''}`,
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
        <button className="icon-btn" title="上下文来源" onClick={() => setShowCtx((v) => !v)}>
          <Icon name="link" size={14} />
        </button>
      </div>
      {showCtx && providers.length > 0 && (
        <div className="ai-chips" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {providers.map((p) => (
            <span key={p.key} className={`chip${consent[p.key] ? ' on' : ''}`} onClick={() => toggleProvider(p.key)} title="切换是否允许 AI 读取该上下文">
              <Icon name={consent[p.key] ? 'check' : 'x'} size={11} />
              {p.label}
            </span>
          ))}
        </div>
      )}
      <div className="ai-msgs" ref={msgsRef}>
        {msgs.length === 0 && (
          <div className="ai-greet">
            <div className="ai-greet-title">{greeting},有什么可以帮你的吗?</div>
            <div className="ai-greet-sub">在获得你的许可后,助手可以读取当前打开的论文、笔记、邮件与文档作为上下文。</div>
            <div className="ai-quick">
              {QUICK.map((a) => (
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
                      await run(a.buildPrompt(chunks), a.label);
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
            {m.text}
            {m.provider && <span className="ai-src">{m.provider}</span>}
          </div>
        ))}
        {busy && <div className="ai-msg assistant">生成中…</div>}
      </div>
      <div className="ai-input">
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
