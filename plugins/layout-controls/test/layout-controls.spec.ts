import { describe, expect, it } from 'vitest';
import { applyLayoutSizeAction, type LayoutControlSnapshot, type LayoutState } from '@mpw/shared';
import { layoutWindows } from '../src/layoutWindows';

const layout: LayoutState = {
  version: 1,
  areas: {
    left: { kind: 'leaf', widgetId: 'mpw.files/browser' },
    center: { kind: 'split', dir: 'row', ratio: 0.4, a: { kind: 'leaf', widgetId: 'mpw.notes/list' }, b: { kind: 'tabs', items: ['mpw.writing/editor', 'mpw.references/library'], active: 0 } },
    right: null, top: null, bottom: null,
  },
  sizes: { leftW: 250, rightW: 340, topH: 180, bottomH: 160 },
  floats: [{ id: 'mail', widgetId: 'mpw.email/client', x: 10, y: 20, w: 600, h: 450, z: 11 }],
};
const snapshot: LayoutControlSnapshot = {
  layout,
  routes: [{ key: 'mpw.email/main', title: '邮箱', icon: 'mail' }],
  widgets: [
    { key: 'mpw.files/browser', title: '文件', icon: 'folder' },
    { key: 'mpw.notes/list', title: '笔记', icon: 'note' },
    { key: 'mpw.writing/editor', title: '写作', icon: 'pen' },
    { key: 'mpw.references/library', title: '文献库', icon: 'book' },
    { key: 'mpw.email/client', title: '邮箱', icon: 'mail' },
  ],
};

describe('layout size controls', () => {
  it('describes docked panes, shared tabs and floating window dimensions', () => {
    const windows = layoutWindows(snapshot);
    expect(windows).toHaveLength(5);
    expect(windows.find((item) => item.widgetId === 'mpw.files/browser')).toMatchObject({ location: 'left', title: '文件' });
    expect(windows.find((item) => item.widgetId === 'mpw.notes/list')?.split).toMatchObject({ path: [], branch: 'a', direction: 'row', ratio: 0.4 });
    expect(windows.find((item) => item.widgetId === 'mpw.writing/editor')?.split).toMatchObject({ path: [], branch: 'b' });
    expect(windows.find((item) => item.widgetId === 'mpw.email/client')).toMatchObject({ location: 'float', width: 600, height: 450 });
  });

  it('clamps and persists area, split and floating sizes without changing positions', () => {
    const area = applyLayoutSizeAction(layout, { kind: 'area', area: 'left', size: 5000 });
    expect(area.sizes.leftW).toBe(800);
    const split = applyLayoutSizeAction(layout, { kind: 'split', area: 'center', path: [], ratio: 0.65 });
    expect(split.areas.center).toMatchObject({ kind: 'split', ratio: 0.65 });
    const floating = applyLayoutSizeAction(layout, { kind: 'float', widgetId: 'mpw.email/client', width: 720, height: 510 });
    expect(floating.floats[0]).toMatchObject({ x: 10, y: 20, w: 720, h: 510 });
  });

  it('resets all split and window dimensions', () => {
    const reset = applyLayoutSizeAction(layout, { kind: 'reset' });
    expect(reset.sizes).toEqual({ leftW: 250, rightW: 340, topH: 180, bottomH: 160 });
    expect(reset.areas.center).toMatchObject({ kind: 'split', ratio: 0.5 });
    expect(reset.floats[0]).toMatchObject({ w: 520, h: 400 });
  });

  it('stores module pane sizes and sidebar visibility independently', () => {
    const resized = applyLayoutSizeAction(layout, { kind: 'modulePane', key: 'localTexPreviewPercent', size: 67 });
    expect(resized.moduleSizes?.localTexPreviewPercent).toBe(67);
    const hidden = applyLayoutSizeAction(resized, { kind: 'sidebarVisibility', routeKey: 'mpw.email/main', visible: false });
    expect(hidden.sidebar?.hiddenRouteKeys).toContain('mpw.email/main');
    const shown = applyLayoutSizeAction(hidden, { kind: 'showAllSidebarRoutes' });
    expect(shown.sidebar?.hiddenRouteKeys).toEqual([]);
  });
});
