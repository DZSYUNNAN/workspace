import React, { useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';

/** In-canvas AI chat widget (the shell also has a global AI sidebar panel). */
export function ChatWidget(props: { ctx: PluginContext }): React.ReactElement {
  const { ctx } = props;
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [msgs]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const result = await ctx.ai.run(text);
      setMsgs((m) => [...m, { role: 'assistant', text: result.text }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'assistant', text: `⚠ ${err instanceof Error ? err.message : err}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="widget" style={{ height: '100%' }}>
      <div className="ai-msgs" ref={boxRef}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            <Icon name="sparkles" size={22} />
            <div>Ask anything — answers land right in your workspace.</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>{m.text}</div>
        ))}
        {busy && <div className="ai-msg assistant">…</div>}
      </div>
      <div className="ai-input">
        <textarea
          className="input"
          placeholder="Ask…"
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
          <Icon name="send" size={13} />
        </button>
      </div>
    </div>
  );
}
