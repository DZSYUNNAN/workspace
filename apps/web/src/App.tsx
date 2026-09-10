import React from 'react';
import { useApp } from './state';
import { useTheme } from './theme';
import { TopBar } from './shell/TopBar';
import { Sidebar } from './shell/Sidebar';
import { StatusBar } from './shell/StatusBar';
import { Toasts } from './shell/Toasts';
import { SearchPalette } from './shell/SearchPalette';
import { AiPanel } from './shell/AiPanel';
import { PluginCenter } from './shell/PluginCenter';
import { SettingsView } from './shell/SettingsView';
import { Canvas } from './workspace/Canvas';

export function App(): React.ReactElement {
  useTheme();
  const { kernel, route } = useApp();

  const center = (() => {
    switch (route.type) {
      case 'home':
        return <Canvas />;
      case 'plugins':
        return <PluginCenter />;
      case 'settings':
        return <SettingsView />;
      case 'pluginRoute': {
        const Comp = kernel.routeComponent(route.key);
        if (!Comp) {
          return (
            <div className="view">
              <h1>Module unavailable</h1>
              <p className="sub">The plugin providing this view is disabled or failed to load.</p>
            </div>
          );
        }
        return <Comp />;
      }
    }
  })();

  return (
    <div className="shell">
      <TopBar />
      <div className="shell-main">
        <Sidebar />
        <div className="shell-center">{center}</div>
        <AiPanel />
      </div>
      <StatusBar />
      <Toasts />
      <SearchPalette />
    </div>
  );
}
