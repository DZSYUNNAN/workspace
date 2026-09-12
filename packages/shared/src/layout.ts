/**
 * Workspace layout model (ARCHITECTURE.md §5).
 * A layout is a per-workspace document composed of dock areas, recursive pane
 * trees (leaf | tabs | split) and floating windows. Plugin-agnostic: it only
 * references widget ids, so disabled plugins degrade gracefully.
 */

export type DockArea = 'left' | 'right' | 'top' | 'bottom' | 'center';

export type PaneTree =
  | { kind: 'leaf'; widgetId: string }
  | { kind: 'tabs'; items: string[]; active: number }
  | { kind: 'split'; dir: 'row' | 'col'; ratio: number; a: PaneTree; b: PaneTree };

export interface FloatWindow {
  id: string;
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface AreaSizes {
  leftW: number;   // px
  rightW: number;  // px
  topH: number;    // px
  bottomH: number; // px
}

export interface LayoutState {
  version: 1;
  areas: Record<DockArea, PaneTree | null>;
  floats: FloatWindow[];
  sizes: AreaSizes;
  /** User-adjustable widths for panes inside plugin views. Unknown keys are ignored. */
  moduleSizes?: Record<string, number>;
  /** Sidebar presentation is independent from plugin installation/enabled state. */
  sidebar?: { width?: number; hiddenRouteKeys?: string[] };
}

export function leaf(widgetId: string): PaneTree {
  return { kind: 'leaf', widgetId };
}
export function tabs(items: string[], active = 0): PaneTree {
  return { kind: 'tabs', items, active };
}
export function split(dir: 'row' | 'col', ratio: number, a: PaneTree, b: PaneTree): PaneTree {
  return { kind: 'split', dir, ratio, a, b };
}

export function emptyLayout(): LayoutState {
  return {
    version: 1,
    areas: { left: null, right: null, top: null, bottom: null, center: null },
    floats: [],
    sizes: { leftW: 220, rightW: 280, topH: 180, bottomH: 160 },
  };
}

/** All widget ids referenced anywhere in the layout (for graceful degradation checks). */
export function collectWidgetIds(state: LayoutState): Set<string> {
  const out = new Set<string>();
  const walk = (t: PaneTree | null): void => {
    if (!t) return;
    if (t.kind === 'leaf') out.add(t.widgetId);
    else if (t.kind === 'tabs') t.items.forEach((w) => out.add(w));
    else {
      walk(t.a);
      walk(t.b);
    }
  };
  Object.values(state.areas).forEach(walk);
  state.floats.forEach((f) => out.add(f.widgetId));
  return out;
}

/**
 * Insert a widget into a dock area. Strategy mirrors the drag & drop reducer:
 *  - empty area        → leaf
 *  - leaf              → tabstack [old, new]
 *  - tabs              → append to stack and activate
 *  - split             → split further in the area's natural direction
 */
export function insertWidget(tree: PaneTree | null, widgetId: string, dir: 'row' | 'col'): PaneTree {
  if (!tree) return leaf(widgetId);
  if (tree.kind === 'leaf') return tabs([tree.widgetId, widgetId], 1);
  if (tree.kind === 'tabs') {
    return { kind: 'tabs', items: [...tree.items, widgetId], active: tree.items.length };
  }
  return split(dir, 0.5, tree, leaf(widgetId));
}

export function removeWidget(tree: PaneTree | null, widgetId: string): PaneTree | null {
  if (!tree) return null;
  if (tree.kind === 'leaf') return tree.widgetId === widgetId ? null : tree;
  if (tree.kind === 'tabs') {
    const items = tree.items.filter((w) => w !== widgetId);
    if (items.length === 0) return null;
    if (items.length === 1) return leaf(items[0] as string);
    const active = Math.min(tree.active, items.length - 1);
    return { kind: 'tabs', items, active };
  }
  const a = removeWidget(tree.a, widgetId);
  const b = removeWidget(tree.b, widgetId);
  if (a && b) return { ...tree, a, b };
  return a ?? b;
}

export function findWidget(tree: PaneTree | null, widgetId: string): PaneTree | null {
  if (!tree) return null;
  if (tree.kind === 'leaf') return tree.widgetId === widgetId ? tree : null;
  if (tree.kind === 'tabs') return tree.items.includes(widgetId) ? tree : null;
  return findWidget(tree.a, widgetId) ?? findWidget(tree.b, widgetId);
}
