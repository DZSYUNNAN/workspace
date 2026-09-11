import React, { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Icon } from '@mpw/ui';
import { APP_VERSION } from './StatusBar.version';
import { APP_NAME } from '../labels';

/** 状态栏:工作区模式切换 · 本地已同步 · 后台任务 · 版本(ModuDesk 设计稿)。 */
export function StatusBar(): React.ReactElement {
  const { kernel, data, version, workspaceId, setLayout, layout, refresh } = useApp();
  const [save, setSave] = useState(data?.db.state);
  useEffect(() => data?.db.subscribe(() => setSave(data.db.state)), [data]);
  void version;
  const [bgCount, setBgCount] = useState(kernel.bgTasks.count());
  const [wsMenu, setWsMenu] = useState(false);

  useEffect(() => {
    return kernel.events.on('bgtasks:changed', (p) => {
      setBgCount((p as { count: number }).count);
    });
  }, [kernel]);

  const plugins = kernel.listPlugins();
  const loaded = plugins.filter((p) => p.loaded).length;
  const failed = plugins.filter((p) => p.state === 'error');
  const presets = kernel.workspaces.listPresets(workspaceId).filter((p) => p.isBuiltin);
  const activePreset = presets.find((p) => JSON.stringify(JSON.parse(p.state).areas) === JSON.stringify(layout.areas));

  return (
    <div className="statusbar">
      <div className="sb-item" style={{ position: 'relative' }}>
        <button className="sb-btn" onClick={() => setWsMenu((v) => !v)} title="切换工作区布局预设">
          <Icon name="grid" size={12} /> 工作区:{activePreset?.name ?? '自定义'} <Icon name="chevron" size={11} />
        </button>
        {wsMenu && (
          <div className="add-menu" style={{ bottom: 26, left: 0, top: 'auto' }} onClick={() => setWsMenu(false)}>
            <div className="group">布局预设</div>
            {presets.map((p) => (
              <button
                key={p.id}
                className="mi"
                onClick={() => {
                  setLayout(() => JSON.parse(p.state));
                  refresh();
                }}
              >
                <Icon name="grid" size={13} /> {p.name}
                {activePreset?.id === p.id && <span className="mu"><Icon name="check" size={12} /></span>}
              </button>
            ))}
            <div className="group">提示</div>
            <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--text-3)' }}>在首页可将当前布局保存为新预设</div>
          </div>
        )}
      </div>
      <span className="sb-item">
        <span className="dot" /> {save?.phase === 'error' ? '保存失败' : save?.phase === 'saving' ? '保存中…' : data ? '已保存到本机' : '本地工作台'}
        {save?.phase === 'error' && <button className="sb-btn" title={save.error} onClick={() => void data?.db.flush().catch(() => {})}>重试保存</button>}
      </span>
      <span className="sb-item">
        <Icon name="puzzle" size={12} /> {loaded}/{plugins.length} 插件
      </span>
      {bgCount > 0 && (
        <span className="sb-item">
          <Icon name="refresh" size={12} /> {bgCount} 个后台任务…
        </span>
      )}
      {failed.length > 0 && (
        <span className="sb-item" style={{ color: 'var(--danger)' }}>
          <Icon name="zap" size={12} /> {failed.length} 个插件异常
        </span>
      )}
      <span className="spacer" />
      <span className="sb-item">{APP_NAME} v{APP_VERSION}</span>
    </div>
  );
}
