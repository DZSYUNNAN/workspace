// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import React from 'react';
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
import '../src/styles.css';

beforeAll(() => {
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
  kernel.registerBuiltins([createHomePlugin(), notesPlugin, referencesPlugin, writingPlugin, emailPlugin, filesPlugin, aiPlugin]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  return kernel;
}

describe('application boot (full shell over real adapters)', () => {
  it('opens the persisted SQLite database and boots every plugin', async () => {
    const kernel = await bootKernel();
    expect(kernel.isLoaded('mpw.home')).toBe(true);
    expect(kernel.isLoaded('mpw.notes')).toBe(true);
    expect(kernel.isLoaded('mpw.email')).toBe(true);
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
    root.render(
      <AppProvider kernel={kernel}>
        <App />
      </AppProvider>
    );
    // let React flush effects
    await new Promise((r) => setTimeout(r, 300));
    const text = container.textContent ?? '';
    expect(container.querySelector('.shell')).toBeTruthy();
    expect(container.querySelector('.sidebar')).toBeTruthy();
    expect(container.querySelector('.canvas')).toBeTruthy();
    expect(text).toContain('Home Dashboard');
    expect(text).toContain('AI Assistant');
    expect(text).toContain('Search workspace');
    expect(container.querySelectorAll('.side-item').length).toBeGreaterThanOrEqual(6);
    root.unmount();
  });
});
