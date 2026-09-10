import React from 'react';
import { useApp, type AppRoute } from '../state';
import { Icon } from '@mpw/ui';

function sameRoute(a: AppRoute, b: AppRoute): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pluginRoute' && b.type === 'pluginRoute') return a.key === b.key;
  return true;
}

export function Sidebar(): React.ReactElement {
  const { kernel, route, navigate } = useApp();
  const routes = kernel.enabledRoutes();
  const main = routes.filter((r) => r.key !== 'mpw.ai/main');
  return (
    <div className="sidebar">
      <button
        className={`side-item${sameRoute(route, { type: 'home' }) ? ' active' : ''}`}
        title="首页"
        onClick={() => navigate({ type: 'home' })}
      >
        <Icon name="home" size={17} />
        <span>首页</span>
      </button>
      <div className="sep" />
      {main.map((r) => (
        <button
          key={r.key}
          className={`side-item${sameRoute(route, { type: 'pluginRoute', key: r.key }) ? ' active' : ''}`}
          title={r.title}
          onClick={() => navigate({ type: 'pluginRoute', key: r.key })}
        >
          <Icon name={r.icon} size={17} />
          <span>{r.title}</span>
        </button>
      ))}
      <div className="spacer" />
      <button
        className={`side-item${route.type === 'plugins' ? ' active' : ''}`}
        title="插件中心"
        onClick={() => navigate({ type: 'plugins' })}
      >
        <Icon name="puzzle" size={17} />
        <span>插件</span>
      </button>
      <button
        className={`side-item${route.type === 'settings' ? ' active' : ''}`}
        title="设置"
        onClick={() => navigate({ type: 'settings' })}
      >
        <Icon name="settings" size={17} />
        <span>设置</span>
      </button>
    </div>
  );
}
