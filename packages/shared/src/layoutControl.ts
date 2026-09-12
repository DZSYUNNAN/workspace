import type { DockArea, LayoutState, PaneTree } from './layout';

export const LAYOUT_CONTROL_REQUEST = 'workspace:layout-control-request';
export const LAYOUT_CONTROL_SNAPSHOT = 'workspace:layout-control-snapshot';
export const LAYOUT_CONTROL_APPLY = 'workspace:layout-control-apply';

export interface LayoutWidgetInfo { key: string; title: string; icon: string }
export interface LayoutControlSnapshot { layout: LayoutState; widgets: LayoutWidgetInfo[] }

export type LayoutSizeAction =
  | { kind: 'area'; area: Exclude<DockArea, 'center'>; size: number }
  | { kind: 'split'; area: DockArea; path: ('a' | 'b')[]; ratio: number }
  | { kind: 'float'; widgetId: string; width: number; height: number }
  | { kind: 'reset' };

export function isLayoutSizeAction(value: unknown): value is LayoutSizeAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<LayoutSizeAction>;
  if (action.kind === 'reset') return true;
  if (action.kind === 'area') return ['left', 'right', 'top', 'bottom'].includes(String(action.area)) && typeof action.size === 'number';
  if (action.kind === 'float') return typeof action.widgetId === 'string' && typeof action.width === 'number' && typeof action.height === 'number';
  if (action.kind === 'split') return ['left', 'right', 'top', 'bottom', 'center'].includes(String(action.area)) && Array.isArray(action.path) && action.path.every((step) => step === 'a' || step === 'b') && typeof action.ratio === 'number';
  return false;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function resizeSplit(tree: PaneTree, path: ('a' | 'b')[], ratio: number): PaneTree {
  if (tree.kind !== 'split') return tree;
  if (path.length === 0) return { ...tree, ratio: clamp(ratio, 0.15, 0.85) };
  const [step, ...rest] = path;
  return step === 'a'
    ? { ...tree, a: resizeSplit(tree.a, rest, ratio) }
    : { ...tree, b: resizeSplit(tree.b, rest, ratio) };
}

function resetSplits(tree: PaneTree | null): PaneTree | null {
  if (!tree || tree.kind !== 'split') return tree;
  return { ...tree, ratio: 0.5, a: resetSplits(tree.a) as PaneTree, b: resetSplits(tree.b) as PaneTree };
}

export function applyLayoutSizeAction(state: LayoutState, action: LayoutSizeAction): LayoutState {
  if (action.kind === 'area') {
    const key = action.area === 'left' ? 'leftW' : action.area === 'right' ? 'rightW' : action.area === 'top' ? 'topH' : 'bottomH';
    const vertical = action.area === 'top' || action.area === 'bottom';
    return { ...state, sizes: { ...state.sizes, [key]: clamp(action.size, vertical ? 80 : 160, vertical ? 600 : 800) } };
  }
  if (action.kind === 'float') {
    return {
      ...state,
      floats: state.floats.map((item) => item.widgetId === action.widgetId
        ? { ...item, w: clamp(action.width, 240, 1600), h: clamp(action.height, 160, 1200) }
        : item),
    };
  }
  if (action.kind === 'split') {
    const tree = state.areas[action.area];
    if (!tree) return state;
    return { ...state, areas: { ...state.areas, [action.area]: resizeSplit(tree, action.path, action.ratio) } };
  }
  const defaults = { leftW: 250, rightW: 340, topH: 180, bottomH: 160 };
  return {
    ...state,
    sizes: defaults,
    areas: {
      left: resetSplits(state.areas.left), right: resetSplits(state.areas.right),
      top: resetSplits(state.areas.top), bottom: resetSplits(state.areas.bottom), center: resetSplits(state.areas.center),
    },
    floats: state.floats.map((item) => ({ ...item, w: 520, h: 400 })),
  };
}
