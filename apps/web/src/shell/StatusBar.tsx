import React from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';

export function StatusBar(): React.ReactElement {
  const { kernel, version } = useApp();
  void version;
  const plugins = kernel.listPlugins();
  const loaded = plugins.filter((p) => p.loaded).length;
  const failed = plugins.filter((p) => p.state === 'error');
  const blobsMb = (Math.round((blobSize(kernel) / 1024 / 1024) * 10) / 10).toFixed(1);
  return (
    <div className="statusbar">
      <span className="sb-item">
        <span className="dot" /> Local · offline-first
      </span>
      <span className="sb-item">
        <Icon name="puzzle" size={12} /> {loaded}/{plugins.length} plugins
      </span>
      <span className="sb-item">
        <Icon name="folder" size={12} /> {blobsMb} MB files
      </span>
      {failed.length > 0 && (
        <span className="sb-item" style={{ color: 'var(--danger)' }}>
          <Icon name="zap" size={12} /> {failed.length} plugin error{failed.length > 1 ? 's' : ''}
        </span>
      )}
      <span className="spacer" />
      <span className="sb-item">MPW v{APP_VERSION} · {kernel.ai.listProviders().find((p) => p.id === kernel.settings.get('ai.provider', 'demo'))?.label ?? 'demo'}</span>
    </div>
  );
}

export const APP_VERSION = '0.1.0';

import type { Kernel } from '@mpw/kernel';
function blobSize(kernel: Kernel): number {
  return (kernel.settings.get<number>('ui.blobBytes', -1) === -1 ? 0 : kernel.settings.get('ui.blobBytes', 0)) as number;
}
