import { PluginKv, type Kernel, type DbAdapter } from '@mpw/kernel';
import { parseResourceUri, resourceUri } from '@mpw/shared';
const kinds = [
  { kind: 'note', plugin: 'mpw.notes', table: 'p_notes_notes', label: 'title' },
  { kind: 'reference', plugin: 'mpw.references', table: 'p_references_references', label: 'title' },
  { kind: 'doc', plugin: 'mpw.writing', table: 'p_writing_documents', label: 'title' },
] as const;
export function registerResources(kernel: Kernel, db: DbAdapter): void {
  kernel.commands.register({ id: 'workspace.resources', title: '项目资源列表' }, () => kinds.flatMap((type) => {
    if (!kernel.isLoaded(type.plugin)) return [];
    return db.all(`SELECT id, ${type.label} AS title FROM ${type.table} WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`)
      .map((row) => ({ uri: resourceUri(type.kind, String(row.id)), title: String(row.title), kind: type.kind }));
  }));
  kernel.commands.register({ id: 'workspace.openResource', title: '打开项目资源' }, (args) => {
    const parsed = parseResourceUri(String(args));
    const type = kinds.find((t) => t.kind === parsed?.kind);
    if (!type || !parsed || !kernel.isLoaded(type.plugin)) throw new Error('该资源的插件未启用');
    const row = db.one(`SELECT id FROM ${type.table} WHERE id = ? AND deleted_at IS NULL`, [parsed.id]);
    if (!row) throw new Error('该资源已删除或不存在');
    new PluginKv(db, type.plugin).set('ui.openId', parsed.id);
    kernel.events.emit('workspace:navigate', { plugin: type.plugin, id: parsed.id });
  });
}
