import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect } from 'vitest';
import { LocalDocuments } from '@mpw/shared';
import { LocalDocumentEditor } from '../../../plugins/writing/src/LocalDocumentEditor';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('keeps a local edit queued after leaving the editor and restores it on remount', async () => {
  let stored = 'old'; const file = () => ({ id: 'test', name: '本地.md', path: '本地.md', bytes: new TextEncoder().encode(stored), stamp: stored });
  const manager = new LocalDocuments({ open: async () => file(), read: async () => file(), write: async (_id, bytes) => { stored = new TextDecoder().decode(bytes); return stored; } });
  const session = (await manager.open())!; const el = document.createElement('div'); document.body.append(el); let root = createRoot(el);
  await act(async () => root.render(<LocalDocumentEditor session={session} onDetach={async () => {}} />));
  await act(async () => { const input = el.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '最新修改'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => root.unmount()); await manager.flush(); expect(stored).toBe('最新修改');
  root = createRoot(el); await act(async () => root.render(<LocalDocumentEditor session={session} onDetach={async () => {}} />));
  expect(el.querySelector('textarea')?.value).toBe('最新修改'); expect(el.textContent).toContain('已同步到原文件');
  await act(async () => root.unmount()); el.remove();
});
