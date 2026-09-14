import { strToU8, zipSync } from 'fflate';

export const STARTER_FILES: Record<string, string> = {
  'modudesk.plugin.json': JSON.stringify({ schemaVersion: 1, id: 'com.example.focus', name: '专注计时', version: '0.1.0', author: 'Your name', description: '一个最小的 ModuDesk 插件示例', license: 'MIT', repository: 'https://github.com/your-name/modudesk-focus', permissions: ['storage'], categories: ['办公'] }, null, 2),
  'package.json': JSON.stringify({ name: '@modudesk-community/focus', version: '0.1.0', private: true, type: 'module', main: './src/index.tsx', dependencies: { '@mpw/kernel': '*', '@mpw/ui': '*', react: '^18.3.1' } }, null, 2),
  'src/index.tsx': `import React from 'react';\nimport { definePlugin, type PluginContext } from '@mpw/kernel';\n\nfunction FocusView({ ctx }: { ctx: PluginContext }): React.ReactElement {\n  return <div className="widget"><div className="widget-toolbar"><strong>专注计时</strong></div><div className="empty-state"><button className="btn primary" onClick={() => ctx.ui.notify('开始专注', 'success')}>开始 25 分钟</button></div></div>;\n}\n\nexport default definePlugin({\n  manifest: {\n    id: 'com.example.focus', name: '专注计时', version: '0.1.0', author: 'Your name',\n    description: '一个最小的 ModuDesk 插件示例', icon: 'zap', minCoreVersion: '^0.8.0',\n    permissions: ['storage'],\n    contributions: {\n      widgets: [{ id: 'timer', title: '专注计时', icon: 'zap', defaultArea: 'right', minW: 220 }],\n      routes: [{ id: 'main', title: '专注计时', icon: 'zap', showInSidebar: true, order: 80 }],\n      commands: [{ id: 'start', title: '专注计时: 开始', category: '专注计时' }],\n    },\n  },\n  activate(ctx) {\n    ctx.ui.registerWidget('timer', () => <FocusView ctx={ctx} />);\n    ctx.ui.registerRoute('main', () => <FocusView ctx={ctx} />);\n    ctx.commands.register('com.example.focus.start', () => ctx.ui.notify('开始专注', 'success'));\n  },\n});\n`,
  'test/plugin.spec.ts': `import { describe, expect, it } from 'vitest';\nimport plugin from '../src/index';\n\ndescribe('focus plugin', () => {\n  it('declares a stable manifest', () => {\n    expect(plugin.manifest.id).toBe('com.example.focus');\n    expect(plugin.manifest.version).toMatch(/^\\d+\\.\\d+\\.\\d+/);\n  });\n});\n`,
  'README.md': `# ModuDesk 专注计时插件\n\n从 ModuDesk 插件市场下载的最小模板。请先阅读 docs/PLUGIN_DEVELOPMENT_GUIDE.md，再修改插件 ID、权限和功能。\n`,
};

export function buildStarterZip(): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(STARTER_FILES).map(([path, content]) => [path, strToU8(content)])), { level: 6 });
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: mime }); const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
