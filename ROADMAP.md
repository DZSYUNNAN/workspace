# MPW — Development Roadmap

Guiding rule: **each phase ends runnable, tested, and committed** (Conventional Commits). Never implement everything before testing anything.

## Phase 0 — Architecture & Specifications ✅ (this commit)
- Requirements analysis, technology selection, architecture, DB design, Plugin API spec, security model, repo structure.
- Deliverables: `ARCHITECTURE.md`, `PRODUCT_SPEC.md`, `PLUGIN_SPEC.md`, `DATABASE.md`, `ROADMAP.md`.
- Exit: docs committed; design review notes in `docs/adr/0001-stack.md`.

## Phase 1 — Workspace MVP (current)
- Monorepo (`packages/shared`, `packages/kernel`, `apps/web`, `plugins/*`), npm workspaces, strict TS.
- Kernel: registry, lifecycle state machine, permission gate, event bus, command bus, storage (SQLite adapter + migrations + plugin namespaces), settings, blob store, search service, AI gateway interfaces.
- Shell: top bar, sidebar, workspace canvas (drag, resize, dock left/right/top/bottom/center, tab groups, floating windows), layout autosave + presets (Research / Teaching / Paper Writing / Daily), multiple workspaces, themes (light/dark/system), Plugin Center, settings page, status bar, Ctrl+K palette, global search.
- Seed plugins proving the SDK end-to-end: **Notes, References, Writing, Email, Files, AI**.
- Tests: kernel lifecycle/permissions/buses, migrations, layout persistence & restore, notes CRUD + wikilinks, references import/export, global search, email folders, docx export model.
- Exit: `typecheck ✓ test ✓ build ✓` + live preview demo; commit trail `feat(kernel)… feat(workspace)… feat(plugin-*)… test…`.

## Phase 2 — Core plugins to production depth
- Email: real transports via Tauri (IMAP/SMTP), OAuth2 (Gmail/M365), background sync worker, AI extension points wired.
- References: annotation persistence (highlights/notes per page), metadata enrichment, collection trees.
- Writing: LaTeX compile adapters (XeLaTeX/LuaLaTeX/pdfLaTeX via Tauri), .docx import, citation insertion API consumed from References.
- Notes: rich text mode, attachment images, note templates.
- Files: native FS adapter, previews.
- Exit: per-plugin "build → run → test → fix" loops, each committed separately.

## Phase 3 — AI everywhere
- Provider production config UI (keys → keychain), streaming sidebar, context provider consent matrix, selection AI menu in all editors, prompt library, usage dashboard.
- Exit: an AI action runs in every editor surface with a user-supplied key **and** offline demo provider.

## Phase 4 — Global search & projects
- Semantic search: `EmbeddingProvider` + `VectorStore` (sqlite-vec locally), incremental indexing pipeline.
- Projects entity UI: link resources via `mpw://` URIs, project dashboard widget.
- Exit: "Summarize the papers I recently read" works end-to-end.

## Phase 5 — Mobile (Capacitor)
- Mobile shell: bottom nav (Home/Search/＋/AI/More), single-module views, gestures, responsive plugin UIs, push-ready notifications.
- Exit: Android build installed on a real device; iOS simulator run.

## Phase 6 — Sync
- `SyncProvider` interface; WebDAV + self-hosted relay first; conflict UX (field-level LWW → CRDT where needed); E2E-encrypted blobs option.
- Exit: two devices converge; airplane-mode safe.

## Phase 7 — Plugin ecosystem hardening
- `.mpwx` packaging, marketplace, worker-sandbox trust tier, plugin signing, dev CLI (`npm create mpw-plugin`), plugin devtools panel.

## Risk register (top 5)
| Risk | Mitigation |
|---|---|
| LaTeX compilation in browser impossible | Subset preview renderer now; real compilers behind Tauri adapter in Phase 2 (already specced) |
| IMAP in browser blocked by CORS/streams | MailTransport adapters; native transport in Tauri shell; demo mailbox keeps UI testable |
| sql.js memory limits with big libraries | Blob store keeps PDFs out of SQL; desktop profile switches to native SQLite transparently |
| Plugin API churn breaking plugins | SDK versioned (`minCoreVersion`), deprecation windows, contract tests published as fixtures |
| Scope creep into "another Notion" | §22 rule: every new feature must first answer "can this be a plugin?" |
