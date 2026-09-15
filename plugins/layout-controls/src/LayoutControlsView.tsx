import React, { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import {
  LAYOUT_CONTROL_APPLY, LAYOUT_CONTROL_REQUEST, LAYOUT_CONTROL_SNAPSHOT,
  MODULE_SIZE_DEFAULTS,
  type DockArea, type LayoutControlSnapshot, type LayoutSizeAction, type ModuleSizeKey,
} from '@mpw/shared';
import { Icon } from '@mpw/ui';
import { layoutWindows, type WindowControl } from './layoutWindows';

const areaLabels: Record<DockArea | 'float', string> = { left: '左侧', center: '中央', right: '右侧', top: '顶部', bottom: '底部', float: '浮动窗口' };

interface PaneSetting { key: ModuleSizeKey; label: string; hint: string; min: number; max: number; unit: 'px' | '%' }
const paneSettings: PaneSetting[] = [
  { key: 'sidebarWidth', label: '主导航栏', hint: '左侧图标与文字区域', min: 84, max: 260, unit: 'px' },
  { key: 'aiPanelWidth', label: 'AI 助手', hint: '右侧 AI 对话区域', min: 240, max: 720, unit: 'px' },
  { key: 'aiContextHeight', label: 'AI 上下文区', hint: '上下文来源开关区域的高度', min: 80, max: 320, unit: 'px' },
  { key: 'aiActionsHeight', label: 'AI 功能区', hint: '翻译、润色和章节任务区域的高度', min: 80, max: 420, unit: 'px' },
  { key: 'aiInputHeight', label: 'AI 输入区', hint: '底部指令输入窗口的高度', min: 80, max: 360, unit: 'px' },
  { key: 'mailFoldersWidth', label: '邮件文件夹', hint: '邮箱账户与文件夹区域', min: 100, max: 360, unit: 'px' },
  { key: 'mailReaderPercent', label: '邮件正文', hint: '邮件内容窗口的宽度占比', min: 25, max: 75, unit: '%' },
  { key: 'notesListWidth', label: '笔记列表', hint: '笔记标题列表区域', min: 120, max: 520, unit: 'px' },
  { key: 'notesEditorPercent', label: '笔记编辑区', hint: '分栏模式中的源码占比', min: 20, max: 80, unit: '%' },
  { key: 'writingListWidth', label: '写作文档列表', hint: '本地文档和工作区文稿列表', min: 120, max: 520, unit: 'px' },
  { key: 'localTexPreviewPercent', label: '本地 TeX PDF', hint: '编译后 PDF 预览宽度占比', min: 20, max: 80, unit: '%' },
  { key: 'latexPreviewPercent', label: 'LaTeX PDF 预览', hint: '工作区 LaTeX 预览宽度占比', min: 20, max: 80, unit: '%' },
  { key: 'referencesListWidth', label: '文献列表', hint: '文献库与条目列表区域', min: 140, max: 560, unit: 'px' },
  { key: 'annotationPanelWidth', label: 'PDF 批注栏', hint: '高亮和批注列表区域', min: 140, max: 560, unit: 'px' },
  { key: 'projectsListWidth', label: '项目列表', hint: '项目选择区域', min: 120, max: 520, unit: 'px' },
];

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
      <div><h1>界面布局</h1><p className="sub">调整模块内部区域、工作台窗口和左侧导航。更改仅作用于当前工作区并自动保存。</p></div>
      <div className="layout-control-actions">
        <button className="btn primary" onClick={() => ctx.ui.openWidget('mpw.layout-controls/panel')}><Icon name="float" size={14} /> 在工作台悬浮调整</button>
        <button className="btn" onClick={() => { apply({ kind: 'reset' }); ctx.ui.notify('窗口尺寸已恢复默认值', 'success'); }}><Icon name="refresh" size={14} /> 恢复默认尺寸</button>
      </div>
    </div>
    {snapshot && <>
      <h2 className="layout-section-title">模块内部区域</h2>
      <div className="layout-pane-grid">
        {paneSettings.map((setting) => {
          const value = setting.key === 'sidebarWidth'
            ? snapshot.layout.sidebar?.width ?? MODULE_SIZE_DEFAULTS.sidebarWidth
            : snapshot.layout.moduleSizes?.[setting.key] ?? MODULE_SIZE_DEFAULTS[setting.key];
          return <section className="card layout-pane-card" key={setting.key}>
            <div><b>{setting.label}</b><div>{setting.hint}</div></div>
            <SizeField label="尺寸" value={value} min={setting.min} max={setting.max} unit={setting.unit} onChange={(size) => apply({ kind: 'modulePane', key: setting.key, size })} />
          </section>;
        })}
      </div>
      <div className="layout-sidebar-heading"><h2 className="layout-section-title">左侧导航显示</h2><button className="btn sm" onClick={() => apply({ kind: 'showAllSidebarRoutes' })}>显示全部</button></div>
      <p className="sub">隐藏入口不会停用或卸载插件，工作台中已经打开的窗口不受影响。</p>
      <div className="layout-route-grid">
        {snapshot.routes.filter((item) => item.key !== 'mpw.ai/main').map((item) => {
          const visible = snapshot.layout.sidebar?.visibleRouteKeys
            ? snapshot.layout.sidebar.visibleRouteKeys.includes(item.key)
            : !(snapshot.layout.sidebar?.hiddenRouteKeys ?? []).includes(item.key);
          return <label className="card layout-route-option" key={item.key}><span className="pc-icon"><Icon name={item.icon} size={15} /></span><span>{item.title}</span><input type="checkbox" checked={visible} onChange={(event) => apply({ kind: 'sidebarVisibility', routeKey: item.key, visible: event.target.checked, routeKeys: snapshot.routes.filter((route) => route.key !== 'mpw.ai/main').map((route) => route.key) })} /></label>;
        })}
      </div>
      <h2 className="layout-section-title">工作台窗口</h2>
    </>}
    {!snapshot && <div className="empty-state">正在读取当前布局…</div>}
    {snapshot && windows.length === 0 && <div className="empty-state">当前工作区没有打开的模块</div>}
    <div className="layout-control-list">
      {windows.map((windowInfo) => <WindowSizeCard key={`${windowInfo.location}-${windowInfo.widgetId}`} info={windowInfo} snapshot={snapshot!} apply={apply} />)}
    </div>
    <p className="layout-control-tip">同一标签组中的模块共用一个工作台窗口；调整其中任意模块，会同步改变该标签组。中央单窗口会自动占满剩余空间。</p>
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
