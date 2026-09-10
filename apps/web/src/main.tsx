import React from 'react';
import { createRoot } from 'react-dom/client';
import { Kernel } from '@mpw/kernel';
import { PersistedDbAdapter, IndexedDbBlobStore } from './adapters/webAdapters';
import { WebCryptoSecretStore } from '@mpw/kernel';
import { AppProvider } from './state';
import { App } from './App';
import { createHomePlugin } from './homePlugin';
import notesPlugin from '@mpw/plugin-notes';
import referencesPlugin from '@mpw/plugin-references';
import writingPlugin from '@mpw/plugin-writing';
import emailPlugin from '@mpw/plugin-email';
import filesPlugin from '@mpw/plugin-files';
import tasksPlugin from '@mpw/plugin-tasks';
import projectsPlugin from '@mpw/plugin-projects';
import aiPlugin from '@mpw/plugin-ai';
import { detectDesktopShell } from './adapters/desktop';
import './styles.css';
import 'katex/dist/katex.min.css';

async function boot(): Promise<void> {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('missing #root');
  createRoot(rootEl).render(
    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#5c6370' }}>
      正在启动 ModuDesk…
    </div>
  );

  const db = await PersistedDbAdapter.open();
  const kernel = new Kernel({
    db,
    blobStore: new IndexedDbBlobStore(),
    secretStore: new WebCryptoSecretStore(),
    logger: {
      debug: (...a) => console.debug(...a),
      info: (...a) => console.info(...a),
      warn: (...a) => console.warn(...a),
      error: (...a) => console.error(...a),
    },
  });
  // 桌面端(Tauri)存在时注入本地 TeX 编译适配器(XeLaTeX/LuaLaTeX/pdfLaTeX)
  detectDesktopShell(kernel);
  kernel.registerBuiltins([
    createHomePlugin(), notesPlugin, referencesPlugin, writingPlugin,
    emailPlugin, filesPlugin, tasksPlugin, projectsPlugin, aiPlugin,
  ]);
  const report = await kernel.boot();
  if (report.failed.length > 0) {
    console.error('plugins failed to activate:', report.failed);
  }

  createRoot(rootEl).render(
    <React.StrictMode>
      <AppProvider kernel={kernel}>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
}

void boot();
