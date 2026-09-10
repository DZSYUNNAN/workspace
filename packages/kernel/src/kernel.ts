import { EventBus } from './eventBus';
import { CommandBus } from './commandBus';
import { PluginRegistry, globalCommandId, globalRouteKey, globalWidgetKey } from './registry';
import { migrate, CORE_MIGRATIONS } from './migrations';
import { tablePrefix, PluginKv, SettingsService, WorkspaceStore } from './storage';
import type { DbAdapter } from './db';
import { BlobStore, MemoryBlobStore, type BlobStoreAdapter } from './blobStore';
import { MemorySecretStore, type SecretStoreAdapter } from './secretStore';
import { AiGateway } from './ai';
import { SearchService } from './search';
import { ContextService } from './context';
import { nowMs, uuidv7, type LayoutState } from '@mpw/shared';
import type {
  AiActionContribution,
  CommandContribution,
  PluginContext,
  PluginManifest,
  PluginState,
  RouteComponent,
  WidgetComponent,
  WorkspacePlugin,
} from './types';

export class PermissionError extends Error {}

export interface PluginRowInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon: string;
  permissions: string[];
  enabled: boolean;
  state: PluginState;
  builtin: boolean;
  error: string | null;
  loaded: boolean;
}

export interface BootReport {
  loaded: string[];
  failed: { id: string; error: string }[];
}

