import React, { useEffect, useState } from 'react';
import { useApp } from '../state';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import { Icon } from '../components/Icon';
import { DataSettings } from './DataSettings';
import { APP_VERSION } from './StatusBar.version';

export function SettingsView(): React.ReactElement {
  const { kernel, refresh, workspaceId, setWorkspaceId } = useApp();
  const providers = kernel.ai.listProviders();
  const currentProvider = kernel.settings.get('ai.provider', 'demo');
  const [baseUrl, setBaseUrl] = useState(kernel.settings.get<string>(`ai.providers.${currentProvider}.baseUrl`, ''));
  const [model, setModel] = useState(kernel.settings.get<string>(`ai.providers.${currentProvider}.model`, ''));
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [keySaved, setKeySaved] = useState<Record<string, boolean>>({});
  const [newWsName, setNewWsName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  useEffect(() => {
    setBaseUrl(kernel.settings.get<string>(`ai.providers.${currentProvider}.baseUrl`, ''));
    setModel(kernel.settings.get<string>(`ai.providers.${currentProvider}.model`, ''));
    setTestResult('');
  }, [currentProvider]);
  const workspaces = kernel.workspaces.list();

  return (
    <div className="view">
      <h1>设置</h1>
      <DataSettings />
      <p className="sub">本地保存。密钥由桌面凭据管理器或浏览器加密存储保护。</p>

      <h2>Appearance</h2>
      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="sun" size={14} />
        {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
          <button key={m} className={`btn sm${getTheme(kernel) === m ? ' primary' : ''}`} onClick={() => { setTheme(kernel, m); refresh(); }}>
            {m[0]?.toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <h2>AI 服务</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p>先保存接口和密钥，再测试连接。测试仅发送一句测试文本，不读取工作台内容。</p>
        <button className="btn" disabled={testing} onClick={() => {
          setTesting(true); setTestResult('');
          void kernel.ai.run('Reply with OK.', { maxTokens: 16 }).then((result) => setTestResult(`${result.provider === 'demo' ? '离线演示' : '连接成功'}：${result.text}`))
            .catch((e) => setTestResult(`连接失败：${e instanceof Error ? e.message : String(e)}`)).finally(() => setTesting(false));
        }}>{testing ? '正在测试…' : '测试已保存的连接'}</button>
        <p role="status">{testResult}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {providers.map((p) => (
            <button key={p.id} className={`btn sm${currentProvider === p.id ? ' primary' : ''}`} onClick={() => { kernel.settings.set('ai.provider', p.id); refresh(); }}>
              {p.label}
              {p.requiresKey && <Icon name="zap" size={11} />}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          当前服务：<b>{providers.find((p) => p.id === currentProvider)?.label}</b> · 默认模型{' '}
          <code>{providers.find((p) => p.id === currentProvider)?.defaultModel}</code>
          {providers.find((p) => p.id === currentProvider)?.requiresKey === false && ' · no key required'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ width: 280 }} placeholder="接口根地址，例如 https://api.openai.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input className="input" style={{ width: 220 }} placeholder="模型名称（可选）" value={model} onChange={(e) => setModel(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              kernel.settings.set(`ai.providers.${currentProvider}.baseUrl`, baseUrl.trim() || undefined);
              kernel.settings.set(`ai.providers.${currentProvider}.model`, model.trim() || undefined);
              kernel.events.emit('notify', { message: 'AI endpoint settings saved', kind: 'success' });
              refresh();
            }}
          >
            保存接口
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          桌面版通过原生网络连接 AI 服务，避免 WebView 跨域限制。API 密钥保存在系统凭据管理器中，不写入工作区数据库。
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
        Modular Personal Workspace v{APP_VERSION} — local-first personal productivity platform.<br />
        Architecture: React shell + plugin kernel + SQLite (sql.js/IndexedDB profile) + pluggable AI providers.<br />
        See ARCHITECTURE.md, PLUGIN_SPEC.md, DATABASE.md in the repository.
      </div>
    </div>
  );
}
