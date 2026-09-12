import React, { useEffect, useRef, useState } from 'react';
import { documentMime, type LocalDocumentSession, type TexEngine } from '@mpw/shared';
import type { PluginContext } from '@mpw/kernel';
import { PdfPreview } from './PdfPreview';
import { ResizeHandle } from '@mpw/ui';
import { LAYOUT_CONTROL_APPLY } from '@mpw/shared';
import { downloadBlob } from './docx';

export function LocalDocumentEditor({ session, onDetach, ctx }: { session: LocalDocumentSession; onDetach(): Promise<void>; ctx?: PluginContext }): React.ReactElement {
  const [, redraw] = useState(0); const [error, setError] = useState(''); const [reloading, setReloading] = useState(false);
  const isTex = session.file.name.toLowerCase().endsWith('.tex');
  const [engine, setEngine] = useState<TexEngine>('xelatex'); const [compiling, setCompiling] = useState(false);
  const compilingRef = useRef(false); const mounted = useRef(true);
  const [pdf, setPdf] = useState<Uint8Array | null>(null); const [log, setLog] = useState('');
  const [compiledText, setCompiledText] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const compile = async (): Promise<void> => {
    if (compilingRef.current) return;
    compilingRef.current = true; setCompiling(true); setError(''); setPdf(null); setLog('正在保存并编译…');
    const source = session.texts[0];
    const task = await ctx?.commands.execute('workspace.beginFileWork', '本地 TeX 编译').catch(() => null) as { finish(): void } | null | undefined;
    try {
      const result = await session.compile(engine);
      if (!mounted.current) return;
      setLog(result.log);
      if (!result.ok || !result.pdfBase64) { setError('编译未成功，请查看编译日志'); return; }
      setPdf(Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0))); setCompiledText(source);
    } catch (e) { if (mounted.current) { const message = String(e instanceof Error ? e.message : e); setError(message); setLog(message); } }
    finally { task?.finish(); compilingRef.current = false; if (mounted.current) setCompiling(false); }
  };
  useEffect(() => session.subscribe(() => redraw((n) => n + 1)), [session]);
  const download = (): void => downloadBlob(new Blob([session.snapshot().slice().buffer], { type: documentMime(session.file.name) }), `编辑副本-${session.file.name}`);
  const reload = async (): Promise<void> => {
    setReloading(true); setError('');
    try { if (session.phase !== 'saved') download(); await session.reload(); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setReloading(false); }
  };
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void session.flush().catch(() => {}); } }}>
    <div className="widget-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{session.file.name}</strong>
      <span role="status">{session.phase === 'saved' ? '已同步到原文件' : session.phase === 'error' ? '同步已暂停' : '同步中…'}</span>
      <button className="btn sm primary" disabled={reloading} onClick={() => void session.flush().catch(() => {})}>{session.phase === 'error' ? '重试同步' : '立即保存'}</button>
      <button className="btn sm" disabled={reloading} onClick={() => { try { download(); } catch (e) { setError(String(e)); } }}>下载编辑副本</button>
      <button className="btn sm" disabled={reloading || compiling} onClick={() => void reload()}>{session.phase === 'saved' ? '重新读取本地文件' : '下载副本并重新读取'}</button>
      <button className="btn sm" disabled={reloading || compiling} onClick={() => {
        setReloading(true);
        void (async () => { if (session.phase !== 'saved') download(); await onDetach(); })().catch((e) => { setError(String(e)); setReloading(false); });
      }}>{session.phase === 'saved' ? '断开同步' : '下载副本并断开'}</button>
    </div>
    {isTex && <div className="widget-toolbar" style={{ flexWrap: 'wrap' }}>
      <select className="input" aria-label="TeX 编译引擎" value={engine} disabled={compiling} onChange={(e) => setEngine(e.target.value as TexEngine)}>
        <option value="xelatex">XeLaTeX（中文推荐）</option><option value="lualatex">LuaLaTeX</option><option value="pdflatex">pdfLaTeX</option>
      </select>
      <button className="btn primary" disabled={compiling || reloading} onClick={() => void compile()}>{compiling ? '正在编译…' : '编译并预览 PDF'}</button>
      {pdf && <button className="btn" onClick={() => downloadBlob(new Blob([pdf.slice().buffer], { type: 'application/pdf' }), session.file.name.replace(/\.tex$/i, '.pdf'))}>下载 PDF</button>}
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>请选择主 .tex 文件；桌面版按文稿引用读取同目录及子目录中的依赖，无关文件不计入工程。</span>
    </div>}
    <div style={{ padding: '8px 14px', fontSize: 12, overflowWrap: 'anywhere', color: 'var(--text-2)' }}>
      原文件：{session.file.path}<br />修改会自动同步到这个文件。第一次保存会保留原稿备份。
      {session.codec.kind === 'docx' && <div>Word 正文按段落编辑，保留原有样式、表格及附件。含图片、公式、域或修订的复杂段落只读；排版请在 Word 中查看。</div>}
    </div>
    {(session.error || error) && <div className="err-panel" role="alert">{session.error || error}</div>}
    {isTex && log && <details open={!!error} style={{ padding: '0 12px' }}><summary>编译日志</summary><pre style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{log}</pre></details>}
    {pdf && session.texts[0] !== compiledText && <p role="status" style={{ padding: '0 12px' }}>内容已修改，右侧显示上一次编译结果，请重新编译。</p>}
    <div className={pdf ? 'local-document-split has-preview' : 'local-document-split'}>
    <div className="local-document-source">
      {session.codec.blocks.length === 0 && <p>文档没有可编辑的正文段落。</p>}
      {session.codec.blocks.map((block, i) => <div key={i} style={{ marginBottom: session.codec.kind === 'docx' ? 10 : 0 }}>
        {session.codec.kind === 'docx' && <label htmlFor={`local-paragraph-${i}`} style={{ fontSize: 11, color: 'var(--text-3)' }}>段落 {i + 1}{!block.editable && ' · 复杂内容只读'}</label>}
        <textarea id={`local-paragraph-${i}`} aria-label={session.codec.kind === 'docx' ? `Word 段落 ${i + 1}` : '本地文档内容'} className="input" readOnly={!block.editable || reloading}
          value={session.texts[i]} onChange={(e) => session.edit(i, e.target.value)}
          rows={session.codec.kind === 'docx' ? Math.max(2, Math.min(10, Math.ceil(session.texts[i].length / 50))) : 25}
          style={{ width: '100%', resize: 'vertical', lineHeight: 1.8, fontFamily: session.codec.kind === 'text' ? 'Consolas, monospace' : 'inherit' }} />
      </div>)}
    </div>
    {pdf && <ResizeHandle direction={-1} onDelta={(delta) => ctx?.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'localTexPreviewPercent', delta: delta / Math.max(1, window.innerWidth) * 100 })} title="拖动调整编译 PDF 宽度" />}
    {pdf && <div className="local-document-preview"><PdfPreview bytes={pdf} /></div>}
    </div>
  </div>;
}
