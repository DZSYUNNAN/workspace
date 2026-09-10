# MPW — System Architecture

> Modular Personal Workspace · v0.1 · This document explains *why* the stack is what it is, and how every piece fits.

## 1. Technology selection (decided, with rationale)

Decision criteria (weighted): Windows desktop experience, mobile experience, **plugin extensibility**, filesystem capability, Word/LaTeX support, local/offline data, long-term maintainability, cross-platform reuse.

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (Rust only as thin Tauri shell) | One type system across shell + plugins; the Plugin SDK *is* TypeScript interfaces. Strict mode from day 1. |
| UI runtime | **React 18** + custom CSS design tokens | Decisive factor: the document-tooling ecosystem (rich text editing, CodeMirror for LaTeX/markdown, pdf.js, KaTeX, docx) is unmatched on the web stack. Flutter's editor ecosystem cannot deliver §Word/LaTeX/PDF requirements without multi-year custom work. |
| Desktop | **Tauri 2** shell hosting the same UI (Phase 1 ships web; Tauri scaffold lands with native features) | Real filesystem, OS keychain (DPAPI / Credential Manager), spawning XeLaTeX/LuaLaTeX/pdfLaTeX, small binaries, WebView2 preinstalled on Win10/11. Electron rejected: heavier, no capability we need. |
| Mobile | **Capacitor** (Phase 5) wrapping the same UI with a mobile-native shell | ~90% code reuse; plugin permission surfaces map to OS permissions; native plugins for keychain/FS. |
| Local DB | **SQLite** via `DatabaseAdapter`: web profile = `sql.js` (WASM) + IndexedDB persistence; desktop = native SQLite through Tauri; mobile = native SQLite through Capacitor | One SQL schema + one migration system everywhere. True local-first, file-copyable database. IndexedDB-only was rejected (weak querying, no SQL for plugin namespaces). PostgreSQL is Phase 6 server-side sync only. |
| Blobs | IndexedDB blob store (web) / app-data FS (desktop) behind `BlobStore` interface | PDFs/images/attachments must never bloat the SQL DB. |
| Server | **None for core.** Optional sync relay (Phase 6) behind `SyncProvider` | Local-first: the app is fully functional offline. No accounts required. |
| Build | **npm workspaces** monorepo, Vite 5, vitest, tsc `--noEmit` typecheck | Fast, boring, debuggable. Turborepo/pnpm can be adopted later without structural change. |

**Rejected alternatives, explicitly:** pure PWA (no FS/process access → no LaTeX compilation, no PDF import pipeline), Flutter (UI is excellent; document ecosystem is not), pure Electron (bundle size + memory for zero capability gain over Tauri), MEVN/Next-style server-rendered app (a *local* workspace must not require a server).

## 2. System context

```
┌────────────────────────────────────────────────────────────────────┐
│                          MPW Application                           │
│  ┌─────────────── Shell (apps/web → Tauri/Capacitor shells) ─────┐ │
│  │ TopBar · Sidebar · WorkspaceCanvas · AiPanel · StatusBar      │ │
│  └───────────────┬───────────────────────────────────────────────┘ │
│  ┌───────────────▼──────────── KERNEL (packages/kernel) ─────────┐ │
│  │ PluginRegistry · LifecycleManager · PermissionGate            │ │
│  │ EventBus · CommandBus · ContextService · SearchService        │ │
│  │ StorageService(SQL+KV) · BlobStore · SecretStore · AiGateway  │ │
│  │ WorkspaceStore(layouts) · SettingsService                     │ │
│  └──┬──────────┬──────────┬───────────┬──────────┬───────────────┘ │
│     │          │          │           │          │                 │
│  ┌──▼───┐  ┌───▼───┐  ┌───▼────┐  ┌───▼───┐  ┌───▼────┐  ┌────────▼──┐
│  │Notes │  │Refer. │  │Writing │  │Email  │  │Files   │  │AI         │
│  └──────┘  └───────┘  └────────┘  └───────┘  └────────┘  └───────────┘
│        all plugins receive ONLY PluginContext (PLUGIN_SPEC §3)     │
└─────────┬───────────────┬───────────────────┬──────────────────────┘
          ▼               ▼                   ▼
   SQLite (adapter)   IndexedDB/FS blobs   OS Keychain (secrets)
```

## 3. Repository layout

```
workspace/
├── ARCHITECTURE.md · PRODUCT_SPEC.md · PLUGIN_SPEC.md · DATABASE.md · ROADMAP.md
├── package.json                 # npm workspaces root
├── packages/
│   ├── shared/                  # @mpw/shared — pure types/models/utils (no React, no DOM)
│   └── kernel/                  # @mpw/kernel — the platform core (no React; React adapter lives in app)
├── apps/
│   └── web/                     # @mpw/app — React shell UI + Vite; Tauri/Capacitor wrap this same build
├── plugins/
│   ├── notes/ · references/ · writing/ · email/ · files/ · ai/
└── docs/adr/                    # architecture decision records
```

Layering rule (enforced by review + import lint later): `shared ← kernel ← plugins ← app`. Plugins never import the app or each other; kernel never imports React.

## 4. Kernel design

