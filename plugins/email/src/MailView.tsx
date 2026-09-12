import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon, ResizeHandle } from '@mpw/ui';
import { LAYOUT_CONTROL_APPLY } from '@mpw/shared';
import {
  FOLDERS,
  getMessage,
  listAccounts,
  listMessages,
  deleteMessage,
  setMessageFlags,
  removeAccount,
  type AccountRecord,
  type MessageRecord,
} from './store';
import { getTransport } from './transport';
import { AccountDialog } from './AccountDialog';
import { accountWork, syncAccount } from './connection';

const FOLDER_LABEL: Record<string, string> = {
  inbox: '收件箱',
  starred: '已加星标',
  sent: '已发送',
  drafts: '草稿箱',
  archive: '归档',
  trash: '回收站',
};

const FOLDER_ICON: Record<string, string> = {
  inbox: 'inbox',
  starred: 'star',
  sent: 'send',
  drafts: 'pen',
  archive: 'archive',
  trash: 'trash',
};

function initial(name: string): string {
  const t = name.replace(/[^\p{L}\p{N}]/gu, '');
  return [...t].slice(0, 1).join('') || '?';
}

const AVA_COLORS = ['#4f63d2', '#2e7d4f', '#a8730a', '#8a4fd2', '#c4394a', '#0a7ea8'];

function avaColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVA_COLORS[Math.abs(h) % AVA_COLORS.length] as string;
}

