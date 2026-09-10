import type { PluginContext } from '@mpw/kernel';

/**
 * Mail transport abstraction (PRODUCT_SPEC §4.3). v1 ships the offline demo
 * transport so the full UX is testable without a server. Live transports plug
 * in here without any UI change:
 *  - ImapSmtpTransport  — via the Tauri shell (raw TCP is not available to
 *                         browsers); TLS + app passwords.
 *  - GraphTransport     — Microsoft 365 via OAuth2 authorization-code + PKCE.
 *  - GmailTransport     — Gmail API via OAuth2; token lives in SecretStore.
 * Tokens/credentials are ALWAYS resolved through ctx.secrets, never stored in
 * the database.
 */
export interface MailTransport {
  readonly kind: 'demo' | 'imap' | 'graph' | 'gmail';
  listFolders(accountId: string): Promise<string[]>;
  fetchMessages(accountId: string, folder: string): Promise<import('./store').MessageSeed[]>;
  send(ctx: PluginContext, accountId: string, msg: { to: string; subject: string; body: string }): Promise<void>;
}

export class DemoTransport implements MailTransport {
  readonly kind = 'demo' as const;

  async listFolders(): Promise<string[]> {
    return ['inbox', 'sent', 'drafts', 'starred', 'archive', 'trash'];
  }

  async fetchMessages(_accountId: string, _folder: string): Promise<import('./store').MessageSeed[]> {
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
      fromName: account?.display_name ?? 'Me',
      fromAddr: account?.address ?? 'me@local',
      toList: [msg.to],
      bodyText: msg.body,
      date: Date.now(),
      isRead: true,
    });
  }
}

export function getTransport(kind: string): MailTransport {
  switch (kind) {
    case 'demo':
    default:
      return new DemoTransport();
    // case 'imap': return new ImapSmtpTransport(...)   // Phase 2 (Tauri)
    // case 'graph': return new GraphTransport(...)     // Phase 2 (OAuth2 + keychain)
    // case 'gmail': return new GmailTransport(...)     // Phase 2 (OAuth2 + keychain)
  }
}
