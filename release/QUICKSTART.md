# ModuDesk(模块化个人工作台)— 快速开始

**一个应用 + 模块化插件 + 可自定义工作区 + 统一数据 + AI 辅助**

## 方式 A:一键启动(推荐,无需安装任何依赖包)

只需安装 [Node.js ≥ 18](https://nodejs.org/zh-cn)(仅此一个前置,无需 `npm install`),然后:

| 系统 | 操作 |
|---|---|
| **Windows** | 双击 **`启动ModuDesk.bat`** |
| **macOS** | 双击 **`启动ModuDesk.command`**(首次需在"系统设置 → 隐私与安全性"中允许) |
| **Linux** | 运行 **`./启动ModuDesk.sh`** |

浏览器会自动打开 **http://localhost:8080**。

- 换端口:`PORT=3000`(Windows 在命令行运行 `set PORT=3000` 后再启动)
- 不自动开浏览器:`MPW_NO_OPEN=1`
- 端口被占用时自动尝试下一个可用端口
- 使用包内已构建好的 `apps-web-dist/`,开箱即用

## 方式 B:开发模式(可修改源码)

```bash
npm install        # 首次安装依赖(约 1 分钟)
npm run dev        # 开发服务器 → http://localhost:5173
```

## 方式 C:自行构建生产版

```bash
npm install
npm run build      # 产物输出到 apps/web/dist
node release/server.mjs   # 启动器会自动探测 apps/web/dist,无需复制
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器(热更新) |
| `npm test` | 运行全部 69 个测试 |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run build` | 生产构建 |

## 快速上手

1. **插件导航**:左侧栏 首页 / 邮箱 / 文献 / 笔记 / 写作 / 文件 / 任务 / 项目;底部为插件中心与设置
2. **全局搜索**:`Ctrl + K`,可搜笔记 / 文献 / 邮件 / 文档 / 文件 / 任务 / 项目,回车直达对应条目
3. **工作区预设**:状态栏左下角切换 日常办公 / 科研模式 / 论文写作 / 教学模式,布局自动保存
4. **PDF 批注**:文献 → 打开 PDF,划选文字即高亮,右侧批注面板管理;AI 可「翻译高亮段落」
5. **LaTeX 写作**:写作模块新建 LaTeX 文档(main.tex + references.bib),桌面端可本地编译 PDF
6. **任务 / 项目**:任务支持优先级(高/中)与截止时间;项目用 `mpw://` 资源链接把文献 / 笔记 / 邮件 / 任务组织为一个课题
7. **AI 助手**:右侧面板;设置里可配置 OpenAI / Anthropic / Google / Ollama / 兼容接口,或使用内置离线 Demo 引擎;API 密钥加密存储,绝不明文落盘

## 数据与安全

- **本地优先**:所有数据(SQLite + 文件)存储在浏览器 IndexedDB,离线可用,不上传任何服务器
- **密钥安全**:API 密钥经 WebCrypto(不可导出密钥)加密存储,永不明文写入数据库
- 清空浏览器站点数据 = 重置应用

## 目录结构

```
mpw-0.1.0/
├── 启动ModuDesk.bat      # Windows 一键启动
├── 启动ModuDesk.command  # macOS 一键启动
├── 启动ModuDesk.sh       # Linux / macOS 一键启动
├── release/server.mjs    # 零依赖启动器(上面三个脚本的实体)
├── apps-web-dist/        # 预构建生产版本(开箱即用)
├── packages/             # shared · kernel(插件内核)· ui
├── plugins/              # email · references · writing · notes · files · tasks · projects · ai
├── apps/web/             # React 外壳(桌面由 Tauri 包装,移动端由 Capacitor 包装)
├── ARCHITECTURE.md       # 架构设计
├── PLUGIN_SPEC.md        # 插件 SDK 规范
├── PRODUCT_SPEC.md       # 产品需求
├── DATABASE.md           # 数据库设计
└── ROADMAP.md            # 开发路线图
```

## 技术栈

React 18 + TypeScript(strict)· 插件化内核 · SQLite(sql.js/IndexedDB,桌面端可切换原生 SQLite)· Vite · Vitest(69 测试)· pdf.js · CodeMirror 6 · KaTeX · docx

> 桌面版(Tauri 2:原生文件系统 / OS 钥匙串 / 本地 LaTeX 编译)与移动版(Capacitor)使用同一套代码,详见 ROADMAP.md。
