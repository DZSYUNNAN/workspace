import type { DockArea, LayoutControlSnapshot, PaneTree } from '@mpw/shared';

export interface SplitControl {
  area: DockArea;
  path: ('a' | 'b')[];
  branch: 'a' | 'b';
  direction: 'row' | 'col';
  ratio: number;
}

export interface WindowControl {
  widgetId: string;
  title: string;
  icon: string;
  location: DockArea | 'float';
  split?: SplitControl;
  width?: number;
  height?: number;
}

const areaOrder: Record<WindowControl['location'], number> = { left: 0, center: 1, right: 2, top: 3, bottom: 4, float: 5 };

export function layoutWindows(snapshot: LayoutControlSnapshot): WindowControl[] {
  const metadata = new Map(snapshot.widgets.map((widget) => [widget.key, widget]));
  const result: WindowControl[] = [];
  const add = (widgetId: string, location: DockArea, split?: SplitControl): void => {
    const widget = metadata.get(widgetId);
    result.push({ widgetId, title: widget?.title ?? widgetId, icon: widget?.icon ?? 'grid', location, split });
  };
  const walk = (tree: PaneTree, area: DockArea, path: ('a' | 'b')[], nearest?: SplitControl): void => {
    if (tree.kind === 'leaf') return add(tree.widgetId, area, nearest);
    if (tree.kind === 'tabs') return tree.items.forEach((widgetId) => add(widgetId, area, nearest));
    walk(tree.a, area, [...path, 'a'], { area, path, branch: 'a', direction: tree.dir, ratio: tree.ratio });
    walk(tree.b, area, [...path, 'b'], { area, path, branch: 'b', direction: tree.dir, ratio: tree.ratio });
  };
  for (const area of ['left', 'center', 'right', 'top', 'bottom'] as DockArea[]) {
    const tree = snapshot.layout.areas[area];
    if (tree) walk(tree, area, []);
  }
  for (const floating of snapshot.layout.floats) {
    const widget = metadata.get(floating.widgetId);
    result.push({ widgetId: floating.widgetId, title: widget?.title ?? floating.widgetId, icon: widget?.icon ?? 'grid', location: 'float', width: floating.w, height: floating.h });
  }
  return result.sort((a, b) => areaOrder[a.location] - areaOrder[b.location] || a.title.localeCompare(b.title, 'zh-CN'));
}
