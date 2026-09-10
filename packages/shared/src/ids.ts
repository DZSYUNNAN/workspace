/** Time-ordered, lexicographically sortable UUID (UUIDv7). Sync-friendly primary keys. */
export function uuidv7(now: number = Date.now()): string {
  const ts = new Uint32Array(2);
  ts[0] = Math.floor(now / 2 ** 16);
  ts[1] = (now % 2 ** 16) >>> 0;
  const hex = ts[0].toString(16).padStart(8, '0') + ts[1].toString(16).padStart(4, '0');
  const rand = new Uint8Array(10);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256);
  }
  rand[0] = (rand[0] & 0x0f) | 0x60; // version 7
  rand[1] = (rand[1] & 0x3f) | 0x80; // variant
  const r = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(7, 19)}`;
}

export function nowMs(): number {
  return Date.now();
}
