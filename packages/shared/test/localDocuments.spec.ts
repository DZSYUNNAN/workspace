import { describe, it, expect, vi } from 'vitest';
import { LocalDocuments, type LocalFileAdapter } from '../src/localDocuments';
const bytes = (text: string) => new TextEncoder().encode(text);
function fixture() {
  let text = 'old'; const writes: string[] = [];
  const adapter: LocalFileAdapter = {
    open: async () => ({ id: 'selected', name: 'test.md', path: 'test.md', bytes: bytes(text), stamp: text }),
    read: async () => (await adapter.open())!,
    write: async (_id, value, expected) => { if (text !== expected) throw new Error('external conflict'); text = new TextDecoder().decode(value); writes.push(text); return text; },
  };
  return { manager: new LocalDocuments(adapter), adapter, writes, external: (v: string) => { text = v; }, stored: () => text };
}
describe('local sync lifecycle', () => {
  it('flushes the last input on exit before the debounce and reuses open sessions', async () => {
    const f = fixture(); const session = (await f.manager.open())!; session.edit(0, 'latest');
    expect(f.manager.unsaved).toBe(true); await f.manager.flush();
    expect(f.stored()).toBe('latest'); expect(f.manager.unsaved).toBe(false);
    expect(await f.manager.open()).toBe(session);
  });
  it('serializes edits arriving while a write is in progress', async () => {
    const f = fixture(); const write = f.adapter.write; let release: () => void = () => {};
    f.adapter.write = async (...args) => { await new Promise<void>((r) => { release = r; }); return write(...args); };
    const s = (await f.manager.open())!; s.edit(0, 'first'); const saving = s.flush(); await Promise.resolve();
    s.edit(0, 'last'); f.adapter.write = write; release(); await saving;
    expect(f.writes).toEqual(['first', 'last']); expect(s.phase).toBe('saved');
  });
  it('keeps edits after conflicts and does not overwrite the external file', async () => {
    const f = fixture(); const s = (await f.manager.open())!; s.edit(0, 'mine'); f.external('external');
    await expect(f.manager.flush()).rejects.toThrow('conflict'); expect(s.phase).toBe('error');
    s.edit(0, 'new draft'); expect(s.phase).toBe('error'); expect(f.stored()).toBe('external');
    expect(new TextDecoder().decode(s.snapshot())).toBe('new draft');
    await s.reload(); expect(s.texts).toEqual(['external']); expect(f.manager.unsaved).toBe(false);
  });
  it('retains unsaved state on disk failure and retries explicitly', async () => {
    const f = fixture(); const write = f.adapter.write; f.adapter.write = vi.fn().mockRejectedValue(new Error('disk full'));
    const s = (await f.manager.open())!; s.edit(0, 'draft'); await expect(s.flush()).rejects.toThrow('disk full');
    expect(f.manager.unsaved).toBe(true); f.adapter.write = write; await s.flush(); expect(f.stored()).toBe('draft');
  });
  it('detaches a conflicted file after the caller preserves its editable snapshot', async () => {
    const f = fixture(); const s = (await f.manager.open())!; s.edit(0, 'draft'); f.external('external');
    await expect(s.flush()).rejects.toThrow(); const copy = s.snapshot(); await f.manager.detach(s);
    expect(new TextDecoder().decode(copy)).toBe('draft'); expect(f.stored()).toBe('external');
    expect(f.manager.sessions).toHaveLength(0); expect(f.manager.unsaved).toBe(false);
  });
  it('routes SyncTeX coordinates only through an authorized desktop adapter', async () => {
    const f = fixture(); const locate = vi.fn().mockResolvedValue({ line: 12, column: 4, source: 'paper.tex' });
    f.adapter.open = async () => ({ id: 'selected', name: 'paper.tex', path: 'paper.tex', bytes: bytes('source'), stamp: 'source' });
    f.adapter.synctex = locate;
    const session = (await f.manager.open())!;
    await expect(session.synctex(2, 72.5, 110)).resolves.toEqual({ line: 12, column: 4, source: 'paper.tex' });
    expect(locate).toHaveBeenCalledWith('selected', 2, 72.5, 110);
  });
});
