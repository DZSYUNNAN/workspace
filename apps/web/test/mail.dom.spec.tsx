import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { Kernel, openMemoryDb, type PluginContext } from '@mpw/kernel';
import emailPlugin from '@mpw/plugin-email';
import { MailView } from '../../../plugins/email/src/MailView';
import { AccountDialog } from '../../../plugins/email/src/AccountDialog';
import { addAccount, addMessage, listAccounts, removeAccount } from '../../../plugins/email/src/store';
import { tencentConfig } from '../../../plugins/email/src/connection';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function setup() {
  const db = await openMemoryDb(); const kernel = new Kernel({ db }); kernel.registerBuiltins([emailPlugin]); await kernel.boot();
  const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.email');
  const el = document.createElement('div'); const root = createRoot(el);
  const click = async (text: string) => act(async () => { const button = [...el.querySelectorAll('button')].find(b => b.textContent === text); expect(button).toBeTruthy(); button!.click(); });
  return { db, kernel, ctx, el, root, click };
}
describe('email account UI', () => {
  it('confirms account deletion and clears the last selected account without reseeding', async () => {
    const { db, ctx, el, root, click } = await setup(); const accounts = await listAccounts(ctx);
    await removeAccount(ctx, accounts[1].id);
    await addMessage(ctx, { accountId: accounts[0].id, folder: 'inbox', subject: '超长正文', fromName: 'Long Sender', fromAddr: `${'very-long-address'.repeat(30)}@example.edu`, toList: [], bodyText: `https://example.edu/${'unbroken'.repeat(800)}`, date: Date.now() });
    await act(async () => root.render(<MailView ctx={ctx} />));
    expect(el.querySelectorAll('.pane-resize-handle')).toHaveLength(2);
    const firstMail = [...el.querySelectorAll<HTMLElement>('.mail-row')].find((row) => row.textContent?.includes('超长正文'));
    expect(firstMail).toBeTruthy();
    await act(async () => firstMail!.click());
    const reader = el.querySelector<HTMLElement>('.mail-reader'); const body = el.querySelector<HTMLElement>('.mail-reader-body');
    expect(reader!.style.width).toBe('var(--mpw-mail-reader-percent, 50%)');
    expect(reader!.style.maxWidth).toBe('var(--mpw-mail-reader-percent, 50%)');
    expect(reader!.style.overflowX).toBe('hidden');
    expect(body!.style.overflowWrap).toBe('anywhere');
    await click('删除账户'); expect(el.textContent).toContain('服务器上的邮箱和邮件不会删除');
    await click('取消'); expect(await listAccounts(ctx)).toHaveLength(1);
    await click('删除账户'); await click('确认删除本机账户');
    expect(await listAccounts(ctx)).toEqual([]); expect(el.querySelectorAll('select option')).toHaveLength(0);
    expect(el.querySelectorAll('.mail-row')).toHaveLength(0); await act(async () => root.unmount()); db.close();
  });
  it('prefills campus endpoints and displays independent test failures without sending', async () => {
    const { db, kernel, ctx, el, root, click } = await setup();
    const account = await addAccount(ctx, 'me@example.edu', '校园', 'relay-imap');
    await ctx.secrets.set(`mail.password.${account.id}`, 'stored-test-secret');
    const test = vi.fn().mockResolvedValue({ imap: 'IMAP 连接及登录成功', smtp: 'SMTP 认证失败', folders: ['INBOX', 'Sent Messages'] }); const send = vi.fn();
    kernel.commands.register({ id: 'workspace.mail', title: 'test' }, () => ({ test, send }));
    await act(async () => root.render(<AccountDialog ctx={ctx} account={account} onClose={() => {}} onSaved={async () => {}} />));
    expect((el.querySelector('[aria-label="IMAP 服务器"]') as HTMLInputElement).value).toBe('imap.exmail.qq.com');
    expect((el.querySelector('[aria-label="SMTP 端口"]') as HTMLInputElement).value).toBe('465');
    expect((el.querySelector('[type="password"]') as HTMLInputElement).value).toBe('');
    await click('测试 IMAP 和 SMTP'); expect(test).toHaveBeenCalledWith(tencentConfig(account.address), 'stored-test-secret');
    expect(el.textContent).toContain('SMTP 认证失败'); expect(send).not.toHaveBeenCalled();
    await act(async () => root.unmount()); db.close();
  });
});
