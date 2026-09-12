import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

export interface PdfRect { x: number; y: number; w: number; h: number }
export interface PdfHighlight { id: string; page: number; rects: PdfRect[]; color: string; title?: string }
export interface PdfTextSelection { page: number; text: string; rects: PdfRect[] }

export interface PdfScrollRequest { page: number; nonce: number }

interface ContinuousPdfProps {
  bytes: Uint8Array;
  scale: number;
  highlights?: PdfHighlight[];
  scrollRequest?: PdfScrollRequest;
  onDocumentLoad?: (document: PDFDocumentProxy) => void;
  onPageChange?: (page: number) => void;
  onTextSelect?: (selection: PdfTextSelection) => void;
  ariaLabel?: string;
}

function PdfPage({
  document,
  pageNumber,
  scale,
  root,
  highlights,
  onTextSelect,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  root: HTMLDivElement | null;
  highlights: PdfHighlight[];
  onTextSelect?: (selection: PdfTextSelection) => void;
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [nearViewport, setNearViewport] = useState(typeof IntersectionObserver === 'undefined');
  const [size, setSize] = useState({ width: 595, height: 842 });

  useEffect(() => {
    let cancelled = false;
    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      setPdfPage(page);
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => { cancelled = true; };
  }, [document, pageNumber]);

  useEffect(() => {
    if (!hostRef.current || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setNearViewport(Boolean(entries[0]?.isIntersecting)),
      { root, rootMargin: '900px 0px' },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!pdfPage) return;
    const viewport = pdfPage.getViewport({ scale });
    setSize({ width: viewport.width, height: viewport.height });
  }, [pdfPage, scale]);

  useEffect(() => {
    if (!pdfPage || !nearViewport || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: { render(): Promise<void>; cancel?(): void } | undefined;
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前环境无法显示 PDF');
      renderTask = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
      const layer = textLayerRef.current;
      if (!layer || cancelled) return;
      layer.innerHTML = '';
      const TextLayerCtor = (pdfjs as unknown as {
        TextLayer?: new (options: unknown) => { render(): Promise<void>; cancel?(): void };
      }).TextLayer;
      if (TextLayerCtor) {
        textLayer = new TextLayerCtor({
          textContentSource: await pdfPage.getTextContent(),
          container: layer,
          viewport,
        });
        await textLayer.render();
      }
    })().catch((error) => {
      if (!cancelled && (error as { name?: string }).name !== 'RenderingCancelledException') {
        console.error(`PDF 第 ${pageNumber} 页渲染失败`, error);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel?.();
    };
  }, [pdfPage, nearViewport, scale, pageNumber]);

  const handleSelection = (): void => {
    if (!onTextSelect || !hostRef.current) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!selection || selection.isCollapsed || text.length < 2) return;
    if (!hostRef.current.contains(selection.anchorNode) || !hostRef.current.contains(selection.focusNode)) return;
    const hostRect = hostRef.current.getBoundingClientRect();
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).map((rect) => {
      const left = Math.max(rect.left, hostRect.left);
      const top = Math.max(rect.top, hostRect.top);
      const right = Math.min(rect.right, hostRect.right);
      const bottom = Math.min(rect.bottom, hostRect.bottom);
      return {
        x: (left - hostRect.left) / hostRect.width,
        y: (top - hostRect.top) / hostRect.height,
        w: (right - left) / hostRect.width,
        h: (bottom - top) / hostRect.height,
      };
    }).filter((rect) => rect.w > 0.001 && rect.h > 0.001);
    if (rects.length > 0) onTextSelect({ page: pageNumber, text, rects });
  };

  return (
    <div
      ref={hostRef}
      className="pdf-page-host"
      data-pdf-page={pageNumber}
      aria-label={`PDF 第 ${pageNumber} 页`}
      style={{ width: size.width, height: size.height }}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" onMouseUp={handleSelection} />
      {highlights.flatMap((highlight) => highlight.rects.map((rect, index) => (
        <div
          key={`${highlight.id}-${index}`}
          className="pdf-hl"
          title={highlight.title}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            background: highlight.color,
            opacity: 0.45,
          }}
        />
      )))}
    </div>
  );
}

/** A plug-in independent, continuous PDF canvas with selectable text layers. */
export function ContinuousPdf({
  bytes,
  scale,
  highlights = [],
  scrollRequest,
  onDocumentLoad,
  onPageChange,
  onTextSelect,
  ariaLabel = '连续 PDF 阅读区',
}: ContinuousPdfProps): React.ReactElement {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setError('');
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdfjs.getDocument({ data: bytes.slice() });
      const loaded = await task.promise;
      if (cancelled) {
        await loaded.destroy();
        return;
      }
      setDocument(loaded);
      onDocumentLoad?.(loaded);
    })().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes, onDocumentLoad]);

  useEffect(() => {
    if (!scrollRequest || !scrollerRef.current) return;
    const page = scrollerRef.current.querySelector<HTMLElement>(`[data-pdf-page="${scrollRequest.page}"]`);
    if (page) scrollerRef.current.scrollTo({ top: Math.max(0, page.offsetTop - 14), behavior: 'smooth' });
  }, [scrollRequest]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const trackCurrentPage = (): void => {
    if (!onPageChange || !scrollerRef.current || frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const rootTop = scrollerRef.current?.getBoundingClientRect().top ?? 0;
      const pages = Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('[data-pdf-page]') ?? []);
      let closest = pages[0];
      let distance = Number.POSITIVE_INFINITY;
      for (const candidate of pages) {
        const nextDistance = Math.abs(candidate.getBoundingClientRect().top - rootTop - 12);
        if (nextDistance < distance) {
          closest = candidate;
          distance = nextDistance;
        }
      }
      const page = Number(closest?.dataset.pdfPage);
      if (page) onPageChange(page);
    });
  };

  return (
    <div ref={scrollerRef} className="pdf-continuous" aria-label={ariaLabel} onScroll={trackCurrentPage}>
      {error && <div className="empty-state" role="alert">PDF 显示失败：{error}</div>}
      {!document && !error && <div className="empty-state">正在加载 PDF…</div>}
      {document && Array.from({ length: document.numPages }, (_, index) => {
        const pageNumber = index + 1;
        return (
          <PdfPage
            key={pageNumber}
            document={document}
            pageNumber={pageNumber}
            scale={scale}
            root={scrollerRef.current}
            highlights={highlights.filter((highlight) => highlight.page === pageNumber)}
            onTextSelect={onTextSelect}
          />
        );
      })}
    </div>
  );
}
