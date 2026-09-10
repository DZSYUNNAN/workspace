import type { DockArea, LayoutState, PaneTree } from '@mpw/shared';
import { removeWidget } from '@mpw/shared';

export type DropZone = 'north' | 'south' | 'west' | 'east' | 'center';

/** Remove a widget from all dock areas and floats. */
export function removeEverywhere(state: LayoutState, widgetId: string): LayoutState {
  const areas = { ...state.areas };
  for (const area of Object.keys(areas) as DockArea[]) {
    areas[area] = removeWidget(areas[area], widgetId);
  }
  return { ...state, areas, floats: state.floats.filter((f) => f.widgetId !== widgetId) };
}

function tabify(tree: PaneTree, widgetId: string): PaneTree {
  if (tree.kind === 'leaf') return { kind: 'tabs', items: [tree.widgetId, widgetId], active: 1 };
  if (tree.kind === 'tabs') return { kind: 'tabs', items: [...tree.items, widgetId], active: tree.items.length };
  return { kind: 'split', dir: 'col', ratio: 0.5, a: tree, b: { kind: 'leaf', widgetId } };
}

function leafOf(widgetId: string): PaneTree {
  return { kind: 'leaf', widgetId };
}

/** Insert widgetId into a pane tree at a drop zone. */
export function insertAtZone(tree: PaneTree | null, widgetId: string, zone: DropZone): PaneTree {
  if (!tree) return leafOf(widgetId);
  if (zone === 'center') return tabify(tree, widgetId);
  const dir: 'row' | 'col' = zone === 'west' || zone === 'east' ? 'row' : 'col';
  const isNewFirst = zone === 'west' || zone === 'north';
  return {
    kind: 'split',
    dir,
    ratio: 0.5,
    a: isNewFirst ? leafOf(widgetId) : tree,
    b: isNewFirst ? tree : leafOf(widgetId),
  };
}

export function moveWidgetToArea(
  state: LayoutState,
  widgetId: string,
  targetArea: DockArea,
  zone: DropZone
): LayoutState {
  const cleaned = removeEverywhere(state, widgetId);
  const target = cleaned.areas[targetArea] ?? null;
  // dropping "center" onto an area that already has this widget alone is a no-op
  if (target && target.kind === 'leaf' && target.widgetId === widgetId) return cleaned;
  const dir: 'row' | 'col' = zone === 'west' || zone === 'east' ? 'row' : 'col';
  let next: PaneTree;
  if (!target) {
    next = leafOf(widgetId);
  } else {
    next = insertAtZone(target, widgetId, zone);
    void dir;
  }
  return { ...cleaned, areas: { ...cleaned.areas, [targetArea]: next } };
}

export function floatWidget(state: LayoutState, widgetId: string, x: number, y: number): LayoutState {
  const cleaned = removeEverywhere(state, widgetId);
  const z = cleaned.floats.reduce((m, f) => Math.max(m, f.z), 10) + 1;
  return {
    ...cleaned,
    floats: [...cleaned.floats, { id: `f_${widgetId}`, widgetId, x, y, w: 520, h: 400, z }],
  };
}

export function moveFloat(state: LayoutState, widgetId: string, x: number, y: number): LayoutState {
  return { ...state, floats: state.floats.map((f) => (f.widgetId === widgetId ? { ...f, x, y } : f)) };
}

export function resizeFloat(state: LayoutState, widgetId: string, w: number, h: number, x?: number, y?: number): LayoutState {
  return {
    ...state,
    floats: state.floats.map((f) =>
      f.widgetId === widgetId ? { ...f, w: Math.max(240, w), h: Math.max(160, h), x: x ?? f.x, y: y ?? f.y } : f
    ),
  };
}

export function dockFloat(state: LayoutState, widgetId: string, area: DockArea = 'center'): LayoutState {
  const cleaned = removeEverywhere(state, widgetId);
  return moveWidgetToArea(cleaned, widgetId, area, 'center');
}

export function closeWidget(state: LayoutState, widgetId: string): LayoutState {
  return removeEverywhere(state, widgetId);
}

/** Set the ratio of a split found by a path of 'a'/'b' steps inside one area. */
export function setSplitRatio(state: LayoutState, area: DockArea, path: ('a' | 'b')[], ratio: number): LayoutState {
  const clamp = Math.min(0.85, Math.max(0.15, ratio));
  // path navigates to the split node: [] = root, ['a'] = root.a, ['ab'] = root.b.a …
  const apply = (tree: PaneTree, p: ('a' | 'b')[]): PaneTree => {
    if (tree.kind !== 'split') return tree;
    if (p.length === 0) return { ...tree, ratio: clamp };
    const step = p[0] as 'a' | 'b';
    return step === 'a' ? { ...tree, a: apply(tree.a, p.slice(1)) } : { ...tree, b: apply(tree.b, p.slice(1)) };
  };
  const current = state.areas[area];
  if (!current) return state;
  return { ...state, areas: { ...state.areas, [area]: apply(current, path) } };
}

/** Find which area currently hosts a widget (null if floating or absent). */
export function areaOf(state: LayoutState, widgetId: string): DockArea | null {
  const walk = (tree: PaneTree | null): boolean => {
    if (!tree) return false;
    if (tree.kind === 'leaf') return tree.widgetId === widgetId;
    if (tree.kind === 'tabs') return tree.items.includes(widgetId);
    return walk(tree.a) || walk(tree.b);
  };
  for (const area of Object.keys(state.areas) as DockArea[]) {
    if (walk(state.areas[area])) return area;
  }
  return null;
}

export function isWidgetPresent(state: LayoutState, widgetId: string): boolean {
  return areaOf(state, widgetId) !== null || state.floats.some((f) => f.widgetId === widgetId);
}
