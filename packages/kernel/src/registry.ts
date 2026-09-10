import { ALL_PERMISSIONS, type Permission, type PluginManifest, type WorkspacePlugin } from './types';
import { tablePrefix } from './storage';

export class PluginValidationError extends Error {}

const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]+)+$/;
const SCOPE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new PluginValidationError(msg);
}

/** Manifest validation — hard gate at install/registration time (PLUGIN_SPEC §2). */
export function validateManifest(m: PluginManifest): void {
  assert(m && typeof m === 'object', 'manifest must be an object');
  assert(typeof m.id === 'string' && ID_RE.test(m.id), `invalid plugin id "${String(m.id)}" (expected reverse-DNS like "mpw.notes")`);
  assert(typeof m.name === 'string' && m.name.length > 0, `${m.id}: name required`);
  assert(typeof m.version === 'string' && SEMVER_RE.test(m.version), `${m.id}: version must be semver`);
  assert(Array.isArray(m.permissions), `${m.id}: permissions must be an array`);
  for (const p of m.permissions) {
    assert(ALL_PERMISSIONS.includes(p as Permission), `${m.id}: unknown permission "${String(p)}"`);
  }
  assert(m.contributions && typeof m.contributions === 'object', `${m.id}: contributions required`);
  const c = m.contributions;
  for (const w of c.widgets ?? []) {
    assert(SCOPE_ID_RE.test(w.id), `${m.id}: widget id "${w.id}" must be [a-z0-9_-]`);
    assert(typeof w.title === 'string' && w.title, `${m.id}: widget ${w.id} needs a title`);
  }
  for (const r of c.routes ?? []) {
    assert(SCOPE_ID_RE.test(r.id), `${m.id}: route id "${r.id}" must be [a-z0-9_-]`);
  }
  for (const cmd of c.commands ?? []) {
    assert(SCOPE_ID_RE.test(cmd.id), `${m.id}: command id "${cmd.id}" must be [a-z0-9_-] (global id gets the plugin prefix)`);
  }
  for (const sp of c.searchProviders ?? []) {
    assert(typeof sp.search === 'function', `${m.id}: search provider ${sp.id} needs a search fn`);
  }
  for (const cp of c.contextProviders ?? []) {
    assert(typeof cp.getContext === 'function', `${m.id}: context provider ${cp.id} needs getContext fn`);
  }
  for (const aa of c.aiActions ?? []) {
    assert(typeof aa.prompt === 'function', `${m.id}: aiAction ${aa.id} needs prompt fn`);
  }
  for (const sf of c.settings ?? []) {
    assert(SCOPE_ID_RE.test(sf.key), `${m.id}: setting key "${sf.key}" must be [a-z0-9_-]`);
    assert(sf.secret !== true || m.permissions.includes('credentials'), `${m.id}: secret setting ${sf.key} requires 'credentials' permission`);
  }
}

export const globalWidgetKey = (pluginId: string, id: string): string => `${pluginId}/${id}`;
export const globalRouteKey = (pluginId: string, id: string): string => `${pluginId}/${id}`;
export const globalCommandId = (pluginId: string, id: string): string => `${pluginId}.${id}`;

interface Registered {
  plugin: WorkspacePlugin;
  prefix: string;
}

export class PluginRegistry {
  private byId = new Map<string, Registered>();
  private prefixes = new Set<string>();

  registerBuiltin(plugin: WorkspacePlugin): void {
    validateManifest(plugin.manifest);
    const prefix = tablePrefix(plugin.manifest.id);
    if (this.prefixes.has(prefix)) {
      throw new PluginValidationError(`table prefix collision for "${plugin.manifest.id}" (${prefix})`);
    }
    this.prefixes.add(prefix);
    this.byId.set(plugin.manifest.id, { plugin, prefix });
  }

  get(id: string): WorkspacePlugin | undefined {
    return this.byId.get(id)?.plugin;
  }

  prefixOf(id: string): string {
    return this.byId.get(id)?.prefix ?? tablePrefix(id);
  }

  all(): WorkspacePlugin[] {
    return [...this.byId.values()].map((r) => r.plugin);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }
}
