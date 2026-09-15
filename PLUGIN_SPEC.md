# MPW — Plugin System Specification (Plugin SDK v1)

> The plugin contract is the product. This document is normative for core and plugins alike.

## 1. Principles
1. **Core is infrastructure only** — auth, workspace/layout management, registry, storage, search, files, AI gateway, settings, buses. Every business feature is a plugin.
2. **No plugin imports another plugin.** Interaction happens only through: **Event Bus**, **Command Bus**, **Shared Service Interfaces** (published by core), and **Context Providers**.
3. **Capability = Permission.** A plugin can only call what its manifest declares and the user granted. Least privilege.
4. **Graceful degradation.** Anything a plugin contributed can disappear (disable/uninstall) without breaking the shell or other plugins.

## 2. Manifest

```ts
export type Permission =
  | 'storage'      // scoped plugin storage (KV + SQL namespace)
  | 'blobs'        // file/blob store read-write
  | 'network'      // outbound fetch (AI APIs, DOI lookup, IMAP…)
  | 'credentials'  // OS keychain via core SecretStore
  | 'clipboard'    // system clipboard
  | 'ai:invoke';   // call the AI gateway
  // future: 'notifications' | 'native-fs' | 'calendar' …

export interface PluginManifest {
  id: string;                    // reverse-DNS, immutable: 'mpw.notes'
  name: string;                  // 'Notes'
  version: string;               // semver of the plugin
  author: string;
  description: string;
  icon: string;                  // icon key from the core icon set
  minCoreVersion: string;        // semver range
  permissions: Permission[];
  contributions: Contributions;
}

export interface Contributions {
  widgets?: WidgetContribution[];      // modules placeable on the workspace canvas
  routes?: RouteContribution[];        // full-page views registered in the sidebar
  commands?: CommandContribution[];    // appear in Ctrl+K palette
  searchProviders?: SearchProviderContribution[];
  contextProviders?: ContextProviderContribution[];   // AI context sources
  settings?: SettingField[];           // auto-rendered in Plugin Center
  aiActions?: AiActionContribution[];  // selection-menu actions (editor integrations)
}
```

### Contribution types

```ts
export interface WidgetContribution {
  id: string;                    // unique within plugin: 'editor'
  title: string; icon?: string;
  minW?: number; minH?: number; defaultW?: number; defaultH?: number; // grid cells
  defaultArea?: DockArea;        // 'left'|'right'|'top'|'bottom'|'center'|'float'
  singleton?: boolean;           // only one instance allowed (default true)
}

export interface RouteContribution {
  id: string; title: string; icon?: string;
  showInSidebar?: boolean; order?: number;
}

export interface CommandContribution {
  id: string;                    // global: `${pluginId}.${id}`
  title: string; icon?: string; shortcut?: string; category?: string;
  // handler registered at activate() via ctx.commands.register
}

export interface SearchProviderContribution {
  id: string; label: string;     // group header in results
  search(q: string, limit: number): Promise<SearchHit[]>;
  // SearchHit { id, pluginId, type, title, snippet, icon, score, open(): void }
}

export interface ContextProviderContribution {
  id: string; label: string;              // e.g. 'Current note'
  getContext(): Promise<ContextChunk | null>;
  // ContextChunk { id, label, kind: 'text'|'selection'|'metadata', content, source }
  requiresPermission?: Permission;
}

export interface AiActionContribution {
  id: string; label: string; icon?: string;
  description?: string;
  inputMode?: 'input-first' | 'input-or-context' | 'context-with-instruction';
  prompt: (selection: string, ctxText?: string) => string;
  appliesTo?: string[];          // mime/kind filter, e.g. ['text/markdown','latex']
  insert?: 'replace' | 'below' | 'none';   // what to do with the result
}

export interface SettingField {
  key: string; label: string;
  type: 'string'|'text'|'number'|'boolean'|'select'|'password';
  default?: unknown; options?: { value: string; label: string }[];
  hint?: string; secret?: boolean;       // secret → stored in keychain, not DB
}
```

`inputMode` controls how the shared right-side composer is routed. `input-first` uses the composer text (or current selection) without attaching the full document; use it for translation and polishing. `input-or-context` falls back to the active document only when both are empty. `context-with-instruction` treats composer text as an instruction and supplies the active document separately. If omitted, the action keeps the original selection/context behavior.

## 3. Plugin context — the only bridge to the core