- **PluginRegistry**: manifest validation (zod-style hand-rolled schema), id/version rules, contribution indexes (widgets by id, commands by global id, …).
- **LifecycleManager**: state machine from PLUGIN_SPEC §4; activation order = dependency-free (v1 has no plugin deps; ordering by priority + failure quarantine).
- **PermissionGate**: every `PluginContext` method consults the manifest's permission set; violations throw `PermissionDenied` and are recorded.
- **EventBus**: sync emit, async handlers, wildcard `plugin:*` subscription for devtools; per-plugin listener caps.
- **CommandBus**: global id → handler map; powers Ctrl+K palette; commands can be re-bound to shortcuts later.
- **StorageService**: one SQLite connection (adapter), **migration runner** (ordered, transactional, checksummed), repository base, and per-plugin namespacing (`plugin_<id>` table prefix + KV prefix). Plugins never see raw SQL outside their namespace.
- **BlobStore**: content-addressed refs, mime, size; adapters: IndexedDB (web), fs (desktop), Capacitor Filesystem (mobile).
- **SecretStore**: adapters: WebCrypto non-extractable AES-GCM (web) → Tauri keychain plugin (desktop) → Capacitor SecureStorage (mobile). Secrets are *never* written to SQLite or localStorage.
- **AiGateway**: `AiProvider` interface + provider registry (OpenAI, Anthropic, Google, OpenAI-compatible, Ollama, Demo-offline). Provider choice + key per user; streaming responses; usage log. Plugins call `ctx.ai.run`, never providers directly.
- **SearchService**: aggregates `SearchProvider` contributions; v1 keyword; interfaces already shaped for `EmbeddingProvider` + `VectorStore` (Phase 4).
- **ContextService**: collects enabled `ContextProvider` chunks for the AI sidebar with per-provider user toggles (consent stored per provider id).

## 5. Workspace layout system (data model summary — full DDL in DATABASE.md)

Layout = per-workspace document:

```
LayoutState {
  version, workspaceId,
  areas: {
    left:   PaneTree | null     # PaneTree = leaf | tabstack | split
    right:  PaneTree | null
    top:    PaneTree | null
    bottom: PaneTree | null
    center: PaneTree
  },
  floats: [{ id, widgetId, x, y, w, h, z }],
  sizes: { leftW, rightW, topH, bottomH, centerColRatios, centerRowRatios }
}
PaneTree = { kind:'leaf', widgetId } | { kind:'tabs', items: widgetId[], active: i }
         | { kind:'split', dir:'row'|'col', ratio, a: PaneTree, b: PaneTree }
```

- Sidebar dock areas are vertical stacks (`split` col) of leaves/tabs; center is recursive splits (VS Code-like but simpler); floats are absolute-positioned windows.
- Renderer: pointer-event based drag with drop-zone hit testing (edge halvs + center tabs + floating); resize handles adjust `sizes`/`ratio`s. No DnD library — full control, no dependency risk.
- Persistence: debounced autosave to `layouts` table + named presets (`layout_presets`). Missing widget ids (plugin disabled) render placeholder tiles; layouts self-heal.

## 6. Data flows

**Boot:** load settings → open DB adapter → run migrations → restore workspaces → instantiate enabled plugins (activate) → register contributions → render shell → hydrate layout of last workspace.

**Layout drag:** pointer down on module header → ghost overlay → pointermove hit-test drop zones → drop → reducer computes new PaneTree → debounce-persist → emit `layout:changed`.

**Search (Ctrl+K):** palette opens → query → `SearchService.searchAll(q)` fans out to providers (parallel, 800 ms soft timeout) → grouped, ranked results → Enter → `hit.open()` (routes to plugin view + focuses entity).

**AI action:** selection in editor → floating menu → action handler → `ctx.ai.run(prompt, { context })` → AiGateway → provider adapter (stream) → result inserted (replace/below) per action config. Context providers feed the sidebar only after user enables them.

## 7. Security model

- Threats: plaintext secrets, malicious plugin exfiltration, XSS via imported markdown/PDF/HTML, blob poisoning.
- Controls: secrets only in OS keychain / non-extractable WebCrypto; permission gate on every context call; HTML sanitization for note/doc previews (sanitize on render, escape on store); CSP headers in production build; blob mime sniffing on open; plugin quarantine on activation failure; audit log table for security-relevant events (Phase 2+).
- Plugin trust tiers (Phase 7): built-in (in-process) → verified marketplace (locked imports) → community (worker sandbox). The SDK contract is identical across tiers.

## 8. Platform shells

| Shell | Role | Native capabilities exposed to kernel via adapters |
|---|---|---|
| `apps/web` (Vite) | dev + PWA | IndexedDB blobs, WebCrypto secrets, OPFS export/import |
| Tauri 2 (desktop) | Windows 10/11 app | real FS, native SQLite, OS keychain, spawn LaTeX toolchain, system notifications, tray |
| Capacitor (mobile) | Android/iOS (Phase 5) | SQLite, secure storage, share sheet, file picker |

The kernel's adapter interfaces (`DatabaseAdapter`, `BlobStoreAdapter`, `SecretStoreAdapter`, `MailTransport`, `LatexCompiler`, `SyncProvider`) are the *only* place platform code appears.

## 9. Performance budgets & engineering guardrails

- Boot (warm, web): < 3 s to interactive; first plugin paint < 1 s after shell.
- Canvas drag ≥ 50 fps; search keystroke→results < 150 ms local.
- Kernel bundle (no plugins) < 250 KB gz; total initial route < 1.5 MB gz including pdf.js lazily loaded.
- Guardrails: strict TS, no `any` in kernel, ESLint import boundaries, conventional commits, every merged milestone keeps `typecheck && test && build` green.
