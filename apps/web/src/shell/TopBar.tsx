import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import { Icon } from '../components/Icon';
import { addWidgetToArea } from '../state';

export function TopBar(): React.ReactElement {
  const { kernel, navigate, setWorkspaceId, aiPanelOpen, setAiPanelOpen, setLayout } = useApp();
  const [wsMenu, setWsMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const workspaces = kernel.workspaces.list();
  const active = workspaces.find((w) => w.id === (kernel.settings.get('workspace.active', null) as string | null)) ?? workspaces[0];
  const widgets = kernel.enabledWidgets();

  useEffect(() => {
    const close = (e: PointerEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const grouped = new Map<string, typeof widgets>();
  for (const w of widgets) {
    const list = grouped.get(w.pluginId) ?? [];
    list.push(w);
    grouped.set(w.pluginId, list);
  }

  return (
    <div className="topbar">
      <div
        className="ws-switch"
        onClick={() => setWsMenu((v) => !v)}
        title="Switch workspace"
        style={{ position: 'relative' }}
      >
        <Icon name="grid" size={15} />
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{active?.name ?? 'Workspace'}</span>
        <Icon name="chevron" size={13} />
        {wsMenu && (
          <div className="add-menu" style={{ top: 32, left: 0 }} onClick={() => setWsMenu(false)}>
            {workspaces.map((w) => (
              <button key={w.id} className="mi" onClick={() => setWorkspaceId(w.id)}>
                <Icon name={w.icon} size={14} /> {w.name}
                {w.id === active?.id && <span className="mu"><Icon name="check" size={13} /></span>}
              </button>
            ))}
            <div className="group">New workspace</div>
            <button
              className="mi"
              onClick={() => {
                const name = `Workspace ${workspaces.length + 1}`;
                const ws = kernel.workspaces.create(name);
                setWorkspaceId(ws.id);
              }}
            >
              <Icon name="plus" size={14} /> Create workspace
            </button>
          </div>
        )}
      </div>

      <div style={{ width: 10 }} />

      <div ref={addRef} style={{ position: 'relative' }}>
        <button className="btn sm" onClick={() => setAddMenu((v) => !v)} title="Add module">
          <Icon name="plus" size={14} /> Module
        </button>
        {addMenu && (
          <div className="add-menu" style={{ top: 30, left: 0 }}>
            {widgets.length === 0 && <div className="palette-empty">No modules — enable plugins first</div>}
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
                    <span className="mu">{w.defaultArea}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="topbar-search" onClick={() => kernel.events.emit('ui:openSearch', {})}>
        <Icon name="search" size={14} />
        <span style={{ flex: 1 }}>Search workspace…</span>
        <span className="kbd">Ctrl K</span>
      </div>

      <ThemeButton />
      <button className="icon-btn" title="Toggle AI panel" onClick={() => setAiPanelOpen(!aiPanelOpen)}>
        <Icon name="panelRight" size={16} className={aiPanelOpen ? 'active' : ''} />
      </button>
      <button className="icon-btn" title="Settings" onClick={() => navigate({ type: 'settings' })}>
        <Icon name="settings" size={16} />
      </button>
      <button className="icon-btn" title="Profile" onClick={() => navigate({ type: 'settings' })}>
        <Icon name="user" size={16} />
      </button>
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
  return (
    <button className="icon-btn" title={`Theme: ${mode} (click to change)`} onClick={cycle}>
      <Icon name={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'monitor'} size={16} />
    </button>
  );
}
