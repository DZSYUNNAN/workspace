// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Kernel, WebCryptoSecretStore } from '@mpw/kernel';
import { PersistedDbAdapter, IndexedDbBlobStore } from '../src/adapters/webAdapters';
import { AppProvider } from '../src/state';
import { App } from '../src/App';
import { createHomePlugin } from '../src/homePlugin';
import notesPlugin from '@mpw/plugin-notes';
import referencesPlugin from '@mpw/plugin-references';
import writingPlugin from '@mpw/plugin-writing';
import emailPlugin from '@mpw/plugin-email';
import filesPlugin from '@mpw/plugin-files';
import aiPlugin from '@mpw/plugin-ai';
import tasksPlugin from '@mpw/plugin-tasks';
import projectsPlugin from '@mpw/plugin-projects';
import layoutControlsPlugin from '@mpw/plugin-layout-controls';
import '../src/styles.css';

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom lacks matchMedia (used by the theme system)
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

const require_ = createRequire(import.meta.url);

async function bootKernel(): Promise<Kernel> {
  const db = await PersistedDbAdapter.open((f) => require_.resolve(`sql.js/dist/${f}`));
  const kernel = new Kernel({
    db,
    blobStore: new IndexedDbBlobStore(),
    secretStore: new WebCryptoSecretStore(),
  });
  kernel.registerBuiltins([
    createHomePlugin(), notesPlugin, referencesPlugin, writingPlugin,
    emailPlugin, filesPlugin, tasksPlugin, projectsPlugin, aiPlugin, layoutControlsPlugin,
  ]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  return kernel;
}

describe('application boot (full shell over real adapters)', () => {
  it('opens the persisted SQLite database and boots every plugin', async () => {
    const kernel = await bootKernel();
    expect(kernel.isLoaded('mpw.home')).toBe(true);
    expect(kernel.isLoaded('mpw.tasks')).toBe(true);
    expect(kernel.isLoaded('mpw.projects')).toBe(true);
    expect(kernel.isLoaded('mpw.notes')).toBe(true);
    expect(kernel.isLoaded('mpw.email')).toBe(true);
    expect(kernel.isLoaded('mpw.layout-controls')).toBe(true);
    expect(kernel.routeComponent('mpw.layout-controls/main')).toBeTruthy();
    expect(kernel.widgetComponent('mpw.home/dashboard')).toBeTruthy();
    // default layout hosts the dashboard
    const ws = kernel.workspaces.list()[0];
    expect(ws).toBeDefined();
    // web secret store round-trip (WebCrypto + IndexedDB master key)
    await kernel.secrets.set('selftest', 'secret-value');
    await expect(kernel.secrets.get('selftest')).resolves.toBe('secret-value');
  });

  it('renders the shell UI (top bar, sidebar, canvas, AI panel, status bar) without crashing', async () => {
    const kernel = await bootKernel();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<AppProvider kernel={kernel}><App /></AppProvider>);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const text = container.textContent ?? '';
    expect(container.querySelector('.shell')).toBeTruthy();
    expect(container.querySelector('.sidebar')).toBeTruthy();
    expect(container.querySelectorAll('.shell-main > .pane-resize-handle').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.canvas')).toBeTruthy();
    expect(text).toContain('首页');
    expect(text).toContain('AI 助手');
    expect(container.querySelector('.topbar-search input')?.getAttribute('placeholder')).toContain('搜索文件、笔记、文献、邮件');
    expect(container.querySelectorAll('.side-item').length).toBeGreaterThanOrEqual(6);
    const layoutButton = container.querySelector<HTMLButtonElement>('.side-item[title="窗口大小"]');
    expect(layoutButton).toBeTruthy();
    await act(async () => layoutButton!.click());
    expect(container.textContent).toContain('调整模块内部区域、工作台窗口和左侧导航');
    expect(container.textContent).toContain('本地 TeX PDF');
    const mailVisibility = [...container.querySelectorAll<HTMLLabelElement>('.layout-route-option')].find((label) => label.textContent?.includes('邮箱'))?.querySelector<HTMLInputElement>('input');
    expect(mailVisibility?.checked).toBe(true);
    await act(async () => mailVisibility!.click());
    expect(container.querySelector('.sidebar .side-item[title="邮箱"]')).toBeNull();
    const floatingButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('在工作台悬浮调整'));
    expect(floatingButton).toBeTruthy();
    await act(async () => floatingButton!.click());
    expect(container.querySelector('.float-win')).toBeTruthy();
    const pluginCenterButton = container.querySelector<HTMLButtonElement>('.side-item[title="插件中心"]');
    expect(pluginCenterButton).toBeTruthy();
    await act(async () => pluginCenterButton!.click());
    expect(container.textContent).toContain('插件市场');
    expect(container.textContent).toContain('浏览市场');
    const developButton = [...container.querySelectorAll<HTMLButtonElement>('.plugin-market-tabs button')].find((button) => button.textContent === '开发插件');
    expect(developButton).toBeTruthy();
    await act(async () => developButton!.click());
    expect(container.textContent).toContain('下载开发模板');
    expect(container.textContent).toContain('检查发布清单');
    await act(async () => root.unmount());
  });
});
