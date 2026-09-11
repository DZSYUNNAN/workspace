import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';
import { Kernel, openMemoryDb, type PluginContext } from '@mpw/kernel';
import notes from '@mpw/plugin-notes';
import writing from '@mpw/plugin-writing';
import { NotesView } from '../../../plugins/notes/src/NotesView';
import { WritingView } from '../../../plugins/writing/src/WritingView';
import { createNote } from '../../../plugins/notes/src/store';
import { createDoc, getDoc, updateDoc } from '../../../plugins/writing/src/store';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context = (k: Kernel, id: string): PluginContext => (k as unknown as { createContext(id: string): PluginContext }).createContext(id);
async function setup() {
  const db = await openMemoryDb(); const kernel = new Kernel({ db });
  kernel.registerBuiltins([notes, writing]); await kernel.boot();
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  return { db, kernel, el, root };
}
function input(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
describe('editing survives navigation', () => {
  it('opens the requested note instead of overwriting it with the previous selection', async () => {
    const { db, kernel, el, root } = await setup(); const ctx = context(kernel, 'mpw.notes');
    const previous = await createNote(ctx, 'Previous');
    const requested = await createNote(ctx, 'Requested');
    await ctx.storage.set('ui.openId', requested.id);
    await act(async () => root.render(<NotesView ctx={ctx} activeId={previous.id} setActiveId={() => {}} />));
    expect([...el.querySelectorAll('input')].some((node) => node.value === 'Requested')).toBe(true);
    expect(await ctx.storage.get('ui.openId', null)).toBe(requested.id);
    await act(async () => root.unmount()); el.remove(); db.close();
  });
  it('persists the last note keystroke before immediate unmount', async () => {
    const { db, kernel, el, root } = await setup(); const ctx = context(kernel, 'mpw.notes');
    const note = await createNote(ctx, 'Original');
    await act(async () => root.render(<NotesView ctx={ctx} activeId={note.id} setActiveId={() => {}} />));
    await act(async () => input(el.querySelector('textarea')!, 'Last keystroke'));
    await act(async () => root.unmount());
    expect(db.one('SELECT body_md FROM p_notes_notes WHERE id = ?', [note.id])?.body_md).toBe('Last keystroke');
    el.remove(); db.close();
  });
  it('opening another document never writes the previous document over it', async () => {
    const { db, kernel, el, root } = await setup(); const ctx = context(kernel, 'mpw.writing');
    const a = await createDoc(ctx, 'Document A', 'rich'); const b = await createDoc(ctx, 'Document B', 'rich');
    await updateDoc(ctx, a.id, { content: '<p>Alpha</p>' }); await updateDoc(ctx, b.id, { content: '<p>Beta</p>' });
    await act(async () => root.render(<WritingView ctx={ctx} />));
    const clickDoc = async (title: string) => act(async () => { const button = [...el.querySelectorAll('button')].find((n) => n.textContent?.includes(title)); expect(button).toBeDefined(); button!.click(); });
    await clickDoc('Document A');
    await act(async () => { const editor = el.querySelector('[contenteditable="true"]')!; editor.innerHTML = '<p>Latest Alpha</p>'; editor.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickDoc('Document B');
    expect(el.querySelector('[contenteditable="true"]')?.textContent).toBe('Beta');
    await act(async () => root.unmount());
    expect((await getDoc(ctx, a.id))?.content).toBe('<p>Latest Alpha</p>');
    expect((await getDoc(ctx, b.id))?.content).toBe('<p>Beta</p>');
    el.remove(); db.close();
  });
});
