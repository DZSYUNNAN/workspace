import React, { useEffect, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { parseResourceUri, resourceUri } from '@mpw/shared';
import { addLink, createProject, deleteProject, listLinks, listProjects, removeLink, type ProjectLinkRecord, type ProjectRecord } from './store';


const KIND_LABEL: Record<string, string> = {
  note: '笔记', reference: '文献', doc: '文档', mail: '邮件', task: '任务', blob: '文件',
};

export function ProjectsView(props: { ctx: PluginContext }): React.ReactElement {
  const { ctx } = props;
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [links, setLinks] = useState<ProjectLinkRecord[]>([]);
  const [uriDraft, setUriDraft] = useState('');
  const [resources, setResources] = useState<{ uri: string; title: string; kind: string }[]>([]);
  const [resourceQuery, setResourceQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const fail = (e: unknown): void => ctx.ui.notify(e instanceof Error ? e.message : String(e), 'error');

  const loadProjects = async (): Promise<void> =>
    setProjects(await listProjects(ctx));

  const loadLinks = async (): Promise<void> => {
    if (!activeId) return setLinks([]);
    setLinks(await listLinks(ctx, activeId));
  };

  useEffect(() => {
    void loadProjects();
    void ctx.commands.execute('workspace.resources').then((r) => setResources(r as typeof resources)).catch(fail);
    void ctx.storage.get<string | null>('activeProject', null).then(setActiveId);
  }, []);
  useEffect(() => {
    void loadLinks();
  }, [activeId]);

  const submitProject = async (): Promise<void> => {
    const name = projectName.trim();
    if (!name) return;
    const created = await createProject(ctx, name);
    setActiveId(created.id);
    await ctx.storage.set('activeProject', created.id);
    await loadProjects();
    setProjectName('');
    setCreating(false);
  };

  const submitLink = async (): Promise<void> => {
    const raw = uriDraft.trim();
    setUriDraft('');
    const parsed = parseResourceUri(raw);
    if (!parsed) {
      ctx.ui.notify('资源链接格式应为 mpw://类型/ID,如 mpw://note/xxx', 'warn');
      return;
    }
    if (!activeId) {
      ctx.ui.notify('请先选择或创建一个项目', 'warn');
      return;
    }
    await addLink(ctx, activeId, raw, parsed.id);
    await loadLinks();
  };

  const active = projects.find((p) => p.id === activeId) ?? null;
  const counts = links.reduce<Record<string, number>>((acc, l) => {
    const kind = parseResourceUri(l.resource_uri)?.kind ?? 'other';
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="notes-split">
      <div className="notes-side">
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1 }}>{projects.length} 个项目</span>
          <button className="btn sm primary" title="新建项目" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        {creating && <form style={{ padding: 8, display: 'grid', gap: 6 }} onSubmit={(e) => { e.preventDefault(); void submitProject().catch(fail); }}>
          <input autoFocus className="input" aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm primary" type="submit" disabled={!projectName.trim()}>创建项目</button>
            <button className="btn sm" type="button" onClick={() => setCreating(false)}>取消</button>
          </div>
        </form>}
        <div className="list">
          {projects.map((p) => (
            <button key={p.id} className={`list-row${p.id === activeId ? ' active' : ''}`} onClick={() => { setActiveId(p.id); void ctx.storage.set('activeProject', p.id); }}>
              <Icon name="grid" size={13} />
              <span className="lr-title">{p.name}</span>
            </button>
          ))}
          {projects.length === 0 && <div className="empty-state">暂无项目<br /><span style={{ fontSize: 11 }}>项目把文献、笔记、文档、任务组织在一起(引用而非复制)</span></div>}
        </div>
      </div>
      <div className="ref-detail">
        {active ? (
          <>
            <h3>{active.name}</h3>
            <div className="ref-meta">把课题所需的文献、笔记和文档放在一起</div>
            <input className="input" aria-label="查找项目资源" placeholder="查找文献、笔记或文档…" value={resourceQuery} onChange={(e) => setResourceQuery(e.target.value)} />
            <div style={{ maxHeight: 180, overflow: 'auto', margin: '8px 0' }}>
              {resources.filter((r) => r.title.toLowerCase().includes(resourceQuery.toLowerCase()) && !links.some((l) => l.resource_uri === r.uri)).map((r) => <button className="list-row" key={r.uri} onClick={() => {
                void addLink(ctx, active.id, r.uri, r.title).then(loadLinks).catch(fail);
              }}>＋ {KIND_LABEL[r.kind]} · {r.title}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
              {Object.entries(counts).map(([kind, n]) => (
                <span key={kind} className="badge">{KIND_LABEL[kind] ?? kind} × {n}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input className="input" style={{ flex: 1 }} placeholder="粘贴资源链接,如 mpw://note/… 或 mpw://reference/…" value={uriDraft} onChange={(e) => setUriDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitLink()} />
              <button className="btn sm primary" onClick={() => void submitLink()}>
                <Icon name="link" size={12} /> 关联资源
              </button>
            </div>
            <div className="list" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              {links.map((l) => (
                <div key={l.id} className="list-row">
                  <Icon name="link" size={12} />
                  <button className="btn sm" onClick={() => void ctx.commands.execute('workspace.openResource', l.resource_uri).catch(fail)}>{l.label || l.resource_uri}</button>
                  <span style={{ flex: 1 }} />
                  <button
                    className="icon-btn danger"
                    onClick={async () => {
                      await removeLink(ctx, l.id);
                      await loadLinks();
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
              {links.length === 0 && <div className="empty-state">还没有关联资源</div>}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
              关联只保存引用，不会复制内容。点击已关联的标题即可继续阅读或编辑。
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Icon name="grid" size={26} />
            <div>选择或创建一个项目</div>
          </div>
        )}
      </div>
    </div>
  );
}
