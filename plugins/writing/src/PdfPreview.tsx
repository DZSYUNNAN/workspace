import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/** Canvas rendering works in WebView2 without requiring a browser PDF plug-in. */
export function PdfPreview({ bytes }: { bytes: Uint8Array }): React.ReactElement {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1); const [scale, setScale] = useState(1);
  const [error, setError] = useState(''); const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false; let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    setDoc(null); setError(''); setPage(1);
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdfjs.getDocument({ data: bytes.slice() }); const loaded = await task.promise;
      if (!cancelled) setDoc(loaded);
    })().catch((e) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false; let task: RenderTask | undefined;
    void (async () => {
      const pdfPage = await doc.getPage(page); if (cancelled || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale }); const context = canvas.current.getContext('2d');
      if (!context) throw new Error('当前环境无法显示 PDF，请使用下载按钮');
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      task = pdfPage.render({ canvasContext: context, viewport }); await task.promise;
    })().catch((e) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); });
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, scale]);
  return <section aria-label="编译 PDF 预览" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%' }}>
    <div className="widget-toolbar">
      <button className="btn sm" disabled={!doc || page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
      <span>{page} / {doc?.numPages ?? '…'}</span>
      <button className="btn sm" disabled={!doc || page >= doc.numPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
      <select className="input" aria-label="PDF 缩放" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
      </select>
    </div>
    {error && <p role="alert">PDF 显示失败：{error}</p>}
    {!doc && !error && <p>正在加载 PDF…</p>}
    <div style={{ flex: 1, overflow: 'auto', background: '#555', padding: 12 }}><canvas aria-label={`PDF 第 ${page} 页`} ref={canvas} style={{ display: 'block', background: 'white' }} /></div>
  </section>;
}
