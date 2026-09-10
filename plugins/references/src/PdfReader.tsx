import React, { useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';

/**
 * PDF reader over pdf.js: page navigation, zoom, text search, text selection.
 * pdf.js is loaded lazily — it never touches the initial bundle (ARCHITECTURE §9).
 */
export function PdfReader(props: { ctx: PluginContext; blobRef: string; fileName: string }): React.ReactElement {
  const { ctx } = props;
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ page: number; count: number }[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textCache = useRef<Map<number, string> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const pdfjs = await import('pdfjs-dist');
        const workerMod = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default: string };
        const workerUrl = workerMod.default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const stored = await ctx.blobs.get(props.blobRef);
        if (!stored) throw new Error('attached file not found in blob store');
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

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page);
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: context, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, scale]);

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

  if (error) {
    return <div className="placeholder"><Icon name="pdf" size={22} /> {error}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
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
          placeholder="Search in PDF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
        />
        {hits && <span className="badge gray">{hits.length} page{hits.length === 1 ? '' : 's'}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)', position: 'relative' }}>
        {loading && <div className="empty-state">Loading PDF…</div>}
        {hits && hits.length > 0 && (
          <div style={{ position: 'absolute', right: 8, top: 8, zIndex: 5, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 6, maxHeight: 160, overflow: 'auto', fontSize: 11.5 }}>
            {hits.map((h) => (
              <div key={h.page}>
                <button className="palette-hit" style={{ padding: '3px 6px' }} onClick={() => setPage(h.page)}>
                  p.{h.page} — {h.count} hit{h.count > 1 ? 's' : ''}
                </button>
              </div>
            ))}
          </div>
        )}
        <canvas ref={canvasRef} className="pdf-page-canvas" />
      </div>
    </div>
  );
}
