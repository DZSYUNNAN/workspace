import React, { useEffect, useMemo, useRef, useState } from 'react';
import { documentMime, LAYOUT_CONTROL_APPLY, type LocalDocumentSession, type TexEngine } from '@mpw/shared';
import type { PluginContext } from '@mpw/kernel';
import { PdfPreview } from './PdfPreview';
import { ResizeHandle, type PdfPoint } from '@mpw/ui';
import { downloadBlob } from './docx';

export function LocalDocumentEditor({ session, onDetach, ctx, onSelectionChange }: { session: LocalDocumentSession; onDetach(): Promise<void>; ctx?: PluginContext; onSelectionChange?: (text: string) => void }): React.ReactElement {
  const [, redraw] = useState(0); const [error, setError] = useState(''); const [reloading, setReloading] = useState(false);
  const isTex = session.file.name.toLowerCase().endsWith('.tex');
  const [engine, setEngine] = useState<TexEngine>('xelatex'); const [compiling, setCompiling] = useState(false);
  const compilingRef = useRef(false); const mounted = useRef(true); const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [pdf, setPdf] = useState<Uint8Array | null>(null); const [log, setLog] = useState(''); const [compiledText, setCompiledText] = useState('');
  const [locateStatus, setLocateStatus] = useState('双击 PDF 文本可定位到左侧 TeX 源码');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => session.subscribe(() => redraw((n) => n + 1)), [session]);

  const compile = async (): Promise<void> => {
    if (compilingRef.current) return;
    compilingRef.current = true; setCompiling(true); setError(''); setLog('正在保存并编译…');
    const source = session.texts[0];
    const task = await ctx?.commands.execute('workspace.beginFileWork', '本地 TeX 编译').catch(() => null) as { finish(): void } | null | undefined;
    try {
      const result = await session.compile(engine);
      if (!mounted.current) return;
      setLog(result.log);
      if (!result.ok || !result.pdfBase64) { setError('编译未成功，请查看编译日志'); return; }
      setPdf(Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0))); setCompiledText(source);
      setLocateStatus('编译完成；双击 PDF 文本可反向定位');
    } catch (e) { if (mounted.current) { const message = String(e instanceof Error ? e.message : e); setError(message); setLog(message); } }
    finally { task?.finish(); compilingRef.current = false; if (mounted.current) setCompiling(false); }
  };

  const locateSource = async (point: PdfPoint): Promise<void> => {
    setLocateStatus(`正在定位第 ${point.page} 页…`);
    try {
      const location = await session.synctex(point.page, point.x, point.y);
      if (location.source.toLowerCase() !== session.file.name.toLowerCase()) {
        setLocateStatus(`定位到依赖文件 ${location.source} 第 ${location.line} 行；请将该文件作为本地文档打开后编辑。`); return;
      }
      const text = session.texts[0] ?? ''; const lines = text.split('\n');
      const lineIndex = Math.max(0, Math.min(lines.length - 1, location.line - 1));
      const lineStart = lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0);
      const lineText = lines[lineIndex] ?? ''; let offset = Math.max(0, Math.min(lineText.length, location.column));
      const candidate = point.word?.replace(/^\W+|\W+$/g, '');
      if (candidate) { const found = lineText.toLocaleLowerCase().indexOf(candidate.toLocaleLowerCase(), Math.max(0, offset - candidate.length)); if (found >= 0) offset = found; }
      const start = lineStart + offset; const end = Math.min(text.length, start + (candidate?.length || 0));
      const editor = sourceRef.current; editor?.focus(); editor?.setSelectionRange(start, Math.max(start, end));
      if (editor) { const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24; editor.scrollTop = Math.max(0, lineIndex * lineHeight - editor.clientHeight / 3); }
      setLocateStatus(`已定位到 ${session.file.name} 第 ${location.line} 行${candidate ? `：${candidate}` : ''}`);
    } catch (e) { setLocateStatus(String(e instanceof Error ? e.message : e)); }
  };

  useEffect(() => {
    if (!ctx || !isTex) return undefined;
    return ctx.events.on('writing:apply-ai-output', (payload) => {
      const data = payload as { text?: string; targetLabel?: string };
      if (!data.text || (data.targetLabel && data.targetLabel !== `本地 TeX: ${session.file.name}`)) return;
      const editor = sourceRef.current; if (!editor) return;
      const source = session.texts[0] ?? ''; const start = editor.selectionStart; const end = editor.selectionEnd;
      session.edit(0, source.slice(0, start) + data.text + source.slice(end));
      window.setTimeout(() => { editor.focus(); editor.setSelectionRange(start, start + data.text!.length); onSelectionChange?.(data.text!); }, 0);
    });
  }, [ctx, isTex, session, onSelectionChange]);

  const download = (): void => downloadBlob(new Blob([session.snapshot().slice().buffer], { type: documentMime(session.file.name) }), `编辑副本-${session.file.name}`);
  const reload = async (): Promise<void> => { setReloading(true); setError(''); try { if (session.phase !== 'saved') download(); await session.reload(); setPdf(null); setCompiledText(''); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setReloading(false); } };
  const words = useMemo(() => (session.texts[0] ?? '').split(/\s+/).filter(Boolean).length, [session.texts[0]]);

  return <div className="paper-workspace" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void session.flush().catch(() => {}); } }}>
    <div className="widget-toolbar paper-main-toolbar">
      <strong>{session.file.name}</strong><span className="badge gray">{isTex ? '本地论文' : '本地文档'}</span><span style={{ flex: 1 }} />
      <span role="status">{session.phase === 'saved' ? `已同步到原文件 · ${words} 词` : session.phase === 'error' ? '同步已暂停' : '同步中…'}</span>
      <button className="btn sm primary" disabled={reloading} onClick={() => void session.flush().catch(() => {})}>{session.phase === 'error' ? '重试同步' : '保存'}</button>
      <button className="btn sm" disabled={reloading} onClick={() => { try { download(); } catch (e) { setError(String(e)); } }}>下载编辑副本</button>
      <button className="btn sm" disabled={reloading || compiling} onClick={() => void reload()}>重新读取</button>
      <button className="btn sm" disabled={reloading || compiling} onClick={() => { setReloading(true); void (async () => { if (session.phase !== 'saved') download(); await onDetach(); })().catch((e) => { setError(String(e)); setReloading(false); }); }}>断开同步</button>
    </div>
    {isTex && <div className="widget-toolbar paper-compile-toolbar">
      <select className="input" aria-label="TeX 编译引擎" value={engine} disabled={compiling} onChange={(e) => setEngine(e.target.value as TexEngine)}><option value="xelatex">XeLaTeX（中文推荐）</option><option value="lualatex">LuaLaTeX</option><option value="pdflatex">pdfLaTeX</option></select>
      <button className="btn primary" disabled={compiling || reloading} onClick={() => void compile()}>{compiling ? '正在编译…' : '保存并编译'}</button>
      {pdf && <button className="btn" onClick={() => downloadBlob(new Blob([pdf.slice().buffer], { type: 'application/pdf' }), session.file.name.replace(/\.tex$/i, '.pdf'))}>下载 PDF</button>}
      <span>只有“保存并编译”会刷新右侧 PDF；输入和 AI 任务不会自动刷新。</span>
    </div>}
    <div className="paper-path">原文件：{session.file.path}。修改自动同步到原文件，第一次保存会创建备份。
      {session.codec.kind === 'docx' && <div>Word 正文按段落编辑，保留原有样式、表格及附件；含图片、公式、域或修订的复杂段落只读。</div>}
    </div>
    {(session.error || error) && <div className="err-panel" role="alert">{session.error || error}</div>}
    {isTex && log && <details open={!!error} className="paper-compile-log"><summary>编译日志</summary><pre>{log}</pre></details>}
    {pdf && session.texts[0] !== compiledText && <div className="paper-stale" role="status">源码已修改，右侧仍显示上一次编译结果。</div>}
    <div className={pdf ? 'local-document-split has-preview' : 'local-document-split'}>
      <div className="local-document-source">
        {session.codec.blocks.length === 0 && <p>文档没有可编辑的正文段落。</p>}
        {session.codec.blocks.map((block, i) => <div key={i} style={{ marginBottom: session.codec.kind === 'docx' ? 10 : 0 }}>
          {session.codec.kind === 'docx' && <label htmlFor={`local-paragraph-${i}`}>段落 {i + 1}{!block.editable && ' · 复杂内容只读'}</label>}
          <textarea ref={i === 0 ? sourceRef : undefined} id={`local-paragraph-${i}`} aria-label={isTex ? 'paper.tex 编辑器' : session.codec.kind === 'docx' ? `Word 段落 ${i + 1}` : '本地文档内容'} className={`input paper-source-editor${isTex || session.codec.kind === 'text' ? ' code' : ''}`} readOnly={!block.editable || reloading}
            value={session.texts[i]} onChange={(e) => session.edit(i, e.target.value)} onSelect={(e) => onSelectionChange?.(e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd))} rows={session.codec.kind === 'docx' ? Math.max(2, Math.min(10, Math.ceil(session.texts[i].length / 50))) : 25} />
        </div>)}
      </div>
      {pdf && <ResizeHandle direction={-1} onDelta={(delta) => ctx?.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'localTexPreviewPercent', delta: delta / Math.max(1, window.innerWidth) * 100 })} title="拖动调整编译 PDF 宽度" />}
      {pdf && <div className="local-document-preview"><PdfPreview bytes={pdf} onPointDoubleClick={(point) => void locateSource(point)} /><div className="pdf-locate-status" role="status">{locateStatus}</div></div>}
    </div>
  </div>;
}
