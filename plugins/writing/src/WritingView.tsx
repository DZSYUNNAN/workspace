import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { createDoc, listDocs, softDeleteDoc, updateDoc, type DocRecord } from './store';
import { RichEditor } from './RichEditor';
import { LatexEditor } from './LatexEditor';
import { downloadBlob, htmlToDocxBlob } from './docx';

export function WritingView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: '', content: '' });
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const reload = async (): Promise<void> => {
    setDocs(await listDocs(ctx));
  };

  useEffect(() => {
    void reload();
    const off = ctx.events.on('docs:changed', () => void reload());
    return off;
  }, []);

  const active = docs.find((d) => d.id === activeId) ?? null;

  useEffect(() => {
    setDraft({ title: active?.title ?? '', content: active?.content ?? '' });
    setDirty(false);
  }, [activeId]);

  const scheduleSave = (): void => {
    if (!active) return;
    setDirty(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const fields: Record<string, unknown> = {};
      if (draft.title !== active.title) fields['title'] = draft.title;
      if (draft.content !== active.content) fields['content'] = draft.content;
      if (Object.keys(fields).length === 0) {
        setDirty(false);
        return;
      }
      const sets = Object.keys(fields).map((k) => `${k} = ?`);
      await ctx.storage.sql.exec(
        `UPDATE p_writing_documents SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`,
        [...Object.values(fields), Date.now(), active.id]
      );
      setDirty(false);
      ctx.events.emit('docs:changed', { id: active.id });
    }, 600);
  };

  useEffect(() => {
    scheduleSave();
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft]);

  const exportDocx = async (): Promise<void> => {
    if (!active) return;
    try {
      const blob = await htmlToDocxBlob(draft.content, draft.title || 'document');
      downloadBlob(blob, `${(draft.title || 'document').replace(/[^\w\u4e00-\u9fff-]+/g, '_')}.docx`);
      ctx.ui.notify('Exported .docx', 'success');
    } catch (err) {
      ctx.ui.notify(`Export failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  const words = useMemo(() => {
    if (!active) return 0;
    if (active.mode === 'rich') {
      return draft.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    }
    return draft.content.split(/\s+/).filter(Boolean).length;
  }, [draft, active]);

  return (
    <div className="notes-split">
      <div className="notes-side" style={props.compact ? { width: 150 } : undefined}>
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1 }}>{docs.length} documents</span>
          <button
            className="btn sm primary"
            title="New rich document"
            onClick={async () => {
              const d = await createDoc(ctx, 'Untitled document', 'rich');
              await reload();
              setActiveId(d.id);
            }}
          >
            <Icon name="pen" size={12} />
          </button>
          <button
            className="btn sm"
            title="New LaTeX project file"
            onClick={async () => {
              const d = await createDoc(ctx, 'Untitled.tex', 'latex');
              await reload();
              setActiveId(d.id);
            }}
          >
            <Icon name="code" size={12} />
          </button>
        </div>
        <div className="list">
          {docs.map((d) => (
            <button key={d.id} className={`list-row${d.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(d.id)}>
              <Icon name={d.mode === 'latex' ? 'code' : 'pen'} size={13} />
              <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span className="lr-title">{d.title}</span>
                <span className="lr-sub">{d.mode === 'latex' ? 'LaTeX' : 'Rich text'} · {new Date(d.updated_at).toLocaleDateString()}</span>
              </span>
            </button>
          ))}
          {docs.length === 0 && (
            <div className="empty-state">
              No documents
              <span style={{ fontSize: 11 }}>Mode A: Word-like · Mode B: LaTeX</span>
            </div>
          )}
        </div>
      </div>

      <div className="note-editor-wrap">
        {active ? (
          <>
            <div className="widget-toolbar">
              <input
                className="input"
                style={{ flex: 1, fontWeight: 600 }}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <span className="badge gray">{active.mode === 'latex' ? 'LaTeX' : 'Rich'}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {dirty ? 'saving…' : `${words} words`}
              </span>
              {active.mode === 'rich' && (
                <button className="btn sm primary" onClick={() => void exportDocx()}>
                  <Icon name="download" size={12} /> .docx
                </button>
              )}
              <button
                className="btn sm danger"
                onClick={async () => {
                  await softDeleteDoc(ctx, active.id);
                  setActiveId(null);
                  ctx.events.emit('docs:changed', {});
                  await reload();
                }}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            {active.mode === 'rich' ? (
              <RichEditor ctx={ctx} value={draft.content} onChange={(html) => setDraft((d) => ({ ...d, content: html }))} />
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <LatexEditor value={draft.content} onChange={(v) => setDraft((d) => ({ ...d, content: v }))} />
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="pen" size={26} />
            <div>Create or select a document</div>
            <div style={{ fontSize: 11.5 }}>Mode A: Word-like rich text with .docx export · Mode B: LaTeX with live preview</div>
          </div>
        )}
      </div>
    </div>
  );
}
