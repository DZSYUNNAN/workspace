# Modular Personal Workspace (MPW)

## 稳定可用版 0.7.1

Windows 安装包与 Web 静态资源由 `npm run desktop:build` 及 `npm run build` 生成。
日常使用与迁移说明见 [docs/STABLE-GUIDE.md](docs/STABLE-GUIDE.md)，验收记录见 [docs/STABILIZATION.md](docs/STABILIZATION.md)。

```powershell
npm ci
npm run check
npm start              # 固定 http://localhost:8080，优先运行最新构建
npm run desktop:build  # Windows，需要 Rust 和 Visual Studio C++ Build Tools
```

开发工作位于 `feat/stable-workspace` 分支；原始 Arena 分支保留。

**One application + modular plugins + customizable workspaces + unified data + AI assistance.**
A personal digital productivity operating system for Windows & mobile — workspace shell, plugin platform, unified local-first data, AI context. The product is the *platform*; Email, Notes, References, Writing, Files and AI are plugins.

## Documentation
| Doc | Contents |
|---|---|
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Vision, users, feature requirements, UX direction |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack decision, system design, kernel, data flows, security |
| [PLUGIN_SPEC.md](PLUGIN_SPEC.md) | Plugin SDK: manifest, lifecycle, permissions, contributions |
| [DATABASE.md](DATABASE.md) | SQLite schema, migrations, blob/secret storage, sync readiness |
| [ROADMAP.md](ROADMAP.md) | Phase 0→7 plan with exit criteria |

## Repository layout
```
packages/shared    @mpw/shared — types, models, utils (pure TS)
packages/kernel    @mpw/kernel — plugin system, storage, buses, services (no React)
apps/web           @mpw/app    — React shell (Tauri/Capacitor wrap this build)
plugins/*          first-party plugins, contracted identically to external ones
```

## Development
```bash
npm install          # install all workspaces
npm run dev          # vite dev server (web profile)
npm run typecheck    # strict TS across the monorepo
npm test             # vitest: kernel, storage, layout, plugin suites
npm run build        # production build
```

Local-first: everything works offline; SQLite (sql.js/IndexedDB profile now, native via Tauri later); secrets in OS keychain only.