export function MailView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string>('inbox');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; replyTo?: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const request = useRef(0);
  const selected = accounts.find((a) => a.id === accountId);
  const act = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };

  const reloadAccounts = async (): Promise<void> => {
    const accs = await listAccounts(ctx);
    setAccounts(accs);
    setAccountId((prev) => accs.some((a) => a.id === prev) ? prev : accs[0]?.id ?? null);
  };

  const reloadMessages = async (): Promise<void> => {
    const ticket = ++request.current;
    if (!accountId) { setMessages([]); return; }
    const rows = await listMessages(ctx, accountId, folder);
    if (ticket === request.current) setMessages(rows);
  };

  useEffect(() => {
    void reloadAccounts();
    const offs = [
      ctx.events.on('mail:accounts-changed', () => void reloadAccounts()),
      ctx.events.on('mail:compose', () => {
        setCompose({ to: '', subject: '', body: '' });
      }),
      ctx.events.on('ui:open:mpw.email', (p) => {
        const hit = (p as { hit?: { id: string } }).hit;
        if (!hit) return;
        void (async () => {
          const { getMessage } = await import('./store');
          const id = hit.id.split(':').pop() ?? null;
          if (!id) return;
          const msg = await getMessage(ctx, id);
          if (!msg) return;
          setAccountId(msg.account_id);
          setFolder(msg.folder === 'starred' ? 'inbox' : msg.folder);
          setOpenId(id);
        })();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    setMessages([]);
    void reloadMessages();
    const off = ctx.events.on('mail:changed', () => void reloadMessages());
    return () => { request.current += 1; off(); };
  }, [accountId, folder]);

  const openMsg = messages.find((m) => m.id === openId) ?? null;
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) => m.subject.toLowerCase().includes(q) || m.body_text.toLowerCase().includes(q) || m.from_name.toLowerCase().includes(q)
    );
  }, [messages, filter]);

  const unread = messages.filter((m) => !m.is_read).length;

  const open = async (id: string): Promise<void> => {
    setOpenId(id);
    await setMessageFlags(ctx, id, { isRead: true });
    await reloadMessages();
  };

  return (
    <div className="mail-layout" style={{ position: 'relative' }}>
      {/* 文件夹 */}
      <div className="mail-folders">
        <select
          className="input"
          style={{ margin: '4px 4px 8px', fontSize: 11.5, width: 'calc(100% - 8px)' }}
          value={accountId ?? ''}
          disabled={busy || !!compose}
          aria-label="当前邮箱账户"
          onChange={(e) => {
            setAccountId(e.target.value);
            setOpenId(null);
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.display_name ?? a.address}</option>
          ))}
        </select>
        {FOLDERS.map((f) => (
          <button key={f} className={`mail-folder-btn${folder === f ? ' active' : ''}`} onClick={() => { setFolder(f); setOpenId(null); }}>
            <Icon name={FOLDER_ICON[f] ?? 'mail'} size={13} />
            {FOLDER_LABEL[f] ?? f}
            {f === 'inbox' && unread > 0 && <span className="badge" style={{ marginLeft: 'auto' }}>{unread}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn sm primary" disabled={!selected || busy} style={{ margin: 6 }} onClick={() => setCompose({ to: '', subject: '', body: '' })}>
          <Icon name="plus" size={12} /> 写邮件
        </button>
        <button className="btn sm" disabled={busy} style={{ margin: '0 6px 6px' }} onClick={() => setAddOpen(true)}>
          <Icon name="user" size={12} /> 添加账户
        </button>
        <button className="btn sm" disabled={!selected || busy || !!compose} style={{ margin: '0 6px 6px' }} onClick={() => setEditOpen(true)}>账户设置</button>
        <button className="btn sm danger" disabled={!selected || busy || !!compose} style={{ margin: '0 6px 6px' }} onClick={() => setDeleteOpen(true)}>删除账户</button>
      </div>
      <ResizeHandle onDelta={(delta) => ctx.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'mailFoldersWidth', delta })} title="拖动调整邮件文件夹宽度" />

      {/* 列表 */}
      <div className="mail-list">
        <div className="widget-toolbar" style={{ padding: 6 }}>
          {selected?.kind === 'relay-imap' && <button className="btn sm" disabled={busy} onClick={() => void act(async () => {
            const result = await syncAccount(ctx, selected.id); await reloadMessages();
            ctx.ui.notify(`已收取最近 ${result.count} 封邮件${result.skipped ? `；${result.skipped} 封大邮件超出本次限额，请在网页版查看` : ''}`, 'success');
          })}>{busy ? '处理中…' : '收取邮件'}</button>}
          <input className="input" style={{ flex: 1, minWidth: 60 }} placeholder="搜索邮件…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {error && <div className="err-panel" role="alert">{error}</div>}
        {selected?.kind === 'relay-imap' && <p style={{ fontSize: 11, padding: 8 }}>收取接收文件夹最近 50 封邮件。已读、星标、归档和删除操作仅作用于本机缓存。附件当前仅显示名称。</p>}
        {selected?.kind === 'demo' && <p style={{ fontSize: 11, padding: 8 }}>离线演示账户：发送只保存本机记录。</p>}
        <div className="list">
          {filtered.map((m) => (
            <div key={m.id} className={`mail-row${m.id === openId ? ' active' : ''}${m.is_read ? '' : ' unread'}`} onClick={() => void open(m.id)}>
              <div className="mr-top">
                <span className="mail-ava" style={{ background: avaColor(m.from_addr) }}>{initial(m.from_name)}</span>
                <span className="mr-from">
                  {folder === 'sent' || folder === 'drafts' ? `收件人: ${(JSON.parse(m.to_list) as string[]).join(', ') || '—'}` : m.from_name}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{fmtTime(m.date)}</span>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  title={m.is_starred ? '取消星标' : '加星标'}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await setMessageFlags(ctx, m.id, { isStarred: !m.is_starred });
                    await reloadMessages();
                  }}
                >
                  <Icon name="star" size={12} />
                </button>
              </div>
              <div className="mr-sub">{m.subject || '(无主题)'}</div>
              <div className="mr-sub" style={{ color: 'var(--text-3)', fontSize: 11 }}>{m.body_text.slice(0, 64)}…</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                {(JSON.parse(m.labels as string) as string[]).map((l) => (
                  <span key={l} className="badge gray" style={{ fontSize: 10 }}>{l}</span>
                ))}
                {m.has_attachments === 1 && <span className="badge" style={{ fontSize: 10 }}><Icon name="file" size={9} /> 附件</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-state">{FOLDER_LABEL[folder] ?? folder}暂无邮件</div>}
        </div>
      </div>
      <ResizeHandle direction={-1} onDelta={(delta) => ctx.events.emit(LAYOUT_CONTROL_APPLY, { kind: 'modulePaneDelta', key: 'mailReaderPercent', delta: delta / Math.max(1, window.innerWidth) * 100 })} title="拖动调整邮件正文宽度" />

      {/* 阅读区 */}
      <div className="mail-reader" style={{ flexBasis: 'var(--mpw-mail-reader-percent, 50%)', width: 'var(--mpw-mail-reader-percent, 50%)', maxWidth: 'var(--mpw-mail-reader-percent, 50%)', minWidth: 0, overflowX: 'hidden', contain: 'inline-size' }}>
        {openMsg ? (
          <>
            <h2>{openMsg.subject || '(无主题)'}</h2>
            <div className="ref-meta mail-reader-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mail-ava" style={{ background: avaColor(openMsg.from_addr) }}>{initial(openMsg.from_name)}</span>
              <b>{openMsg.from_name}</b> &lt;{openMsg.from_addr}&gt; · {new Date(openMsg.date).toLocaleString('zh-CN')}
            </div>
            <div style={{ display: 'flex', gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => setCompose({ to: openMsg.from_addr, subject: openMsg.subject.startsWith('Re:') ? openMsg.subject : `Re: ${openMsg.subject}`, body: `\n\n——— 原始邮件 ———\n${openMsg.body_text}`, replyTo: openMsg.id })}>
                <Icon name="reply" size={12} /> 回复
              </button>
              <button
                className="btn sm"
                onClick={() =>
                  setCompose({
                    to: '',
                    subject: `转发: ${openMsg.subject}`,
                    body: `\n\n——— 转发邮件 ———\n发件人: ${openMsg.from_name}\n\n${openMsg.body_text}`,
                  })
                }
              >
                <Icon name="forward" size={12} /> 转发
              </button>
              {openMsg.folder !== 'archive' ? (
                <button className="btn sm" onClick={async () => { await setMessageFlags(ctx, openMsg.id, { folder: 'archive' }); setOpenId(null); await reloadMessages(); }}>
                  <Icon name="archive" size={12} /> 归档
                </button>
              ) : (
                <button className="btn sm" onClick={async () => { await setMessageFlags(ctx, openMsg.id, { folder: 'inbox' }); setOpenId(null); await reloadMessages(); }}>
                  <Icon name="inbox" size={12} /> 移回收件箱
                </button>
              )}
              <button className="btn sm danger" onClick={async () => { await deleteMessage(ctx, openMsg.id); setOpenId(null); await reloadMessages(); }}>
                <Icon name="trash" size={12} /> 删除
              </button>
            </div>
            <div className="mail-reader-body" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{openMsg.body_text}</div>
            {openMsg.has_attachments === 1 && (
              <div style={{ marginTop: 16 }}>
                <b style={{ fontSize: 12 }}>附件</b>
                {(JSON.parse(openMsg.attachments as string) as string[]).map((a) => (
                  <div key={a} className="file-card" style={{ marginTop: 6, maxWidth: 300 }}>
                    <Icon name="pdf" size={16} />
                    <span className="fc-name">{a}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="mail" size={26} />
            <div>选择一封邮件</div>
            <div style={{ fontSize: 11.5 }}>阅读 · 回复 · 转发 · 星标 · 归档 · 搜索</div>
          </div>
        )}
      </div>

      {/* 写邮件 */}
      {compose && (
        <div className="compose" onPointerDown={(e) => !busy && e.target === e.currentTarget && setCompose(null)}>
          <div className="compose-card">
            <div className="widget-toolbar">
              <b>{compose.replyTo ? '回复' : '新邮件'}</b>
              <span style={{ flex: 1 }} />
              <button className="icon-btn" disabled={busy} onClick={() => setCompose(null)}><Icon name="x" size={14} /></button>
            </div>
            <div className="cc-body">
              <input className="input" disabled={busy} placeholder="收件人" value={compose.to} onChange={(e) => setCompose((c) => (c ? { ...c, to: e.target.value } : c))} />
              <input className="input" disabled={busy} placeholder="主题" value={compose.subject} onChange={(e) => setCompose((c) => (c ? { ...c, subject: e.target.value } : c))} />
              <textarea className="input" disabled={busy} placeholder="正文…" value={compose.body} onChange={(e) => setCompose((c) => (c ? { ...c, body: e.target.value } : c))} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" disabled={busy || !accountId} onClick={() => void act(async () => {
                  if (!accountId) return;
                  await saveDraft(ctx, accountId, compose);
                  setCompose(null);
                  setFolder('drafts');
                  await reloadMessages();
                  ctx.ui.notify('已保存到草稿箱', 'success');
                })}>
                  存草稿
                </button>
                <button className="btn primary" disabled={busy || !accountId || !compose.to || !compose.subject} onClick={() => void act(async () => {
                  if (!accountId) return;
                  const transport = await getTransport(ctx, accounts.find((a) => a.id === accountId)?.kind ?? 'demo');
                  await transport.send(ctx, accountId, { to: compose.to, subject: compose.subject, body: compose.body });
                  ctx.events.emit('mail:changed', {});
                  setCompose(null);
                  setFolder('sent');
                  await reloadMessages();
                  ctx.ui.notify(selected?.kind === 'demo' ? '演示邮件已保存（未发送到网络）' : 'SMTP 服务器已接受邮件', 'success');
                })}>
                  <Icon name="send" size={13} /> 发送
                </button>
              </div>
              {error && <p className="err-panel" role="alert">{error}</p>}
            </div>
          </div>
        </div>
      )}

      {/* 添加账户 */}
      {addOpen && <AccountDialog ctx={ctx} onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); await reloadAccounts(); }} />}
      {editOpen && selected && <AccountDialog ctx={ctx} account={selected} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await reloadAccounts(); }} />}
      {deleteOpen && selected && <div className="compose"><div className="compose-card" role="dialog" aria-label="删除邮箱账户"><div className="cc-body">
        <b>删除账户 {selected.address}？</b><p>删除本机账户配置、已保存的密码和此账户的本机邮件（含草稿）。服务器上的邮箱和邮件不会删除。</p>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={busy} onClick={() => setDeleteOpen(false)}>取消</button><button className="btn danger" disabled={busy} onClick={() => void act(async () => {
          await accountWork(ctx, selected.id, () => removeAccount(ctx, selected.id)); setDeleteOpen(false); setOpenId(null); setMessages([]); await reloadAccounts();
        })}>确认删除本机账户</button></div>{error && <p role="alert">{error}</p>}
      </div></div></div>}
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - ts < 7 * 24 * 3600 * 1000) return d.toLocaleDateString('zh-CN', { weekday: 'long' });
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

async function saveDraft(ctx: PluginContext, accountId: string, compose: { to: string; subject: string; body: string }): Promise<void> {
  const { addMessage } = await import('./store');
  const account = await ctx.storage.sql.one<{ address: string; display_name: string }>(
    'SELECT address, display_name FROM p_email_accounts WHERE id = ?',
    [accountId]
  );
  await addMessage(ctx, {
    accountId,
    folder: 'drafts',
    subject: compose.subject || '(无主题)',
    fromName: account?.display_name ?? '我',
    fromAddr: account?.address ?? 'me@local',
    toList: [compose.to],
    bodyText: compose.body,
    date: Date.now(),
  });
}
