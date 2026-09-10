import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import type { AiResult, ContextChunk } from '@mpw/shared';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  provider?: string;
}

/** Global AI sidebar — ContextService feeds it, AiGateway answers (PRODUCT_SPEC §4.5). */
export function AiPanel(): React.ReactElement {
  const { kernel, aiPanelOpen, refresh } = useApp();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCtx, setShowCtx] = useState(true);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
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
  const providerLabel = kernel.ai.listProviders().find((p) => p.id === kernel.settings.get('ai.provider', 'demo'))?.label ?? 'Demo (offline)';

  const toggleProvider = (key: string): void => {
    const next = !consent[key];
    kernel.context.setEnabled(key, next);
    kernel.settings.set('ai.context.disabled', kernel.context.consentSnapshot());
    setConsent((c) => ({ ...c, [key]: next }));
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const chunks: ContextChunk[] = await kernel.context.getActiveContext();
      const active = chunks.filter((c) => consent[`${c.source}/${c.id}`] !== false);
      const result: AiResult = await kernel.ai.run(text, { context: active });
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          text: result.text,
          provider: `${result.provider}${active.length > 0 ? ` · ${active.length} context source${active.length > 1 ? 's' : ''}` : ''}`,
        },
      ]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'assistant', text: `⚠ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <Icon name="sparkles" size={15} />
        AI Assistant
        <span className="badge gray" style={{ marginLeft: 4 }}>{providerLabel}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Context sources" onClick={() => setShowCtx((v) => !v)}>
          <Icon name="link" size={14} />
        </button>
      </div>
      {showCtx && providers.length > 0 && (
        <div className="ai-chips" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {providers.map((p) => (
            <span key={p.key} className={`chip${consent[p.key] ? ' on' : ''}`} onClick={() => toggleProvider(p.key)} title="Toggle context sharing">
              <Icon name={consent[p.key] ? 'check' : 'x'} size={11} />
              {p.label}
            </span>
          ))}
        </div>
      )}
      <div className="ai-msgs" ref={msgsRef}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            <Icon name="sparkles" size={24} />
            <div>
              Ask anything. With your permission, the assistant can see the context you have open — notes,
              references, email, documents.
            </div>
            <div style={{ fontSize: 11.5 }}>
              e.g. “Summarize the papers I recently read about image fusion”
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.text}
            {m.provider && <span className="ai-src">{m.provider}</span>}
          </div>
        ))}
        {busy && <div className="ai-msg assistant">…</div>}
      </div>
      <div className="ai-input">
        <textarea
          className="input"
          placeholder="Ask the assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" disabled={busy} onClick={() => void send()}>
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}
