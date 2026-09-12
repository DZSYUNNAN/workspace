import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContinuousPdf } from '../src/ContinuousPdf';

const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
const getPage = vi.fn(async (pageNumber: number) => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
  render: renderPage,
  getTextContent: async () => ({ items: [{ str: `page ${pageNumber}` }] }),
}));
const documentProxy = { numPages: 3, getPage, destroy: vi.fn() };

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({ promise: Promise.resolve(documentProxy), destroy: vi.fn() }),
  TextLayer: class {
    private container: HTMLDivElement;
    constructor({ container }: { container: HTMLDivElement }) { this.container = container; }
    async render(): Promise<void> { this.container.append(document.createElement('span')); }
    cancel(): void {}
  },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('ContinuousPdf', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => ({} as CanvasRenderingContext2D)) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders every page in one scrolling document and reports text selections', async () => {
    const selected = vi.fn();
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => { root.render(<ContinuousPdf bytes={new Uint8Array([1])} scale={1} onTextSelect={selected} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(element.querySelectorAll('[data-pdf-page]')).toHaveLength(3);
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));

    const host = element.querySelector<HTMLElement>('[data-pdf-page="2"]')!;
    const span = document.createElement('span');
    host.querySelector('.textLayer')!.append(span);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 110, bottom: 170, width: 100, height: 150, x: 10, y: 20, toJSON: () => ({}) });
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      anchorNode: span,
      focusNode: span,
      toString: () => 'selected text',
      getRangeAt: () => ({ getClientRects: () => [{ left: 20, top: 35, right: 70, bottom: 50, width: 50, height: 15 }] }),
    } as unknown as Selection);
    await act(async () => { host.querySelector<HTMLElement>('.textLayer')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    expect(selected).toHaveBeenCalledWith({ page: 2, text: 'selected text', rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.1 }] });
    await act(async () => root.unmount());
    element.remove();
  });
});
