import React, { useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { addAnnotation, deleteAnnotation, listAnnotations, type AnnotationRecord } from './store';

/**
 * PDF 阅读器(pdf.js):
 *  - 页面导航 / 缩放 / 全文检索 / 文本选择(文本层)
 *  - 高亮批注持久化(比例坐标,缩放自适应),批注列表可跳转 / 删除
 */
interface Rect { x: number; y: number; w: number; h: number }

export function PdfReader(props: { ctx: PluginContext; blobRef: string; fileName: string; referenceId?: string }): React.ReactElement {
  const { ctx } = props;
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ page: number; count: number }[] | null>(null);
  const [annos, setAnnos] = useState<AnnotationRecord[]>([]);
  const [showAnno, setShowAnno] = useState(true);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textCache = useRef<Map<number, string> | null>(null);

  const loadAnnos = async (): Promise<void> => {
    if (!props.referenceId) return setAnnos([]);
    setAnnos(await listAnnotations(ctx, props.referenceId));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const pdfjs = await import('pdfjs-dist');
        const workerMod = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default: string };
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
        const stored = await ctx.blobs.get(props.blobRef);
        if (!stored) throw new Error('附件在文件库中不存在');
        const bytes = stored.bytes instanceof Uint8Array ? stored.bytes : new Uint8Array(await (stored.bytes as Blob).arrayBuffer());
        const loaded = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        textCache.current = null;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPage(1);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.blobRef]);

  // 渲染页面 + 文本层
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const p = await doc.getPage(page);
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (!canvas || !host || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      await p.render({ canvasContext: context, viewport }).promise;
      // 文本层(用于选择 / 高亮);旧版 pdf.js 无 TextLayer 时优雅降级
      const tl = textLayerRef.current;
      if (tl) {
        tl.innerHTML = '';
        tl.style.width = `${viewport.width}px`;
        tl.style.height = `${viewport.height}px`;
        const TextLayerCtor = (pdfjs as unknown as { TextLayer?: new (o: unknown) => { render(): Promise<void> } }).TextLayer;
        if (TextLayerCtor) {
          const tc = await p.getTextContent();
          await new TextLayerCtor({ textContentSource: tc, container: tl, viewport }).render();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, scale]);

  useEffect(() => {
    void loadAnnos();
    const off = ctx.events.on('refs:changed', () => void loadAnnos());
    return off;
  }, [props.referenceId]);

  const doSearch = async (): Promise<void> => {
    if (!doc) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      setHits(null);
      return;
    }
    if (!textCache.current) {
      textCache.current = new Map();
      for (let i = 1; i <= numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
        textCache.current.set(i, text);
      }
    }
    const found: { page: number; count: number }[] = [];
    for (const [i, text] of textCache.current) {
      let idx = 0;
      let count = 0;
      const hay = text.toLowerCase();
      while ((idx = hay.indexOf(q, idx)) !== -1) {
        count++;
        idx += q.length;
      }
      if (count > 0) found.push({ page: i, count });
    }
    setHits(found);
    if (found.length > 0) setPage(found[0]?.page ?? page);
  };

  // 选择文本 → 高亮
  const onMouseUp = (): void => {
    const tl = textLayerRef.current;
    const host = hostRef.current;
    if (!tl || !host || !props.referenceId) return;
    const sel = window.getSelection();
    const text = sel?.toString() ?? '';
    if (!sel || sel.isCollapsed || text.trim().length < 2) return;
    if (!host.contains(sel.anchorNode)) return;
    const hostRect = host.getBoundingClientRect();
    const rects: Rect[] = Array.from(sel.getRangeAt(0).getClientRects()).map((r) => ({
      x: (r.left - hostRect.left) / hostRect.width,
      y: (r.top - hostRect.top) / hostRect.height,
      w: r.width / hostRect.width,
      h: r.height / hostRect.height,
    })).filter((r) => r.w > 0.001 && r.h > 0.001);
    if (rects.length === 0) return;
    void (async () => {
      const savedText = text.trim().slice(0, 2000);
      await addAnnotation(ctx, { reference_id: props.referenceId as string, page, kind: 'highlight', rects: JSON.stringify(rects), text: savedText, color: '#ffe066' });
      ctx.events.emit('refs:annotationMade', { text: savedText, page });
      ctx.events.emit('refs:changed', { kind: 'annotation' });
      ctx.ui.notify('已添加高亮批注', 'success');
      sel.removeAllRanges();
    })();
  };

  const pageAnnos = annos.filter((a) => a.page === page);

  if (error) {
    return <div className="placeholder"><Icon name="pdf" size={22} /> {error}</div>;
  }
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="pdf-toolbar">
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span>{page} / {numPages || '…'}</span>
          <button className="btn sm" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>›</button>
          <button className="btn sm" onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button className="btn sm" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
          <input
            className="input"
            style={{ flex: 1, minWidth: 80, maxWidth: 260, fontSize: 12 }}
            placeholder="全文检索…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
          />
          {hits && <span className="badge gray">{hits.length} 页命中</span>}
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>选中文字即可高亮</span>
          {showAnno && <span className="badge">{annos.length} 条批注</span>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)', position: 'relative' }}>
          {loading && <div className="empty-state">正在加载 PDF…</div>}
          {hits && hits.length > 0 && (
            <div style={{ position: 'absolute', right: 8, top: 8, zIndex: 5, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 6, maxHeight: 160, overflow: 'auto', fontSize: 11.5 }}>
              {hits.map((h) => (
                <div key={h.page}>
                  <button className="palette-hit" style={{ padding: '3px 6px' }} onClick={() => setPage(h.page)}>
                    第 {h.page} 页 — {h.count} 处
                  </button>
                </div>
              ))}
            </div>
          )}
          <div ref={hostRef} className="pdf-page-host">
            <canvas ref={canvasRef} />
            <div ref={textLayerRef} className="textLayer" onMouseUp={onMouseUp} />
            {pageAnnos.map((a) => (
              (JSON.parse(a.rects) as Rect[]).map((r, i) => (
                <div
                  key={`${a.id}-${i}`}
                  className="pdf-hl"
                  title={a.text.slice(0, 120)}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: a.color, opacity: 0.45 }}
                />
              ))
            ))}
          </div>
        </div>
      </div>
      {showAnno && (
        <div className="anno-panel">
          <div className="widget-toolbar" style={{ padding: 8 }}>
            <b style={{ fontSize: 12 }}>批注</b>
            <span style={{ flex: 1 }} />
            <button className="icon-btn" title="收起批注面板" onClick={() => setShowAnno(false)}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="list">
            {annos.map((a) => (
              <div key={a.id} className="anno-row" onClick={() => setPage(a.page)}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, background: a.color, borderRadius: 2, display: 'inline-block' }} />
                  <span>第 {a.page} 页</span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="icon-btn danger"
                    style={{ width: 20, height: 20 }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteAnnotation(ctx, a.id);
                      await loadAnnos();
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </div>
                <div className="a-text">{a.text}</div>
              </div>
            ))}
            {annos.length === 0 && (
              <div className="empty-state" style={{ fontSize: 11 }}>
                还没有批注<br />用鼠标选中 PDF 文字即可高亮,<br />高亮会保存在本地并出现在这里
              </div>
            )}
          </div>
        </div>
      )}
      {!showAnno && annos.length > 0 && (
        <button className="btn sm" style={{ position: 'absolute', right: 10, bottom: 10 }} onClick={() => setShowAnno(true)}>
          批注 ({annos.length})
        </button>
      )}
    </div>
  );
}
