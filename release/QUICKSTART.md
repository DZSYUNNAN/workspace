# Modular Personal Workspace (MPW) — 快速开始

**一个应用 + 模块化插件 + 可自定义工作区 + 统一数据 + AI 辅助**

## 方式 A:直接运行(推荐,无需安装依赖)

只需安装 [Node.js ≥ 18](https://nodejs.org),然后:

```bash
node server.mjs
```

打开浏览器访问 **http://localhost:8080** 即可。
(使用包内已构建好的 `dist/`,换端口:`PORT=3000 node server.mjs`)

## 方式 B:开发模式(可修改源码)

```bash
npm install        # 首次安装依赖(约 1 分钟)
npm run dev        # 开发服务器 → http://localhost:5173
```

## 方式 C:自行构建生产版

```bash
npm install
npm run build      # 产物输出到 apps/web/dist
node server.mjs    # 仍然从顶层 dist/ 读取;如需用新构建,请将 apps/web/dist 复制到顶层 dist/
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器(热更新) |
| `npm test` | 运行全部 59 个测试 |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run build` | 生产构建 |

## 快速上手

1. **拖拽模块**:按住模块标题栏拖动 —— 拖到边缘分屏、拖到中间变标签页、拖到空白处变浮动窗口
2. **全局搜索**:`Ctrl + K`,可搜笔记 / 文献 / 邮件 / 文档 / 文件
3. **布局预设**:首页 → Research Mode / Paper Writing / Daily Work / Teaching Mode
4. **多工作区**:左上角工作区菜单可新建 / 切换,布局自动保存
5. **插件中心**:侧栏拼图图标 —— 启用 / 禁用插件,查看权限,布局自动自愈
6. **AI 助手**:右侧面板;设置里可配置 OpenAI / Anthropic / Google / Ollama / 兼容接口,或使用内置离线 Demo 引擎;API 密钥加密存储,绝不明文落盘

## 数据与安全

- **本地优先**:所有数据(SQLite + 文件)存储在浏览器 IndexedDB,离线可用,不上传任何服务器
- **密钥安全**:API 密钥经 WebCrypto(不可导出密钥)加密存储,永不明文写入数据库
- 清空浏览器站点数据 = 重置应用

## 目录结构

```
mpw-0.1.0/
├── server.mjs        # 免安装启动器(方式 A)
├── dist/             # 预构建生产版本
├── packages/         # shared · kernel(插件内核)· ui
├── plugins/          # notes · references · writing · email · files · ai
├── apps/web/         # React 外壳(桌面由 Tauri 包装,移动端由 Capacitor 包装)
├── ARCHITECTURE.md   # 架构设计
├── PLUGIN_SPEC.md    # 插件 SDK 规范
├── PRODUCT_SPEC.md   # 产品需求
├── DATABASE.md       # 数据库设计
└── ROADMAP.md        # 开发路线图
```

## 技术栈

React 18 + TypeScript(strict)· 插件化内核 · SQLite(sql.js/IndexedDB,桌面端可切换原生 SQLite)· Vite · Vitest(59 测试)· pdf.js · CodeMirror 6 · KaTeX · docx

> 桌面版(Tauri 2:原生文件系统 / OS 钥匙串 / 本地 LaTeX 编译)与移动版(Capacitor)使用同一套代码,详见 ROADMAP.md。
