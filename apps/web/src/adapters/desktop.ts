import { invoke, isTauri } from '@tauri-apps/api/core';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SqlJsAdapter, type Kernel, type BlobStoreAdapter, type SecretStoreAdapter } from '@mpw/kernel';
import { DurableDb } from './durableDb';
import type { WorkspaceData } from './backup';
export { isTauri };
export function toBase64(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
const fromBase64 = (raw: string): Uint8Array => Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
export const desktopSecrets: SecretStoreAdapter = {
  get: (name) => invoke('secret_get', { name }),
  set: (name, value) => invoke('secret_set', { name, value }),
  delete: (name) => invoke('secret_delete', { name }),
};
export async function openDesktopData(): Promise<WorkspaceData> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const stored = await invoke<string | null>('workspace_read');
  const db = new DurableDb(new SqlJsAdapter(new SQL.Database(stored ? fromBase64(stored) : undefined)),
    (bytes) => invoke('workspace_write', { database: toBase64(bytes) }));
  const blobs: BlobStoreAdapter = {
    put: (name, bytes) => invoke('blob_put', { name, data: toBase64(bytes) }),
    get: async (name) => { const data = await invoke<string | null>('blob_get', { name }); return data ? { bytes: fromBase64(data), mime: 'application/octet-stream' } : null; },
    delete: async () => {},
    listRefs: () => invoke('blob_list'),
  };
  return { db, blobs, location: await invoke<string>('workspace_path'), restore: (bytes, files) => db.exclusive(() =>
    invoke('workspace_restore', { database: toBase64(bytes), blobs: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, toBase64(value)])) }), true) };
}
export function detectDesktopShell(kernel: Kernel): void {
  if (!isTauri()) return;
  kernel.latex.register({
    engine: 'xelatex', available: true, via: 'native',
    async compile(req) {
      const res = await invoke<{ ok: boolean; pdfBase64?: string; log: string }>('compile_latex', {
        source: req.source, engine: req.engine ?? 'xelatex', entry: req.entry ?? 'main.tex', files: req.files ?? {},
      });
      return { ok: res.ok, pdfBytes: res.pdfBase64 ? fromBase64(res.pdfBase64) : null, log: res.log, engine: req.engine ?? 'xelatex', via: 'native' };
    },
  });
}
