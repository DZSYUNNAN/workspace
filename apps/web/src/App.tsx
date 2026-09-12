import React from 'react';
import { MODULE_SIZE_DEFAULTS } from '@mpw/shared';
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
import { CloseDialog } from './shell/CloseDialog';

export function App(): React.ReactElement {
  useTheme();
  const { kernel, route, layout } = useApp();
  const size = { ...MODULE_SIZE_DEFAULTS, ...layout.moduleSizes, sidebarWidth: layout.sidebar?.width ?? MODULE_SIZE_DEFAULTS.sidebarWidth };
  const shellStyle = {
    '--mpw-sidebar-width': `${size.sidebarWidth}px`, '--mpw-ai-panel-width': `${size.aiPanelWidth}px`,
    '--mpw-mail-folders-width': `${size.mailFoldersWidth}px`, '--mpw-mail-reader-percent': `${size.mailReaderPercent}%`,
    '--mpw-notes-list-width': `${size.notesListWidth}px`, '--mpw-notes-editor-percent': `${size.notesEditorPercent}%`,
    '--mpw-writing-list-width': `${size.writingListWidth}px`, '--mpw-latex-preview-percent': `${size.latexPreviewPercent}%`,
    '--mpw-local-tex-preview-percent': `${size.localTexPreviewPercent}%`, '--mpw-references-list-width': `${size.referencesListWidth}px`,
    '--mpw-annotation-panel-width': `${size.annotationPanelWidth}px`, '--mpw-projects-list-width': `${size.projectsListWidth}px`,
  } as React.CSSProperties;

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
    <div className="shell" style={shellStyle}>
      <TopBar />
      <div className="shell-main">
        <Sidebar />
        <div className="shell-center">{center}</div>
        <AiPanel />
      </div>
      <StatusBar />
      <Toasts />
      <SearchPalette />
      <CloseDialog />
    </div>
  );
}
