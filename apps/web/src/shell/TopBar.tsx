import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import { Icon } from '@mpw/ui';
import { addWidgetToArea } from '../state';
import { APP_NAME } from '../labels';

export function TopBar(): React.ReactElement {
  const { kernel, navigate, setWorkspaceId, aiPanelOpen, setAiPanelOpen, setLayout } = useApp();
  const [wsMenu, setWsMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const addRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const workspaces = kernel.workspaces.list();
  const active = workspaces.find((w) => w.id === (kernel.settings.get('workspace.active', null) as string | null)) ?? workspaces[0];
  const widgets = kernel.enabledWidgets();

  useEffect(() => {
    const close = (e: PointerEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddMenu(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setWsMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  // 未读邮件数 → 铃铛角标
  useEffect(() => {
    const update = async (): Promise<void> => {
      try {
        const rows = await kernel.search.searchAll('', 0); // noop warm
        void rows;
      } catch {
        /* noop */
      }
    };
    void update();
    const off = kernel.events.on('mail:changed', () => {
      void (async () => {
        try {
          const res = await (kernel as unknown as { commands: { execute(id: string): Promise<unknown> } }).commands.execute('mpw.email.unreadCount');
          setUnread(typeof res === 'number' ? res : 0);
        } catch {
          /* command may be disabled */
        }
      })();
    });
    return off;
  }, [kernel]);

  const grouped = new Map<string, typeof widgets>();
  for (const w of widgets) {
    const list = grouped.get(w.pluginId) ?? [];
    list.push(w);
    grouped.set(w.pluginId, list);
  }

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-logo">
          <Icon name="grid" size={15} />
        </div>
        <b>{APP_NAME}</b>
      </div>

      <div className="topbar-search" ref={searchRef} onClick={() => kernel.events.emit('ui:openSearch', {})} title="全局搜索 (Ctrl+K)">
        <Icon name="search" size={14} />
        <input readOnly placeholder="搜索文件、笔记、文献、邮件… (Ctrl + K)" />
      </div>

      <button className="icon-btn" title="通知" style={{ position: 'relative' }} onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.email/main' })}>
        <Icon name="inbox" size={16} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <ThemeButton />
      <button className="icon-btn" title="AI 面板" onClick={() => setAiPanelOpen(!aiPanelOpen)}>
        <Icon name="sparkles" size={16} />
      </button>
      <div className="avatar" title="本地资料(无账号,数据仅存本机)" onClick={() => navigate({ type: 'settings' })}>
        <Icon name="user" size={15} />
      </div>

      <div ref={addRef} style={{ position: 'absolute', right: 118, top: 6 }}>
        <button className="btn sm" onClick={() => setAddMenu((v) => !v)} title="添加模块">
          <Icon name="plus" size={13} /> 模块
        </button>
        {addMenu && (
          <div className="add-menu" style={{ top: 30, right: 0, left: 'auto' }}>
            {widgets.length === 0 && <div className="palette-empty">暂无可用模块 — 请先在插件中心启用插件</div>}
            {[...grouped.entries()].map(([pluginId, list]) => (
              <React.Fragment key={pluginId}>
                <div className="group">{kernel.listPlugins().find((p) => p.id === pluginId)?.name ?? pluginId}</div>
                {list.map((w) => (
                  <button
                    key={w.key}
                    className="mi"
                    onClick={() => {
                      setLayout((l) => addWidgetToArea(l, w.key, w.defaultArea === 'float' ? 'center' : (w.defaultArea as 'center')));
                      setAddMenu(false);
                    }}
                  >
                    <Icon name={w.icon} size={14} /> {w.title}
                    <span className="mu">{w.defaultArea === 'center' ? '中间' : w.defaultArea === 'left' ? '左侧' : w.defaultArea === 'right' ? '右侧' : w.defaultArea}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      <div style={{ width: 8 }} />

      {/* workspace switcher lives in the status bar per ModuDesk mockup */}
      {void wsMenu}
      {void setWorkspaceId}
      {active !== null && null}
    </div>
  );
}

function ThemeButton(): React.ReactElement {
  const { kernel, refresh } = useApp();
  const mode = getTheme(kernel);
  const cycle = (): void => {
    const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setTheme(kernel, next);
    refresh();
  };
  const label = mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统';
  return (
    <button className="icon-btn" title={`主题:${label}(点击切换)`} onClick={cycle}>
      <Icon name={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'monitor'} size={16} />
    </button>
  );
}
