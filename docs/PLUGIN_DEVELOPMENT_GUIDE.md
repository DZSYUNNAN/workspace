# ModuDesk 插件制作与发布教程

本文面向希望为 ModuDesk 0.8.0 及更高版本制作插件的开发者。当前社区插件采用“源码仓库 + 自动测试 + 审核后进入内置市场”的发布方式。市场不会直接执行未经审核的远程 JavaScript 包。

## 1. 准备开发环境

需要 Node.js 20 或更高版本、npm 10、Git。若插件调用桌面能力，还需要 Rust、Cargo 和 Tauri 2 的 Windows 构建环境。

```powershell
git clone https://github.com/DZSYUNNAN/workspace.git
cd workspace/development
npm ci
npm run check
```

从 ModuDesk 的“插件市场 → 开发插件”下载模板，将目录复制为 `plugins/<插件名>`。插件目录至少包含：

```text
plugins/focus/
├─ package.json
├─ modudesk.plugin.json
├─ src/index.tsx
├─ test/plugin.spec.ts
└─ README.md
```

## 2. 两份清单各自负责什么

`src/index.tsx` 中的 `manifest` 是运行时清单，内核会校验插件 ID、版本、权限和贡献点。`modudesk.plugin.json` 是发布清单，插件市场用它展示作者、许可证、源码仓库和分类。

插件 ID 必须采用反向域名，例如 `com.example.focus`。发布后不要更改 ID，否则用户数据会进入新的命名空间。版本必须使用 SemVer，例如 `0.1.0`。

```json
{
  "schemaVersion": 1,
  "id": "com.example.focus",
  "name": "专注计时",
  "version": "0.1.0",
  "author": "Your name",
  "description": "一个专注计时插件",
  "license": "MIT",
  "repository": "https://github.com/your-name/modudesk-focus",
  "permissions": ["storage"],
  "categories": ["办公"]
}
```

发布清单与运行时清单的 ID、名称、版本、作者、说明和权限必须一致。可在“插件市场 → 开发插件”上传发布清单进行检查。

## 3. 最小插件

```tsx
import React from 'react';
import { definePlugin, type PluginContext } from '@mpw/kernel';

function FocusView({ ctx }: { ctx: PluginContext }): React.ReactElement {
  return (
    <div className="widget">
      <div className="widget-toolbar"><strong>专注计时</strong></div>
      <div className="empty-state">
        <button className="btn primary" onClick={() => ctx.ui.notify('开始专注', 'success')}>
          开始 25 分钟
        </button>
      </div>
    </div>
  );
}

export default definePlugin({
  manifest: {
    id: 'com.example.focus',
    name: '专注计时',
    version: '0.1.0',
    author: 'Your name',
    description: '一个专注计时插件',
    icon: 'zap',
    minCoreVersion: '^0.8.0',
    permissions: ['storage'],
    contributions: {
      widgets: [{ id: 'timer', title: '专注计时', icon: 'zap', defaultArea: 'right', minW: 220 }],
      routes: [{ id: 'main', title: '专注计时', icon: 'zap', showInSidebar: true, order: 80 }],
      commands: [{ id: 'start', title: '专注计时: 开始', category: '专注计时' }]
    }
  },
  activate(ctx) {
    ctx.ui.registerWidget('timer', () => <FocusView ctx={ctx} />);
    ctx.ui.registerRoute('main', () => <FocusView ctx={ctx} />);
    ctx.commands.register('com.example.focus.start', () => ctx.ui.notify('开始专注', 'success'));
  }
});
```

在 `apps/web/src/main.tsx` 中导入插件并加入 `kernel.registerBuiltins([...])`，同时在根 `tsconfig.json` 和 `apps/web/package.json` 添加工作区映射。开发阶段运行：

```powershell
npm run dev
npm run typecheck
npm test
```

## 4. 权限

只声明实际使用的权限。启用插件时，用户会在插件卡片看到这些权限。

| 权限 | 能力 |
|---|---|
| `storage` | 插件独立的 KV 和 SQL 数据 |
| `blobs` | ModuDesk 文件库中的二进制对象 |
| `network` | 网络请求 |
| `credentials` | 系统安全存储中的密码或令牌 |
| `clipboard` | 剪贴板 |
| `ai:invoke` | 调用用户选择的 AI 服务 |
| `native` | 经内核封装的桌面能力 |

