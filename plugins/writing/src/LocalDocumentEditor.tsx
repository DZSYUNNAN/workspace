import React, { useEffect, useState } from 'react';
import { documentMime, type LocalDocumentSession } from '@mpw/shared';
import { downloadBlob } from './docx';

export function LocalDocumentEditor({ session, onDetach }: { session: LocalDocumentSession; onDetach(): Promise<void> }): React.ReactElement {
  const [, redraw] = useState(0); const [error, setError] = useState(''); const [reloading, setReloading] = useState(false);
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
      <button className="btn sm" disabled={reloading} onClick={() => void reload()}>{session.phase === 'saved' ? '重新读取本地文件' : '下载副本并重新读取'}</button>
      <button className="btn sm" disabled={reloading} onClick={() => {
        setReloading(true);
        void (async () => { if (session.phase !== 'saved') download(); await onDetach(); })().catch((e) => { setError(String(e)); setReloading(false); });
      }}>{session.phase === 'saved' ? '断开同步' : '下载副本并断开'}</button>
    </div>
    <div style={{ padding: '8px 14px', fontSize: 12, overflowWrap: 'anywhere', color: 'var(--text-2)' }}>
      原文件：{session.file.path}<br />修改会自动同步到这个文件。第一次保存会保留原稿备份。
      {session.codec.kind === 'docx' && <div>Word 正文按段落编辑，保留原有样式、表格及附件。含图片、公式、域或修订的复杂段落只读；排版请在 Word 中查看。</div>}
    </div>
    {(session.error || error) && <div className="err-panel" role="alert">{session.error || error}</div>}
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      {session.codec.blocks.length === 0 && <p>文档没有可编辑的正文段落。</p>}
      {session.codec.blocks.map((block, i) => <div key={i} style={{ marginBottom: session.codec.kind === 'docx' ? 10 : 0 }}>
        {session.codec.kind === 'docx' && <label htmlFor={`local-paragraph-${i}`} style={{ fontSize: 11, color: 'var(--text-3)' }}>段落 {i + 1}{!block.editable && ' · 复杂内容只读'}</label>}
        <textarea id={`local-paragraph-${i}`} aria-label={session.codec.kind === 'docx' ? `Word 段落 ${i + 1}` : '本地文档内容'} className="input" readOnly={!block.editable || reloading}
          value={session.texts[i]} onChange={(e) => session.edit(i, e.target.value)}
          rows={session.codec.kind === 'docx' ? Math.max(2, Math.min(10, Math.ceil(session.texts[i].length / 50))) : 25}
          style={{ width: '100%', resize: 'vertical', lineHeight: 1.8, fontFamily: session.codec.kind === 'text' ? 'Consolas, monospace' : 'inherit' }} />
      </div>)}
    </div>
  </div>;
}
