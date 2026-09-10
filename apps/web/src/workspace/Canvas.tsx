import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DockArea, LayoutState, PaneTree } from '@mpw/shared';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import { WidgetHost } from './WidgetHost';
import {
  areaOf,
  closeWidget,
  dockFloat,
  floatWidget,
  moveFloat,
  moveWidgetToArea,
  resizeFloat,
  setSplitRatio,
  type DropZone,
} from './layoutOps';

interface DragInfo {
  widgetId: string;
  title: string;
  x: number;
  y: number;
  zone: { area: DockArea; zone: DropZone; rect: { x: number; y: number; w: number; h: number } } | 'float' | null;
}

interface HeaderAction {
  onPointerDown?: (e: React.PointerEvent) => void;
}

/* ----------------------------- widget title lookup ----------------------------- */
function widgetTitle(kernel: ReturnType<typeof useApp>['kernel'], key: string): { title: string; icon: string } {
  for (const w of kernel.enabledWidgets()) {
    if (w.key === key) return { title: w.title, icon: w.icon };
  }
  const info = kernel.listPlugins().find((p) => p.id === key.split('/')[0]);
  return { title: info ? `${info.name}` : key.split('/')[1] ?? key, icon: info?.icon ?? 'puzzle' };
}

/* --------------------------------- pane header --------------------------------- */
function PaneHeader(props: {
  widgetId: string;
  onFloatBtn?: boolean;
  dragHandlers?: HeaderAction;
}): React.ReactElement {
  const { kernel, layout, setLayout } = useApp();
  const { title, icon } = widgetTitle(kernel, props.widgetId);
  const float = layout.floats.find((f) => f.widgetId === props.widgetId);
  return (
    <div className="pane-header" onPointerDown={props.dragHandlers?.onPointerDown}>
      <div className="ph-title">
        <Icon name={icon} size={13} />
        {title}
      </div>
      <div className="ph-actions" onPointerDown={(e) => e.stopPropagation()}>
        {float ? (
          <button className="icon-btn" title="Dock module" onClick={() => setLayout((l) => dockFloat(l, props.widgetId, 'center'))}>
            <Icon name="dock" size={14} />
          </button>
        ) : (
          <button
            className="icon-btn"
            title="Float module"
            onClick={() => setLayout((l) => floatWidget(l, props.widgetId, 140 + Math.random() * 120, 90 + Math.random() * 60))}
          >
            <Icon name="float" size={14} />
          </button>
        )}
        <button className="icon-btn danger" title="Remove module" onClick={() => setLayout((l) => closeWidget(l, props.widgetId))}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------- tab set ----------------------------------- */
function TabSet(props: { tree: Extract<PaneTree, { kind: 'tabs' }>; startDrag: (widgetId: string, title: string, e: React.PointerEvent) => void }): React.ReactElement {
  const { kernel, layout, setLayout } = useApp();
  const active = props.tree.items[props.tree.active] ?? props.tree.items[0];
  return (
    <div className="pane">
      <div className="pane-header" style={{ cursor: 'default' }}>
        <div className="tabbar">
          {props.tree.items.map((wid, i) => {
            const { title, icon } = widgetTitle(kernel, wid);
            return (
              <div
                key={wid}
                className={`tab${wid === active ? ' active' : ''}`}
                onPointerDown={(e) => {
                  if (wid !== active) {
                    const idx = props.tree.items.indexOf(wid);
                    setLayout((l) => patchTabs(l, wid, idx));
                  } else {
                    props.startDrag(wid, title, e);
                  }
                }}
              >
                <Icon name={icon} size={12} />
                {title}
              </div>
            );
          })}
        </div>
        <div className="ph-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            title="Float module"
            onClick={() => active && setLayout((l) => floatWidget(l, active, 150, 100))}
          >
            <Icon name="float" size={14} />
          </button>
          <button className="icon-btn danger" title="Remove module" onClick={() => active && setLayout((l) => closeWidget(l, active))}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      <div className="pane-body">{active && <WidgetHost widgetId={active} />}</div>
    </div>
  );
}

function patchTabs(l: LayoutState, widgetId: string, active: number): LayoutState {
  const walk = (t: PaneTree | null): PaneTree | null => {
    if (!t) return null;
    if (t.kind === 'tabs' && t.items.includes(widgetId)) return { ...t, active };
    if (t.kind === 'split') {
      const a = walk(t.a);
      const b = walk(t.b);
      return { ...t, a: a ?? t.a, b: b ?? t.b };
    }
    return t;
  };
  const areas = { ...l.areas };
  for (const a of Object.keys(areas) as DockArea[]) areas[a] = walk(areas[a]);
  return { ...l, areas };
}

/* --------------------------------- split render --------------------------------- */
function SplitView(props: {
  area: DockArea;
  tree: Extract<PaneTree, { kind: 'split' }>;
  path: ('a' | 'b')[];
  startDrag: (widgetId: string, title: string, e: React.PointerEvent) => void;
}): React.ReactElement {
  const { layout, setLayout } = useApp();
  const { tree, path, area } = props;
  const handleRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startPos: number; startRatio: number; length: number } | null>(null);

  const onHandleDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const length = tree.dir === 'row' ? rect.width : rect.height;
    const point = tree.dir === 'row' ? e.clientX - rect.left : e.clientY - rect.top;
    const cut = tree.dir === 'row' ? rect.width * tree.ratio : rect.height * tree.ratio;
    dragging.current = { startPos: point - cut, startRatio: tree.ratio, length };
    handleRef.current?.classList.add('dragging');
    const onMove = (ev: PointerEvent): void => {
      const d = dragging.current;
      if (!d) return;
      const rect2 = containerRef.current?.getBoundingClientRect();
      if (!rect2) return;
      const p = tree.dir === 'row' ? ev.clientX - rect2.left : ev.clientY - rect2.top;
      const ratio = (p - d.startPos) / d.length;
      setLayout((l) => setSplitRatio(l, area, path, ratio));
    };
    const onUp = (): void => {
      dragging.current = null;
      handleRef.current?.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={containerRef} className={`split dir-${tree.dir}`} style={{ flex: 1 }}>
      <div className="split-a" style={tree.dir === 'row' ? { width: `${tree.ratio * 100}%` } : { height: `${tree.ratio * 100}%` }}>
        <PaneTreeRender area={area} tree={tree.a} path={[...path, 'a']} startDrag={props.startDrag} />
      </div>
      <div ref={handleRef} className="split-handle" onPointerDown={onHandleDown} />
      <div className="split-b" style={{ flex: 1 }}>
        <PaneTreeRender area={area} tree={tree.b} path={[...path, 'b']} startDrag={props.startDrag} />
      </div>
    </div>
  );
}

/* --------------------------------- pane tree --------------------------------- */
function PaneTreeRender(props: {
  area: DockArea;
  tree: PaneTree | null;
  path: ('a' | 'b')[];
  startDrag: (widgetId: string, title: string, e: React.PointerEvent) => void;
}): React.ReactElement {
  const { tree, startDrag, area } = props;
  if (!tree) {
    return <div className="dock-empty">Drop a module here</div>;
  }
  if (tree.kind === 'leaf') {
    return (
      <div className="pane">
        <PaneHeader widgetId={tree.widgetId} dragHandlers={{ onPointerDown: (e) => startDrag(tree.widgetId, widgetTitleFallback(tree.widgetId), e) }} />
        <div className="pane-body">
          <WidgetHost widgetId={tree.widgetId} />
        </div>
      </div>
    );
  }
  if (tree.kind === 'tabs') return <TabSet tree={tree} startDrag={startDrag} />;
  return <SplitView area={area} tree={tree} path={props.path} startDrag={startDrag} />;

  function widgetTitleFallback(key: string): string {
    return key;
  }
}

/* ----------------------------------- canvas ----------------------------------- */
export function Canvas(): React.ReactElement {
  const { kernel, layout, setLayout } = useApp();
  const canvasRef = useRef<HTMLDivElement>(null);
  const areaRefs = useRef(new Map<DockArea, HTMLElement>());
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const dragRef = useRef<DragInfo | null>(null);

  const setAreaRef = useCallback((area: DockArea, el: HTMLElement | null) => {
    if (el) areaRefs.current.set(area, el);
    else areaRefs.current.delete(area);
  }, []);

  const startDrag = useCallback(
    (widgetId: string, title: string, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const info: DragInfo = { widgetId, title, x: e.clientX, y: e.clientY, zone: null };
      dragRef.current = info;
      setDrag(info);

      const onMove = (ev: PointerEvent): void => {
        const cur = dragRef.current;
        if (!cur) return;
        const moved = { ...cur, x: ev.clientX, y: ev.clientY };
        moved.zone = computeZone(ev.clientX, ev.clientY);
        dragRef.current = moved;
        setDrag(moved);
      };
      const onUp = (upEv: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const cur = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!cur) return;
        const zone = cur.zone;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (zone && zone !== 'float') {
          setLayout((l) => moveWidgetToArea(l, cur.widgetId, zone.area, zone.zone));
        } else if (rect) {
          const x = upEv.clientX - rect.left;
          const y = upEv.clientY - rect.top;
          setLayout((l) => floatWidget(l, cur.widgetId, Math.max(8, x - 260), Math.max(8, y - 30)));
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setLayout]
  );

  const computeZone = (x: number, y: number): DragInfo['zone'] => {
    for (const area of ['left', 'right', 'top', 'bottom', 'center'] as DockArea[]) {
      const el = areaRefs.current.get(area);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const rx = (x - r.left) / r.width;
      const ry = (y - r.top) / r.height;
      let zone: DropZone;
      if (rx < 0.25) zone = 'west';
      else if (rx > 0.75) zone = 'east';
      else if (ry < 0.28) zone = 'north';
      else if (ry > 0.72) zone = 'south';
      else zone = 'center';
      return { area, zone, rect: zoneRect(r, zone) };
    }
    return 'float';
  };

  const sizes = layout.sizes;

  return (
    <div className="canvas" ref={canvasRef}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {layout.areas.top && (
          <div style={{ height: sizes.topH, flex: 'none', paddingBottom: 6, display: 'flex' }}>
            <AreaView area="top" tree={layout.areas.top} setAreaRef={setAreaRef} startDrag={startDrag} />
          </div>
        )}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 6 }}>
          {layout.areas.left && (
            <div style={{ width: sizes.leftW, flex: 'none', display: 'flex' }}>
              <AreaView area="left" tree={layout.areas.left} setAreaRef={setAreaRef} startDrag={startDrag} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <AreaView area="center" tree={layout.areas.center} setAreaRef={setAreaRef} startDrag={startDrag} />
          </div>
          {layout.areas.right && (
            <div style={{ width: sizes.rightW, flex: 'none', display: 'flex' }}>
              <AreaView area="right" tree={layout.areas.right} setAreaRef={setAreaRef} startDrag={startDrag} />
            </div>
          )}
        </div>
        {layout.areas.bottom && (
          <div style={{ height: sizes.bottomH, flex: 'none', paddingTop: 6, display: 'flex' }}>
            <AreaView area="bottom" tree={layout.areas.bottom} setAreaRef={setAreaRef} startDrag={startDrag} />
          </div>
        )}
      </div>

      {/* dock-edge resize handles */}
      {layout.areas.left && <EdgeHandle dir="left" size={sizes.leftW} onResize={(w) => setLayout((l) => ({ ...l, sizes: { ...l.sizes, leftW: Math.max(160, w) } }))} canvas={canvasRef} />}
      {layout.areas.right && <EdgeHandle dir="right" size={sizes.rightW} onResize={(w) => setLayout((l) => ({ ...l, sizes: { ...l.sizes, rightW: Math.max(220, w) } }))} canvas={canvasRef} />}
      {layout.areas.top && <EdgeHandle dir="top" size={sizes.topH} onResize={(h) => setLayout((l) => ({ ...l, sizes: { ...l.sizes, topH: Math.max(80, h) } }))} canvas={canvasRef} />}
      {layout.areas.bottom && <EdgeHandle dir="bottom" size={sizes.bottomH} onResize={(h) => setLayout((l) => ({ ...l, sizes: { ...l.sizes, bottomH: Math.max(80, h) } }))} canvas={canvasRef} />}

      {/* floating windows */}
      {layout.floats.map((f) => (
        <FloatWindowView key={f.widgetId} widgetId={f.widgetId} x={f.x} y={f.y} w={f.w} h={f.h} z={f.z} />
      ))}

      {drag && drag.zone && drag.zone !== 'float' && (
        <div
          className="drop-overlay"
          style={{
            position: 'fixed',
            left: drag.zone.rect.x,
            top: drag.zone.rect.y,
            width: drag.zone.rect.w,
            height: drag.zone.rect.h,
          }}
        />
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon name="grid" size={13} />
          {drag.title}
        </div>
      )}
    </div>
  );

  function FloatWindowView(props: { widgetId: string; x: number; y: number; w: number; h: number; z: number }): React.ReactElement {
    const { title } = widgetTitle(kernel, props.widgetId);
    const ref = useRef<HTMLDivElement>(null);
    const onHeaderDown = (e: React.PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX - props.x;
      const startY = e.clientY - props.y;
      const onMove = (ev: PointerEvent): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        setLayout((l) => moveFloat(l, props.widgetId, Math.max(0, ev.clientX - startX - rect.left), Math.max(0, ev.clientY - startY - rect.top)));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onResizeDown = (e: React.PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const startW = props.w;
      const startH = props.h;
      const sx = e.clientX;
      const sy = e.clientY;
      const onMove = (ev: PointerEvent): void => {
        setLayout((l) => resizeFloat(l, props.widgetId, startW + (ev.clientX - sx), startH + (ev.clientY - sy)));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    return (
      <div ref={ref} className="float-win" style={{ left: props.x, top: props.y, width: props.w, height: props.h, zIndex: 50 + props.z }}>
        <PaneHeader widgetId={props.widgetId} dragHandlers={{ onPointerDown: onHeaderDown }} />
        <div className="pane-body">
          <WidgetHost widgetId={props.widgetId} />
        </div>
        <div className="float-resize" onPointerDown={onResizeDown} />
      </div>
    );
  }
}

function AreaView(props: {
  area: DockArea;
  tree: PaneTree | null;
  setAreaRef: (area: DockArea, el: HTMLElement | null) => void;
  startDrag: (widgetId: string, title: string, e: React.PointerEvent) => void;
}): React.ReactElement {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    props.setAreaRef(props.area, el);
    return () => props.setAreaRef(props.area, null);
  });
  return (
    <div className="dock-area" style={{ flex: 1 }} ref={setEl}>
      <PaneTreeRender area={props.area} tree={props.tree} path={[]} startDrag={props.startDrag} />
    </div>
  );
}

function EdgeHandle(props: { dir: 'left' | 'right' | 'top' | 'bottom'; size: number; onResize: (v: number) => void; canvas: React.RefObject<HTMLDivElement> }): React.ReactElement {
  const start = useRef(0);
  const onDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    start.current = props.dir === 'left' || props.dir === 'right' ? e.clientX : e.clientY;
    const origin = props.size;
    const onMove = (ev: PointerEvent): void => {
      const cur = props.dir === 'left' || props.dir === 'right' ? ev.clientX : ev.clientY;
      const delta = cur - start.current;
      props.onResize(origin + (props.dir === 'left' || props.dir === 'top' ? delta : -delta));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const style: React.CSSProperties =
    props.dir === 'left'
      ? { width: 5, cursor: 'col-resize', margin: '0 -2.5px', zIndex: 5 }
      : props.dir === 'right'
        ? { width: 5, cursor: 'col-resize', margin: '0 -2.5px', zIndex: 5 }
        : { height: 5, cursor: 'row-resize', margin: '-2.5px 0', zIndex: 5 };
  return <div onPointerDown={onDown} style={{ ...style, flex: 'none', borderRadius: 3 }} className="split-handle" title="drag to resize" />;
}

function zoneRect(r: DOMRect, zone: DropZone): { x: number; y: number; w: number; h: number } {
  const wq = r.width * 0.25;
  const hq = r.height * 0.28;
  switch (zone) {
    case 'west':
      return { x: r.left, y: r.top, w: wq, h: r.height };
    case 'east':
      return { x: r.right - wq, y: r.top, w: wq, h: r.height };
    case 'north':
      return { x: r.left, y: r.top, w: r.width, h: hq };
    case 'south':
      return { x: r.left, y: r.bottom - hq, w: r.width, h: hq };
    default:
      return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
}

export { areaOf };