```ts
export interface PluginContext {
  pluginId: string;

  /** Namespaced persistence. Tables and keys are automatically prefixed with the plugin id. */
  storage: {
    get<T>(key: string, def: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    /** Own SQL namespace: execute DML/DDL inside `plugin_<id>` schema. */
    sql: { exec(stmt: string, params?: unknown[]): Promise<void>;
           all<T>(stmt: string, params?: unknown[]): Promise<T[]>; };
  };

  /** Typed pub/sub. Core also emits system events: 'layout:changed', 'settings:changed', 'theme:changed', … */
  events: { emit(type: string, payload?: unknown): void;
            on(type: string, handler: (p: any) => void): Unsubscribe };

  commands: { register(id: string, handler: CommandHandler): Unsubscribe;
              execute(id: string, args?: unknown): Promise<unknown> };

  /** Requires 'credentials'. Backed by OS keychain (Tauri) or non-extractable WebCrypto (web). */
  secrets: { get(key: string): Promise<string | null>;
             set(key: string, value: string): Promise<void>;
             delete(key: string): Promise<void> };

  /** Requires 'blobs'. Virtual file store shared across plugins. */
  blobs: { put(path: string, data: Blob|Uint8Array, mime?: string): Promise<BlobRef>;
           get(ref: string): Promise<Blob | null>;
           list(prefix?: string): Promise<BlobRef[]>;
           delete(ref: string): Promise<void> };

  /** Requires 'ai:invoke'. Routes to the user-selected provider with plugin attribution. */
  ai: { run(prompt: string, opts?: AiRunOptions): Promise<AiResult> };

  ui: { notify(message: string, kind?: 'info'|'success'|'warn'|'error'): void;
        registerWidget(id: string, component: WidgetComponent): void;
        registerRoute(id: string, component: RouteComponent): void;
        openWidget(widgetId: string): void };

  log: { debug(msg: string, ...a: unknown[]): void; info(...a: unknown[]): void;
         warn(...a: unknown[]): void; error(...a: unknown[]): void };
}

export interface WorkspacePlugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): Promise<void> | void;   // register everything here
  deactivate?(): Promise<void> | void;                  // release listeners, timers, handles
}
```

## 4. Lifecycle

```
             install                enable                 load
  [Marketplace] ───▶ INSTALLED ───▶ ENABLED ──▶ activate() ─▶ LOADED ◀── shell start
                       │                │                       │
                    uninstall        disable                 deactivate()
                       ▼                ▼                       ▼
                   REMOVED          INSTALLED(disabled)     ENABLED(idle)
```

- **install**: manifest validated (schema, semver, permission list), records row in `plugins`, no code runs.
- **enable**: persists `enabled=1`; on next shell start (or immediately) the module is activated.
- **load/activate**: `activate(ctx)` runs; contributions register; failures quarantine the plugin (state `error`, shell unaffected).
- **deactivate**: core unregisters widgets/routes/commands/search/context providers, removes UI, then calls plugin `deactivate()`. All layout cells referencing the plugin render a "module disabled" placeholder.
- **uninstall**: deactivate if needed → drop `plugin_<id>` SQL namespace + KV keys + blobs owned by plugin → remove row. (v1 keeps user data unless "delete data" checked.)
- **update**: version compare via semver; migrations run inside the plugin namespace; core `minCoreVersion` enforced.

State machine transitions are the kernel's job — plugins never mutate their own state.

## 5. Built-in and community packages

- First-party plugins live in `plugins/*` workspaces and only receive `PluginContext`.
- In 0.8, community plugins use the same source layout and enter the market through source review, automated tests and a ModuDesk release. This keeps executable code reviewable before it reaches users.
- Runtime installation of external `.mpwx` packages remains reserved for a future isolated loader. The market must not execute an unsigned remote JavaScript bundle in the main WebView.

Community submissions include `modudesk.plugin.json` with `schemaVersion`, `id`, `name`, `version`, `author`, `description`, `license`, `repository`, `permissions` and `categories`. These fields must agree with the runtime manifest. See `docs/PLUGIN_DEVELOPMENT_GUIDE.md` for the development and publication workflow.

## 6. Permissions & consent

| Permission | Grants | Shown to user as |
|---|---|---|
| `storage` | scoped KV + SQL namespace | "Local storage" |
| `blobs` | shared virtual file store | "File system" |
| `network` | outbound fetch | "Network access" |
| `credentials` | keychain secrets | "Credentials (OS keychain)" |
| `clipboard` | read/write clipboard | "Clipboard" |
| `ai:invoke` | AI gateway calls | "AI assistant" |

Plugin Center displays permissions **before** install and on every plugin card. Enabling a plugin = consent to its permission set; the core throws `PermissionDenied` on undeclared capability use (fail loud in dev, quarantine in prod).

## 7. Cross-plugin contracts (core-owned catalog)

| Channel | Contract |
|---|---|
| Event Bus | `notes:changed`, `references:changed`, `mail:changed`, `docs:changed`, `blobs:changed`, `theme:changed`, `settings:changed`, `layout:changed`, `ai:context-request` |
| Command Bus | `mpw.openSearch`, `mpw.openWidget`, `ai.runAction`, plugin-owned `${pluginId}.…` |
| Shared services | `SearchService`, `ContextService`, `BlobStore`, `SecretStore`, `AiGateway` — published by core only |
| Resource links | `mpw://note/<id>`, `mpw://reference/<id>`, `mpw://doc/<id>`, `mpw://mail/<id>`, `mpw://blob/<path>` — stable URIs any plugin may store and ask core to resolve/open |

## 8. Example — minimal plugin

```ts
import { definePlugin } from '@mpw/kernel';

export default definePlugin({
  manifest: {
    id: 'mpw.notes', name: 'Notes', version: '0.1.0', author: 'MPW',
    description: 'Markdown knowledge base', icon: 'notes',
    minCoreVersion: '^0.1.0', permissions: ['storage', 'blobs'],
    contributions: {
      routes: [{ id: 'main', title: 'Notes', icon: 'notes', showInSidebar: true, order: 30 }],
      commands: [{ id: 'newNote', title: 'Notes: New note', category: 'Notes' }],
      searchProviders: [{ id: 'notes', label: 'Notes', search: searchNotes }],
      contextProviders: [{ id: 'current', label: 'Current note', getContext }],
    },
  },
  activate(ctx) { ctx.commands.register('mpw.notes.newNote', () => createNote(ctx)); },
});
```
