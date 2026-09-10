import { describe, expect, it } from 'vitest';
import {
  areaOf,
  closeWidget,
  dockFloat,
  floatWidget,
  insertAtZone,
  isWidgetPresent,
  moveWidgetToArea,
  removeEverywhere,
  resizeFloat,
  setSplitRatio,
} from '../src/workspace/layoutOps';
import { emptyLayout, leaf, tabs, split, collectWidgetIds, findWidget } from '@mpw/shared';

describe('layout operations (workspace canvas reducer)', () => {
  it('drop zones split the target area in the right direction', () => {
    expect(insertAtZone(leaf('a'), 'b', 'west')).toEqual({
      kind: 'split', dir: 'row', ratio: 0.5, a: leaf('b'), b: leaf('a'),
    });
    expect(insertAtZone(leaf('a'), 'b', 'south')).toEqual({
      kind: 'split', dir: 'col', ratio: 0.5, a: leaf('a'), b: leaf('b'),
    });
    expect(insertAtZone(leaf('a'), 'b', 'center')).toEqual({ kind: 'tabs', items: ['a', 'b'], active: 1 });
  });

  it('center drop on a tab stack appends and activates', () => {
    const t = tabs(['a', 'b'], 0);
    const next = insertAtZone(t, 'c', 'center');
    expect(next).toEqual({ kind: 'tabs', items: ['a', 'b', 'c'], active: 2 });
  });

  it('moves widgets between areas, including out of tab stacks', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, left: tabs(['notes', 'files'], 0), center: leaf('editor') } };
    l = moveWidgetToArea(l, 'notes', 'right', 'center');
    expect(areaOf(l, 'notes')).toBe('right');
    expect(l.areas.left).toEqual(leaf('files')); // tabstack collapsed to leaf
    expect(l.areas.right).toEqual(leaf('notes'));
  });

  it('re-adding the only widget of an area to itself is a no-op', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, center: leaf('editor') } };
    const next = moveWidgetToArea(l, 'editor', 'center', 'center');
    expect(next.areas.center).toEqual(leaf('editor'));
  });

  it('floating removes from docks; docking restores', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, center: leaf('editor') } };
    l = floatWidget(l, 'editor', 30, 40);
    expect(l.areas.center).toBeNull();
    expect(l.floats).toHaveLength(1);
    expect(l.floats[0]).toMatchObject({ widgetId: 'editor', x: 30, y: 40 });
    l = resizeFloat(l, 'editor', 100, 90); // clamped to min size
    expect(l.floats[0]?.w).toBe(240);
    l = dockFloat(l, 'editor', 'center');
    expect(l.areas.center).toEqual(leaf('editor'));
    expect(l.floats).toHaveLength(0);
  });

  it('closing a widget removes it everywhere and self-heals trees', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, center: split('row', 0.5, tabs(['a', 'b'], 1), leaf('c')) } };
    l = closeWidget(l, 'b');
    expect(l.areas.center).toEqual(split('row', 0.5, leaf('a'), leaf('c')));
    l = closeWidget(l, 'a');
    expect(l.areas.center).toEqual(leaf('c'));
    l = closeWidget(l, 'c');
    expect(l.areas.center).toBeNull();
  });

  it('setSplitRatio clamps to safe bounds', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, center: split('row', 0.5, leaf('a'), leaf('b')) } };
    l = setSplitRatio(l, 'center', [], 0.99);
    expect((l.areas.center as { ratio: number }).ratio).toBe(0.85);
    l = setSplitRatio(l, 'center', [], 0.01);
    expect((l.areas.center as { ratio: number }).ratio).toBe(0.15);
  });

  it('removeEverywhere clears both docks and floats', () => {
    let l = emptyLayout();
    l = { ...l, areas: { ...l.areas, left: leaf('x'), center: leaf('y') }, floats: [{ id: 'f', widgetId: 'z', x: 0, y: 0, w: 100, h: 100, z: 1 }] };
    l = removeEverywhere(l, 'x');
    expect(isWidgetPresent(l, 'x')).toBe(false);
    expect(collectWidgetIds(l)).toEqual(new Set(['y', 'z']));
    expect(findWidget(l.areas.left, 'x')).toBeNull();
  });
});
