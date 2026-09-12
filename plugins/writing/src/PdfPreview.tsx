import React, { useCallback, useState } from 'react';
import { ContinuousPdf, type PdfScrollRequest } from '@mpw/ui';

/** Continuous canvas rendering works in WebView2 without a browser PDF plug-in. */
export function PdfPreview({ bytes }: { bytes: Uint8Array }): React.ReactElement {
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [scrollRequest, setScrollRequest] = useState<PdfScrollRequest>();
  const loaded = useCallback((document: import('pdfjs-dist').PDFDocumentProxy) => setNumPages(document.numPages), []);
  const jumpToPage = (nextPage: number): void => {
    const target = Math.max(1, Math.min(numPages || 1, nextPage));
    setPage(target); setScrollRequest({ page: target, nonce: Date.now() });
  };
  return <section aria-label="编译 PDF 预览" className="pdf-preview">
    <div className="widget-toolbar">
      <button className="btn sm" disabled={page <= 1} onClick={() => jumpToPage(page - 1)}>上一页</button><span>{page} / {numPages || '…'}</span>
      <button className="btn sm" disabled={!numPages || page >= numPages} onClick={() => jumpToPage(page + 1)}>下一页</button>
      <select className="input" aria-label="PDF 缩放" value={scale} onChange={(event) => setScale(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select>
      <span className="badge gray">连续滚动</span>
    </div>
    <ContinuousPdf bytes={bytes} scale={scale} scrollRequest={scrollRequest} onDocumentLoad={loaded} onPageChange={setPage} ariaLabel="LaTeX 编译结果连续预览" />
  </section>;
}
