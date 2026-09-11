import React, { useState } from 'react';
import { useApp } from '../state';
import { createBackup, readBackup, type BackupData } from '../adapters/backup';
import type { LocalDocuments } from '@mpw/shared';

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function DataSettings(): React.ReactElement {
  const { data, kernel } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [candidate, setCandidate] = useState<BackupData | null>(null);
  if (!data) return <></>;
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true); setMessage('');
    try { if (kernel.bgTasks.count() > 0) throw new Error('文件导入或后台任务尚未完成，请稍后再备份/恢复'); await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section>
    {busy && <div role="alert" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(20,30,40,.65)', display: 'grid', placeItems: 'center' }}><div className="card">正在处理数据，请等待完成…</div></div>}
    <h2>数据与备份</h2>
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <p>保存位置：{data.location}。备份包含工作台、笔记、文献、文档和附件；不包含 API 密钥。</p>
      <button className="btn primary" disabled={busy} onClick={() => void run(async () => {
        download(await createBackup(data), `ModuDesk-${new Date().toISOString().slice(0, 10)}.mpwbackup`);
        setMessage('备份已生成，请保留下载的文件。');
      })}>导出完整备份</button>
      <label>选择备份文件（最多 512 MB） <input aria-label="选择备份文件" type="file" accept=".mpwbackup,.zip" disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0]; setCandidate(null); e.target.value = '';
        if (file) void run(async () => {
          if (file.size > 513 * 1024 * 1024) throw new Error('备份文件过大');
          const parsed = await readBackup(new Uint8Array(await file.arrayBuffer()));
          setCandidate(parsed); setMessage('校验通过，可以恢复。');
        });
      }} /></label>
      {candidate && <div>
        <p>备份时间：{candidate.createdAt}，附件 {Object.keys(candidate.blobs).length} 个。恢复将替换当前工作台，并先下载一份当前数据的备份。</p>
        <button className="btn danger" disabled={busy} onClick={() => void run(async () => {
          if (kernel.commands.has('workspace.localDocuments')) await (await kernel.commands.execute('workspace.localDocuments') as LocalDocuments).flush();
          download(await createBackup(data), `ModuDesk-before-restore-${Date.now()}.mpwbackup`);
          await data.restore(candidate.database, candidate.blobs);
          window.location.reload();
        })}>备份当前数据并恢复</button>
        <button className="btn" disabled={busy} onClick={() => setCandidate(null)}>取消</button>
      </div>}
      <p role="status">{busy ? '正在处理，请等待完成…' : message}</p>
    </div>
  </section>;
}
