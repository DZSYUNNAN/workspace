import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import DOMPurify from 'dompurify';

const exec = (cmd: string, value?: string): void => {
  document.execCommand(cmd, false, value);
};

function ToolBtn(props: { cmd: string; arg?: string; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      className="btn sm"
      title={props.title}
      onMouseDown={(e) => {
        e.preventDefault();
        exec(props.cmd, props.arg);
      }}
    >
      {props.children}
    </button>
  );
}

/** Mode A editor: Word-like rich text on contenteditable, HTML persisted. */
export function RichEditor(props: {
  ctx: PluginContext;
  value: string;
  onChange: (html: string) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const { ctx } = props;

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== props.value) el.innerHTML = DOMPurify.sanitize(props.value);
  }, [props.value]);

  const onInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // sanitize what we persist; DOM stays as the browser rendered it
    props.onChange(DOMPurify.sanitize(el.innerHTML));
  }, [props.onChange]);

  const onSelect = (): void => {
    const sel = window.getSelection();
    const text = sel?.toString() ?? '';
    if (!sel || sel.isCollapsed || text.trim().length < 3) {
      setSelMenu(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = ref.current?.getBoundingClientRect();
    setSelMenu({
      x: rect.left - (host?.left ?? 0) + rect.width / 2,
      y: rect.top - (host?.top ?? 0) - 8,
      text,
    });
  };

  const runAi = async (label: string, buildPrompt: (sel: string) => string, insert: 'replace' | 'below' | 'none'): Promise<void> => {
    if (!selMenu || aiBusy) return;
    setAiBusy(true);
    const sel = selMenu.text;
    setSelMenu(null);
    try {
      const result = await ctx.ai.run(buildPrompt(sel));
      const el = ref.current;
      if (!el) return;
      if (insert === 'replace') {
        document.execCommand('insertText', false, result.text);
      } else if (insert === 'below') {
        el.innerHTML += `<p>${DOMPurify.sanitize(result.text)}</p>`;
      }
      onInput();
    } catch (err) {
      ctx.ui.notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const aiActions = [
    { label: 'Polish', system: 'polish this text.' },
    { label: 'Academic Rewrite', system: 'rewrite in formal academic style this text.' },
    { label: 'Expand', system: 'expand this text.' },
    { label: 'Shorten', system: 'shorten this text.' },
    { label: 'Summarize', system: 'summarize this text.' },
    { label: 'EN→中文', system: 'translate to chinese this text.' },
    { label: '中文→EN', system: 'translate to english this text.' },
    { label: 'Grammar', system: 'polish and grammar check this text.' },
    { label: 'LaTeX', system: 'generate latex this text.' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
      <div className="widget-toolbar" style={{ gap: 3 }}>
        <ToolBtn cmd="formatBlock" arg="H1" title="Heading 1"><b style={{ fontSize: 13 }}>H1</b></ToolBtn>
        <ToolBtn cmd="formatBlock" arg="H2" title="Heading 2"><b style={{ fontSize: 12 }}>H2</b></ToolBtn>
        <ToolBtn cmd="formatBlock" arg="H3" title="Heading 3"><b style={{ fontSize: 11 }}>H3</b></ToolBtn>
        <ToolBtn cmd="formatBlock" arg="P" title="Body text">¶</ToolBtn>
        <span style={{ width: 6 }} />
        <ToolBtn cmd="bold" title="Bold"><b>B</b></ToolBtn>
        <ToolBtn cmd="italic" title="Italic"><i>I</i></ToolBtn>
        <ToolBtn cmd="underline" title="Underline"><u>U</u></ToolBtn>
        <span style={{ width: 6 }} />
        <ToolBtn cmd="insertUnorderedList" title="Bullet list">•≡</ToolBtn>
        <ToolBtn cmd="insertOrderedList" title="Numbered list">1≡</ToolBtn>
        <ToolBtn cmd="justifyLeft" title="Align left">⇤</ToolBtn>
        <ToolBtn cmd="justifyCenter" title="Center">⇔</ToolBtn>
        <ToolBtn cmd="justifyRight" title="Align right">⇥</ToolBtn>
        <span style={{ width: 6 }} />
        <button
          className="btn sm"
          title="Insert table"
          onMouseDown={(e) => {
            e.preventDefault();
            exec('insertHTML', '<table><tr><th>Column A</th><th>Column B</th></tr><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></table><p></p>');
          }}
        >
          <Icon name="table" size={12} />
        </button>
        <ToolBtn cmd="formatBlock" arg="BLOCKQUOTE" title="Quote">❝</ToolBtn>
        <ToolBtn cmd="undo" title="Undo">↩</ToolBtn>
      </div>
      <div
        ref={ref}
        className="rte"
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onMouseUp={onSelect}
        onKeyUp={onSelect}
        onBlur={() => setSelMenu(null)}
      />
      {selMenu && (
        <div className="sel-menu" style={{ left: Math.max(10, selMenu.x - 160), top: Math.max(46, selMenu.y + 40) }}>
          {aiActions.map((a) => (
            <button
              key={a.label}
              disabled={aiBusy}
              onClick={() =>
                void runAi(
                  a.label,
                  (sel) => sel,
                  a.label === 'LaTeX' ? 'below' : 'replace'
                )
              }
            >
              {aiBusy ? '…' : a.label}
            </button>
          ))}
          <button onClick={() => setSelMenu(null)}>×</button>
        </div>
      )}
    </div>
  );
}
