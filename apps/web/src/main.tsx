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
import { detectDesktopShell, isTauri, openDesktopData, desktopSecrets } from './adapters/desktop';
import './styles.css';
import 'katex/dist/katex.min.css';
import type { WorkspaceData } from './adapters/backup';
import { registerResources } from './resources';
import { createLocalDocuments } from './adapters/localFiles';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
const root = createRoot(rootEl);

async function boot(): Promise<void> {
  root.render(
    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#5c6370' }}>
      正在启动 ModuDesk…
    </div>
  );

  const data: WorkspaceData = await (async () => {
    if (isTauri()) return openDesktopData();
    const db = await PersistedDbAdapter.open();
    return { db, blobs: new IndexedDbBlobStore(), restore: (bytes: Uint8Array, files: Record<string, Uint8Array>) => db.restore(bytes, files), location: `当前浏览器（${window.location.origin}）` };
  })();
  const { db, blobs } = data;
  const kernel = new Kernel({
    db,
    blobStore: blobs,
    secretStore: isTauri() ? desktopSecrets : new WebCryptoSecretStore(),
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
  const localDocuments = createLocalDocuments();
  kernel.commands.register({ id: 'workspace.localDocuments', title: '本地文档' }, () => localDocuments);
  kernel.commands.register({ id: 'workspace.beginFileWork', title: '文件导入任务' }, () => kernel.bgTasks.begin('文献导入'));
  localDocuments.subscribe(() => kernel.events.emit('local-documents:changed', { unsaved: localDocuments.unsaved }));
  registerResources(kernel, db);
  if (report.failed.length > 0) {
    console.error('plugins failed to activate:', report.failed);
  }

  await db.flush();
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      kernel.events.emit('desktop:close-requested', {});
    });
  }
  window.addEventListener('beforeunload', (event) => {
    if (db.state.phase !== 'saved' || localDocuments.unsaved || kernel.bgTasks.count() > 0) { event.preventDefault(); event.returnValue = ''; void Promise.all([db.flush(), localDocuments.flush()]).catch(() => {}); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void db.flush().catch(() => {});
  });
  root.render(
    <React.StrictMode>
      <AppProvider kernel={kernel} data={data}>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
}

function failure(error: unknown): void {
  root.render(<div style={{ padding: 32 }}><h1>工作台未能启动</h1><p role="alert">{error instanceof Error ? error.message : String(error)}</p><button onClick={() => window.location.reload()}>重新打开</button></div>);
}
// Keep one writer per origin; two independent SQL snapshots must never overwrite each other.
if (isTauri()) {
  void boot().catch(failure);
} else if (navigator.locks) {
  void navigator.locks.request('modudesk-workspace-writer', { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('工作台已在另一个窗口打开。请先关闭另一个窗口，再重新打开此页。');
    await boot();
    await new Promise<void>(() => {});
  }).catch(failure);
} else {
  failure(new Error('当前浏览器不支持安全的单窗口存储，请使用新版 Edge、Chrome 或桌面版。'));
}
