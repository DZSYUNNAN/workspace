import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { CloseChoice } from '../src/shell/CloseDialog';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('close choice', () => {
  it('saves before exiting and offers taskbar minimize and cancel', async () => {
    const calls: string[] = []; const actions = { save: async () => { calls.push('save'); }, exit: async () => { calls.push('exit'); }, minimize: async () => { calls.push('minimize'); } };
    const el = document.createElement('div'); const root = createRoot(el); const cancel = vi.fn();
    await act(async () => root.render(<CloseChoice actions={actions} onCancel={cancel} />));
    const click = async (text: string) => act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === text)!.click(); });
    await click('取消'); expect(cancel).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
    await click('最小化到任务栏'); expect(calls).toEqual(['save', 'minimize']);
    await click('保存并退出'); expect(calls).toEqual(['save', 'minimize', 'save', 'exit']);
    await act(async () => root.unmount());
  });
  it('keeps the window open when saving fails', async () => {
    const actions = { save: vi.fn().mockRejectedValue(new Error('conflict')), exit: vi.fn(), minimize: vi.fn() };
    const el = document.createElement('div'); const root = createRoot(el);
    await act(async () => root.render(<CloseChoice actions={actions} onCancel={() => {}} />));
    await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === '保存并退出')!.click(); });
    expect(actions.exit).not.toHaveBeenCalled(); expect(el.querySelector('[role="alert"]')?.textContent).toContain('conflict');
    await act(async () => root.unmount());
  });
});
