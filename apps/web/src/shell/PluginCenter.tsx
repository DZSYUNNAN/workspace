import React, { useState } from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import { PERMISSION_LABELS, type Permission } from '@mpw/kernel';

type Tab = 'installed' | 'disabled' | 'available';

export function PluginCenter(): React.ReactElement {
  const { kernel, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('installed');
  const plugins = kernel.listPlugins();
  const shown = tab === 'disabled' ? plugins.filter((p) => !p.enabled) : plugins;

  return (
    <div className="view">
      <h1>Plugin Center</h1>
      <p className="sub">Every capability in MPW is a plugin. Enable, disable, inspect permissions — the core stays small.</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['installed', 'disabled', 'available'] as Tab[]).map((t) => (
          <button key={t} className={`btn sm${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>
            {t === 'installed' ? `Installed (${plugins.filter((p) => p.enabled).length})` : t === 'disabled' ? `Disabled (${plugins.filter((p) => !p.enabled).length})` : 'Available'}
          </button>
        ))}
      </div>

      <div className="cards">
        {shown.map((p) => (
          <PluginCard key={p.id} info={p} />
        ))}
        {tab === 'available' && (
          <div className="card plugin-card" style={{ opacity: 0.75 }}>
            <div className="pc-head">
              <div className="pc-icon"><Icon name="download" size={17} /></div>
              <div>
                <div style={{ fontWeight: 600 }}>Marketplace</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Roadmap Phase 7</div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Third-party <code>.mpwx</code> packages with sandboxed trust tiers, signing, and permission consent
              will install here. The plugin contract is already live — first-party plugins use exactly the same
              SDK.
            </div>
          </div>
        )}
      </div>
    </div>
  );

  function PluginCard(props: { info: (typeof plugins)[number] }): React.ReactElement {
    const { kernel: k, refresh: r } = useApp();
    const p = props.info;
    const [confirmDelete, setConfirmDelete] = useState(false);
    const busy = useState(false);
    const toggle = async (): Promise<void> => {
      busy[1](true);
      try {
        if (p.enabled) await k.disablePlugin(p.id);
        else await k.enablePlugin(p.id);
        r();
      } finally {
        busy[1](false);
      }
    };
    return (
      <div className="card plugin-card">
        <div className="pc-head">
          <div className="pc-icon"><Icon name={p.icon} size={17} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
              {p.name} <span className="badge gray">v{p.version}</span>
              {p.state === 'error' && <span className="badge" style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}>error</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.author}</div>
          </div>
          <button className={`toggle${p.enabled ? ' on' : ''}`} title={p.enabled ? 'Disable' : 'Enable'} onClick={() => void toggle()} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{p.description}</div>
        <div className="perm-row">
          {p.permissions.map((perm) => (
            <span key={perm} className="perm" title={PERMISSION_LABELS[perm as Permission]}>
              <Icon name="check" size={10} /> {PERMISSION_LABELS[perm as Permission] ?? perm}
            </span>
          ))}
        </div>
        {p.error && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{p.error}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          {p.builtin ? (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Built-in · ships with the core</span>
          ) : confirmDelete ? (
            <>
              <button
                className="btn sm danger"
                onClick={async () => {
                  await k.uninstallPlugin(p.id, { deleteData: true });
                  setConfirmDelete(false);
                  r();
                }}
              >
                Delete data & uninstall
              </button>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={12} /> Uninstall
            </button>
          )}
        </div>
      </div>
    );
  }
}
