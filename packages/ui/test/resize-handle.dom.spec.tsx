import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from '../src/index';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('ResizeHandle', () => {
  it('reports incremental pointer movement with edge direction', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host); const resize = vi.fn();
    await act(async () => root.render(<ResizeHandle direction={-1} onDelta={resize} />));
    const handle = host.querySelector('[role="separator"]') as HTMLElement;
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 80 }));
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 70 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 70 }));
    });
    expect(resize.mock.calls).toEqual([[20], [10]]);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
    await act(async () => root.unmount()); host.remove();
  });
});
