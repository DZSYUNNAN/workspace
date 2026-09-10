/**
 * Plugin SDK types (normative — see PLUGIN_SPEC.md).
 * The kernel stays React-free: UI handles are opaque `unknown` and are cast by the app layer.
 */
import type { ReactElement } from 'react';
import type { ContextChunk, SearchHit, AiRunOptions, AiResult } from '@mpw/shared';
import type { StoredBlob } from './blobStore';

export type Permission =
  | 'storage'
  | 'blobs'
  | 'network'
  | 'credentials'
  | 'clipboard'
  | 'ai:invoke';

export const ALL_PERMISSIONS: Permission[] = [
  'storage',
  'blobs',
  'network',
  'credentials',
  'clipboard',
  'ai:invoke',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  storage: 'Local storage',
  blobs: 'File system',
  network: 'Network access',
  credentials: 'Credentials (OS keychain)',
  clipboard: 'Clipboard',
  'ai:invoke': 'AI assistant',
};

export type DockArea = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'float';

export interface WidgetContribution {
  id: string; // unique within plugin; global key is `${pluginId}/${id}`
  title: string;
  icon?: string;
  minW?: number;
  minH?: number;
  defaultW?: number;
  defaultH?: number;
  defaultArea?: DockArea;
  singleton?: boolean;
}

export interface RouteContribution {
  id: string; // global key `${pluginId}/${id}`
  title: string;
  icon?: string;
  showInSidebar?: boolean;
  order?: number;
}

export interface CommandContribution {
  id: string; // global id `${pluginId}.${id}`
  title: string;
  icon?: string;
  shortcut?: string;
  category?: string;
}

export interface SearchProviderContribution {
  id: string;
  label: string;
  search(q: string, limit: number): Promise<SearchHit[]>;
}

export interface ContextProviderContribution {
  id: string;
  label: string;
  getContext(): Promise<ContextChunk | null>;
}

export interface AiActionContribution {
  id: string;
  label: string;
  icon?: string;
  prompt: (selection: string, contextText?: string) => string;
  appliesTo?: string[];
  insert?: 'replace' | 'below' | 'none';
}

export type SettingFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'password';

export interface SettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  default?: unknown;
  options?: { value: string; label: string }[];
  hint?: string;
  secret?: boolean;
}

export interface Contributions {
  widgets?: WidgetContribution[];
  routes?: RouteContribution[];
  commands?: CommandContribution[];
  searchProviders?: SearchProviderContribution[];
  contextProviders?: ContextProviderContribution[];
  settings?: SettingField[];
  aiActions?: AiActionContribution[];
}

export interface PluginManifest {
  id: string; // reverse-DNS, immutable: 'mpw.notes'
  name: string;
  version: string;
  author: string;
  description: string;
  icon: string;
  minCoreVersion: string;
  permissions: Permission[];
  contributions: Contributions;
}

/* ---------- UI component handles (opaque to the kernel) ---------- */

export interface WidgetProps {
  widgetId: string; // global widget key
  instanceId: string;
}

export type WidgetComponent = (props: WidgetProps) => ReactElement;
export type RouteComponent = () => ReactElement;

/* ---------- plugin-facing services ---------- */

export type Unsubscribe = () => void;
export type CommandHandler = (args?: unknown) => unknown | Promise<unknown>;

export interface PluginStorage {
  get<T>(key: string, defaultValue: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  sql: {
    exec(statement: string, params?: unknown[]): Promise<void>;
    all<T = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T[]>;
    one<T = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T | null>;
  };
}

export interface PluginEvents {
  emit(type: string, payload?: unknown): void;
  on(type: string, handler: (payload: unknown) => void): Unsubscribe;
}

export interface PluginCommands {
  register(id: string, handler: CommandHandler): Unsubscribe;
  execute(id: string, args?: unknown): Promise<unknown>;
  list(): CommandContribution[];
}

export interface PluginSecrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface BlobRef {
  ref: string;
  path: string;
  mime: string;
  size: number;
}

export interface PluginBlobs {
  put(path: string, data: Blob | Uint8Array, mime?: string): Promise<BlobRef>;
  get(ref: string): Promise<StoredBlob | null>;
  list(prefix?: string): Promise<BlobRef[]>;
  delete(ref: string): Promise<void>;
}

export interface PluginAi {
  run(prompt: string, opts?: AiRunOptions): Promise<AiResult>;
}

export interface PluginUi {
  notify(message: string, kind?: 'info' | 'success' | 'warn' | 'error'): void;
  registerWidget(id: string, component: WidgetComponent): Unsubscribe;
  registerRoute(id: string, component: RouteComponent): Unsubscribe;
  openWidget(globalWidgetId: string): void;
}

export interface PluginLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface PluginSettings {
  get<T>(key: string, defaultValue: T): Promise<T>;
  all(): Promise<Record<string, unknown>>;
}

export interface PluginContext {
  pluginId: string;
  storage: PluginStorage;
  settings: PluginSettings;
  events: PluginEvents;
  commands: PluginCommands;
  secrets: PluginSecrets;
  blobs: PluginBlobs;
  ai: PluginAi;
  ui: PluginUi;
  log: PluginLogger;
}

export interface WorkspacePlugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'error' | 'uninstalled';

/** A helper for plugins — identity function with a nicer name. */
export function definePlugin(plugin: WorkspacePlugin): WorkspacePlugin {
  return plugin;
}
