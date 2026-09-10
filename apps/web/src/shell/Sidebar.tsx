import React from 'react';
import { useApp, type AppRoute } from '../state';
import { Icon } from '../components/Icon';

function sameRoute(a: AppRoute, b: AppRoute): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pluginRoute' && b.type === 'pluginRoute') return a.key === b.key;
  return true;
}

export function Sidebar(): React.ReactElement {
  const { kernel, route, navigate } = useApp();
  const routes = kernel.enabledRoutes();
  return (
    <div className="sidebar">
      <button
        className={`side-item${sameRoute(route, { type: 'home' }) ? ' active' : ''}`}
        title="Home"
        onClick={() => navigate({ type: 'home' })}
      >
        <Icon name="home" size={18} />
      </button>
      <div className="sep" />
      {routes.map((r) => (
        <button
          key={r.key}
          className={`side-item${sameRoute(route, { type: 'pluginRoute', key: r.key }) ? ' active' : ''}`}
          title={r.title}
          onClick={() => navigate({ type: 'pluginRoute', key: r.key })}
        >
          <Icon name={r.icon} size={18} />
        </button>
      ))}
      <div className="spacer" />
      <button
        className={`side-item${route.type === 'plugins' ? ' active' : ''}`}
        title="Plugin Center"
        onClick={() => navigate({ type: 'plugins' })}
      >
        <Icon name="puzzle" size={18} />
      </button>
      <button
        className={`side-item${route.type === 'settings' ? ' active' : ''}`}
        title="Settings"
        onClick={() => navigate({ type: 'settings' })}
      >
        <Icon name="settings" size={18} />
      </button>
    </div>
  );
}
