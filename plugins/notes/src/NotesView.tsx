import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { backlinks, createNote, parseTags, softDeleteNote, type NoteRecord } from './store';
import { renderMarkdown } from './markdown';

export function NotesView(props: {
  ctx: PluginContext;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  compact?: boolean;
}): React.ReactElement {
  const { ctx, activeId, setActiveId, compact } = props;
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<{ title: string; body: string; tags: string }>({ title: '', body: '', tags: '' });
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split');
  const saveTimer = useRef<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [selMenu, setSelMenu] = useState<{ text: string } | null>(null);

  const reload = async (): Promise<void> => {
    const list = await ctx.storage.sql.all<NoteRecord>(
      `SELECT * FROM p_notes_notes WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    setNotes(list);
  };

  useEffect(() => {
    void reload();
    const off = ctx.events.on('notes:changed', () => void reload());
    const offOpen = ctx.events.on('ui:open:mpw.notes', (p) => {
      const id = (p as { hit?: { id: string } }).hit?.id.split(':').pop();
      if (id) setActiveId(id);
    });
    return () => {
      off();
      offOpen();
    };
  }, []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  useEffect(() => {
    setDraft({
      title: active?.title ?? '',
      body: active?.body_md ?? '',
      tags: parseTags(active?.tags ?? '[]').join(', '),
    });
  }, [activeId]);

  const scheduleSave = (): void => {
    if (!active) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const fields: Record<string, unknown> = {};
      if (draft.title !== active.title) fields['title'] = draft.title;
      if (draft.body !== active.body_md) fields['body_md'] = draft.body;
      const tagJson = JSON.stringify(draft.tags.split(',').map((t) => t.trim()).filter(Boolean));
      if (tagJson !== active.tags) fields['tags'] = tagJson;
      if (Object.keys(fields).length === 0) return;
      const sets = Object.keys(fields).map((k) => `${k} = ?`);
      const params = Object.values(fields);
      await ctx.storage.sql.exec(
        `UPDATE p_notes_notes SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`,
        [...params, Date.now(), active.id]
      );
      ctx.events.emit('notes:changed', { id: active.id });
    }, 450);
  };

  useEffect(() => {
    scheduleSave();
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body_md.toLowerCase().includes(q) ||
        parseTags(n.tags).some((t) => t.toLowerCase().includes(q))
    );
  }, [notes, filter]);

  const linksBack = useMemo(() => (active ? backlinksSync(notes, active.title) : []), [notes, activeId]);

  const runAi = async (kind: string): Promise<void> => {
    if (!selMenu || aiBusy || !selMenu.text) return;
    setAiBusy(true);
    const text = selMenu.text;
    setSelMenu(null);
    try {
      const result = await ctx.ai.run(text, { system: `${kind} the following text.` });
      setDraft((d) => ({ ...d, body: d.body.replace(text, result.text) }));
    } catch (err) {
      ctx.ui.notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const openOrCreate = async (title: string): Promise<void> => {
    const existing = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const n = await createNote(ctx, title);
    await reload();
    setActiveId(n.id);
  };

  return (
    <div className="notes-split">
      <div className="notes-side" style={compact ? { width: 150 } : undefined}>
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <input className="input" style={{ flex: 1, minWidth: 50 }} placeholder="筛选…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button
            className="btn sm primary"
            title="新建笔记"
            onClick={async () => {
              const n = await createNote(ctx, 'Untitled note');
              await reload();
              setActiveId(n.id);
            }}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div className="list">
          {filtered.map((n) => (
            <button key={n.id} className={`list-row${n.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(n.id)}>
              <Icon name="note" size={13} />
              <span className="lr-title">{n.title}</span>
              <span className="lr-meta">{new Date(n.updated_at).toLocaleDateString()}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-state">暂无笔记</div>}
        </div>
      </div>

      <div className="note-editor-wrap" style={{ position: 'relative' }}>
        {active ? (
          <>
            <div className="widget-toolbar">
              <input
                className="input"
                style={{ flex: 1, fontWeight: 600, fontSize: 14 }}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              {(['edit', 'split', 'preview'] as const).map((m) => (
                <button key={m} className={`btn sm${mode === m ? ' primary' : ''}`} onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
              <button
                className="btn sm danger"
                onClick={async () => {
                  await softDeleteNote(ctx, active.id);
                  setActiveId(null);
                  ctx.events.emit('notes:changed', {});
                  await reload();
                }}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: mode === 'split' ? 'flex' : 'block' }}>
              {mode !== 'preview' && (
                <textarea
                  className="input"
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 0,
                    resize: 'none',
                    fontFamily: 'ui-monospace, Consolas, monospace',
                    fontSize: 12.8,
                    lineHeight: 1.6,
                    padding: 16,
                    outline: 'none',
                  }}
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  onSelect={(e) => {
                    const ta = e.currentTarget;
                    const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
                    setSelMenu(text.trim().length >= 3 ? { text } : null);
                  }}
                  placeholder="Markdown…用 [[笔记名]] 链接笔记,$x^2$ 插入公式。"
                />
              )}
              {mode !== 'edit' && (
                <div
                  className="md"
                  style={{ flex: 1, overflow: 'auto', borderLeft: mode === 'split' ? '1px solid var(--border)' : undefined }}
                  onClick={(e) => {
                    const t = (e.target as HTMLElement).closest('.wikilink');
                    if (t) void openOrCreate(decodeURIComponent((t as HTMLElement).dataset.target ?? ''));
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body) }}
                />
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', padding: '4px 12px', fontSize: 11.5, color: 'var(--text-3)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 11.5, padding: '2px 8px' }}
                placeholder="标签(逗号分隔)"
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
              />
              {linksBack.length > 0 && (
                <span title={linksBack.map((b) => b.title).join(', ')}>
                  <Icon name="link" size={11} /> {linksBack.length} 条反向链接
                </span>
              )}
            </div>
            {selMenu && (
              <div className="sel-menu" style={{ right: 30, top: 60 }}>
                {['Polish', 'Expand', 'Shorten', 'Summarize'].map((k) => (
                  <button key={k} disabled={aiBusy} onClick={() => void runAi(k.toLowerCase())}>
                    {aiBusy ? '…' : k}
                  </button>
                ))}
                <button onClick={() => setSelMenu(null)}>×</button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="note" size={26} />
            <div>选择或新建笔记</div>
            <div style={{ fontSize: 11.5 }}>Markdown · [[双向链接]] · 公式 · 标签 · 反向链接</div>
          </div>
        )}
      </div>
    </div>
  );
}

function backlinksSync(notes: NoteRecord[], title: string): NoteRecord[] {
  const re = new RegExp(`\\[\\[${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`);
  return notes.filter((n) => re.test(n.body_md) && n.title !== title);
}
