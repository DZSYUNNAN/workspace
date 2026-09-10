export interface StoredBlob {
  bytes: Uint8Array;
  mime: string;
}

/** Platform seam: IndexedDB on web, app-data FS on desktop, Capacitor FS on mobile. */
export interface BlobStoreAdapter {
  put(ref: string, bytes: Uint8Array): Promise<void>;
  get(ref: string): Promise<StoredBlob | null>;
  delete(ref: string): Promise<void>;
  listRefs(): Promise<string[]>;
}

/** Deterministic, dependency-free content hash for blob addressing. */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h1 = (Math.imul(h1 ^ bytes[i] as number, 0x01000193) >>> 0) ^ (h1 << 3 >>> 0);
    h2 = (Math.imul(h2 + (bytes[i] as number), 0x85ebca6b) >>> 0) ^ (h2 >>> 7);
  }
  return `b_${h1.toString(16)}${h2.toString(16)}_${bytes.length.toString(16)}`;
}

export interface BlobRefMeta {
  ref: string;
  path: string;
  mime: string;
  size: number;
}

/**
 * Content-addressed blob store. Metadata lives in SQLite (blob_meta); bytes in
 * the adapter — large files never bloat the SQL database (DATABASE.md §4).
 */
export class BlobStore {
  constructor(private adapter: BlobStoreAdapter, private db: import('./db').DbAdapter) {}

  async put(path: string, data: Blob | Uint8Array, mime = 'application/octet-stream'): Promise<BlobRefMeta> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const ref = hashBytes(bytes);
    await this.adapter.put(ref, bytes);
    const existing = this.db.one('SELECT ref FROM blob_meta WHERE ref = ?', [ref]);
    if (!existing) {
      this.db.run('INSERT INTO blob_meta (ref, path, mime, size, created_at) VALUES (?, ?, ?, ?, ?)', [
        ref,
        path,
        mime,
        bytes.length,
        Date.now(),
      ]);
    }
    return { ref, path, mime, size: bytes.length };
  }

  async get(ref: string): Promise<StoredBlob | null> {
    return await this.adapter.get(ref);
  }

  async delete(ref: string): Promise<void> {
    await this.adapter.delete(ref);
    this.db.run('DELETE FROM blob_meta WHERE ref = ?', [ref]);
  }

  list(prefix?: string): BlobRefMeta[] {
    const rows = prefix
      ? this.db.all('SELECT * FROM blob_meta WHERE path LIKE ? ORDER BY created_at', [`${prefix}%`])
      : this.db.all('SELECT * FROM blob_meta ORDER BY created_at');
    return rows.map((r) => ({
      ref: r['ref'] as string,
      path: r['path'] as string,
      mime: r['mime'] as string,
      size: r['size'] as number,
    }));
  }

  async byteSize(): Promise<number> {
    const row = this.db.one('SELECT SUM(size) AS s FROM blob_meta');
    return (row?.['s'] as number) ?? 0;
  }
}

/** In-memory adapter — tests and fallback. */
export class MemoryBlobStore implements BlobStoreAdapter {
  private map = new Map<string, Uint8Array>();
  async put(ref: string, bytes: Uint8Array): Promise<void> {
    this.map.set(ref, bytes);
  }
  async get(ref: string): Promise<StoredBlob | null> {
    const b = this.map.get(ref);
    return b ? { bytes: b, mime: 'application/octet-stream' } : null;
  }
  async delete(ref: string): Promise<void> {
    this.map.delete(ref);
  }
  async listRefs(): Promise<string[]> {
    return [...this.map.keys()];
  }
}
