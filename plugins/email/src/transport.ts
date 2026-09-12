import type { PluginContext } from '@mpw/kernel';

export interface MailTransport {
  readonly kind: 'demo' | 'relay-imap' | 'graph' | 'gmail';
  listFolders(accountId: string): Promise<string[]>;
  fetchMessages(accountId: string, folder: string): Promise<import('./store').MessageSeed[]>;
  send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void>;
}

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

export class NativeImapTransport implements MailTransport {
  readonly kind = 'relay-imap' as const;
  constructor(private ctx: PluginContext) {}
  async listFolders(): Promise<string[]> { return ['inbox']; }
  async fetchMessages(accountId: string): Promise<import('./store').MessageSeed[]> {
    const { credentials, mailBridge } = await import('./connection');
    const { config, password } = await credentials(this.ctx, accountId);
    const result = await (await mailBridge(this.ctx)).fetch(config, password, config.folder || 'INBOX');
    return result.messages.map((message) => ({ ...message, accountId, folder: 'inbox' }));
  }
  async send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void> {
    const { sendNative } = await import('./connection'); await sendNative(ctx, accountId, msg);
  }
}
export async function getTransport(ctx: PluginContext, kind: string): Promise<MailTransport> {
  if (kind === 'relay-imap') return new NativeImapTransport(ctx);
  if (kind === 'demo') return new DemoTransport();
  throw new Error('此账户的 OAuth 服务尚未接入，请在账户设置中改用学校支持的 IMAP/SMTP');
}