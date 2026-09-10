# Modular Personal Workspace (MPW)

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
