import { invoke } from '@tauri-apps/api/core';
import { LocalDocuments, EDITABLE_EXTENSIONS, type LocalFile, type LocalFileAdapter } from '@mpw/shared';
import { isTauri, toBase64 } from './desktop';
interface NativeFile { id: string; name: string; path: string; data: string; stamp: string }
const unpack = (f: NativeFile): LocalFile => ({ ...f, bytes: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) });
const hash = async (bytes: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map((b) => b.toString(16).padStart(2, '0')).join('');
interface FileHandle {
  name: string; getFile(): Promise<File>; isSameEntry(other: FileHandle): Promise<boolean>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export function createLocalDocuments(): LocalDocuments {
  if (isTauri()) return new LocalDocuments({
    open: async () => { const f = await invoke<NativeFile | null>('local_file_open'); return f ? unpack(f) : null; },
    read: async (id) => unpack(await invoke<NativeFile>('local_file_read', { id })),
    write: (id, bytes, expected) => invoke('local_file_write', { id, data: toBase64(bytes), expected }),
    compile: (id, source, engine, expected) => invoke('local_file_compile', { id, source, engine, expected }),
    synctex: (id, page, x, y) => invoke('local_file_synctex', { id, page, x, y }),
  });
  const handles = new Map<string, FileHandle>(); const backedUp = new Set<string>();
  const adapter: LocalFileAdapter = {
    open: async () => {
      const picker = (window as unknown as { showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]> }).showOpenFilePicker;
      if (!picker) throw new Error('当前浏览器不支持原文件同步，请使用 Windows 桌面版或新版 Edge / Chrome。');
      try {
        const [handle] = await picker.call(window, { multiple: false, types: [{ description: '可编辑文档', accept: { 'application/octet-stream': EDITABLE_EXTENSIONS.map((e) => `.${e}`) } }] });
        if (!handle) return null;
        let id = ''; for (const [key, stored] of handles) if (await handle.isSameEntry(stored)) id = key;
        if (!id) { id = crypto.randomUUID(); handles.set(id, handle); }
        return adapter.read(id);
      } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return null; throw e; }
    },
    read: async (id) => {
      const handle = handles.get(id); if (!handle) throw new Error('请重新选择本地文件');
      const file = await handle.getFile(); if (file.size > 32 * 1024 * 1024) throw new Error('可编辑文件上限为 32 MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { id, name: handle.name, path: handle.name, bytes, stamp: await hash(bytes) };
    },
    write: async (id, bytes, expected) => {
      const before = await adapter.read(id);
      if (before.stamp !== expected) throw new Error('本地文件已被其他程序修改，已暂停同步。请下载当前编辑副本后重新读取。');
      const writer = await handles.get(id)!.createWritable();
      try {
        // Permission UI may take time; verify again after acquiring the writable stream.
        if ((await adapter.read(id)).stamp !== expected) throw new Error('授权期间本地文件已改变，请重新读取');
        if (!backedUp.has(id)) {
          const url = URL.createObjectURL(new Blob([before.bytes.slice().buffer])); const link = document.createElement('a');
          link.href = url; link.download = `${before.name}.modudesk-original.bak`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); backedUp.add(id);
        }
        await writer.write(bytes); await writer.close(); return hash(bytes);
      } catch (e) { await writer.abort().catch(() => {}); throw e; }
    },
  };
  return new LocalDocuments(adapter);
}
