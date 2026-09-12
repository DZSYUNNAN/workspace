import type { PluginContext } from '@mpw/kernel';
import { addAccount, addMessage, cacheRemoteMessage, removeAccount, type AccountRecord, type MessageSeed } from './store';

export interface Endpoint { host: string; port: number; security: 'tls' | 'starttls' }
export interface MailConfig { address: string; username: string; imap: Endpoint; smtp: Endpoint; folder: string }
export interface ConnectionReport { imap: string; smtp: string; folders: string[] }
export interface Incoming extends Omit<MessageSeed, 'accountId' | 'folder'> { remoteKey: string; attachmentNames: string[] }
export interface MailBridge {
  test(config: MailConfig, password: string): Promise<ConnectionReport>;
  fetch(config: MailConfig, password: string, folder: string): Promise<{ messages: Incoming[]; skipped: number }>;
  send(config: MailConfig, password: string, outgoing: { to: string; subject: string; body: string }): Promise<void>;
}
export const tencentConfig = (address = ''): MailConfig => ({ address, username: address, imap: { host: 'imap.exmail.qq.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.exmail.qq.com', port: 465, security: 'tls' }, folder: 'INBOX' });
export function validateConfig(config: MailConfig): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address)) throw new Error('请填写完整邮箱地址');
  if (!config.username.trim()) throw new Error('请填写登录用户名，通常为完整邮箱地址');
  for (const endpoint of [config.imap, config.smtp]) {
    if (!/^[a-zA-Z0-9.:-]+$/.test(endpoint.host) || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('请填写服务器主机名及有效端口，不要包含 https://');
    if (!['tls', 'starttls'].includes(endpoint.security)) throw new Error('请选择加密方式');
  }
}
export async function mailBridge(ctx: PluginContext): Promise<MailBridge> {
  const bridge = await ctx.commands.execute('workspace.mail').catch(() => null);
  if (!bridge) throw new Error('IMAP/SMTP 直连需要 Windows 桌面版，请安装新版 ModuDesk 后使用');
  return bridge as MailBridge;
}
const active = new Set<string>();
export async function accountWork<T>(ctx: PluginContext, id: string, work: () => Promise<T>): Promise<T> {
  if (active.has(id)) throw new Error('此邮箱正在处理连接或邮件操作，请稍后再试');
  active.add(id);
  const task = await ctx.commands.execute('workspace.beginFileWork', '邮箱操作').catch(() => null) as { finish(): void } | null;
  try { return await work(); } finally { active.delete(id); task?.finish(); }
}
export const readConfig = (ctx: PluginContext, id: string): Promise<MailConfig | null> => ctx.storage.get(`mail.config.${id}`, null);
export async function credentials(ctx: PluginContext, id: string): Promise<{ config: MailConfig; password: string }> {
  const config = await readConfig(ctx, id); const password = await ctx.secrets.get(`mail.password.${id}`);
  if (!config) throw new Error('请先打开账户设置，填写 IMAP/SMTP 服务器参数');
  if (!password) throw new Error('请在账户设置中填写密码／客户端授权码（恢复备份后需重新输入）');
  return { config, password };
}
export async function saveAccount(ctx: PluginContext, existing: AccountRecord | undefined, name: string, kind: string, config: MailConfig, password: string): Promise<void> {
  return accountWork(ctx, existing?.id ?? 'new-account', async () => {
    if (kind === 'relay-imap') { validateConfig(config); await mailBridge(ctx); if (!password && !existing) throw new Error('请填写密码／客户端授权码'); }
    const account = existing ?? await addAccount(ctx, config.address, name || config.address, kind);
    try {
      if (kind === 'relay-imap') {
        if (password) await ctx.secrets.set(`mail.password.${account.id}`, password);
        else if (!await ctx.secrets.get(`mail.password.${account.id}`)) throw new Error('请填写密码／客户端授权码');
        // Store only the explicitly named non-secret fields, never the form object.
        await ctx.storage.set(`mail.config.${account.id}`, { address: config.address, username: config.username, imap: { host: config.imap.host, port: config.imap.port, security: config.imap.security }, smtp: { host: config.smtp.host, port: config.smtp.port, security: config.smtp.security }, folder: config.folder });
      }
      await ctx.storage.sql.exec('UPDATE p_email_accounts SET address = ?, display_name = ?, kind = ?, provider = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [config.address, name || config.address, kind, kind, Date.now(), account.id]);
    } catch (e) { if (!existing) await removeAccount(ctx, account.id); throw e; }
    ctx.events.emit('mail:accounts-changed', {});
  });
}
export async function syncAccount(ctx: PluginContext, id: string): Promise<{ count: number; skipped: number }> {
  return accountWork(ctx, id, async () => {
    const { config, password } = await credentials(ctx, id);
    const result = await (await mailBridge(ctx)).fetch(config, password, config.folder || 'INBOX');
    for (const message of result.messages) await cacheRemoteMessage(ctx, JSON.stringify([config.folder || 'INBOX', message.remoteKey]), { ...message, accountId: id, folder: 'inbox', hasAttachments: message.attachmentNames.length > 0 });
    ctx.events.emit('mail:changed', {});
    return { count: result.messages.length, skipped: result.skipped };
  });
}
export async function sendNative(ctx: PluginContext, id: string, outgoing: { to: string; subject: string; body: string }): Promise<void> {
  return accountWork(ctx, id, async () => {
    const { config, password } = await credentials(ctx, id);
    await (await mailBridge(ctx)).send(config, password, outgoing);
    try { await addMessage(ctx, { accountId: id, folder: 'sent', subject: outgoing.subject, fromName: config.address, fromAddr: config.address, toList: outgoing.to.split(/[,;；]/).map(s => s.trim()), bodyText: outgoing.body, date: Date.now(), isRead: true }); }
    catch { ctx.ui.notify('服务器已接受邮件，但本机已发送记录保存失败，请勿重复发送', 'warn'); }
  });
}
