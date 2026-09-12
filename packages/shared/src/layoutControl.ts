import type { DockArea, LayoutState, PaneTree } from './layout';

export const LAYOUT_CONTROL_REQUEST = 'workspace:layout-control-request';
export const LAYOUT_CONTROL_SNAPSHOT = 'workspace:layout-control-snapshot';
export const LAYOUT_CONTROL_APPLY = 'workspace:layout-control-apply';

export interface LayoutWidgetInfo { key: string; title: string; icon: string }
export interface LayoutRouteInfo { key: string; title: string; icon: string }
export interface LayoutControlSnapshot { layout: LayoutState; widgets: LayoutWidgetInfo[]; routes: LayoutRouteInfo[] }

export const MODULE_SIZE_DEFAULTS = {
  sidebarWidth: 128,
  aiPanelWidth: 360,
  mailFoldersWidth: 150,
  mailReaderPercent: 50,
  notesListWidth: 220,
  notesEditorPercent: 50,
  writingListWidth: 220,
  latexPreviewPercent: 54,
  localTexPreviewPercent: 50,
  referencesListWidth: 220,
  annotationPanelWidth: 220,
  projectsListWidth: 220,
} as const;

export type ModuleSizeKey = keyof typeof MODULE_SIZE_DEFAULTS;

export type LayoutSizeAction =
  | { kind: 'area'; area: Exclude<DockArea, 'center'>; size: number }
  | { kind: 'split'; area: DockArea; path: ('a' | 'b')[]; ratio: number }
  | { kind: 'float'; widgetId: string; width: number; height: number }
  | { kind: 'modulePane'; key: ModuleSizeKey; size: number }
  | { kind: 'modulePaneDelta'; key: ModuleSizeKey; delta: number }
  | { kind: 'sidebarVisibility'; routeKey: string; visible: boolean; routeKeys: string[] }
  | { kind: 'showAllSidebarRoutes' }
  | { kind: 'reset' };

export function isLayoutSizeAction(value: unknown): value is LayoutSizeAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<LayoutSizeAction>;
  if (action.kind === 'reset' || action.kind === 'showAllSidebarRoutes') return true;
  if (action.kind === 'area') return ['left', 'right', 'top', 'bottom'].includes(String(action.area)) && typeof action.size === 'number';
  if (action.kind === 'float') return typeof action.widgetId === 'string' && typeof action.width === 'number' && typeof action.height === 'number';
  if (action.kind === 'split') return ['left', 'right', 'top', 'bottom', 'center'].includes(String(action.area)) && Array.isArray(action.path) && action.path.every((step) => step === 'a' || step === 'b') && typeof action.ratio === 'number';
  if (action.kind === 'modulePane') return typeof action.key === 'string' && action.key in MODULE_SIZE_DEFAULTS && typeof action.size === 'number';
  if (action.kind === 'modulePaneDelta') return typeof action.key === 'string' && action.key in MODULE_SIZE_DEFAULTS && typeof action.delta === 'number';
  if (action.kind === 'sidebarVisibility') return typeof action.routeKey === 'string' && typeof action.visible === 'boolean' && Array.isArray(action.routeKeys) && action.routeKeys.every((key) => typeof key === 'string');
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
  if (action.kind === 'modulePaneDelta') {
    const current = action.key === 'sidebarWidth'
      ? state.sidebar?.width ?? MODULE_SIZE_DEFAULTS.sidebarWidth
      : state.moduleSizes?.[action.key] ?? MODULE_SIZE_DEFAULTS[action.key];
    return applyLayoutSizeAction(state, { kind: 'modulePane', key: action.key, size: current + action.delta });
  }
  if (action.kind === 'modulePane') {
    const percent = action.key.endsWith('Percent');
    const size = clamp(action.size, percent ? 20 : 80, percent ? 80 : 900);
    if (action.key === 'sidebarWidth') return { ...state, sidebar: { ...state.sidebar, width: clamp(size, 84, 260) } };
    return { ...state, moduleSizes: { ...state.moduleSizes, [action.key]: size } };
  }
  if (action.kind === 'sidebarVisibility') {
    const visible = new Set(state.sidebar?.visibleRouteKeys ?? action.routeKeys.filter((key) => !(state.sidebar?.hiddenRouteKeys ?? []).includes(key)));
    if (action.visible) visible.add(action.routeKey); else visible.delete(action.routeKey);
    return { ...state, sidebar: { ...state.sidebar, hiddenRouteKeys: undefined, visibleRouteKeys: [...visible] } };
  }
  if (action.kind === 'showAllSidebarRoutes') return { ...state, sidebar: { ...state.sidebar, hiddenRouteKeys: [], visibleRouteKeys: undefined } };
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
    moduleSizes: {},
    sidebar: { ...state.sidebar, width: MODULE_SIZE_DEFAULTS.sidebarWidth },
  };
}
