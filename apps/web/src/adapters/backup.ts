import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { CORE_MIGRATIONS, type BlobStoreAdapter } from '@mpw/kernel';
import type { DurableDb } from './durableDb';

const MAX_BYTES = 512 * 1024 * 1024;
interface Manifest { format: 'modudesk'; version: 1; createdAt: string; files: Record<string, { size: number; sha256: string }> }
export interface BackupData { database: Uint8Array; blobs: Record<string, Uint8Array>; createdAt: string }
export interface WorkspaceData {
  db: DurableDb;
  blobs: BlobStoreAdapter;
  restore(database: Uint8Array, blobs: Record<string, Uint8Array>): Promise<void>;
  location: string;
}
const digest = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function createBackup(data: WorkspaceData): Promise<Uint8Array> {
  return data.db.exclusive(async () => {
    const files: Record<string, Uint8Array> = { 'workspace.sqlite': data.db.export() };
    let size = files['workspace.sqlite'].length;
    for (const row of data.db.all('SELECT ref, size FROM blob_meta')) {
      const ref = String(row.ref);
      if (!/^[a-zA-Z0-9_-]+$/.test(ref)) throw new Error('附件引用无效');
      const blob = await data.blobs.get(ref);
      if (!blob || blob.bytes.length !== row.size) throw new Error(`附件缺失或损坏：${ref}`);
      size += blob.bytes.length;
      if (size > MAX_BYTES) throw new Error('当前备份上限为 512 MB');
      files[`blobs/${ref}`] = blob.bytes;
    }
    const manifest: Manifest = { format: 'modudesk', version: 1, createdAt: new Date().toISOString(), files: {} };
    for (const [name, bytes] of Object.entries(files)) manifest.files[name] = { size: bytes.length, sha256: await digest(bytes) };
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    return zipSync(files, { level: 0 });
  });
}

/** Validate every byte and required SQL table before touching the destination. */
export async function readBackup(bytes: Uint8Array, locateFile = (_file: string) => wasmUrl): Promise<BackupData> {
  if (bytes.length > MAX_BYTES + 1024 * 1024) throw new Error('备份超过 512 MB 上限');
  let total = 0;
  const files = unzipSync(bytes, { filter: (file) => {
    total += file.originalSize;
    if (total > MAX_BYTES + 1024 * 1024) throw new Error('解压后的备份过大');
    if (!/^(manifest\.json|workspace\.sqlite|blobs\/[a-zA-Z0-9_-]+)$/.test(file.name)) throw new Error('备份包含无效路径');
    return true;
  } });
  if (!files['manifest.json']) throw new Error('不是 ModuDesk 备份文件');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest;
  if (manifest.format !== 'modudesk' || manifest.version !== 1 || !manifest.files || typeof manifest.createdAt !== 'string') throw new Error('备份格式或版本不支持');
  if (Object.keys(files).length !== Object.keys(manifest.files).length + 1) throw new Error('备份清单不完整');
  for (const [name, meta] of Object.entries(manifest.files)) {
    const file = files[name];
    if (name === 'manifest.json' || !file || file.length !== meta.size || await digest(file) !== meta.sha256) throw new Error(`备份校验失败：${name}`);
  }
  const database = files['workspace.sqlite'];
  if (!database) throw new Error('缺少数据库');
  const SQL = await initSqlJs({ locateFile });
  const check = new SQL.Database(database);
  try {
    if (check.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('数据库完整性检查失败');
    const required = ['schema_migrations', 'settings', 'workspaces', 'layouts', 'plugins', 'plugin_kv', 'blob_meta'];
    const tables = new Set(check.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map((r) => r[0]));
    if (required.some((t) => !tables.has(t))) throw new Error('数据库缺少必要表');
    const version = Number(check.exec('SELECT MAX(version) FROM schema_migrations')[0]?.values[0]?.[0]);
    if (!version || version > Math.max(...CORE_MIGRATIONS.map((m) => m.version))) throw new Error('备份数据库版本不支持');
    for (const [ref, size] of check.exec('SELECT ref, size FROM blob_meta')[0]?.values ?? []) {
      if (!files[`blobs/${ref}`] || files[`blobs/${ref}`].length !== size) throw new Error(`备份缺少附件：${ref}`);
    }
  } finally { check.close(); }
  const blobs: Record<string, Uint8Array> = {};
  for (const [name, file] of Object.entries(files)) if (name.startsWith('blobs/')) blobs[name.slice(6)] = file;
  return { database, blobs, createdAt: manifest.createdAt };
}
