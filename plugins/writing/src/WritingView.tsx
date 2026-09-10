import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
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

export function WritingView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: '', content: '' });
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const reload = async (): Promise<void> => setDocs(await listDocs(ctx));

  useEffect(() => {
    void reload();
    const off = ctx.events.on('docs:changed', () => void reload());
    return off;
  }, []);

  const active = docs.find((d) => d.id === activeId) ?? null;

  // 载入 LaTeX 工程文件
  useEffect(() => {
    void (async () => {
      if (!activeId || active?.mode !== 'latex') {
        setFiles([]);
        setActiveFileId(null);
        return;
      }
      const list = await listFiles(ctx, activeId);
      setFiles(list);
      setActiveFileId((prev) => (prev && list.some((f) => f.id === prev) ? prev : (list[0]?.id ?? null)));
      // 兼容 v1 数据:content 里已有主文件但 files 表为空 → 迁移
      if (list.length === 0 && active?.content) {
        const { addFile, saveFile } = await import('./store');
        const f = await addFile(ctx, activeId, 'main.tex');
        await saveFile(ctx, f.id, active.content);
        setFiles(await listFiles(ctx, activeId));
        setActiveFileId(f.id);
      }
    })();
  }, [activeId, active?.mode]);

  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  useEffect(() => {
    setDraft({ title: active?.title ?? '', content: activeFile?.content ?? active?.content ?? '' });
    setDirty(false);
  }, [activeId, activeFileId]);

  const scheduleSave = (): void => {
    if (!active) return;
    setDirty(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (active.mode === 'latex' && activeFile) {
        await saveFile(ctx, activeFile.id, draft.content);
        if (draft.title !== active.title) await updateDoc(ctx, active.id, { title: draft.title });
      } else {
        const fields: Record<string, unknown> = {};
        if (draft.title !== active.title) fields['title'] = draft.title;
        if (draft.content !== active.content) fields['content'] = draft.content;
        if (Object.keys(fields).length > 0) {
          const sets = Object.keys(fields).map((k) => `${k} = ?`);
          await ctx.storage.sql.exec(
            `UPDATE p_writing_documents SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`,
            [...Object.values(fields), Date.now(), active.id]
          );
        }
      }
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
    const source = activeFile?.name.endsWith('.tex') ? draft.content : (files.find((f) => f.name.endsWith('.tex'))?.content ?? draft.content);
    const result = await ctx.latex.compile({ source, engine, jobName: 'modudesk' });
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
      <div className="notes-side" style={props.compact ? { width: 150 } : undefined}>
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
            {active.mode === 'rich' ? (
              <RichEditor ctx={ctx} value={draft.content} onChange={(html) => setDraft((d) => ({ ...d, content: html }))} />
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
                <LatexEditor value={draft.content} onChange={(v) => setDraft((d) => ({ ...d, content: v }))} />
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
