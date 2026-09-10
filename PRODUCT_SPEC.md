# Modular Personal Workspace (MPW) — Product Specification

> **One application + modular plugins + customizable workspaces + unified data + AI assistance.**
> Status: v0.1 (Phase 0) · Owner: DZSYUNNAN · The living product contract for MPW.

## 1. Vision

MPW is a **personal digital productivity operating system** — not a dashboard, not a single-purpose app.
The product is the **Workspace + Plugin System + Unified Data + AI Context**. Email, Notes, References,
Writing and Files are *plugins* that prove and consume that platform; they are never the core.

Users compose their own toolset: install plugins, arrange modules into docked/tabbed/floating layouts,
save workspace presets (Research Mode, Paper Writing Mode, …), and get AI assistance that can see —
only with permission — the context of whatever they are doing.

## 2. Target users & personas

| Persona | Needs | Primary plugins |
|---|---|---|
| **Researcher / PhD student** | Literature management, PDF reading, citation output (IEEE, APA, GB/T 7714), LaTeX papers, AI writing help | References, Writing, Notes, AI |
| **Knowledge worker** | Email triage, notes, files, daily dashboard | Email, Notes, Files, AI |
| **Teacher / author** | Course material, Word documents, translation, summarization | Writing, Notes, AI |

## 3. Platform targets

| Platform | Shell | Priority |
|---|---|---|
| Windows 10/11 | Tauri 2 (WebView2) hosting the shared web UI | **P0** |
| Web / PWA (any OS) | Same UI, installable, IndexedDB persistence | **P0** (this is what ships first & is demoable everywhere) |
| Android / iOS | Capacitor wrapping the same UI, mobile-native shell | **P1** (Phase 5) |

Non-negotiable: ≥ 90% of code shared across platforms; platform shells are thin adapters.

## 4. Functional requirements

### 4.1 Application Shell (core)
- Authentication (v1: local profile + optional passphrase-protected keychain unlock; cloud auth only with SyncProvider in Phase 6).
- Workspace management: create / rename / duplicate / delete workspaces; per-workspace layout.
- Plugin management: registry, lifecycle, Plugin Center UI, permission consent.
- Layout management: docking, tab groups, floating panels, presets, persistence.
- Storage service, file/blob service, settings service, global search, AI gateway, event & command buses.
- Status bar: sync state, background tasks, notifications.

### 4.2 Workspace canvas
- Add module → picker of all widgets contributed by enabled plugins.
- Drag modules between dock areas: **left / right / top / bottom / center / floating**.
- Resize by dragging module edges (center area is a free grid).
- Group modules into **tab stacks** (e.g. `[References] [Notes] [AI]`, `[Word] [LaTeX] [PDF]`).
- Float a module as a window; float panels are freely positioned/resizable.
- Save current arrangement as a **layout preset**; one-click presets: Research, Teaching, Paper Writing, Daily Work.
- Removing/disabling a plugin degrades layouts gracefully (placeholder tile, never a crash).

### 4.3 Plugin scope matrix

| Plugin | v1 (seed) scope | Later roadmap |
|---|---|---|
| **Email** | Multi-account model, demo mailbox, folders (Inbox/Sent/Drafts/Starred/Archive/Trash), read, compose, reply/forward, star, labels, search; `MailTransport` adapter interface (IMAP/SMTP/OAuth2/M365/Gmail ready) | Live IMAP/OAuth transports, AI summarization/classification/reply drafting |
| **References** | Import BibTeX/DOI(Crossref)/RIS/manual; library/collections/tags; metadata model; notes per reference; citation export BibTeX/GB/T 7714/IEEE/APA; PDF attach + reader (navigate/zoom/text search) | Highlight+annotation persistence layers, metadata auto-fetch enrichment, citation insertion API consumed by Writing |
| **Notes** | Markdown notes, folders, tags, `[[WikiLinks]]`, backlinks, preview w/ math & code, full-text search, link-to-reference | Rich-text mode, knowledge-graph view, per-note AI actions |
| **Writing** | Mode A rich text: headings/format/align/lists/tables/images/autosave/**.docx export**; Mode B LaTeX: split editor + live preview (subset renderer w/ KaTeX), project files, error panel; BibTeX-aware | Full LaTeX compile via Tauri (XeLaTeX/LuaLaTeX/pdfLaTeX adapters), headers/footers, citation field insertion, .docx *import* |
| **Files** | Virtual file store (IndexedDB blob FS), upload/download/folders/delete/rename, file cards in search | Real FS via Tauri, cloud drive adapters, PDF/text preview |
| **AI** | Provider registry (OpenAI / Anthropic / Google / OpenAI-compatible / Ollama / Demo), global AI sidebar, selection action menu (Polish, Academic Rewrite, Expand, Shorten, Summarize, Translate zh↔en, Extract Keywords, Explain Equation, Grammar, Generate LaTeX/Table/Citation), context-provider plumbing | RAG over embeddings, vector index, agent tools |

### 4.4 Global search (Ctrl/⌘+K)
- Searches across all enabled plugins via `SearchProvider` contributions: emails, references, PDF text, notes, documents, files.
- Results grouped by type; Enter opens the owning plugin view; arrow navigation.
- v1 keyword (SQLite LIKE + in-memory index). Phase 4+: `EmbeddingProvider` + `VectorStore` interfaces for semantic/RAG search — same UI, no rework.

### 4.5 AI assistant
- Collapsible right-hand **AI Sidebar** (desktop) and a dedicated mobile tab.
- **Context Providers**: each plugin may expose typed, user-authorized context (current note, selected PDF text, email under read, current document). The sidebar shows active context chips; user can toggle any off.
- Selection menu: select text in any editor → floating AI actions.
- Providers are configured in Settings; keys go to the OS keychain (never SQLite, never plaintext).

## 5. UX principles
- Modern, minimal, professional, calm, information-dense; **no** gaming aesthetics, gratuitous gradients, or toy roundedness. Inspirations: Notion, Linear, Obsidian, VS Code — never copies.
- Light / Dark / System themes; comfortable + compact density.
- Desktop: `top bar (workspace switcher · search · profile) / sidebar / canvas / AI panel / status bar`.
- Mobile: bottom nav `Home · Search · ＋ · AI · More`; one primary module per screen; no multi-dock on phones.
- Every destructive action reversible or confirmed; offline is a first-class state.

## 6. Non-goals (v1)
- Real-time multi-user collaboration; public publishing; calendar-heavy scheduling; replacement for Zotero/Overleaf parity on day 1. These are explicitly *later*, via plugins.

## 7. Success criteria for v1 MVP
1. App boots offline in < 3 s (web profile) with seeded demo data.
2. A user can build a "Paper Writing" workspace: Notes + References + Writing docked, AI sidebar open, layout saved & restored after reload.
3. Plugins can be disabled → their widgets vanish → re-enabled → layouts self-heal.
4. Global search returns grouped results from ≥ 4 plugins.
5. A note with `[[links]]` + math renders; a .docx exports; a BibTeX entry imports and exports as IEEE/APA/GB/T 7714.
6. `npm test` covers kernel lifecycle, migrations, layout persistence, notes, references, search — all green.
