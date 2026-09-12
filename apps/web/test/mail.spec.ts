import { describe, it, expect, vi } from 'vitest';
import { Kernel, openMemoryDb, type PluginContext } from '@mpw/kernel';
import emailPlugin from '@mpw/plugin-email';
import { accountWork, credentials, mailBridge, saveAccount, sendNative, syncAccount, tencentConfig, type MailBridge } from '../../../plugins/email/src/connection';
import { addAccount, addMessage, listAccounts, listMessages, removeAccount, searchMessages, seedDemoData, setMessageFlags } from '../../../plugins/email/src/store';

async function setup() {
  const db = await openMemoryDb(); const kernel = new Kernel({ db }); kernel.registerBuiltins([emailPlugin]); await kernel.boot();
  const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.email');
  const bridge: MailBridge = { test: vi.fn(), fetch: vi.fn().mockResolvedValue({ messages: [{ remoteKey: '7:9', subject: '远程测试', fromName: '老师', fromAddr: 'teacher@example.edu', toList: [], bodyText: '正文', date: 123, attachmentNames: [] }], skipped: 0 }), send: vi.fn().mockResolvedValue(undefined) };
  kernel.commands.register({ id: 'workspace.mail', title: 'test' }, () => bridge);
  return { db, kernel, ctx, bridge };
}
describe('mail accounts and native transport', () => {
  it('stores server configuration separately from credentials and preserves credentials on edit', async () => {
    const { db, ctx } = await setup(); const config = tencentConfig('me@example.edu');
    await saveAccount(ctx, undefined, '校园', 'relay-imap', config, 'unique-test-secret');
    const account = (await listAccounts(ctx)).find(a => a.address === config.address)!;
    expect(await credentials(ctx, account.id)).toEqual({ config, password: 'unique-test-secret' });
    expect(JSON.stringify(db.all('SELECT * FROM plugin_kv'))).not.toContain('unique-test-secret');
    await saveAccount(ctx, account, '新名称', 'relay-imap', { ...config, folder: 'Inbox' }, '');
    expect((await credentials(ctx, account.id)).password).toBe('unique-test-secret'); db.close();
  });
  it('deletes only this local account, cache and password, without demo reseeding', async () => {
    const { db, ctx, bridge } = await setup();
    const a = await addAccount(ctx, 'one@example.edu', 'one');
    await addMessage(ctx, { accountId: a.id, folder: 'drafts', subject: 'private-draft', fromName: '', fromAddr: '', toList: [], bodyText: '', date: 1 });
    await ctx.secrets.set(`mail.password.${a.id}`, 'secret'); await ctx.storage.set(`mail.config.${a.id}`, tencentConfig(a.address));
    await removeAccount(ctx, a.id);
    expect((await listAccounts(ctx)).some(v => v.id === a.id)).toBe(false);
    expect(await listMessages(ctx, a.id, 'drafts')).toEqual([]); expect(await searchMessages(ctx, 'private-draft', 10)).toEqual([]);
    expect(await ctx.secrets.get(`mail.password.${a.id}`)).toBeNull(); expect(await ctx.storage.get(`mail.config.${a.id}`, null)).toBeNull();
    expect(bridge.send).not.toHaveBeenCalled(); expect(bridge.fetch).not.toHaveBeenCalled();
    for (const remaining of await listAccounts(ctx)) await removeAccount(ctx, remaining.id);
    await seedDemoData(ctx); expect(await listAccounts(ctx)).toEqual([]); db.close();
  });
  it('deduplicates remote UIDs and retains local flags across repeated fetches', async () => {
    const { db, ctx, bridge } = await setup(); await saveAccount(ctx, undefined, 'real', 'relay-imap', tencentConfig('me@example.edu'), 'secret');
    const a = (await listAccounts(ctx)).find(a => a.address === 'me@example.edu')!;
    await syncAccount(ctx, a.id); const row = (await listMessages(ctx, a.id, 'inbox'))[0];
    await setMessageFlags(ctx, row.id, { isRead: true, isStarred: true, folder: 'archive' }); await syncAccount(ctx, a.id);
    expect(await listMessages(ctx, a.id, 'inbox')).toEqual([]); const archived = await listMessages(ctx, a.id, 'archive');
    expect(archived).toHaveLength(1); expect(archived[0].is_read).toBe(1); expect(archived[0].is_starred).toBe(1);
    expect(bridge.fetch).toHaveBeenCalledWith(tencentConfig('me@example.edu'), 'secret', 'INBOX'); db.close();
  });
  it('does not claim sent or create sent mail when SMTP rejects the message', async () => {
    const { db, ctx, bridge } = await setup(); await saveAccount(ctx, undefined, 'real', 'relay-imap', tencentConfig('me@example.edu'), 'secret');
    const a = (await listAccounts(ctx)).find(a => a.address === 'me@example.edu')!;
    vi.mocked(bridge.send).mockRejectedValueOnce(new Error('SMTP auth rejected'));
    await expect(sendNative(ctx, a.id, { to: 'to@example.edu', subject: 'test', body: 'body' })).rejects.toThrow('SMTP auth rejected');
    expect(await listMessages(ctx, a.id, 'sent')).toEqual([]);
    await sendNative(ctx, a.id, { to: 'to@example.edu', subject: 'test', body: 'body' }); expect(await listMessages(ctx, a.id, 'sent')).toHaveLength(1); db.close();
  });
  it('rejects concurrent account deletion and explains browser limitations', async () => {
    const { db, ctx } = await setup();
    await accountWork(ctx, 'a', async () => { await expect(accountWork(ctx, 'a', async () => {})).rejects.toThrow('正在处理'); });
    const webCtx = { ...ctx, commands: { ...ctx.commands, execute: vi.fn().mockRejectedValue(new Error('unknown command')) } };
    await expect(mailBridge(webCtx)).rejects.toThrow('Windows 桌面版'); db.close();
  });
});
