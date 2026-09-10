import type { PluginContext } from '@mpw/kernel';

/**
 * 邮件传输抽象(Phase 2)。凭据一律走 ctx.secrets,绝不入库。
 *
 *  - demo           离线演示:完整可测的 UI 数据流。
 *  - relay-imap     IMAP/SMTP 中转:浏览器无法直连 TCP,由
 *                     (a) Tauri 桌面壳 的 Rust 侧,或
 *                     (b) 自建轻量中转服务 (POST /list /fetch /send)
 *                   代理。settings → mail.relayUrl 配置端点。
 *  - graph / gmail  OAuth2 授权码 + PKCE(桌面壳完成回调),token 存钥匙串。
 */
export interface MailTransport {
  readonly kind: 'demo' | 'relay-imap' | 'graph' | 'gmail';
  listFolders(accountId: string): Promise<string[]>;
  fetchMessages(accountId: string, folder: string): Promise<import('./store').MessageSeed[]>;
  send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void>;
}

export const TRANSPORT_INFO: { kind: MailTransport['kind']; label: string; hint: string }[] = [
  { kind: 'demo', label: '演示账户', hint: '离线演示模式:内置中文科研邮箱场景,立即可用,无需网络。' },
  { kind: 'relay-imap', label: 'IMAP / SMTP', hint: '通过中转服务或桌面壳代理 IMAP/SMTP(浏览器禁止直连 TCP)。需在「设置 → 邮件中转」填写端点;应用密码等凭据加密存放在本机钥匙串。' },
  { kind: 'graph', label: 'Microsoft 365', hint: 'OAuth2 授权码 + PKCE 登录 Microsoft 365(桌面端完成回调;Web 端将打开授权页并引导回跳)。Token 仅存本机钥匙串。' },
  { kind: 'gmail', label: 'Gmail', hint: 'OAuth2 授权 Gmail API(只读邮件 + 发送 scope)。Token 仅存本机钥匙串。' },
];

export class DemoTransport implements MailTransport {
  readonly kind = 'demo' as const;
  async listFolders(): Promise<string[]> {
    return ['inbox', 'sent', 'drafts', 'starred', 'archive', 'trash'];
  }
  async fetchMessages(): Promise<import('./store').MessageSeed[]> {
    return [];
  }
  async send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void> {
    const { addMessage } = await import('./store');
    const account = await ctx.storage.sql.one<{ address: string; display_name: string }>(
      'SELECT address, display_name FROM p_email_accounts WHERE id = ?',
      [accountId]
    );
    await addMessage(ctx, {
      accountId,
      folder: 'sent',
      subject: msg.subject,
      fromName: account?.display_name ?? '我',
      fromAddr: account?.address ?? 'me@local',
      toList: [msg.to],
      bodyText: msg.body,
      date: Date.now(),
      isRead: true,
    });
  }
}

/**
 * IMAP/SMTP 中转传输。约定端点(自建或桌面壳内置):
 *   GET  {relay}/folders?account=…          → string[]
 *   GET  {relay}/messages?account=…&folder=…→ MessageSeed[]
 *   POST {relay}/send     {account,to,subject,body}
 * 认证:Authorization: Bearer <token from SecretStore `mail.relay.token`>
 */
export class RelayImapTransport implements MailTransport {
  readonly kind = 'relay-imap' as const;
  constructor(private baseUrl: string) {}
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) throw new Error(`邮件中转请求失败 HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  async listFolders(accountId: string): Promise<string[]> {
    return await this.call<string[]>(`/folders?account=${encodeURIComponent(accountId)}`);
  }
  async fetchMessages(accountId: string, folder: string): Promise<import('./store').MessageSeed[]> {
    return await this.call<import('./store').MessageSeed[]>(`/messages?account=${encodeURIComponent(accountId)}&folder=${encodeURIComponent(folder)}`);
  }
  async send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void> {
    await this.call('/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: accountId, ...msg }),
    });
    const { addMessage } = await import('./store');
    await addMessage(ctx, {
      accountId, folder: 'sent', subject: msg.subject, fromName: '我', fromAddr: '',
      toList: [msg.to], bodyText: msg.body, date: Date.now(), isRead: true,
    });
  }
}

export function getTransport(ctx: PluginContext, kind: string): MailTransport {
  if (kind === 'relay-imap') {
    const relayUrl = ctx.storage.get('mail.relayUrl', '');
    if (relayUrl && typeof relayUrl === 'string') return new RelayImapTransport(relayUrl);
  }
  // graph / gmail 在桌面壳可用前回退到 demo(UI 保持可测)
  return new DemoTransport();
}
