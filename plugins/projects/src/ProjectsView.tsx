import React, { useEffect, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { parseResourceUri, resourceUri } from '@mpw/shared';

interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
}
interface Link {
  id: string;
  resource_uri: string;
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  note: '笔记', reference: '文献', doc: '文档', mail: '邮件', task: '任务', blob: '文件',
};

export function ProjectsView(props: { ctx: PluginContext }): React.ReactElement {
  const { ctx } = props;
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [uriDraft, setUriDraft] = useState('');

  const loadProjects = async (): Promise<void> =>
    setProjects(await ctx.storage.sql.all<Project>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at'));

  const loadLinks = async (): Promise<void> => {
    if (!activeId) return setLinks([]);
    setLinks(
      await ctx.storage.sql.all<Link>('SELECT id, resource_uri, label FROM project_links WHERE project_id = ? ORDER BY added_at', [activeId])
    );
  };

  useEffect(() => {
    void loadProjects();
  }, []);
  useEffect(() => {
    void loadLinks();
  }, [activeId]);

  const createProject = async (): Promise<void> => {
    const name = window.prompt('项目名称(如:多模态图像融合)');
    if (!name) return;
    await ctx.storage.sql.exec(
      'INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, '', Date.now(), Date.now()]
    );
    await loadProjects();
  };

  const addLink = async (): Promise<void> => {
    const raw = uriDraft.trim();
    setUriDraft('');
    const parsed = parseResourceUri(raw);
    if (!parsed) {
      ctx.ui.notify('资源链接格式应为 mpw://类型/ID,如 mpw://note/xxx', 'warn');
      return;
    }
    await ctx.storage.sql.exec('INSERT INTO project_links (id, project_id, resource_uri, label, added_at) VALUES (?, ?, ?, ?, ?)', [
      String(Date.now()) + Math.random().toString(16).slice(2, 6),
      activeId,
      raw,
      parsed.id,
      Date.now(),
    ]);
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
          <button className="btn sm primary" onClick={() => void createProject()}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div className="list">
          {projects.map((p) => (
            <button key={p.id} className={`list-row${p.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(p.id)}>
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
            <div className="ref-meta">通过稳定资源链接(mpw://)组织跨插件内容</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
              {Object.entries(counts).map(([kind, n]) => (
                <span key={kind} className="badge">{KIND_LABEL[kind] ?? kind} × {n}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input className="input" style={{ flex: 1 }} placeholder="粘贴资源链接,如 mpw://note/… 或 mpw://reference/…" value={uriDraft} onChange={(e) => setUriDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addLink()} />
              <button className="btn sm primary" onClick={() => void addLink()}>
                <Icon name="link" size={12} /> 关联资源
              </button>
            </div>
            <div className="list" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              {links.map((l) => (
                <div key={l.id} className="list-row">
                  <Icon name="link" size={12} />
                  <code style={{ fontSize: 11 }}>{l.resource_uri}</code>
                  <span style={{ flex: 1 }} />
                  <button
                    className="icon-btn danger"
                    onClick={async () => {
                      await ctx.storage.sql.exec('DELETE FROM project_links WHERE id = ?', [l.id]);
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
              提示:在笔记 / 文献 / 邮件列表中右键复制资源链接的功能将在下一版本开放;当前可在对应详情页获取 ID 后手动构造 {resourceUri('note', '…')}
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
