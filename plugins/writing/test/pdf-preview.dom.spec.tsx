import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { PdfPreview } from '../src/PdfPreview';

vi.mock('@mpw/ui', () => ({ ContinuousPdf: () => <div aria-label="continuous PDF" /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('paper PDF review controls', () => {
  it('exposes zoom controls, continuous review, and a horizontal slider', async () => {
    const element = document.createElement('div'); const root = createRoot(element);
    await act(async () => root.render(<PdfPreview bytes={new Uint8Array([1])} />));
    expect(element.querySelector('[aria-label="PDF 缩放"]')).toBeTruthy();
    expect(element.querySelector('[aria-label="缩小 PDF"]')).toBeTruthy();
    expect(element.querySelector('[aria-label="放大 PDF"]')).toBeTruthy();
    expect(element.querySelector<HTMLInputElement>('[aria-label="PDF 横向查看位置"]')?.type).toBe('range');
    expect(element.textContent).toContain('连续滚动');
    await act(async () => root.unmount());
  });
});