export interface KernelOptions {
  db: DbAdapter;
  blobStore?: BlobStoreAdapter;
  secretStore?: SecretStoreAdapter;
  logger?: {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

const log = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The kernel: infrastructure only (§22). Owns plugin lifecycle, permission gate,
 * storage, buses, search, AI gateway, context system. React-free.
 */
export class Kernel {
  readonly events = new EventBus();
  readonly commands = new CommandBus();
  readonly registry = new PluginRegistry();
  readonly settings: SettingsService;
  readonly workspaces: WorkspaceStore;
  readonly search = new SearchService();
  readonly context = new ContextService();
  readonly blobs: BlobStore;
  readonly secrets: SecretStoreAdapter;
  readonly ai: AiGateway;

  private readonly db: DbAdapter;
  private readonly logger;
  private readonly loaded = new Set<string>();
  private readonly disposables = new Map<string, (() => void)[]>();
  private readonly uiWidgets = new Map<string, WidgetComponent>();
  private readonly uiRoutes = new Map<string, RouteComponent>();
  private booted = false;

  constructor(opts: KernelOptions) {
    this.db = opts.db;
    this.logger = opts.logger ?? log;
    this.settings = new SettingsService(this.db);
    this.workspaces = new WorkspaceStore(this.db);
    this.blobs = new BlobStore(opts.blobStore ?? new MemoryBlobStore(), this.db);
    this.secrets = opts.secretStore ?? new MemorySecretStore();
    this.ai = new AiGateway(
      () => ({
        providerId: this.settings.get('ai.provider', 'demo'),
        baseUrl: this.settings.get<string | undefined>('ai.baseUrl', undefined),
        model: this.settings.get<string | undefined>('ai.model', undefined),
      }),
      (providerId) => this.secrets.get(`ai.key.${providerId}`)
    );
  }

  registerBuiltins(plugins: WorkspacePlugin[]): void {
    for (const p of plugins) this.registry.registerBuiltin(p);
  }

  /* ------------------------------- boot ------------------------------- */

  async boot(): Promise<BootReport> {
    if (this.booted) throw new Error('kernel already booted');
    this.booted = true;
    const result = migrate(this.db, CORE_MIGRATIONS);
    this.logger.info(`schema at v${result.current} (applied ${result.applied.length})`);
    this.settings.hydrate();
    this.workspaces.ensureDefault();
    this.seedBuiltinPresets();
    this.seedPluginRows();
    const consent = this.settings.get<string[]>('ai.context.disabled', []);
    this.context.loadConsent(consent);
    return await this.activateEnabledPlugins();
  }

  private seedPluginRows(): void {
    for (const p of this.registry.all()) {
      const m = p.manifest;
      const row = this.db.one('SELECT id, version FROM plugins WHERE id = ?', [m.id]);
      if (!row) {
        this.db.run(
          `INSERT INTO plugins (id, name, version, author, description, icon, permissions, manifest, enabled, builtin, state, settings, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'installed', '{}', ?, ?)`,
          [
            m.id,
            m.name,
            m.version,
            m.author,
            m.description,
            m.icon,
            JSON.stringify(m.permissions),
            JSON.stringify({
              ...m,
              contributions: {
                ...m.contributions,
                searchProviders: undefined,
                contextProviders: undefined,
                aiActions: undefined,
              },
            }),
            nowMs(),
            nowMs(),
          ]
        );
      } else if (row['version'] !== m.version) {
        this.db.run('UPDATE plugins SET version = ?, manifest = ?, updated_at = ? WHERE id = ?', [
          m.version,
          JSON.stringify(m),
          nowMs(),
          m.id,
        ]);
      }
    }
  }

  private seedBuiltinPresets(): void {
    const existing = this.db.one(
      "SELECT COUNT(*) AS n FROM layout_presets WHERE is_builtin = 1 AND deleted_at IS NULL"
    );
    if ((existing?.['n'] as number) > 0) return;
    const mk = (areas: Partial<LayoutState['areas']>): string =>
      JSON.stringify({
        version: 1,
        areas: { left: null, right: null, top: null, bottom: null, center: null, ...areas },
        floats: [],
        sizes: { leftW: 250, rightW: 340, topH: 180, bottomH: 160 },
      } satisfies LayoutState);
    const presets: { name: string; state: string }[] = [
      {
        name: 'Daily Work',
        state: mk({
          left: { kind: 'tabs', items: ['mpw.notes/list', 'mpw.files/browser'], active: 0 },
          center: { kind: 'tabs', items: ['mpw.email/client', 'mpw.home/dashboard'], active: 0 },
          right: { kind: 'tabs', items: ['mpw.ai/chat'], active: 0 },
        }),
      },
      {
        name: 'Research Mode',
        state: mk({
          left: { kind: 'tabs', items: ['mpw.notes/list'], active: 0 },
          center: { kind: 'tabs', items: ['mpw.references/library'], active: 0 },
          right: { kind: 'tabs', items: ['mpw.ai/chat'], active: 0 },
        }),
      },
      {
        name: 'Paper Writing',
        state: mk({
          left: { kind: 'tabs', items: ['mpw.references/library'], active: 0 },
          center: { kind: 'tabs', items: ['mpw.writing/editor'], active: 0 },
          right: { kind: 'tabs', items: ['mpw.ai/chat'], active: 0 },
        }),
      },
      {
        name: 'Teaching Mode',
        state: mk({
          left: { kind: 'tabs', items: ['mpw.files/browser'], active: 0 },
          center: { kind: 'tabs', items: ['mpw.writing/editor', 'mpw.notes/list'], active: 0 },
          right: { kind: 'tabs', items: ['mpw.ai/chat'], active: 0 },
        }),
      },
    ];
    for (const p of presets) this.workspaces.savePreset(p.name, p.state, null, true);
  }

  /* --------------------------- lifecycle mgmt --------------------------- */

  private row(id: string): Record<string, unknown> | null {
    return this.db.one('SELECT * FROM plugins WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  listPlugins(): PluginRowInfo[] {
    return this.db
      .all('SELECT * FROM plugins WHERE deleted_at IS NULL ORDER BY name')
      .map((r) => {
        const id = r['id'] as string;
        const state = r['state'] as PluginState;
        return {
          id,
          name: r['name'] as string,
          version: r['version'] as string,
          author: (r['author'] as string) ?? '',
          description: (r['description'] as string) ?? '',
          icon: (r['icon'] as string) ?? 'puzzle',
          permissions: JSON.parse((r['permissions'] as string) ?? '[]') as string[],
          enabled: r['enabled'] === 1,
          state,
          builtin: r['builtin'] === 1,
          error: (r['error'] as string) ?? null,
          loaded: this.loaded.has(id),
        };
      });
  }

  private async activateEnabledPlugins(): Promise<BootReport> {
    const loaded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const info of this.listPlugins()) {
      if (!info.enabled) continue;
      try {
        await this.activatePlugin(info.id);
        loaded.push(info.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`plugin ${info.id} failed to activate: ${message}`);
        this.db.run("UPDATE plugins SET state = 'error', error = ?, updated_at = ? WHERE id = ?", [
          message,
          nowMs(),
          info.id,
        ]);
        failed.push({ id: info.id, error: message });
      }
    }
    this.events.emit('plugins:changed', { loaded, failed });
    return { loaded, failed };
  }

  async enablePlugin(id: string): Promise<void> {
    this.assertRegistered(id);
    this.db.run("UPDATE plugins SET enabled = 1, state = 'enabled', error = NULL, updated_at = ? WHERE id = ?", [
      nowMs(),
      id,
    ]);
    await this.activatePlugin(id);
    this.events.emit('plugins:changed', { id, enabled: true });
  }

  async disablePlugin(id: string): Promise<void> {
    this.assertRegistered(id);
    await this.deactivatePlugin(id);
    this.db.run("UPDATE plugins SET enabled = 0, state = 'disabled', updated_at = ? WHERE id = ?", [
      nowMs(),
      id,
    ]);
    this.events.emit('plugins:changed', { id, enabled: false });
  }

  /** Uninstall: deactivate + optionally wipe the plugin's namespaced data. */
  async uninstallPlugin(id: string, opts?: { deleteData?: boolean }): Promise<void> {
    this.assertRegistered(id);
    await this.deactivatePlugin(id);
    if (opts?.deleteData) {
      const prefix = this.registry.prefixOf(id);
      for (const row of this.db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?", [`${prefix}%`])) {
        this.db.run(`DROP TABLE IF EXISTS "${row['name'] as string}"`);
      }
      this.db.run('DELETE FROM plugin_kv WHERE plugin_id = ?', [id]);
    }
    this.db.run("UPDATE plugins SET enabled = 0, state = 'uninstalled', updated_at = ? WHERE id = ?", [
      nowMs(),
      id,
    ]);
    this.events.emit('plugins:changed', { id, uninstalled: true });
  }

  async setPluginSettings(id: string, values: Record<string, unknown>): Promise<void> {
    this.assertRegistered(id);
    const plugin = this.registry.get(id);
    const secretKeys = new Set(
      (plugin?.manifest.contributions.settings ?? []).filter((s) => s.secret).map((s) => s.key)
    );
    const current = this.getPluginSettingsRaw(id);
    for (const [key, value] of Object.entries(values)) {
      if (secretKeys.has(key)) {
        if (typeof value === 'string' && value.length > 0) {
          await this.secrets.set(`${id}:setting.${key}`, value);
        }
      } else {
        current[key] = value;
      }
    }
    this.db.run('UPDATE plugins SET settings = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(current),
      nowMs(),
      id,
    ]);
    this.events.emit('settings:changed', { pluginId: id });
  }

  private getPluginSettingsRaw(id: string): Record<string, unknown> {
    const row = this.row(id);
    try {
      return JSON.parse((row?.['settings'] as string) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private assertRegistered(id: string): void {
    if (!this.registry.get(id)) throw new Error(`plugin not registered: ${id}`);
  }

  /* --------------------- activation & contributions --------------------- */

  private async activatePlugin(id: string): Promise<void> {
    if (this.loaded.has(id)) return;
    const plugin = this.registry.get(id);
    if (!plugin) throw new Error(`plugin not registered: ${id}`);
    const ctx = this.createContext(id);
    const subs: (() => void)[] = [];
    this.disposables.set(id, subs);

    for (const w of plugin.manifest.contributions.widgets ?? []) {
      // components are registered by the plugin during activate()
    }
    await plugin.activate(ctx);

    // manifest-declared services are wired by the kernel at activation time
    for (const sp of plugin.manifest.contributions.searchProviders ?? []) {
      subs.push(this.search.register(id, sp));
    }
    for (const cp of plugin.manifest.contributions.contextProviders ?? []) {
      subs.push(this.context.register(id, cp));
    }

    for (const w of plugin.manifest.contributions.widgets ?? []) {
      const key = globalWidgetKey(id, w.id);
      if (!this.uiWidgets.has(key)) {
        this.logger.warn(`widget ${key} declared but never registered — placeholder will render`);
      }
    }
    this.loaded.add(id);
    this.db.run("UPDATE plugins SET state = 'enabled', error = NULL, updated_at = ? WHERE id = ?", [
      nowMs(),
      id,
    ]);
  }

  private async deactivatePlugin(id: string): Promise<void> {
    if (!this.loaded.has(id)) return;
    this.loaded.delete(id);
    const subs = this.disposables.get(id) ?? [];
    this.disposables.delete(id);
    // unregister contributions first — UI must not call into a dying plugin
    for (const w of this.registry.get(id)?.manifest.contributions.widgets ?? []) {
      this.uiWidgets.delete(globalWidgetKey(id, w.id));
    }
    for (const r of this.registry.get(id)?.manifest.contributions.routes ?? []) {
      this.uiRoutes.delete(globalRouteKey(id, r.id));
    }
    this.search.unregisterPlugin(id);
    this.context.unregisterPlugin(id);
    for (const cmd of this.registry.get(id)?.manifest.contributions.commands ?? []) {
      void this.commands.register(
        { id: globalCommandId(id, cmd.id), title: cmd.title },
        () => {
          throw new Error(`plugin ${id} is disabled`);
        }
      );
    }
    for (const off of subs.reverse()) off();
    const plugin = this.registry.get(id);
    try {
      await plugin?.deactivate?.();
    } catch (err) {
      this.logger.warn(`plugin ${id} deactivate threw: ${String(err)}`);
    }
  }

  /* --------------------------- PluginContext --------------------------- */

  private requirePermission(id: string, permission: string): void {
    const manifest = this.registry.get(id)?.manifest;
    if (!manifest?.permissions.includes(permission as never)) {
      throw new PermissionError(
        `plugin "${id}" tried to use "${permission}" without declaring it in its manifest`
      );
    }
  }

  private createContext(id: string): PluginContext {
    const prefix = this.registry.prefixOf(id);
    const kv = new PluginKv(this.db, id);
    const subs = this.disposables.get(id) ?? [];
    const self = this;

    return {
      pluginId: id,
      storage: {
        get: async <T,>(key: string, defaultValue: T) => kv.get(key, defaultValue),
        set: async <T,>(key: string, value: T) => {
          kv.set(key, value);
        },
        delete: async (key: string) => kv.delete(key),
        sql: {
          exec: async (statement: string, params?: unknown[]) => {
            this.requirePermission(id, 'storage');
            tableStatementGuard(statement, prefix);
            this.db.run(statement, params as never[]);
          },
          all: async <T,>(statement: string, params?: unknown[]) => {
            this.requirePermission(id, 'storage');
            tableStatementGuard(statement, prefix);
            return this.db.all(statement, params) as T[];
          },
          one: async <T,>(statement: string, params?: unknown[]) => {
            this.requirePermission(id, 'storage');
            tableStatementGuard(statement, prefix);
            return (this.db.one(statement, params) as T) ?? null;
          },
        },
      },
      settings: {
        get: async <T,>(key: string, defaultValue: T) => {
          const plugin = self.registry.get(id);
          const def = plugin?.manifest.contributions.settings?.find((s) => s.key === key);
          const raw = self.getPluginSettingsRaw(id);
          if (key in raw) return raw[key] as T;
          if (def?.secret) {
            const secret = await self.secrets.get(`${id}:setting.${key}`);
            return (secret ?? (defaultValue as T)) as T;
          }
          return (def?.default as T) ?? defaultValue;
        },
        all: async () => self.getPluginSettingsRaw(id),
      },
      events: {
        emit: (type: string, payload?: unknown) => self.events.emit(type, payload),
        on: (type: string, handler: (p: unknown) => void) => {
          const off = self.events.on(type, handler);
          subs.push(off);
          return off;
        },
      },
      commands: {
        register: (localId: string, handler) => {
          const gid = globalCommandId(id, localId.replace(`${id}.`, ''));
          const declared = self
            .registry.get(id)
            ?.manifest.contributions.commands?.find((c) => globalCommandId(id, c.id) === gid);
          if (!declared) throw new Error(`command "${gid}" is not declared in the manifest`);
          const off = self.commands.register(
            { id: gid, title: declared.title, icon: declared.icon, shortcut: declared.shortcut, category: declared.category },
            handler
          );
          subs.push(off);
          return off;
        },
        execute: (cmdId: string, args?: unknown) => self.commands.execute(cmdId, args),
        list: () => self.commands.list(),
      },
      secrets: {
        get: async (key: string) => {
          self.requirePermission(id, 'credentials');
          return await self.secrets.get(`${id}:${key}`);
        },
        set: async (key: string, value: string) => {
          self.requirePermission(id, 'credentials');
          await self.secrets.set(`${id}:${key}`, value);
        },
        delete: async (key: string) => {
          self.requirePermission(id, 'credentials');
          await self.secrets.delete(`${id}:${key}`);
        },
      },
      blobs: {
        put: async (path: string, data: Blob | Uint8Array, mime?: string) => {
          self.requirePermission(id, 'blobs');
          return await self.blobs.put(`${id}/${path}`, data, mime);
        },
        get: async (ref: string) => await self.blobs.get(ref),  // StoredBlob | null
        list: async (prefixPath?: string) => self.blobs.list(prefixPath ? `${id}/${prefixPath}` : id),
        delete: async (ref: string) => await self.blobs.delete(ref),
      },
      ai: {
        run: async (prompt: string, opts?) => {
          self.requirePermission(id, 'ai:invoke');
          return await self.ai.run(prompt, opts);
        },
      },
      ui: {
        notify: (message, kind) => self.events.emit('notify', { message, kind, pluginId: id }),
        registerWidget: (localId, component) => {
          const key = globalWidgetKey(id, localId);
          self.uiWidgets.set(key, component);
          subs.push(() => self.uiWidgets.delete(key));
          return () => self.uiWidgets.delete(key);
        },
        registerRoute: (localId, component) => {
          const key = globalRouteKey(id, localId);
          self.uiRoutes.set(key, component);
          subs.push(() => self.uiRoutes.delete(key));
          return () => self.uiRoutes.delete(key);
        },
        openWidget: (globalId) => self.events.emit('ui:openWidget', { widgetId: globalId }),
      },
      log: {
        debug: (m, ...a) => self.logger.debug(`[${id}] ${m}`, ...a),
        info: (m, ...a) => self.logger.info(`[${id}] ${m}`, ...a),
        warn: (m, ...a) => self.logger.warn(`[${id}] ${m}`, ...a),
        error: (m, ...a) => self.logger.error(`[${id}] ${m}`, ...a),
      },
    };
  }

  /* ------------------------- UI-facing accessors ------------------------- */

  widgetComponent(key: string): WidgetComponent | undefined {
    return this.uiWidgets.get(key);
  }

  routeComponent(key: string): RouteComponent | undefined {
    return this.uiRoutes.get(key);
  }

  loadedIds(): string[] {
    return [...this.loaded];
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  enabledWidgets(): { key: string; pluginId: string; title: string; icon: string; defaultArea: string }[] {
    const out: { key: string; pluginId: string; title: string; icon: string; defaultArea: string }[] = [];
    for (const id of this.loaded) {
      for (const w of this.registry.get(id)?.manifest.contributions.widgets ?? []) {
        out.push({
          key: globalWidgetKey(id, w.id),
          pluginId: id,
          title: w.title,
          icon: w.icon ?? 'puzzle',
          defaultArea: w.defaultArea ?? 'center',
        });
      }
    }
    return out;
  }

  enabledRoutes(): { key: string; pluginId: string; title: string; icon: string; order: number }[] {
    const out: { key: string; pluginId: string; title: string; icon: string; order: number }[] = [];
    for (const id of this.loaded) {
      for (const r of this.registry.get(id)?.manifest.contributions.routes ?? []) {
        out.push({
          key: globalRouteKey(id, r.id),
          pluginId: id,
          title: r.title,
          icon: r.icon ?? 'puzzle',
          order: r.order ?? 100,
        });
      }
    }
    return out.sort((a, b) => a.order - b.order);
  }

  enabledAiActions(): (AiActionContribution & { pluginId: string; globalId: string })[] {
    const out: (AiActionContribution & { pluginId: string; globalId: string })[] = [];
    for (const id of this.loaded) {
      for (const a of this.registry.get(id)?.manifest.contributions.aiActions ?? []) {
        out.push({ ...a, pluginId: id, globalId: `${id}/${a.id}` });
      }
    }
    return out;
  }

  /** Commands palette feed: only commands of loaded plugins. */
  availableCommands(): CommandContribution[] {
    return this.commands.list().filter((c) => {
      const pluginId = c.id.split('.')[0] as string;
      return pluginId === 'mpw' || this.loaded.has(pluginId);
    });
  }
}

/** Defense-in-depth: plugins may only touch tables in their own namespace. */
function tableStatementGuard(sql: string, prefix: string): void {
  const refs: string[] = [];
  const re = /\b(?:from|into|update|join|table|index|trigger|view)\s+(?:if\s+(?:not\s+)?exists\s+)?["'`]?([a-zA-Z_][\w]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) refs.push(m[1] as string);
  for (const t of refs) {
    if (t.startsWith(prefix)) continue;
    if (t === 'sqlite_sequence' || t.startsWith('temp_') || t.startsWith('cte_')) continue;
    throw new PermissionError(
      `storage namespace violation: table "${t}" is outside this plugin's namespace (${prefix}*)`
    );
  }
}

export { tablePrefix, globalCommandId, globalRouteKey, globalWidgetKey };
