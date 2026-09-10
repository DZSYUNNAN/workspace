import React from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';

/** Renders a widget component contributed by a plugin, or a graceful placeholder. */
export function WidgetHost({ widgetId }: { widgetId: string }): React.ReactElement {
  const { kernel, navigate, refresh } = useApp();
  const Comp = kernel.widgetComponent(widgetId);
  if (Comp) {
    return <Comp widgetId={widgetId} instanceId={widgetId} />;
  }
  const pluginId = widgetId.split('/')[0];
  const info = kernel.listPlugins().find((p) => p.id === pluginId);
  const disabled = info && !info.loaded;
  return (
    <div className="placeholder">
      <Icon name="puzzle" size={26} />
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>
        {info ? `${info.name} module is disabled` : `Module "${widgetId}" unavailable`}
      </div>
      <div style={{ fontSize: 12 }}>Enable the plugin to restore this module. Your layout is preserved.</div>
      {disabled && (
        <button
          className="btn sm"
          onClick={async () => {
            await kernel.enablePlugin(pluginId);
            refresh();
          }}
        >
          Enable {info.name}
        </button>
      )}
    </div>
  );
}
