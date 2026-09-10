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
  type AccountRecord,
  type MessageRecord,
} from './store';
import { getTransport } from './transport';

const FOLDER_ICON: Record<string, string> = {
  inbox: 'inbox',
  starred: 'star',
  sent: 'send',
  drafts: 'pen',
  archive: 'archive',
  trash: 'trash',
};

export function MailView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string>('inbox');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; replyTo?: string } | null>(null);

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
      {/* folders */}
      <div className="mail-folders" style={props.compact ? { width: 118 } : undefined}>
        <select className="input" style={{ margin: '4px 4px 8px', fontSize: 11.5, width: 'calc(100% - 8px)' }} value={accountId ?? ''} onChange={(e) => { setAccountId(e.target.value); setOpenId(null); }}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.display_name ?? a.address}</option>
          ))}
        </select>
        {FOLDERS.map((f) => (
          <button key={f} className={`mail-folder-btn${folder === f ? ' active' : ''}`} onClick={() => { setFolder(f); setOpenId(null); }}>
            <Icon name={FOLDER_ICON[f] ?? 'mail'} size={13} />
            {f[0]?.toUpperCase() + f.slice(1)}
            {f === 'inbox' && unread > 0 && <span className="badge" style={{ marginLeft: 'auto' }}>{unread}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn sm primary" style={{ margin: 6 }} onClick={() => setCompose({ to: '', subject: '', body: '' })}>
          <Icon name="plus" size={12} /> Compose
        </button>
      </div>

      {/* list */}
      <div className="mail-list">
        <div className="widget-toolbar" style={{ padding: 6 }}>
          <input className="input" style={{ flex: 1, minWidth: 60 }} placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="list">
          {filtered.map((m) => (
            <div key={m.id} className={`mail-row${m.id === openId ? ' active' : ''}${m.is_read ? '' : ' unread'}`} onClick={() => void open(m.id)}>
              <div className="mr-top">
                {!m.is_read && <span style={{ width: 7 }} />}
                <span className="mr-from">{folder === 'sent' || folder === 'drafts' ? `To: ${(JSON.parse(m.to_list) as string[]).join(', ')}` : m.from_name}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{new Date(m.date).toLocaleDateString()}</span>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await setMessageFlags(ctx, m.id, { isStarred: !m.is_starred });
                    await reloadMessages();
                  }}
                >
                  <Icon name="star" size={12} />
                </button>
              </div>
              <div className="mr-sub">{m.subject || '(no subject)'}</div>
              <div className="mr-sub" style={{ color: 'var(--text-3)', fontSize: 11 }}>{m.body_text.slice(0, 70)}…</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                {JSON.parse(m.labels as string).map((l: string) => (
                  <span key={l} className="badge gray" style={{ fontSize: 10 }}>{l}</span>
                ))}
                {m.has_attachments === 1 && <span className="badge" style={{ fontSize: 10 }}><Icon name="file" size={9} /> attachment</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-state">No messages in {folder}</div>}
        </div>
      </div>

      {/* reader */}
      <div className="mail-reader">
        {openMsg ? (
          <>
            <h2>{openMsg.subject || '(no subject)'}</h2>
            <div className="ref-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="user" size={13} />
              <b>{openMsg.from_name}</b> &lt;{openMsg.from_addr}&gt; · {new Date(openMsg.date).toLocaleString()}
            </div>
            <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
              <button className="btn sm" onClick={() => setCompose({ to: openMsg.from_addr, subject: `Re: ${openMsg.subject}`, body: `\n\n---\n${openMsg.body_text}`, replyTo: openMsg.id })}>
                <Icon name="reply" size={12} /> Reply
              </button>
              <button
                className="btn sm"
                onClick={() =>
                  setCompose({
                    to: '',
                    subject: `Fwd: ${openMsg.subject}`,
                    body: `\n\n--- forwarded ---\nFrom: ${openMsg.from_name}\n\n${openMsg.body_text}`,
                  })
                }
              >
                <Icon name="forward" size={12} /> Forward
              </button>
              {openMsg.folder !== 'archive' ? (
                <button className="btn sm" onClick={async () => { await setMessageFlags(ctx, openMsg.id, { folder: 'archive' }); setOpenId(null); await reloadMessages(); }}>
                  <Icon name="archive" size={12} /> Archive
                </button>
              ) : (
                <button className="btn sm" onClick={async () => { await setMessageFlags(ctx, openMsg.id, { folder: 'inbox' }); setOpenId(null); await reloadMessages(); }}>
                  <Icon name="inbox" size={12} /> Move to Inbox
                </button>
              )}
              <button className="btn sm danger" onClick={async () => { await deleteMessage(ctx, openMsg.id); setOpenId(null); await reloadMessages(); }}>
                <Icon name="trash" size={12} /> Delete
              </button>
            </div>
            <div style={{ lineHeight: 1.75, whiteSpace: 'pre-wrap', fontSize: 13 }}>{openMsg.body_text}</div>
            {openMsg.has_attachments === 1 && (
              <div style={{ marginTop: 16 }}>
                <b style={{ fontSize: 12 }}>Attachments</b>
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
            <div>Select a message</div>
            <div style={{ fontSize: 11.5 }}>Read · reply · forward · star · archive · search</div>
          </div>
        )}
      </div>

      {compose && (
        <div className="compose" onPointerDown={(e) => e.target === e.currentTarget && setCompose(null)}>
          <div className="compose-card">
            <div className="widget-toolbar">
              <b>{compose.replyTo ? 'Reply' : 'New message'}</b>
              <span style={{ flex: 1 }} />
              <button className="icon-btn" onClick={() => setCompose(null)}><Icon name="x" size={14} /></button>
            </div>
            <div className="cc-body">
              <input className="input" placeholder="To" value={compose.to} onChange={(e) => setCompose((c) => (c ? { ...c, to: e.target.value } : c))} />
              <input className="input" placeholder="Subject" value={compose.subject} onChange={(e) => setCompose((c) => (c ? { ...c, subject: e.target.value } : c))} />
              <textarea className="input" placeholder="Message…" value={compose.body} onChange={(e) => setCompose((c) => (c ? { ...c, body: e.target.value } : c))} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={async () => {
                  if (!accountId) return;
                  await updateDoc(ctx, accountId, compose);
                  setCompose(null);
                  setFolder('drafts');
                  await reloadMessages();
                  ctx.ui.notify('Saved to Drafts', 'success');
                }}>
                  Save draft
                </button>
                <button className="btn primary" disabled={!compose.to || !compose.subject} onClick={async () => {
                  if (!accountId) return;
                  const transport = getTransport(accounts.find((a) => a.id === accountId)?.kind ?? 'demo');
                  await transport.send(ctx, accountId, { to: compose.to, subject: compose.subject, body: compose.body });
                  ctx.events.emit('mail:changed', {});
                  setCompose(null);
                  setFolder('sent');
                  await reloadMessages();
                  ctx.ui.notify('Sent', 'success');
                }}>
                  <Icon name="send" size={13} /> Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function updateDoc(ctx: PluginContext, accountId: string, compose: { to: string; subject: string; body: string }): Promise<void> {
  const { addMessage } = await import('./store');
  const account = await ctx.storage.sql.one<{ address: string; display_name: string }>(
    'SELECT address, display_name FROM p_email_accounts WHERE id = ?',
    [accountId]
  );
  await addMessage(ctx, {
    accountId,
    folder: 'drafts',
    subject: compose.subject || '(no subject)',
    fromName: account?.display_name ?? 'Me',
    fromAddr: account?.address ?? 'me@local',
    toList: [compose.to],
    bodyText: compose.body,
    date: Date.now(),
  });
}
