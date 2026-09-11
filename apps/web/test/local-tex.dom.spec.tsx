import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { LocalDocuments } from '@mpw/shared';
import { LocalDocumentEditor } from '../../../plugins/writing/src/LocalDocumentEditor';
vi.mock('../../../plugins/writing/src/PdfPreview', () => ({ PdfPreview: ({ bytes }: { bytes: Uint8Array }) => <div aria-label="PDF test preview">{new TextDecoder().decode(bytes)}</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('local TeX editor compile flow', () => {
  it('saves the latest edit, compiles the selected engine and displays or clears the result', async () => {
    let saved = 'old'; const calls: string[] = []; let fail = false;
    const compile = vi.fn(async (_id: string, source: string, engine: string, expected: string) => {
      calls.push('compile'); expect(source).toBe(saved); expect(expected).toBe(saved);
      return fail ? { ok: false, log: '! Missing input file' } : { ok: true, pdfBase64: btoa('%PDF-fixture'), log: 'Output written' };
    });
    const manager = new LocalDocuments({
      open: async () => ({ id: 'tex', name: '主 稿.tex', path: '主 稿.tex', stamp: saved, bytes: new TextEncoder().encode(saved) }),
      read: vi.fn(), write: async (_id, bytes) => { saved = new TextDecoder().decode(bytes); calls.push('save'); return saved; }, compile,
    });
    const session = (await manager.open())!; const el = document.createElement('div'); const root = createRoot(el);
    await act(async () => root.render(<LocalDocumentEditor session={session} onDetach={async () => {}} />));
    await act(async () => session.edit(0, 'latest source'));
    await act(async () => { const select = el.querySelector('select')!; select.value = 'lualatex'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const clickCompile = async () => act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === '编译并预览 PDF')!.click(); });
    await clickCompile(); expect(calls).toEqual(['save', 'compile']); expect(compile.mock.calls[0][2]).toBe('lualatex');
    expect(el.querySelector('[aria-label="PDF test preview"]')?.textContent).toBe('%PDF-fixture'); expect(el.textContent).toContain('下载 PDF');
    await act(async () => session.edit(0, 'changed again')); expect(el.textContent).toContain('上一次编译结果');
    fail = true; await clickCompile(); expect(el.querySelector('[aria-label="PDF test preview"]')).toBeNull(); expect(el.textContent).toContain('Missing input file');
    await act(async () => root.unmount());
  });
  it('does not invoke the compiler if syncing the source fails', async () => {
    const compile = vi.fn(); const manager = new LocalDocuments({
      open: async () => ({ id: 'tex', name: 'main.tex', path: 'main.tex', stamp: 'old', bytes: new TextEncoder().encode('old') }),
      read: vi.fn(), write: vi.fn().mockRejectedValue(new Error('disk conflict')), compile,
    });
    const session = (await manager.open())!; session.edit(0, 'draft');
    await expect(session.compile('xelatex')).rejects.toThrow('disk conflict'); expect(compile).not.toHaveBeenCalled();
  });
  it('explains the desktop requirement for browser file handles', async () => {
    const manager = new LocalDocuments({ open: async () => ({ id: 'tex', name: 'main.tex', path: 'main.tex', stamp: '', bytes: new Uint8Array() }), read: vi.fn(), write: vi.fn() });
    const session = (await manager.open())!; await expect(session.compile('xelatex')).rejects.toThrow('Windows 桌面版');
  });
});
