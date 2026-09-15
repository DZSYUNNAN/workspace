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
    const clickCompile = async () => act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === '保存并编译')!.click(); });
    await clickCompile(); expect(calls).toEqual(['save', 'compile']); expect(compile.mock.calls[0][2]).toBe('lualatex');
    expect(el.querySelector('[aria-label="PDF test preview"]')?.textContent).toBe('%PDF-fixture'); expect(el.textContent).toContain('下载 PDF');
    await act(async () => session.edit(0, 'changed again')); expect(el.textContent).toContain('上一次编译结果');
    fail = true; await clickCompile(); expect(el.querySelector('[aria-label="PDF test preview"]')?.textContent).toBe('%PDF-fixture'); expect(el.textContent).toContain('Missing input file');
    await act(async () => root.unmount());
  });
  it('builds output and rewrite prompts without compiling or changing the source', async () => {
    const { buildPaperAiRequest, PAPER_AI_ACTIONS } = await import('../../../plugins/writing/src/paperAi');
    const translation = buildPaperAiRequest('zh-en', '中文段落', '', '不应翻译的论文全文');
    expect(translation.system).toContain('publication-ready English');
    expect(translation.prompt).toBe('中文段落');
    expect(translation.prompt).not.toContain('论文全文');
    expect(buildPaperAiRequest('review', '重点检查证据', '', '\\section{Result}').prompt).toBe('重点检查证据');
    expect(buildPaperAiRequest('rewrite', '改写摘要', '\\begin{abstract}x', 'source').prompt).toContain('Current TeX selection');
    expect(buildPaperAiRequest('rewrite-abstract', '', '', '\\begin{abstract}x').system).toContain('context, gap, approach');
    expect(PAPER_AI_ACTIONS.map((action) => action.label)).toEqual(expect.arrayContaining(['自由指令', '中译英', '英译中', '学术英文润色', '中文学术润色', '一键写出全部章节', '摘要', '实验分析', '结论']));
  });
  it('uses the unified assistant write-back without refreshing the compiled PDF', async () => {
    const compile = vi.fn().mockResolvedValue({ ok: true, pdfBase64: btoa('%PDF-before-ai'), log: 'ok' });
    const manager = new LocalDocuments({
      open: async () => ({ id: 'tex-ai', name: 'paper.tex', path: 'paper.tex', stamp: 'source', bytes: new TextEncoder().encode('source') }),
      read: vi.fn(), write: vi.fn().mockResolvedValue('source'), compile,
    });
    let applyOutput: ((payload: unknown) => void) | undefined;
    const ctx = { commands: { execute: vi.fn().mockResolvedValue(null) }, events: { emit: vi.fn(), on: vi.fn((type: string, handler: (payload: unknown) => void) => { if (type === 'writing:apply-ai-output') applyOutput = handler; return () => {}; }) } };
    const session = (await manager.open())!; const el = document.createElement('div'); const root = createRoot(el);
    await act(async () => root.render(<LocalDocumentEditor session={session} ctx={ctx as never} onDetach={async () => {}} />));
    await act(async () => [...el.querySelectorAll('button')].find((button) => button.textContent === '保存并编译')!.click());
    expect(el.querySelector('[aria-label="PDF test preview"]')?.textContent).toBe('%PDF-before-ai');
    expect(el.textContent).not.toContain('发送到 AI');
    await act(async () => applyOutput?.({ text: 'polished output', targetLabel: '本地 TeX: paper.tex' }));
    expect(compile).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[aria-label="PDF test preview"]')?.textContent).toBe('%PDF-before-ai');
    expect(session.texts[0]).toContain('polished output');
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
