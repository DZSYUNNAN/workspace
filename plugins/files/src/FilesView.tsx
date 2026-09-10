import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { nowMs, uuidv7 } from '@mpw/shared';

interface Entry {
  id: string;
  parent_id: string | null;
  name: string;
  kind: 'dir' | 'file';
  mime: string | null;
  size: number;
  blob_ref: string | null;
}

async function listChildren(ctx: PluginContext, parent: string | null): Promise<Entry[]> {
  return await ctx.storage.sql.all<Entry>(
    'SELECT * FROM p_files_entries WHERE deleted_at IS NULL AND parent_id IS ? ORDER BY kind DESC, name',
    [parent]
  );
}

export function FilesView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [cwd, setCwd] = useState<{ id: string | null; name: string }>({ id: null, name: 'Home' });
  const [crumbs, setCrumbs] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Home' }]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = async (): Promise<void> => setEntries(await listChildren(ctx, cwd.id));

  useEffect(() => {
    void reload();
    const off = ctx.events.on('files:changed', () => void reload());
    return off;
  }, [cwd.id]);

  const upload = async (files: FileList): Promise<void> => {
    for (const f of Array.from(files)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const blob = await ctx.blobs.put(`files/${f.name}`, bytes, f.type || 'application/octet-stream');
      await ctx.storage.sql.exec(
        'INSERT INTO p_files_entries (id, parent_id, name, kind, mime, size, blob_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv7(), cwd.id, f.name, 'file', f.type || 'application/octet-stream', bytes.length, blob.ref, nowMs(), nowMs()]
      );
    }
    ctx.events.emit('files:changed', {});
    ctx.ui.notify(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`, 'success');
  };

  const download = async (e: Entry): Promise<void> => {
    if (!e.blob_ref) return;
    const stored = await ctx.blobs.get(e.blob_ref);
    if (!stored) return;
    const bytes = stored.bytes;
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset) as ArrayBuffer], { type: e.mime ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = e.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const open = async (e: Entry): Promise<void> => {
    if (e.kind === 'dir') {
      const next = { id: e.id, name: e.name };
      setCwd(next);
      setCrumbs((c) => [...c, next]);
    } else {
      await download(e);
    }
  };

  return (
    <div className="widget" style={{ position: 'relative' }}>
      <div className="widget-toolbar">
        {crumbs.map((c, i) => (
          <React.Fragment key={c.id ?? 'root'}>
            {i > 0 && <span style={{ color: 'var(--text-3)' }}>/</span>}
            <button
              className="btn sm"
              onClick={() => {
                setCwd(c);
                setCrumbs((all) => all.slice(0, i + 1));
              }}
            >
              {c.name}
            </button>
          </React.Fragment>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="btn sm"
          onClick={async () => {
            const name = window.prompt('Folder name');
            if (!name) return;
            await ctx.storage.sql.exec(
              'INSERT INTO p_files_entries (id, parent_id, name, kind, mime, size, blob_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)',
              [uuidv7(), cwd.id, name, 'dir', null, nowMs(), nowMs()]
            );
            ctx.events.emit('files:changed', {});
          }}
        >
          <Icon name="folder" size={12} /> New folder
        </button>
        <button className="btn sm primary" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={12} /> Upload
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            if (e.target.files && e.target.files.length > 0) await upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {entries.length === 0 ? (
        <div className="empty-state">
          <Icon name="folder" size={24} />
          <div>Empty folder</div>
          <div style={{ fontSize: 11 }}>Upload files or create folders — stored locally in the blob store</div>
        </div>
      ) : (
        <div className="files-grid" style={props.compact ? { gridTemplateColumns: '1fr' } : undefined}>
          {entries.map((e) => (
            <div key={e.id} className="file-card" style={{ cursor: 'pointer' }} onClick={() => void open(e)}>
              <Icon name={e.kind === 'dir' ? 'folder' : e.mime?.includes('pdf') ? 'pdf' : 'file'} size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fc-name">{e.name}</div>
                <div className="fc-sub">{e.kind === 'dir' ? 'folder' : `${(e.size / 1024).toFixed(1)} KB`}</div>
              </div>
              {e.kind === 'file' && (
                <>
                  <button className="icon-btn" title="Download" onClick={(ev) => { ev.stopPropagation(); void download(e); }}>
                    <Icon name="download" size={13} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete"
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      await ctx.storage.sql.exec('UPDATE p_files_entries SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowMs(), nowMs(), e.id]);
                      if (e.blob_ref) await ctx.blobs.delete(e.blob_ref);
                      ctx.events.emit('files:changed', {});
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
