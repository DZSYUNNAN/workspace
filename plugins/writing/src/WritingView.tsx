import React, { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon, ResizeHandle } from '@mpw/ui';
import { escapeHtml, LAYOUT_CONTROL_APPLY, type LocalDocuments, type LocalDocumentSession } from '@mpw/shared';
import { LocalDocumentEditor } from './LocalDocumentEditor';
import {
  addFile,
  createDoc,
  deleteFile,
  getDoc,
  listDocs,
  listFiles,
  saveFile,
  softDeleteDoc,
  updateDoc,
  type DocRecord,
  type FileRecord,
} from './store';
import { RichEditor } from './RichEditor';
import { LatexEditor } from './LatexEditor';
import { downloadBlob, htmlToDocxBlob } from './docx';

export function WritingView(props: { ctx: PluginContext; compact?: boolean; onSelectedChange?: (id: string | null) => void; onLocalSessionChange?: (session: LocalDocumentSession | null) => void; onLocalSelectionChange?: (text: string) => void }): React.ReactElement {
  const { ctx } = props;
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [activeId, selectActiveId] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalDocuments | null>(null);
  const [activeLocal, setActiveLocal] = useState<LocalDocumentSession | null>(null);
  const [, redrawLocal] = useState(0);
  const [openingLocal, setOpeningLocal] = useState(false);
  const setActiveId = (id: string | null): void => { setActiveLocal(null); props.onLocalSessionChange?.(null); props.onLocalSelectionChange?.(''); selectActiveId(id); };
  useEffect(() => {
    let dispose: (() => void) | undefined; let cancelled = false;
    void ctx.commands.execute('workspace.localDocuments').then((value) => {
      if (cancelled) return; const manager = value as LocalDocuments; setLocal(manager);
      dispose = manager.subscribe(() => redrawLocal((n) => n + 1));
    }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, [ctx]);
  useEffect(() => () => { props.onLocalSessionChange?.(null); props.onLocalSelectionChange?.(''); }, []);
  const openLocal = async (): Promise<void> => {
    if (!local) { ctx.ui.notify('请使用更新后的完整工作台打开本地文档', 'warn'); return; }
    setOpeningLocal(true);
    try { const session = await local.open(); if (session) { setActiveLocal(session); props.onSelectedChange?.(null); props.onLocalSessionChange?.(session); props.onLocalSelectionChange?.(''); } }
    catch (e) { ctx.ui.notify(String(e instanceof Error ? e.message : e), 'error'); }
    finally { setOpeningLocal(false); }
  };
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: '', content: '' });
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const [citations, setCitations] = useState<{ id: string; title: string; key: string; text: string; bib: string }[] | null>(null);

  const reload = async (): Promise<void> => setDocs(await listDocs(ctx));

  useEffect(() => {
    void reload();
    const off = ctx.events.on('docs:changed', () => void reload());
    return off;
  }, []);

  const active = docs.find((d) => d.id === activeId) ?? null;

  // 载入 LaTeX 工程文件
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!activeId || active?.mode !== 'latex') {
        setFiles([]);
        setActiveFileId(null);
        return;
      }
      const list = await listFiles(ctx, activeId);
      if (cancelled) return;
      setFiles(list);
      setActiveFileId((prev) => (prev && list.some((f) => f.id === prev) ? prev : (list[0]?.id ?? null)));
      // 兼容 v1 数据:content 里已有主文件但 files 表为空 → 迁移
      if (list.length === 0 && active?.content) {
        const { addFile, saveFile } = await import('./store');
        const f = await addFile(ctx, activeId, 'main.tex');
        await saveFile(ctx, f.id, active.content);
        if (cancelled) return;
        setFiles(await listFiles(ctx, activeId));
        setActiveFileId(f.id);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId, active?.mode]);

  const activeFile = files.find((f) => f.id === activeFileId && f.doc_id === activeId) ?? null;

  useEffect(() => {
    setDraft({ title: active?.title ?? '', content: activeFile?.content ?? active?.content ?? '' });
    setDirty(false);
  }, [activeId, activeFileId, !!active, !!activeFile]);

  const updateDraft = (updater: (value: typeof draft) => typeof draft): void => {
    const next = updater(draft);
    setDraft(next);
    if (!active) return;
    setDirty(true);
    const writes = [updateDoc(ctx, active.id, { title: next.title, ...(active.mode === 'rich' || activeFile?.name === 'main.tex' ? { content: next.content } : {}) })];
    if (active.mode === 'latex' && activeFile) {
      writes.push(saveFile(ctx, activeFile.id, next.content));
      setFiles((list) => list.map((f) => f.id === activeFile.id ? { ...f, content: next.content } : f));
    }
    void Promise.all(writes).then(() => {
      setDirty(false); ctx.events.emit('docs:changed', { id: active.id });
    }).catch((e) => ctx.ui.notify(String(e), 'error'));
  };
  useEffect(() => { props.onSelectedChange?.(activeId); if (activeId) void ctx.storage.set('ui.openId', activeId); }, [activeId]);
  useEffect(() => {
    const requested = ctx.storage.get<string | null>('ui.openId', null);
    void requested.then((id) => { if (id) setActiveId(id); });
    return ctx.events.on('ui:open:mpw.writing', (p) => {
      const id = (p as { hit?: { id: string } }).hit?.id.split(':').pop();
      if (id) { void reload(); setActiveId(id); }
    });
  }, []);

  const exportDocx = async (): Promise<void> => {
    if (!active) return;
    const task = ctx.ui.notify('正在导出 .docx…', 'info');
    void task;
    try {
      const blob = await htmlToDocxBlob(draft.content, draft.title || '文档');
      downloadBlob(blob, `${(draft.title || '文档').replace(/[^\w\u4e00-\u9fff-]+/g, '_')}.docx`);
      ctx.ui.notify('已导出 .docx', 'success');
    } catch (err) {
      ctx.ui.notify(`导出失败: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  const compileNative = async (): Promise<void> => {
    if (!active || active.mode !== 'latex') return;
    setCompileMsg(null);
    const engine = (await ctx.settings.get<string>('engine', 'xelatex')) as 'xelatex' | 'lualatex' | 'pdflatex';
    const projectFiles = Object.fromEntries(files.map((f) => [f.name, f.id === activeFileId ? draft.content : f.content]));
    const entry = files.find((f) => f.name === 'main.tex')?.name ?? files.find((f) => f.name.endsWith('.tex'))?.name ?? 'main.tex';
    const source = projectFiles[entry] ?? draft.content;
    const result = await ctx.latex.compile({ source, engine, jobName: 'modudesk', entry, files: projectFiles });
    setCompileMsg(result.log);
    if (result.ok && result.pdfBytes) {
      downloadBlob(new Blob([result.pdfBytes.buffer.slice(result.pdfBytes.byteOffset) as ArrayBuffer], { type: 'application/pdf' }), 'modudesk.pdf');
      ctx.ui.notify('本地编译完成,已下载 PDF', 'success');
    }
  };

  const downloadTex = (): void => {
    if (!active) return;
    downloadBlob(new Blob([draft.content], { type: 'text/x-tex' }), activeFile?.name ?? 'main.tex');
    ctx.ui.notify('已下载 .tex 文件', 'success');
  };

  const words = useMemo(() => {
    if (!active) return 0;
    if (active.mode === 'rich') return draft.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    return draft.content.split(/\s+/).filter(Boolean).length;
  }, [draft, active]);

  return (
    <div className="notes-split">
      <div className="notes-side writing-side">
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1 }}>{docs.length} 篇文档</span>
          <button
            className="btn sm primary"
            title="新建富文本文档"
            onClick={async () => {
              const d = await createDoc(ctx, '未命名文档', 'rich');
              await reload();
              setActiveId(d.id);
            }}
          >
            <Icon name="pen" size={12} />
          </button>
          <button
            className="btn sm"
            title="新建 LaTeX 工程"
            onClick={async () => {
              const d = await createDoc(ctx, '未命名.tex', 'latex');
              await reload();
              setActiveId(d.id);
            }}
          >
            <Icon name="code" size={12} />
          </button>
        </div>
        <div className="list">
          <button className="list-row" disabled={openingLocal} onClick={() => void openLocal()}><Icon name="folder" size={13} />{openingLocal ? '正在打开…' : '选取本地文档'}</button>
          {local?.sessions.map((s) => <button key={s.file.id} className={`list-row${activeLocal === s ? ' active' : ''}`} onClick={() => { setActiveLocal(s); props.onSelectedChange?.(null); props.onLocalSessionChange?.(s); props.onLocalSelectionChange?.(''); }}>
            <Icon name="file" size={13} /><span className="lr-title">{s.file.name}</span><span className="badge gray">{s.phase === 'saved' ? '本地' : s.phase === 'error' ? '同步失败' : '保存中'}</span>
          </button>)}
          {docs.map((d) => (
            <button key={d.id} className={`list-row${d.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(d.id)}>
              <Icon name={d.mode === 'latex' ? 'code' : 'pen'} size={13} />
              <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span className="lr-title">{d.title}</span>
                <span className="lr-sub">{d.mode === 'latex' ? 'LaTeX 工程' : '富文本'} · {new Date(d.updated_at).toLocaleDateString()}</span>
              </span>
            </button>
          ))}
          {docs.length === 0 && (
            <div className="empty-state">
              暂无文档
              <span style={{ fontSize: 11 }}>模式 A:类 Word 富文本 · 模式 B:LaTeX</span>
            </div>
          )}
        </div>
      </div>
      <ResizeHandle onDelta={(delta) => ctx.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'writingListWidth', delta })} title="拖动调整写作文档列表宽度" />

      <div className="note-editor-wrap">
        {activeLocal ? <LocalDocumentEditor key={activeLocal.file.id} ctx={ctx} session={activeLocal} onSelectionChange={props.onLocalSelectionChange} onDetach={async () => { await local?.detach(activeLocal); setActiveLocal(null); props.onLocalSessionChange?.(null); props.onLocalSelectionChange?.(''); props.onSelectedChange?.(activeId); }} /> : active ? (
          <>
            <div className="widget-toolbar">
              <button className="btn sm" onClick={() => void ctx.commands.execute('mpw.references.citations').then((r) => setCitations(r as NonNullable<typeof citations>)).catch(() => ctx.ui.notify('请先启用文献插件', 'warn'))}>插入引用</button>
              <input
                className="input"
                style={{ flex: 1, fontWeight: 600 }}
                value={draft.title}
                onChange={(e) => updateDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <span className="badge gray">{active.mode === 'latex' ? 'LaTeX' : '富文本'}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{dirty ? '保存中…' : `${words} 词`}</span>
              {active.mode === 'rich' && (
                <button className="btn sm primary" onClick={() => void exportDocx()}>
                  <Icon name="download" size={12} /> 导出 .docx
                </button>
              )}
              {active.mode === 'latex' && (
                <>
                  <button className="btn sm" onClick={downloadTex}>
                    <Icon name="download" size={12} /> .tex
                  </button>
                  <button className="btn sm primary" onClick={() => void compileNative()} title={ctx.latex.available() ? '使用本地 TeX 工具链编译' : '需要桌面端(Tauri)与本机 TeX 工具链'}>
                    <Icon name="play" size={12} /> 本地编译 PDF
                  </button>
                </>
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
            {citations && <div className="card" style={{ maxHeight: 220, overflow: 'auto' }}>
              <b>选择文献，追加引用到文档末尾</b><button className="btn sm" onClick={() => setCitations(null)}>关闭</button>
              {citations.length === 0 && <p>请先在文献库导入文献。</p>}
              {citations.map((c) => <button key={c.id} className="list-row" onClick={() => {
                if (active.mode === 'rich') {
                  updateDraft((d) => ({ ...d, content: `${d.content}<p>${escapeHtml(c.text)}</p>` }));
                } else {
                  if (!/^[a-zA-Z0-9_:.+-]+$/.test(c.key)) { ctx.ui.notify('请先为文献设置有效的 BibTeX 引用键', 'warn'); return; }
                  if (!activeFile?.name.endsWith('.tex')) { ctx.ui.notify('请先选择一个 .tex 文件', 'warn'); return; }
                  const cite = `\\cite{${c.key}}`;
                  updateDraft((d) => ({ ...d, content: d.content.includes('\\end{document}') ? d.content.replace('\\end{document}', `${cite}\n\\end{document}`) : `${d.content}\n${cite}` }));
                  void (async () => {
                    const bib = files.find((f) => f.name === 'references.bib') ?? await addFile(ctx, active.id, 'references.bib');
                    if (!bib.content.includes(`{${c.key},`)) await saveFile(ctx, bib.id, `${bib.content}\n${c.bib}`);
                    setFiles(await listFiles(ctx, active.id));
                  })().catch((e) => ctx.ui.notify(String(e), 'error'));
                }
                setCitations(null);
              }}>{c.title}</button>)}
            </div>}
            {active.mode === 'rich' ? (
              <RichEditor key={active.id} ctx={ctx} value={draft.content} onChange={(html) => updateDraft((d) => ({ ...d, content: html }))} />
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="latex-filetabs">
                  {files.map((f) => (
                    <div key={f.id} className={`tab${f.id === activeFileId ? ' active' : ''}`} onClick={() => setActiveFileId(f.id)}>
                      <Icon name={f.name.endsWith('.bib') ? 'book' : 'code'} size={11} />
                      {f.name}
                      {files.length > 1 && (
                        <button
                          className="icon-btn"
                          style={{ width: 16, height: 16 }}
                          title="删除文件"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteFile(ctx, f.id);
                            setFiles(await listFiles(ctx, active.id));
                            setActiveFileId(null);
                          }}
                        >
                          <Icon name="x" size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="icon-btn"
                    style={{ marginBottom: 3 }}
                    title="新建文件"
                    onClick={async () => {
                      const name = window.prompt('文件名(main.tex / sections/intro.tex / references.bib)', 'sections/new.tex');
                      if (!name) return;
                      const f = await addFile(ctx, active.id, name);
                      setFiles(await listFiles(ctx, active.id));
                      setActiveFileId(f.id);
                    }}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                </div>
                <LatexEditor key={`${active.id}/${activeFileId}`} value={draft.content} onChange={(v) => updateDraft((d) => ({ ...d, content: v }))} onResize={(delta) => ctx.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'latexPreviewPercent', delta })} />
                {compileMsg && <div className="err-panel">{compileMsg}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="pen" size={26} />
            <div>新建或选择一篇文档</div>
            <div style={{ fontSize: 11.5 }}>模式 A:类 Word 富文本,支持 .docx 导出 · 模式 B:LaTeX 工程实时预览</div>
          </div>
        )}
      </div>
    </div>
  );
}

export { getDoc };
