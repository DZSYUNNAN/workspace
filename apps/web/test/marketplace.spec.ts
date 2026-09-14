import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildStarterZip, STARTER_FILES } from '../src/marketplace/devkit';
import { filterMarketplace, marketplaceCatalog, validatePublishManifest } from '../src/marketplace/catalog';
import type { PluginRowInfo } from '@mpw/kernel';

const plugin = (values: Partial<PluginRowInfo>): PluginRowInfo => ({
  id: 'mpw.notes', name: '笔记', version: '1.0.0', author: 'ModuDesk', description: 'Markdown 笔记', icon: 'note',
  permissions: ['storage'], enabled: true, state: 'enabled', builtin: true, error: null, loaded: true, ...values,
});

describe('plugin marketplace', () => {
  it('categorizes and searches installed plugins', () => {
    const catalog = marketplaceCatalog([plugin({}), plugin({ id: 'mpw.writing', name: '写作', description: 'LaTeX 编辑器' })]);
    expect(filterMarketplace(catalog, 'latex', '全部').map((item) => item.id)).toEqual(['mpw.writing']);
    expect(filterMarketplace(catalog, '', '办公').map((item) => item.id)).toEqual(['mpw.notes']);
  });

  it('validates publication metadata before submission', () => {
    const valid = validatePublishManifest(JSON.parse(STARTER_FILES['modudesk.plugin.json']));
    expect(valid.errors).toEqual([]); expect(valid.manifest?.id).toBe('com.example.focus');
    expect(validatePublishManifest({ schemaVersion: 1, id: 'bad', version: 'next' }).errors.length).toBeGreaterThan(3);
  });

  it('downloads a complete starter plugin archive', () => {
    const files = unzipSync(buildStarterZip());
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['modudesk.plugin.json', 'package.json', 'src/index.tsx', 'test/plugin.spec.ts', 'README.md']));
    expect(strFromU8(files['src/index.tsx'])).toContain('definePlugin');
  });
});
