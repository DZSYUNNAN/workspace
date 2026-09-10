import React, { useEffect, useState } from 'react';
import { definePlugin } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { useApp } from './state';
import { APP_NAME, APP_TAGLINE } from './labels';

/** mpw.home — 首页仪表盘。同样是插件:连"首页"都是模块化的。 */
export function createHomePlugin(): ReturnType<typeof definePlugin> {
  const Dashboard = (): React.ReactElement => {
    const { kernel, layout, setLayout, navigate, workspaceId, version } = useApp();
    void version;
    const [stats, setStats] = useState<Record<string, { label: string; count: number; icon: string }[]>>({});
    useEffect(() => {
      return kernel.events.on('plugin:stats', (p) => {
        const d = p as { pluginId: string; name: string; stats: { label: string; count: number; icon: string }[] };
        setStats((s) => ({ ...s, [d.name]: d.stats }));
      });
    }, [kernel]);
    const presets = kernel.workspaces.listPresets(workspaceId).filter((p) => p.isBuiltin);
    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';

    return (
      <div className="home-dash">
        <h1>{greeting} — {kernel.workspaces.list().find((w) => w.id === workspaceId)?.name ?? '工作区'}</h1>
        <div style={{ color: 'var(--text-2)', fontSize: 12.5, marginBottom: 16 }}>{APP_TAGLINE} · 数据仅存本机,离线可用</div>

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
              <div className="sc-label">全局搜索</div>
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px' }}>工作区预设</h2>
        <div className="presets" style={{ marginBottom: 16 }}>
          {presets.map((p) => (
            <button key={p.id} className="btn sm" onClick={() => setLayout(() => JSON.parse(p.state))}>
              <Icon name="grid" size={13} /> {p.name}
            </button>
          ))}
          <button
            className="btn sm"
            onClick={() => {
              const name = window.prompt('将当前布局保存为预设', '我的模式');
              if (!name) return;
              kernel.workspaces.savePreset(name, JSON.stringify(layout), workspaceId);
              kernel.events.emit('notify', { message: `预设「${name}」已保存`, kind: 'success' });
            }}
          >
            <Icon name="plus" size={13} /> 保存当前布局
          </button>
        </div>

        <h2 style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px' }}>快速访问</h2>
        <div className="presets">
          <button className="btn sm" onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.email/main' })}>
            <Icon name="mail" size={13} /> 邮箱
          </button>
          <button className="btn sm" onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.references/main' })}>
            <Icon name="book" size={13} /> 文献
          </button>
          <button className="btn sm" onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.notes/main' })}>
            <Icon name="note" size={13} /> 笔记
          </button>
          <button className="btn sm" onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.writing/main' })}>
            <Icon name="pen" size={13} /> 写作
          </button>
          <button className="btn sm" onClick={() => navigate({ type: 'pluginRoute', key: 'mpw.tasks/main' })}>
            <Icon name="check" size={13} /> 任务
          </button>
          <button className="btn sm" onClick={() => navigate({ type: 'plugins' })}>
            <Icon name="puzzle" size={13} /> 插件中心
          </button>
        </div>
      </div>
    );
  };

  return definePlugin({
    manifest: {
      id: 'mpw.home',
      name: '首页',
      version: '0.1.0',
      author: 'ModuDesk',
      description: '工作台首页:活动统计、工作区预设、快速访问。',
      icon: 'home',
      minCoreVersion: '^0.1.0',
      permissions: ['storage'],
      contributions: {
        widgets: [{ id: 'dashboard', title: '首页', icon: 'home', defaultArea: 'center', defaultW: 6, defaultH: 4 }],
      },
    },
    activate(ctx) {
      ctx.ui.registerWidget('dashboard', Dashboard);
    },
  });
}
