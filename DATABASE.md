# MPW — Database & Storage Design

## 1. Storage architecture

```
┌──────────────────────────── StorageService ───────────────────────────┐
│  DbAdapter (SQLite)          BlobStoreAdapter        SecretStore      │
│  ┌──────────────────┐   ┌───────────────────┐   ┌──────────────────┐  │
│  │ web: sql.js WASM │   │ web: IndexedDB    │   │ web: WebCrypto   │  │
│  │ desktop: native  │   │ desktop: app-data │   │ desktop: keychain│  │
│  │ mobile: native   │   │ mobile: FS        │   │ mobile: secure   │  │
│  └──────────────────┘   └───────────────────┘   └──────────────────┘  │
│  persisted: IndexedDB "mpw.sqlite" (web) / file mpw.db (native)       │
└───────────────────────────────────────────────────────────────────────┘
```

Conventions for every table:
- `id TEXT PRIMARY KEY` — UUIDv7 strings (time-ordered, sync-friendly).
- `created_at` / `updated_at` INTEGER (unix ms); `deleted_at INTEGER NULL` — **tombstone soft delete** so Phase 6 sync can diff.
- `device_id TEXT` on entities users create (set at insert; used later by SyncProvider).
- Plugin data is namespaced: plugin SQL tables are prefixed `p_notes_`, `p_email_`, … ; plugin KV rows live in `plugin_kv(plugin_id, key, value)`. Plugins cannot read other plugins' namespaces (enforced by prefixing inside `PluginContext.storage`).

## 2. Core schema (kernel-owned)

```sql
-- schema bookkeeping
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  layout_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

CREATE TABLE layouts (           -- one autosaved layout per workspace
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  state TEXT NOT NULL,           -- JSON LayoutState (ARCHITECTURE §5)
  updated_at INTEGER NOT NULL);

CREATE TABLE layout_presets (    -- named modes: Research / Writing / Daily …
  id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT NOT NULL,
  state TEXT NOT NULL, is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

CREATE TABLE plugins (
  id TEXT PRIMARY KEY,           -- 'mpw.notes'
  name TEXT NOT NULL, version TEXT NOT NULL, author TEXT, description TEXT,
  icon TEXT, permissions TEXT NOT NULL,     -- JSON array
  manifest TEXT NOT NULL,                   -- full manifest JSON snapshot
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'installed',  -- installed|enabled|disabled|error
  settings TEXT NOT NULL DEFAULT '{}',      -- public settings JSON (never secrets)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

CREATE TABLE plugin_kv (
  plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, key));

CREATE TABLE settings (           -- kernel settings: theme, density, ai provider choice…
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE projects (           -- Phase 4 entity, table created now for stability
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT, icon TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

CREATE TABLE project_links (      -- stable resource links: mpw://note/.. etc.
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  resource_uri TEXT NOT NULL, label TEXT, added_at INTEGER NOT NULL);

CREATE TABLE search_index (       -- v1 keyword index maintained by kernel+plugins
  id TEXT PRIMARY KEY,            -- '<pluginId>:<type>:<entityId>'
  plugin_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL, icon TEXT,
  updated_at INTEGER NOT NULL);
CREATE INDEX idx_search_body ON search_index(plugin_id, type);

CREATE TABLE audit_log (          -- security-relevant events (Phase 2 writer)
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, detail TEXT);
```

## 3. Plugin namespaces (created by each plugin's own migrations)

```sql
-- mpw.notes
CREATE TABLE p_notes_notes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

-- mpw.references
CREATE TABLE p_references_references (
  id TEXT PRIMARY KEY, citation_key TEXT, entry_type TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '[]',            -- JSON [{family,given}]
  venue TEXT, year INTEGER, doi TEXT, abstract TEXT, keywords TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
  blob_ref TEXT, file_name TEXT, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE p_references_collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE p_references_collection_items (
  collection_id TEXT NOT NULL, reference_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, reference_id));
CREATE TABLE p_references_annotations (   -- PDF highlights (Phase 2 persistence layer ready)
  id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, page INTEGER NOT NULL,
  kind TEXT NOT NULL, rects TEXT NOT NULL, text TEXT, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

-- mpw.writing
CREATE TABLE p_writing_documents (    -- mode='rich' | 'latex'
  id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'rich',
  content TEXT NOT NULL DEFAULT '',          -- HTML (rich) | LaTeX source
  folder TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);

-- mpw.email
CREATE TABLE p_email_accounts (
  id TEXT PRIMARY KEY, address TEXT NOT NULL, display_name TEXT, provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'demo',         -- demo|imap|graph|gmail
  status TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
  -- NOTE: passwords/tokens intentionally absent → SecretStore only.
CREATE TABLE p_email_messages (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder TEXT NOT NULL,
  thread_id TEXT, subject TEXT NOT NULL DEFAULT '', from_name TEXT, from_addr TEXT,
  to_list TEXT NOT NULL DEFAULT '[]', cc_list TEXT NOT NULL DEFAULT '[]',
  body_text TEXT NOT NULL DEFAULT '', body_html TEXT,
  date INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0, labels TEXT NOT NULL DEFAULT '[]',
  has_attachments INTEGER NOT NULL DEFAULT 0, attachments TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX idx_mail_folder ON p_email_messages(account_id, folder, date DESC);

-- mpw.files (metadata; contents in BlobStore)
CREATE TABLE p_files_entries (
  id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, -- dir|file
  mime TEXT, size INTEGER NOT NULL DEFAULT 0, blob_ref TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
```

## 4. Blob & secret storage
- **BlobStore**: `refs` are opaque ids; metadata (path, mime, size, sha-256) lives in plugin tables, bytes in the store. Large files never enter SQLite.
- **Secrets**: `SecretStore.set('ai.key.openai', …)` → OS keychain. Only *which* key exists (not its value) is mirrored in settings. Email OAuth tokens: same store, namespaced per account id.

## 5. Migrations
- Ordered array `MIGRATIONS: {version, name, up(sql|fn)}`; runner executes inside a transaction, records `checksum`; mismatch → hard fail with clear error (never silently patch). Plugin migrations run through the same runner with per-plugin version table `plugin_kv('__schema_version')`.
- Tests: fresh-DB migration, incremental migration, checksum tamper detection, idempotent re-run — see `packages/kernel/test/migrations.spec.ts`.

## 6. Sync readiness (Phase 6, no work now)
UUIDv7 ids + tombstones + `updated_at` + `device_id` on every mutable row mean a `SyncProvider` can later do last-write-wins per field-bundle or CRDT upgrade without schema rewrites. Table `sync_state(device_id, table, last_push, last_pull)` will be added by the sync plugin, not core.