表名会被限制在插件自己的前缀内。密钥必须使用 `ctx.secrets`，不得写入源码、日志、数据库、测试夹具或 `.runtime` 文件。

## 5. 让插件出现在工作台、搜索和右侧 AI

- `widgets`：可放入工作台布局的小窗口。设置合理的 `minW`、`minH` 和 `defaultArea`。
- `routes`：完整页面；`showInSidebar: true` 后可由用户决定是否显示在左侧导航。
- `commands`：在命令面板中展示，处理函数必须在 `activate()` 中注册完整全局 ID。
- `searchProviders`：把插件数据加入全局搜索。
- `contextProviders`：把当前打开的内容提供给右侧 AI 助手。
- `aiActions`：在右侧助手显示与当前模块相关的快捷任务。

```ts
contextProviders: [{
  id: 'current',
  label: '当前记录',
  getContext: async () => currentRecord ? {
    id: 'current', label: currentRecord.title, kind: 'text',
    content: currentRecord.body.slice(0, 12000), source: 'com.example.focus'
  } : null
}],
aiActions: [{
  id: 'summarize', label: '总结当前记录', icon: 'sparkles', insert: 'none',
  prompt: (_selection, context = '') => `请准确总结以下内容：\n\n${context}`
}]
```

上下文应只返回用户当前打开或明确选择的内容，并设置长度上限。用户可以在右侧助手顶部关闭任何来源。

## 6. 可拉伸界面

使用 `@mpw/ui` 的 `ResizeHandle`，通过 `LAYOUT_CONTROL_APPLY` 将变化交给统一布局系统。不要自行保存像素值。

```tsx
<ResizeHandle
  onDelta={(delta) => ctx.events.emit(LAYOUT_CONTROL_APPLY, {
    kind: 'modulePaneDelta', key: 'yourPaneWidth', delta
  })}
  title="拖动调整面板宽度"
/>
```

新增布局键时，还要更新 `packages/shared` 中的 `ModuleSizeKey`、默认值、边界和“窗口大小”插件。窄窗口下必须验证最小宽度、横向滚动和正文换行。

## 7. 数据与跨插件协作

插件不得直接导入另一个插件。使用以下稳定接口：

- `ctx.events` 发布变化事件，例如 `focus:changed`。
- `ctx.commands` 暴露可调用能力。
- `mpw://<kind>/<id>` 保存跨插件资源链接。
- 搜索和 AI 上下文由内核聚合。

在 `deactivate()` 中释放事件监听、定时器和外部资源。插件被禁用后，其他模块必须继续工作。

## 8. 测试要求

至少覆盖：清单合法性、核心数据操作、权限边界、启用与禁用、关键 DOM 交互。不要只测试实现细节。

```powershell
npx vitest run plugins/focus/test
npm run check
```

涉及 `apps/desktop/src-tauri` 时还要运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

不得提交 API key、邮箱密码、真实邮件、个人论文原稿、`.runtime`、构建缓存或本地数据库。

## 9. 发布到插件市场

1. 将插件放在独立公开仓库，包含许可证、README、界面截图、变更记录和 `modudesk.plugin.json`。
2. Fork `DZSYUNNAN/workspace`，把插件源码加入 `development/plugins/<name>`。
3. 在 `development/apps/web/src/marketplace/catalog.ts` 增加分类和标签，并完成应用入口、工作区依赖与 TypeScript 路径映射。
4. 更新版本说明，执行 `npm run check`；涉及桌面端时执行 Rust 测试。
5. 提交 Pull Request，说明权限用途、数据保存位置、网络域名、测试结果和维护计划。

审核会检查清单一致性、最小权限、敏感信息、数据隔离、禁用后的清理、界面伸缩、测试和依赖许可证。通过审核并随新版本发布后，插件会出现在“插件市场”，用户可以启用或停用。

## 10. 更新与下架

- 修复保持插件 ID 不变并提高版本号。
- 数据结构升级必须可重复执行，并记录 schema 版本。
- 删除贡献点前先兼容已有布局和资源链接。
- 停止维护时在 README 和市场清单标明，并提交下架请求。
- 严重安全问题应先禁用受影响能力，再发布修复和迁移说明。

完整运行时接口以仓库根目录的 `PLUGIN_SPEC.md` 为准；现有 `plugins/notes`、`plugins/writing` 和 `plugins/layout-controls` 分别展示了数据、AI 上下文和可拉伸面板的实际用法。
