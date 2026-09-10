import React, { useState } from 'react';
import { useApp } from '../state';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import { Icon } from '../components/Icon';

export function SettingsView(): React.ReactElement {
  const { kernel, refresh, workspaceId, setWorkspaceId } = useApp();
  const providers = kernel.ai.listProviders();
  const currentProvider = kernel.settings.get('ai.provider', 'demo');
  const [baseUrl, setBaseUrl] = useState(kernel.settings.get<string>('ai.baseUrl', ''));
  const [model, setModel] = useState(kernel.settings.get<string>('ai.model', ''));
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [keySaved, setKeySaved] = useState<Record<string, boolean>>({});
  const [newWsName, setNewWsName] = useState('');
  const workspaces = kernel.workspaces.list();

  return (
    <div className="view">
      <h1>Settings</h1>
      <p className="sub">Local-first configuration. Secrets go to OS-grade storage — never the database.</p>

      <h2>Appearance</h2>
      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="sun" size={14} />
        {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
          <button key={m} className={`btn sm${getTheme(kernel) === m ? ' primary' : ''}`} onClick={() => { setTheme(kernel, m); refresh(); }}>
            {m[0]?.toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <h2>AI provider</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {providers.map((p) => (
            <button key={p.id} className={`btn sm${currentProvider === p.id ? ' primary' : ''}`} onClick={() => { kernel.settings.set('ai.provider', p.id); refresh(); }}>
              {p.label}
              {p.requiresKey && <Icon name="zap" size={11} />}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Active: <b>{providers.find((p) => p.id === currentProvider)?.label}</b> · default model{' '}
          <code>{providers.find((p) => p.id === currentProvider)?.defaultModel}</code>
          {providers.find((p) => p.id === currentProvider)?.requiresKey === false && ' · no key required'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ width: 240 }} placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input className="input" style={{ width: 200 }} placeholder="Model override" value={model} onChange={(e) => setModel(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              kernel.settings.set('ai.baseUrl', baseUrl.trim() || undefined);
              kernel.settings.set('ai.model', model.trim() || undefined);
              kernel.events.emit('notify', { message: 'AI endpoint settings saved', kind: 'success' });
              refresh();
            }}
          >
            Save endpoint
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          API keys are stored in the OS keychain (or encrypted origin storage on web) — never in SQLite.
        </div>
        {providers
          .filter((p) => p.requiresKey)
          .map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 150, fontSize: 12.5 }}>{p.label} key</span>
              <input
                className="input"
                style={{ width: 280 }}
                type="password"
                placeholder="sk-…"
                value={keys[p.id] ?? ''}
                onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
              />
              <button
                className="btn sm"
                onClick={async () => {
                  const v = (keys[p.id] ?? '').trim();
                  if (!v) return;
                  await kernel.secrets.set(`ai.key.${p.id}`, v);
                  setKeySaved((s) => ({ ...s, [p.id]: true }));
                  kernel.events.emit('notify', { message: `${p.label} key stored securely`, kind: 'success' });
                }}
              >
                {keySaved[p.id] ? 'Saved ✓' : 'Store key'}
              </button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  await kernel.secrets.delete(`ai.key.${p.id}`);
                  setKeySaved((s) => ({ ...s, [p.id]: false }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
      </div>

      <h2>Workspaces</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {workspaces.map((w) => (
          <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name={w.icon} size={14} />
            <b style={{ fontSize: 12.5 }}>{w.name}</b>
            {w.id === workspaceId && <span className="badge">active</span>}
            <span style={{ flex: 1 }} />
            <button
              className="btn sm"
              onClick={() => {
                const name = window.prompt('Rename workspace', w.name);
                if (name) {
                  kernel.workspaces.rename(w.id, name);
                  refresh();
                }
              }}
            >
              Rename
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                try {
                  kernel.workspaces.remove(w.id);
                  if (w.id === workspaceId) setWorkspaceId(kernel.workspaces.list()[0]?.id ?? '');
                  refresh();
                } catch (err) {
                  kernel.events.emit('notify', { message: String(err instanceof Error ? err.message : err), kind: 'warn' });
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="New workspace name" value={newWsName} onChange={(e) => setNewWsName(e.target.value)} />
          <button
            className="btn primary sm"
            onClick={() => {
              if (!newWsName.trim()) return;
              const ws = kernel.workspaces.create(newWsName.trim());
              setNewWsName('');
              setWorkspaceId(ws.id);
            }}
          >
            <Icon name="plus" size={13} /> Create
          </button>
        </div>
      </div>

      <h2>Layout presets</h2>
      <div className="card">
        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
          Built-in presets (Daily Work, Research, Paper Writing, Teaching) are seeded globally; you can save the
          current arrangement from the Home dashboard as your own preset.
        </div>
      </div>

      <h2>About</h2>
      <div className="card" style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
        Modular Personal Workspace v0.1.0 — local-first personal productivity platform.<br />
        Architecture: React shell + plugin kernel + SQLite (sql.js/IndexedDB profile) + pluggable AI providers.<br />
        See ARCHITECTURE.md, PLUGIN_SPEC.md, DATABASE.md in the repository.
      </div>
    </div>
  );
}
