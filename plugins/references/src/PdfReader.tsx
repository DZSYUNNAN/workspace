import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PluginContext } from '@mpw/kernel';
import { ContinuousPdf, Icon, type PdfHighlight, type PdfScrollRequest, type PdfTextSelection } from '@mpw/ui';
import { addAnnotation, deleteAnnotation, listAnnotations, type AnnotationRecord } from './store';

function annotationHighlights(annotations: AnnotationRecord[]): PdfHighlight[] {
  return annotations.flatMap((annotation) => {
    try {
      return [{ id: annotation.id, page: annotation.page, rects: JSON.parse(annotation.rects), color: annotation.color, title: annotation.text.slice(0, 120) }];
    } catch { return []; }
  });
}

export function PdfReader(props: { ctx: PluginContext; blobRef: string; fileName: string; referenceId?: string }): React.ReactElement {
  const { ctx } = props;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ page: number; count: number }[] | null>(null);
  const [annos, setAnnos] = useState<AnnotationRecord[]>([]);
  const [showAnno, setShowAnno] = useState(true);
  const [scrollRequest, setScrollRequest] = useState<PdfScrollRequest>();
  const textCache = useRef<Map<number, string> | null>(null);

  const jumpToPage = (nextPage: number): void => {
    const target = Math.max(1, Math.min(doc?.numPages ?? 1, nextPage));
    setPage(target);
    setScrollRequest({ page: target, nonce: Date.now() });
  };
  const loadAnnos = async (): Promise<void> => {
    if (!props.referenceId) return setAnnos([]);
    setAnnos(await listAnnotations(ctx, props.referenceId));
  };

  useEffect(() => {
    let cancelled = false;
    setBytes(null); setDoc(null); setPage(1); setError(''); setHits(null); textCache.current = null;
    void ctx.blobs.get(props.blobRef).then(async (stored) => {
      if (!stored) throw new Error('附件在文件库中不存在');
      const value = stored.bytes instanceof Uint8Array ? stored.bytes : new Uint8Array(await (stored.bytes as Blob).arrayBuffer());
      if (!cancelled) setBytes(value);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [ctx, props.blobRef]);

  useEffect(() => {
    void loadAnnos();
    return ctx.events.on('refs:changed', () => void loadAnnos());
  }, [props.referenceId]);

  const doSearch = async (): Promise<void> => {
    if (!doc) return;
    const needle = query.trim().toLowerCase();
    if (!needle) return setHits(null);
    if (!textCache.current) {
      textCache.current = new Map();
      for (let index = 1; index <= doc.numPages; index++) {
        const pdfPage = await doc.getPage(index);
        const content = await pdfPage.getTextContent();
        textCache.current.set(index, content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }
    }
    const found: { page: number; count: number }[] = [];
    for (const [pageNumber, text] of textCache.current) {
      let from = 0; let count = 0; const searchable = text.toLowerCase();
      while ((from = searchable.indexOf(needle, from)) !== -1) { count += 1; from += needle.length; }
      if (count > 0) found.push({ page: pageNumber, count });
    }
    setHits(found);
    if (found[0]) jumpToPage(found[0].page);
  };

  const addHighlight = ({ page: selectedPage, text, rects }: PdfTextSelection): void => {
    if (!props.referenceId) return;
    void (async () => {
      const savedText = text.slice(0, 2000);
      await addAnnotation(ctx, { reference_id: props.referenceId as string, page: selectedPage, kind: 'highlight', rects: JSON.stringify(rects), text: savedText, color: '#ffe066' });
      ctx.events.emit('refs:annotationMade', { text: savedText, page: selectedPage });
      ctx.events.emit('refs:changed', { kind: 'annotation' });
      ctx.ui.notify('已添加高亮批注', 'success');
      window.getSelection()?.removeAllRanges();
    })();
  };

  if (error) return <div className="placeholder"><Icon name="pdf" size={22} /> {error}</div>;
  return <div className="pdf-reader-shell">
    <div className="pdf-reader-main">
      <div className="pdf-toolbar">
        <button className="btn sm" disabled={page <= 1} onClick={() => jumpToPage(page - 1)}>‹</button>
        <span>{page} / {doc?.numPages ?? '…'}</span>
        <button className="btn sm" disabled={!doc || page >= doc.numPages} onClick={() => jumpToPage(page + 1)}>›</button>
        <button className="btn sm" onClick={() => setScale((value) => Math.max(0.4, value - 0.2))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button className="btn sm" onClick={() => setScale((value) => Math.min(3, value + 0.2))}>+</button>
        <input className="input" style={{ flex: 1, minWidth: 80, maxWidth: 260, fontSize: 12 }} placeholder="全文检索…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void doSearch()} />
        {hits && <span className="badge gray">{hits.length} 页命中</span>}
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>拖选文字即可高亮</span>
        {showAnno && <span className="badge">{annos.length} 条批注</span>}
      </div>
      <div className="pdf-reader-stage">
        {hits && hits.length > 0 && <div className="pdf-search-hits">{hits.map((hit) => <button key={hit.page} className="palette-hit" onClick={() => jumpToPage(hit.page)}>第 {hit.page} 页 — {hit.count} 处</button>)}</div>}
        {bytes ? <ContinuousPdf bytes={bytes} scale={scale} highlights={annotationHighlights(annos)} scrollRequest={scrollRequest} onDocumentLoad={setDoc} onPageChange={setPage} onTextSelect={props.referenceId ? addHighlight : undefined} ariaLabel={`${props.fileName} 连续阅读区`} /> : <div className="empty-state">正在读取 PDF…</div>}
      </div>
    </div>
    {showAnno && <div className="anno-panel">
      <div className="widget-toolbar" style={{ padding: 8 }}><b style={{ fontSize: 12 }}>批注</b><span style={{ flex: 1 }} /><button className="icon-btn" title="收起批注面板" onClick={() => setShowAnno(false)}><Icon name="x" size={13} /></button></div>
      <div className="list">
        {annos.map((annotation) => <div key={annotation.id} className="anno-row" onClick={() => jumpToPage(annotation.page)}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, background: annotation.color, borderRadius: 2, display: 'inline-block' }} /><span>第 {annotation.page} 页</span><span style={{ flex: 1 }} /><button className="icon-btn danger" style={{ width: 20, height: 20 }} onClick={async (event) => { event.stopPropagation(); await deleteAnnotation(ctx, annotation.id); await loadAnnos(); }}><Icon name="trash" size={11} /></button></div>
          <div className="a-text">{annotation.text}</div>
        </div>)}
        {annos.length === 0 && <div className="empty-state" style={{ fontSize: 11 }}>还没有批注<br />拖选 PDF 文字即可高亮<br />高亮会保存在本地并出现在这里</div>}
      </div>
    </div>}
    {!showAnno && <button className="btn sm pdf-show-annotations" onClick={() => setShowAnno(true)}>批注 ({annos.length})</button>}
  </div>;
}
