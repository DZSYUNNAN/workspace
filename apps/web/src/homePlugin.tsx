import React, { useEffect, useState } from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';
import { Icon } from './components/Icon';
import { useApp } from './state';

/**
 * mpw.home — the Home dashboard, implemented AS A PLUGIN to prove that even the
 * dashboard is modular. Cross-plugin stats arrive over the Event Bus contract.
 */
interface StatItem {
  label: string;
  count: number;
  icon: string;
}

export function createHomePlugin(): ReturnType<typeof definePlugin> {
  let ctxRef: PluginContext | null = null;

  const Dashboard = (): React.ReactElement => {
    const { kernel, layout, setLayout, navigate, workspaceId, version } = useApp();
    void version;
    const [stats, setStats] = useState<Record<string, StatItem[]>>({});
    useEffect(() => {
      const off = kernel.events.on('plugin:stats', (p) => {
        const d = p as { pluginId: string; name: string; stats: StatItem[] };
        setStats((s) => ({ ...s, [d.name]: d.stats }));
      });
      return off;
    }, [kernel]);
    const presets = kernel.workspaces.listPresets(workspaceId).filter((p) => p.isBuiltin);
    const hour = new Date().getHours();
    const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    return (
      <div className="home-dash">
        <h1>{greeting} — {kernel.workspaces.list().find((w) => w.id === workspaceId)?.name ?? 'Workspace'}</h1>
        <div className="stat-cards">
          {Object.entries(stats).flatMap(([name, items]) =>
            items.map((s) => (
              <div className="stat-card" key={name + s.label}>
                <div className="sc-num">{s.count}</div>
                <div className="sc-label">
                  <Icon name={s.icon} size={11} /> {s.label}
                </div>
              </div>
            ))
          )}
          <div className="stat-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="search" size={16} />
            <div>
              <div className="sc-num" style={{ fontSize: 13 }}>Ctrl K</div>
              <div className="sc-label">global search</div>
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px' }}>Layout presets</h2>
        <div className="presets" style={{ marginBottom: 16 }}>
          {presets.map((p) => (
            <button key={p.id} className="btn sm" onClick={() => setLayout(() => JSON.parse(p.state))}>
              <Icon name="grid" size={13} /> {p.name}
            </button>
          ))}
          <button
            className="btn sm"
            onClick={() => {
              const name = window.prompt('Save current layout as preset', 'My Mode');
              if (!name) return;
              kernel.workspaces.savePreset(name, JSON.stringify(layout), workspaceId);
              kernel.events.emit('notify', { message: `Preset “${name}” saved`, kind: 'success' });
            }}
          >
            <Icon name="plus" size={13} /> Save current layout
          </button>
        </div>

        <h2 style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px' }}>Quick actions</h2>
        <div className="presets">
          <button className="btn sm" onClick={() => navigate({ type: 'plugins' })}>
            <Icon name="puzzle" size={13} /> Plugin Center
          </button>
          <button className="btn sm" onClick={() => kernel.events.emit('ui:openSearch', {})}>
            <Icon name="search" size={13} /> Global search
          </button>
        </div>
      </div>
    );
  };

  return definePlugin({
    manifest: {
      id: 'mpw.home',
      name: 'Home',
      version: '0.1.0',
      author: 'MPW Core',
      description: 'Workspace dashboard: activity stats, layout presets and quick actions.',
      icon: 'home',
      minCoreVersion: '^0.1.0',
      permissions: ['storage'],
      contributions: {
        widgets: [{ id: 'dashboard', title: 'Home Dashboard', icon: 'home', defaultArea: 'center', defaultW: 6, defaultH: 4 }],
      },
    },
    activate(ctx) {
      ctxRef = ctx;
      ctx.ui.registerWidget('dashboard', Dashboard);
    },
    deactivate() {
      ctxRef = null;
    },
  });
}
