/**
 * Secret storage (DATABASE.md §4): secrets NEVER touch SQLite.
 * Adapters: OS keychain via Tauri (desktop), non-extractable WebCrypto key
 * (web), memory (tests). Values are namespaced by callers: `<pluginId>:<key>`.
 */
export interface SecretStoreAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemorySecretStore implements SecretStoreAdapter {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const KEY_DB = 'mpw-secrets';
const KEY_STORE = 'keys';
const ENV_STORE = 'envelopes';

/**
 * Web profile: AES-GCM with a NON-EXTRACTABLE key persisted in IndexedDB;
 * ciphertext envelopes in localStorage. The plaintext key never exists in
 * storage, so stolen envelopes are useless without the origin.
 */
export class WebCryptoSecretStore implements SecretStoreAdapter {
  private keyPromise: Promise<CryptoKey> | null = null;

  private async openDb(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(KEY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
        if (!db.objectStoreNames.contains(ENV_STORE)) db.createObjectStore(ENV_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    });
  }

  private async idbGet<T>(store: string, key: string): Promise<T | null> {
    const db = await this.openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async idbPut(store: string, key: string, value: unknown): Promise<void> {
    const db = await this.openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        const existing = await this.idbGet<CryptoKey>(KEY_STORE, 'master');
        if (existing) return existing;
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        await this.idbPut(KEY_STORE, 'master', key);
        return key;
      })();
    }
    return await this.keyPromise;
  }

  private envKey(key: string): string {
    return `mpw.env.${key}`;
  }

  async get(name: string): Promise<string | null> {
    const raw = localStorage.getItem(this.envKey(name));
    if (!raw) return null;
    try {
      const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
      const key = await this.getKey();
      const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
      const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, dataBytes);
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  async set(name: string, value: string): Promise<void> {
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(value)
    );
    const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    localStorage.setItem(this.envKey(name), JSON.stringify({ iv: toB64(iv), data: toB64(new Uint8Array(data)) }));
  }

  async delete(name: string): Promise<void> {
    localStorage.removeItem(this.envKey(name));
  }
}
