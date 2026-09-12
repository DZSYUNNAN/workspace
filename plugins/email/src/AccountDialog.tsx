import React, { useEffect, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import type { AccountRecord } from './store';
import { accountWork, mailBridge, readConfig, saveAccount, tencentConfig, validateConfig, type ConnectionReport, type Endpoint } from './connection';

export function AccountDialog({ ctx, account, onClose, onSaved }: { ctx: PluginContext; account?: AccountRecord; onClose(): void; onSaved(): Promise<void> }): React.ReactElement {
  const [kind, setKind] = useState(account?.kind ?? 'relay-imap');
  const [name, setName] = useState(account?.display_name ?? '');
  const [config, setConfig] = useState(tencentConfig(account?.address));
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!account); const [error, setError] = useState('');
  const [report, setReport] = useState<ConnectionReport | null>(null);
  useEffect(() => setReport(null), [config, password]);
  useEffect(() => {
    if (!account) return;
    let active = true;
    void readConfig(ctx, account.id).then((value) => { if (active && value) setConfig(value); }).catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account?.id]);
  const act = async (test: boolean): Promise<void> => {
    setBusy(true); setError('');
    try {
      if (test) {
        setReport(null); validateConfig(config);
        const secret = password || (account ? await ctx.secrets.get(`mail.password.${account.id}`) : null);
        if (!secret) throw new Error('请填写密码／客户端授权码');
        setReport(await accountWork(ctx, account?.id ?? 'new-account', async () => (await mailBridge(ctx)).test(config, secret)));
      } else {
        await saveAccount(ctx, account, name, kind, config, password);
        ctx.ui.notify('账户配置已保存', 'success'); await onSaved();
      }
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };
  const endpoint = (key: 'imap' | 'smtp'): React.ReactElement => <fieldset style={{ padding: 10 }}>
    <legend>{key === 'imap' ? 'IMAP 接收服务器' : 'SMTP 发送服务器'}</legend>
    <label>服务器地址<input className="input" aria-label={`${key.toUpperCase()} 服务器`} value={config[key].host} onChange={(e) => setConfig({ ...config, [key]: { ...config[key], host: e.target.value.trim() } })} /></label>
    <div style={{ display: 'flex', gap: 8 }}>
      <label style={{ flex: 1 }}>端口<input className="input" aria-label={`${key.toUpperCase()} 端口`} type="number" min={1} max={65535} value={config[key].port} onChange={(e) => setConfig({ ...config, [key]: { ...config[key], port: Number(e.target.value) } })} /></label>
      <label style={{ flex: 1 }}>加密<select className="input" aria-label={`${key.toUpperCase()} 加密`} value={config[key].security} onChange={(e) => {
        const security = e.target.value as Endpoint['security'];
        setConfig({ ...config, [key]: { ...config[key], security, port: key === 'imap' ? (security === 'tls' ? 993 : 143) : (security === 'tls' ? 465 : 587) } });
      }}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label>
    </div>
  </fieldset>;
  return <div className="compose"><div className="compose-card mail-account-dialog" role="dialog" aria-label="邮箱账户设置" style={{ maxHeight: 'calc(100% - 16px)', overflow: 'auto' }}>
    <div className="widget-toolbar"><b>{account ? '邮箱账户设置' : '添加邮箱账户'}</b><span style={{ flex: 1 }} /><button className="btn sm" disabled={busy} onClick={onClose}>关闭</button></div>
    <fieldset disabled={busy || loading} style={{ border: 0, padding: 0 }}><div className="cc-body">
      <label>账户类型<select className="input" value={kind} disabled={!!account && account.kind === 'demo'} onChange={(e) => { setKind(e.target.value); setReport(null); }}>
        <option value="relay-imap">IMAP / SMTP（桌面直连）</option><option value="demo">离线演示</option>
        {account && !['demo', 'relay-imap'].includes(account.kind) && <option value={account.kind}>旧版未接入账户，请改选 IMAP / SMTP</option>}
      </select></label>
      <label>邮箱地址<input className="input" aria-label="邮箱地址" value={config.address} onChange={(e) => setConfig({ ...config, address: e.target.value.trim(), username: config.username === config.address ? e.target.value.trim() : config.username })} /></label>
      <label>显示名称<input className="input" aria-label="显示名称" value={name} onChange={(e) => setName(e.target.value)} /></label>
      {kind === 'relay-imap' && <>
        <button className="btn" onClick={() => { setConfig(tencentConfig(config.address)); setReport(null); }}>填入腾讯企业邮／校园邮箱配置</button>
        {endpoint('imap')}{endpoint('smtp')}
        <label>登录用户名<input className="input" aria-label="登录用户名" value={config.username} onChange={(e) => setConfig({ ...config, username: e.target.value.trim() })} /></label>
        <label>密码／客户端授权码<input className="input" aria-label="密码或客户端授权码" type="password" autoComplete="new-password" placeholder={account ? '留空保留已保存的凭据' : '仅存本机凭据库'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>接收文件夹<input className="input" aria-label="接收文件夹" list="mail-server-folders" value={config.folder} onChange={(e) => setConfig({ ...config, folder: e.target.value })} /><datalist id="mail-server-folders">{report?.folders.map((f) => <option key={f} value={f} />)}</datalist></label>
        <p style={{ fontSize: 12 }}>腾讯企业邮：使用完整邮箱地址登录，并在网页版邮箱中开启 IMAP/SMTP。若学校启用了客户端专用密码，请填写该密码。测试连接不会发送邮件。</p>
      </>}
      {kind !== 'demo' && kind !== 'relay-imap' && <p role="alert">此 OAuth 服务尚未接入，请改用学校支持的 IMAP/SMTP。</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {kind === 'relay-imap' && <button className="btn" onClick={() => void act(true)}>测试 IMAP 和 SMTP</button>}
        <button className="btn primary" disabled={!config.address || !['demo','relay-imap'].includes(kind)} onClick={() => void act(false)}>保存账户</button>
      </div>
    </div></fieldset>
    {busy && <p role="status" style={{ padding: 12 }}>正在处理，请稍候…</p>}
    {error && <p role="alert" className="err-panel">{error}</p>}
    {report && <div role="status" style={{ padding: 12, whiteSpace: 'pre-wrap' }}><p>{report.imap}</p><p>{report.smtp}</p></div>}
  </div></div>;
}
