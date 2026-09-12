import React, { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import {
  LAYOUT_CONTROL_APPLY, LAYOUT_CONTROL_REQUEST, LAYOUT_CONTROL_SNAPSHOT,
  type DockArea, type LayoutControlSnapshot, type LayoutSizeAction,
} from '@mpw/shared';
import { Icon } from '@mpw/ui';
import { layoutWindows, type WindowControl } from './layoutWindows';

const areaLabels: Record<DockArea | 'float', string> = { left: '左侧', center: '中央', right: '右侧', top: '顶部', bottom: '底部', float: '浮动窗口' };

export function LayoutControlsView({ ctx }: { ctx: PluginContext }): React.ReactElement {
  const [snapshot, setSnapshot] = useState<LayoutControlSnapshot | null>(null);
  useEffect(() => {
    const request = (): void => ctx.events.emit(LAYOUT_CONTROL_REQUEST);
    const offSnapshot = ctx.events.on(LAYOUT_CONTROL_SNAPSHOT, (payload) => setSnapshot(payload as LayoutControlSnapshot));
    request();
    return offSnapshot;
  }, [ctx]);
  const windows = useMemo(() => snapshot ? layoutWindows(snapshot).filter((item) => item.widgetId !== 'mpw.layout-controls/panel') : [], [snapshot]);
  const apply = (action: LayoutSizeAction): void => ctx.events.emit(LAYOUT_CONTROL_APPLY, action);

  return <div className="view layout-control-view">
    <div className="layout-control-heading">
      <div><h1>窗口大小</h1><p className="sub">调整当前工作区中每个模块的停靠区域、分栏占比或浮动窗口尺寸，更改会自动保存。</p></div>
      <div className="layout-control-actions">
        <button className="btn primary" onClick={() => ctx.ui.openWidget('mpw.layout-controls/panel')}><Icon name="float" size={14} /> 在工作台悬浮调整</button>
        <button className="btn" onClick={() => { apply({ kind: 'reset' }); ctx.ui.notify('窗口尺寸已恢复默认值', 'success'); }}><Icon name="refresh" size={14} /> 恢复默认尺寸</button>
      </div>
    </div>
    {!snapshot && <div className="empty-state">正在读取当前布局…</div>}
    {snapshot && windows.length === 0 && <div className="empty-state">当前工作区没有打开的模块</div>}
    <div className="layout-control-list">
      {windows.map((windowInfo) => <WindowSizeCard key={`${windowInfo.location}-${windowInfo.widgetId}`} info={windowInfo} snapshot={snapshot!} apply={apply} />)}
    </div>
    <p className="layout-control-tip">同一标签组中的模块共用一个窗口；调整其中任意模块，会同步改变该标签组。中央单窗口会自动占满剩余空间。</p>
  </div>;
}

function WindowSizeCard({ info, snapshot, apply }: { info: WindowControl; snapshot: LayoutControlSnapshot; apply: (action: LayoutSizeAction) => void }): React.ReactElement {
  const area = info.location;
  const areaSize = area === 'left' ? snapshot.layout.sizes.leftW : area === 'right' ? snapshot.layout.sizes.rightW : area === 'top' ? snapshot.layout.sizes.topH : area === 'bottom' ? snapshot.layout.sizes.bottomH : undefined;
  const share = info.split ? Math.round((info.split.branch === 'a' ? info.split.ratio : 1 - info.split.ratio) * 100) : undefined;
  const updateArea = (size: number): void => {
    if (area !== 'center' && area !== 'float') apply({ kind: 'area', area, size });
  };
  const updateShare = (value: number): void => {
    if (!info.split) return;
    apply({ kind: 'split', area: info.split.area, path: info.split.path, ratio: info.split.branch === 'a' ? value / 100 : 1 - value / 100 });
  };
  return <section className="card layout-window-card">
    <div className="layout-window-title"><span className="pc-icon"><Icon name={info.icon} size={17} /></span><div><b>{info.title}</b><div>{areaLabels[area]}</div></div></div>
    {areaSize !== undefined && <SizeField label={area === 'left' || area === 'right' ? '区域宽度' : '区域高度'} value={areaSize} min={area === 'left' || area === 'right' ? 160 : 80} max={area === 'left' || area === 'right' ? 800 : 600} unit="px" onChange={updateArea} />}
    {share !== undefined && <SizeField label={info.split?.direction === 'row' ? '横向占比' : '纵向占比'} value={share} min={15} max={85} unit="%" onChange={updateShare} />}
    {area === 'float' && <>
      <SizeField label="窗口宽度" value={info.width ?? 520} min={240} max={1600} unit="px" onChange={(width) => apply({ kind: 'float', widgetId: info.widgetId, width, height: info.height ?? 400 })} />
      <SizeField label="窗口高度" value={info.height ?? 400} min={160} max={1200} unit="px" onChange={(height) => apply({ kind: 'float', widgetId: info.widgetId, width: info.width ?? 520, height })} />
    </>}
    {area === 'center' && areaSize === undefined && share === undefined && <div className="layout-auto-size">自动填满剩余空间</div>}
  </section>;
}

function SizeField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }): React.ReactElement {
  return <label className="layout-size-field"><span>{label}</span><input type="range" min={min} max={max} step={unit === '%' ? 1 : 10} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} /><span className="layout-size-number"><input className="input" type="number" min={min} max={max} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} /> {unit}</span></label>;
}
