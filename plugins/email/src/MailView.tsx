import React, { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import {
  FOLDERS,
  getMessage,
  listAccounts,
  listMessages,
  deleteMessage,
  setMessageFlags,
  addAccount,
  type AccountRecord,
  type MessageRecord,
} from './store';
import { getTransport, TRANSPORT_INFO } from './transport';

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

  const reloadAccounts = async (): Promise<void> => {
    const accs = await listAccounts(ctx);
    setAccounts(accs);
    setAccountId((prev) => prev ?? accs[0]?.id ?? null);
  };

  const reloadMessages = async (): Promise<void> => {
    if (!accountId) return;
    setMessages(await listMessages(ctx, accountId, folder));
  };

  useEffect(() => {
    void reloadAccounts();
    const offs = [
      ctx.events.on('mail:changed', () => void reloadMessages()),
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
    void reloadMessages();
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
      <div className="mail-folders" style={props.compact ? { width: 128 } : undefined}>
        <select
          className="input"
          style={{ margin: '4px 4px 8px', fontSize: 11.5, width: 'calc(100% - 8px)' }}
          value={accountId ?? ''}
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
        <button className="btn sm primary" style={{ margin: 6 }} onClick={() => setCompose({ to: '', subject: '', body: '' })}>
          <Icon name="plus" size={12} /> 写邮件
        </button>
        <button className="btn sm" style={{ margin: '0 6px 6px' }} onClick={() => setAddOpen(true)}>
          <Icon name="user" size={12} /> 添加账户
        </button>
      </div>

      {/* 列表 */}
      <div className="mail-list">
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <input className="input" style={{ flex: 1, minWidth: 60 }} placeholder="搜索邮件…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
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

      {/* 阅读区 */}
      <div className="mail-reader">
        {openMsg ? (
          <>
            <h2>{openMsg.subject || '(无主题)'}</h2>
            <div className="ref-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', fontSize: 13 }}>{openMsg.body_text}</div>
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
        <div className="compose" onPointerDown={(e) => e.target === e.currentTarget && setCompose(null)}>
          <div className="compose-card">
            <div className="widget-toolbar">
              <b>{compose.replyTo ? '回复' : '新邮件'}</b>
              <span style={{ flex: 1 }} />
              <button className="icon-btn" onClick={() => setCompose(null)}><Icon name="x" size={14} /></button>
            </div>
            <div className="cc-body">
              <input className="input" placeholder="收件人" value={compose.to} onChange={(e) => setCompose((c) => (c ? { ...c, to: e.target.value } : c))} />
              <input className="input" placeholder="主题" value={compose.subject} onChange={(e) => setCompose((c) => (c ? { ...c, subject: e.target.value } : c))} />
              <textarea className="input" placeholder="正文…" value={compose.body} onChange={(e) => setCompose((c) => (c ? { ...c, body: e.target.value } : c))} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={async () => {
                  if (!accountId) return;
                  await saveDraft(ctx, accountId, compose);
                  setCompose(null);
                  setFolder('drafts');
                  await reloadMessages();
                  ctx.ui.notify('已保存到草稿箱', 'success');
                }}>
                  存草稿
                </button>
                <button className="btn primary" disabled={!compose.to || !compose.subject} onClick={async () => {
                  if (!accountId) return;
                  const transport = getTransport(ctx, accounts.find((a) => a.id === accountId)?.kind ?? 'demo');
                  await transport.send(ctx, accountId, { to: compose.to, subject: compose.subject, body: compose.body });
                  ctx.events.emit('mail:changed', {});
                  setCompose(null);
                  setFolder('sent');
                  await reloadMessages();
                  ctx.ui.notify('已发送', 'success');
                }}>
                  <Icon name="send" size={13} /> 发送
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 添加账户 */}
      {addOpen && <AddAccountDialog ctx={ctx} onClose={() => setAddOpen(false)} onAdded={async () => { setAddOpen(false); await reloadAccounts(); }} />}
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

function AddAccountDialog(props: { ctx: PluginContext; onClose: () => void; onAdded: () => Promise<void> }): React.ReactElement {
  const { ctx } = props;
  const [kind, setKind] = useState('demo');
  const [addr, setAddr] = useState('');
  const [name, setName] = useState('');
  const [relay, setRelay] = useState(ctx.settings ? '' : '');
  void relay;
  const info = TRANSPORT_INFO.find((t) => t.kind === kind);
  return (
    <div className="compose" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="compose-card">
        <div className="widget-toolbar">
          <b>添加邮箱账户</b>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={props.onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="cc-body">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TRANSPORT_INFO.map((t) => (
              <button key={t.kind} className={`btn sm${kind === t.kind ? ' primary' : ''}`} onClick={() => setKind(t.kind)}>{t.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{info?.hint}</div>
          <input className="input" placeholder="邮箱地址" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <input className="input" placeholder="显示名称(如:林伟 · 校园邮箱)" value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={props.onClose}>取消</button>
            <button
              className="btn primary"
              disabled={!addr.trim()}
              onClick={async () => {
                await addAccount(ctx, addr.trim(), name.trim() || addr.trim(), kind);
                ctx.events.emit('mail:changed', {});
                ctx.ui.notify(`账户「${addr.trim()}」已添加`, 'success');
                await props.onAdded();
              }}
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
