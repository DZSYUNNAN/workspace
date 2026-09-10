# ADR 0001 — Technology stack selection

Date: 2026-09-10 · Status: Accepted

## Context
MPW must deliver a native-feeling Windows workspace app + mobile apps + a plugin platform, with rich-text (Word-like) and LaTeX authoring, PDF reading, offline local data, and OS-grade secret storage. Eight criteria from PRODUCT_SPEC §3 weighted the decision.

## Decision
TypeScript monorepo · React 18 UI · Vite · npm workspaces · SQLite through a `DatabaseAdapter` (sql.js+IndexedDB on web, native on Tauri/Capacitor) · Tauri 2 as Windows shell · Capacitor for mobile (Phase 5) · no core server (sync = Phase 6 `SyncProvider`).

## Alternatives considered
| Option | Verdict | Reason |
|---|---|---|
| Electron + React | Rejected | Larger binaries/memory; no capability we need over Tauri. |
| Flutter (+desktop/mobile) | Rejected | First-class UI toolkit, but no ecosystem equal to ProseMirror/CodeMirror/pdf.js/docx/KaTeX for the document features that define this product; plugin-authoring story in TS is far larger. |
| Pure PWA | Rejected as sole target | No filesystem/process access → no LaTeX toolchain, awkward PDF import; kept as a *profile* of the same codebase instead. |
| Server-centric (Next.js + PostgreSQL) | Rejected for core | A personal workspace must run offline; server enters only at Phase 6 behind SyncProvider. |

## Consequences
- One language/type system for core + plugins; Plugin SDK is plain TS interfaces (PLUGIN_SPEC).
- Web profile ships first (testable everywhere), Tauri closes filesystem/keychain/LaTeX gaps; adapters are the only platform seam.
- sql.js (WASM) memory is bounded by keeping blobs out of SQL; native SQLite swap is transparent behind the adapter.
