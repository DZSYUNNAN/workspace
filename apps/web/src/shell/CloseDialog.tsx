import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import type { LocalDocuments } from '@mpw/shared';
export interface CloseActions { save(): Promise<void>; exit(): Promise<void>; minimize(): Promise<void> }
export function CloseChoice({ actions, onCancel }: { actions: CloseActions; onCancel(): void }): React.ReactElement {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const running = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { if (busy) dialogRef.current?.focus(); }, [busy]);
  const choose = async (kind: 'exit' | 'minimize'): Promise<void> => {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try { await actions.save(); await actions[kind](); if (kind === 'minimize') onCancel(); }
    catch (e) { setError(`保存或关闭失败，窗口已保留：${String(e instanceof Error ? e.message : e)}`); }
    finally { running.current = false; setBusy(false); }
  };
  return <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 12000, background: '#0008', display: 'grid', placeItems: 'center' }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="close-title" className="card" style={{ width: 420, maxWidth: '90vw', padding: 24 }} onKeyDown={(e) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Tab') {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    }}>
      <h2 id="close-title">退出还是最小化？</h2>
      <p>最小化后仍在任务栏运行；退出前会保存工作台及正在同步的本地文档。</p>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button autoFocus className="btn" disabled={busy} onClick={onCancel}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void choose('minimize')}>最小化到任务栏</button>
        <button className="btn danger" disabled={busy} onClick={() => void choose('exit')}>{busy ? '正在保存…' : '保存并退出'}</button>
      </div>
    </section>
  </div>;
}
export function CloseDialog(): React.ReactElement | null {
  const { kernel, data } = useApp(); const [open, setOpen] = useState(false);
  useEffect(() => kernel.events.on('desktop:close-requested', () => setOpen(true)), [kernel]);
  if (!open) return null;
  return <CloseChoice onCancel={() => setOpen(false)} actions={{
    save: async () => {
      if (kernel.bgTasks.count() > 0) throw new Error('文献导入或后台任务尚未完成，请稍后重试');
      const local = await kernel.commands.execute('workspace.localDocuments') as LocalDocuments; await local.flush(); await data?.db.flush();
    },
    minimize: async () => { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().minimize(); },
    exit: async () => { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().destroy(); },
  }} />;
}
