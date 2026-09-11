import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SqlJsAdapter, type BlobStoreAdapter, type DbAdapter, type StoredBlob } from '@mpw/kernel';
import { DurableDb } from './durableDb';

/* ------------------------- SQLite (sql.js + IndexedDB) ------------------------- */

const DB_FILE_KEY = 'mpw.sqlite';
const DB_NAME = 'mpw';
const KV_STORE = 'kv';
const BLOB_STORE = 'blobs';

function openIdb(name: string, version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`indexedDB open failed: ${name}`));
  });
}

async function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | null> {
  return await new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** SQLite over sql.js, persisted to IndexedDB with debounced saves. */
export class PersistedDbAdapter extends DurableDb {
  private constructor(
    inner: SqlJsAdapter,
    private idb: IDBDatabase
  ) { super(inner, (bytes) => idbPut(idb, KV_STORE, DB_FILE_KEY, bytes.slice().buffer)); }

  static async open(locateFileOverride?: (file: string) => string, databaseName = DB_NAME): Promise<PersistedDbAdapter> {
    const SQL = await initSqlJs({ locateFile: locateFileOverride ?? (() => wasmUrl) });
    const idb = await openIdb(databaseName, 1, (db) => {
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    });
    const saved = await idbGet<ArrayBuffer>(idb, KV_STORE, DB_FILE_KEY);
    const database = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    return new PersistedDbAdapter(new SqlJsAdapter(database), idb);
  }

  async restore(bytes: Uint8Array, blobs: Record<string, Uint8Array>): Promise<void> {
    await this.exclusive(() => new Promise<void>((resolve, reject) => {
      const tx = this.idb.transaction([KV_STORE, BLOB_STORE], 'readwrite');
      try {
      // Previous complete workspace stays recoverable in the same atomic transaction.
      const kv = tx.objectStore(KV_STORE);
      kv.put(this.export().slice().buffer, 'mpw.before-restore.sqlite');
      kv.put(bytes.slice().buffer, DB_FILE_KEY);
      const store = tx.objectStore(BLOB_STORE);
      // Keep old blobs for recovery; imported refs have already been validated.
      for (const [ref, data] of Object.entries(blobs)) store.put({ bytes: data.slice().buffer }, ref);
      } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('恢复事务已取消'));
      tx.onerror = () => reject(tx.error);
    }), true);
  }
  override close(): void {
    super.close(); this.idb.close();
  }
}

/* ------------------------------ blob store (IDB) ------------------------------ */

export class IndexedDbBlobStore implements BlobStoreAdapter {
  private db: IDBDatabase | null = null;
  constructor(private databaseName = DB_NAME) {}

  private async conn(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openIdb(this.databaseName, 1, (d) => {
        if (!d.objectStoreNames.contains(KV_STORE)) d.createObjectStore(KV_STORE);
        if (!d.objectStoreNames.contains(BLOB_STORE)) d.createObjectStore(BLOB_STORE);
      });
    }
    return this.db;
  }

  async put(ref: string, bytes: Uint8Array): Promise<void> {
    const db = await this.conn();
    await idbPut(db, BLOB_STORE, ref, { bytes: bytes.buffer.slice(bytes.byteOffset) });
  }

  async get(ref: string): Promise<StoredBlob | null> {
    const db = await this.conn();
    const v = await idbGet<{ bytes: ArrayBuffer }>(db, BLOB_STORE, ref);
    return v ? { bytes: new Uint8Array(v.bytes), mime: 'application/octet-stream' } : null;
  }

  async delete(ref: string): Promise<void> {
    const db = await this.conn();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).delete(ref);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async listRefs(): Promise<string[]> {
    const db = await this.conn();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(BLOB_STORE, 'readonly').objectStore(BLOB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  }
}
