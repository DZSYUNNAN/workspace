import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import type { SearchHit } from '@mpw/shared';

/** Global command + search palette (Ctrl+K). */
export function SearchPalette(): React.ReactElement | null {
  const { kernel, navigate, setAiPanelOpen, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<{ label: string; hits: SearchHit[] }[]>([]);
  const [commands, setCommands] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = (): void => {
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    };
    kernel.events.on('ui:openSearch', onOpen);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kernel]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 30);
    const query = q.trim();
    const t = window.setTimeout(async () => {
      if (!query) {
        setGroups([]);
        setCommands(kernel.availableCommands().slice(0, 8).map((c) => ({ id: c.id, title: c.title })));
        setSel(0);
        return;
      }
      setCommands(
        kernel
          .availableCommands()
          .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 5)
          .map((c) => ({ id: c.id, title: c.title }))
      );
      const res = await kernel.search.searchAll(query, 6);
      setGroups(res);
      setSel(0);
    }, 160);
    return () => window.clearTimeout(t);
  }, [q, open, kernel]);

  if (!open) return null;

  const flat: ({ kind: 'cmd'; cmd: { id: string; title: string } } | { kind: 'hit'; hit: SearchHit })[] = [
    ...commands.map((c) => ({ kind: 'cmd' as const, cmd: c })),
    ...groups.flatMap((g) => g.hits.map((h) => ({ kind: 'hit' as const, hit: h }))),
  ];

  const activate = async (item: (typeof flat)[number]): Promise<void> => {
    setOpen(false);
    if (item.kind === 'cmd') {
      try {
        await kernel.commands.execute(item.cmd.id);
        refresh();
      } catch (err) {
        kernel.events.emit('notify', { message: String(err instanceof Error ? err.message : err), kind: 'error' });
      }
      return;
    }
    setQ('');
    // route to the owning plugin's primary view and ask it to open the entity
    navigate({ type: 'pluginRoute', key: `${item.hit.pluginId}/main` });
    kernel.events.emit(`ui:open:${item.hit.pluginId}`, { hit: item.hit });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && flat[sel]) {
      void activate(flat[sel] as never);
    }
  };

  let idx = -1;
  return (
    <div className="palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog">
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={q}
            placeholder="Search notes, references, email, documents, files… or run a command"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results">
          {commands.length > 0 && !q.trim() && <div className="palette-group">Commands</div>}
          {commands.map((c) => {
            idx++;
            return (
              <button
                key={c.id}
                className={`palette-hit${idx === sel ? ' sel' : ''}`}
                onMouseEnter={() => setSel(idx)}
                onClick={() => void activate({ kind: 'cmd', cmd: c })}
              >
                <Icon name="zap" size={14} />
                <span>{c.title}</span>
                <span className="ph-snippet">{c.id}</span>
              </button>
            );
          })}
          {groups.map((g) => (
            <React.Fragment key={g.label}>
              <div className="palette-group">{g.label}</div>
              {g.hits.map((h) => {
                idx++;
                return (
                  <button
                    key={h.id}
                    className={`palette-hit${idx === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => void activate({ kind: 'hit', hit: h })}
                  >
                    <Icon name="file" size={14} />
                    <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{h.title}</span>
                    <span className="ph-snippet">{h.snippet}</span>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          {q.trim() && flat.length === 0 && <div className="palette-empty">No results for “{q}”</div>}
        </div>
      </div>
    </div>
  );
}
