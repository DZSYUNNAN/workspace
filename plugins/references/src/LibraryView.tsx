import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { formatAuthors } from '@mpw/shared';
import {
  addToCollection,
  createCollection,
  getRef,
  insertRef,
  listCollections,
  listRefs,
  parseAuthors,
  parseStringArray,
  softDeleteRef,
  updateRef,
  type CollectionRecord,
  type RefRecord,
} from './store';
import { fetchDoi, parseBibtex, parseRis } from './parsers';
import { formatCitation, type CitationRecord, type CitationStyle } from './citations';
import { PdfReader } from './PdfReader';

type ImportTab = 'bibtex' | 'ris' | 'doi' | 'manual';

export function LibraryView(props: {
  ctx: PluginContext;
  compact?: boolean;
  onSelectedChange?: (id: string | null) => void;
}): React.ReactElement {
  const { ctx } = props;
  const [refs, setRefs] = useState<RefRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const setSelectedId = (id: string | null): void => {
    setSelectedIdState(id);
    props.onSelectedChange?.(id);
  };
  const [filter, setFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = async (): Promise<void> => {
    setRefs(await listRefs(ctx, collectionId ?? undefined));
    setCollections(await listCollections(ctx));
  };

  useEffect(() => {
    void reload();
    const offs = [
      ctx.events.on('refs:changed', () => void reload()),
      ctx.events.on('refs:openImport', () => setImportOpen(true)),
      ctx.events.on('ui:open:mpw.references', (p) => {
        const hit = (p as { hit?: { id: string } }).hit;
        if (hit) {
          const id = hit.id.split(':').pop() ?? null;
          setSelectedId(id);
          setReaderOpen(false);
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [collectionId]);

  const selected = refs.find((r) => r.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return refs;
    return refs.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.authors.toLowerCase().includes(q) ||
        r.venue.toLowerCase().includes(q) ||
        parseStringArray(r.tags).some((t) => t.toLowerCase().includes(q))
    );
  }, [refs, filter]);

  const citation = (r: RefRecord): CitationRecord => ({
    citationKey: r.citation_key,
    entryType: r.entry_type,
    title: r.title,
    authors: parseAuthors(r.authors),
    venue: r.venue,
    year: r.year,
    doi: r.doi,
    volume: r.volume,
    number: r.number,
    pages: r.pages,
    publisher: r.publisher,
  });

  const copy = async (style: CitationStyle): Promise<void> => {
    if (!selected) return;
    const text = formatCitation(style, citation(selected));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(style);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      ctx.ui.notify('当前浏览器剪贴板不可用', 'warn');
    }
  };

  const attachPdf = async (file: File): Promise<void> => {
    if (!selected) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blob = await ctx.blobs.put(`references/${file.name}`, bytes, 'application/pdf');
    await updateRef(ctx, selected.id, { blob_ref: blob.ref, file_name: file.name });
    ctx.events.emit('refs:changed', { id: selected.id });
    ctx.ui.notify(`已附加 ${file.name}`, 'success');
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* library list */}
      <div className="notes-side" style={props.compact ? { width: 170 } : undefined}>
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <input className="input" style={{ flex: 1, minWidth: 50 }} placeholder="搜索文献库…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn sm primary" title="导入文献" onClick={() => setImportOpen(true)}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div style={{ padding: '2px 6px' }}>
          <button className={`mail-folder-btn${collectionId === null ? ' active' : ''}`} style={{ width: '100%' }} onClick={() => setCollectionId(null)}>
            <Icon name="book" size={13} /> 全部 ({refs.length})
          </button>
          {collections.map((c) => (
            <button key={c.id} className={`mail-folder-btn${collectionId === c.id ? ' active' : ''}`} style={{ width: '100%' }} onClick={() => setCollectionId(c.id)}>
              <Icon name="folder" size={13} /> {c.name}
            </button>
          ))}
          <button
            className="mail-folder-btn"
            style={{ width: '100%', color: 'var(--text-3)' }}
            onClick={async () => {
              const name = window.prompt('新建文献集合名称');
              if (name) {
                await createCollection(ctx, name);
                await reload();
              }
            }}
          >
            <Icon name="plus" size={13} /> 新建集合
          </button>
        </div>
        <div className="list">
          {filtered.map((r) => (
            <button key={r.id} className={`list-row${r.id === selectedId ? ' active' : ''}`} onClick={() => { setSelectedId(r.id); setReaderOpen(false); }}>
              <Icon name={r.blob_ref ? 'pdf' : 'book'} size={13} />
              <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span className="lr-title">{r.title}</span>
                <span className="lr-sub">{formatAuthors(parseAuthors(r.authors), 2)}{r.year ? ` · ${r.year}` : ''}</span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-state">文献库还是空的<br /><span style={{ fontSize: 11 }}>支持导入 BibTeX / RIS / DOI,或手动添加</span></div>}
        </div>
      </div>

      {/* detail */}
      <div className="ref-detail">
        {selected ? (
          <>
            {readerOpen && selected.blob_ref ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <button className="btn sm" style={{ alignSelf: 'flex-start', marginBottom: 8 }} onClick={() => setReaderOpen(false)}>
                  ← 返回详情
                </button>
                <PdfReader ctx={ctx} blobRef={selected.blob_ref} fileName={selected.file_name} />
              </div>
            ) : (
              <>
                <h3>{selected.title}</h3>
                <div className="ref-meta">
                  {formatAuthors(parseAuthors(selected.authors))} {selected.venue ? `· ${selected.venue}` : ''} {selected.year ? `· ${selected.year}` : ''}
                  {selected.doi ? ` · doi:${selected.doi}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className="badge gray">{selected.entry_type}</span>
                  {parseStringArray(selected.tags).map((t) => (
                    <span key={t} className="badge">{t}</span>
                  ))}
                  <input
                    className="input"
                    style={{ fontSize: 11, padding: '1px 8px', width: 110 }}
                    placeholder="+ 标签"
                    onKeyDown={async (e) => {
                      if (e.key !== 'Enter') return;
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (!v) return;
                      const tags = parseStringArray(selected.tags);
                      if (!tags.includes(v)) tags.push(v);
                      await updateRef(ctx, selected.id, { tags: JSON.stringify(tags) });
                      (e.target as HTMLInputElement).value = '';
                      ctx.events.emit('refs:changed', { id: selected.id });
                    }}
                  />
                </div>

                {selected.abstract && <p style={{ fontSize: 12.8, color: 'var(--text-2)', lineHeight: 1.6 }}>{selected.abstract}</p>}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                  {selected.blob_ref ? (
                    <button className="btn sm primary" onClick={() => setReaderOpen(true)}>
                      <Icon name="pdf" size={13} /> 打开 PDF 阅读
                    </button>
                  ) : (
                    <button className="btn sm" onClick={() => fileInput.current?.click()}>
                      <Icon name="upload" size={13} /> 附件 PDF
                    </button>
                  )}
                  <select
                    className="input"
                    style={{ fontSize: 12 }}
                    value=""
                    onChange={async (e) => {
                      const cid = e.target.value;
                      if (cid) {
                        await addToCollection(ctx, cid, selected.id);
                        ctx.ui.notify('已加入集合', 'success');
                      }
                    }}
                  >
                    <option value="">加入集合…</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn sm danger"
                    onClick={async () => {
                      await softDeleteRef(ctx, selected.id);
                      setSelectedId(null);
                      ctx.events.emit('refs:changed', {});
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
                <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await attachPdf(f);
                  e.target.value = '';
                }} />

                <h2 style={{ fontSize: 13, color: 'var(--text-2)' }}>引用格式</h2>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {(['bibtex', 'ieee', 'apa', 'gbt7714'] as CitationStyle[]).map((s) => (
                    <button key={s} className="btn sm" onClick={() => void copy(s)}>
                      {copied === s ? '已复制 ✓' : s.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="cite-block">{formatCitation('bibtex', citation(selected))}</div>
                <div style={{ height: 8 }} />
                <div className="cite-block">{formatCitation('gbt7714', citation(selected))}</div>

                <h2 style={{ fontSize: 13, color: 'var(--text-2)' }}>阅读笔记</h2>
                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: 90, resize: 'vertical' }}
                  placeholder="阅读笔记…"
                  defaultValue={selected.notes}
                  onBlur={async (e) => {
                    if (e.target.value !== selected.notes) {
                      await updateRef(ctx, selected.id, { notes: e.target.value });
                      ctx.events.emit('refs:changed', { id: selected.id });
                    }
                  }}
                />
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="book" size={26} />
            <div>选择一篇文献</div>
            <div style={{ fontSize: 11.5 }}>元数据 · 引文(BibTeX/IEEE/APA/GB-T 7714)· PDF 阅读 · 笔记</div>
          </div>
        )}
      </div>

      {importOpen && (
        <ImportDialog
          ctx={ctx}
          onClose={() => setImportOpen(false)}
          onImported={async (ids) => {
            setImportOpen(false);
            await reload();
            if (ids.length > 0) setSelectedId(ids[0] as string);
          }}
        />
      )}
    </div>
  );
}

function ImportDialog(props: {
  ctx: PluginContext;
  onClose: () => void;
  onImported: (ids: string[]) => Promise<void>;
}): React.ReactElement {
  const { ctx } = props;
  const [tab, setTab] = useState<ImportTab>('bibtex');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const doImport = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const ids: string[] = [];
      if (tab === 'bibtex') {
        const parsed = parseBibtex(text);
        if (parsed.length === 0) throw new Error('未找到 BibTeX 条目');
        for (const raw of parsed) ids.push((await insertRef(ctx, raw)).id);
      } else if (tab === 'ris') {
        const parsed = parseRis(text);
        if (parsed.length === 0) throw new Error('未找到 RIS 记录');
        for (const raw of parsed) ids.push((await insertRef(ctx, raw)).id);
      } else if (tab === 'doi') {
        const dois = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
        for (const doi of dois) ids.push((await insertRef(ctx, await fetchDoi(doi))).id);
      } else {
        const title = text.trim();
        if (!title) throw new Error('请输入标题');
        const raw = {
          entryType: 'article', citationKey: title.toLowerCase().split(/\s+/)[0] ?? 'ref',
          title, authors: [], venue: '', year: null, doi: '', abstract: '', keywords: [],
          volume: '', number: '', pages: '', publisher: '',
        };
        ids.push((await insertRef(ctx, raw)).id);
      }
      ctx.events.emit('refs:changed', {});
      ctx.ui.notify(`已导入 ${ids.length} 篇文献`, 'success');
      await props.onImported(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="compose" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="compose-card">
        <div className="widget-toolbar">
          <b>导入文献</b>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={props.onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="cc-body">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['bibtex', 'ris', 'doi', 'manual'] as ImportTab[]).map((t) => (
              <button key={t} className={`btn sm${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>
                {t === 'doi' ? 'DOI(联网)' : t === 'manual' ? '手动添加' : t.toUpperCase()}
              </button>
            ))}
          </div>
          {tab !== 'manual' ? (
            <textarea
              className="input"
              style={{ height: 180, resize: 'none', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
              placeholder={
                tab === 'bibtex'
                  ? '@article{key, title = {…}, author = {…}, year = {2023}}'
                  : tab === 'ris'
                    ? 'TY  - JOUR\nTI  - 标题\nAU  - 作者\nER  -'
                    : '10.1038/s41586-021-03819-2'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
            <input className="input" placeholder="文献标题" value={text} onChange={(e) => setText(e.target.value)} />
          )}
          {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={props.onClose}>取消</button>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void doImport()}>
              {busy ? '导入中…' : '导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { getRef };
