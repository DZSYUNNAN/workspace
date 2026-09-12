import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface AccountRecord {
  id: string;
  address: string;
  display_name: string;
  provider: string;
  kind: string;
}

export interface MessageRecord {
  id: string;
  account_id: string;
  folder: string;
  thread_id: string;
  subject: string;
  from_name: string;
  from_addr: string;
  to_list: string;
  cc_list: string;
  body_text: string;
  date: number;
  is_read: number;
  is_starred: number;
  labels: string;
  has_attachments: number;
  attachments: string;
}

export interface MessageSeed {
  remoteKey?: string;
  accountId: string;
  folder: string;
  subject: string;
  fromName: string;
  fromAddr: string;
  toList: string[];
  bodyText: string;
  date: number;
  isRead?: boolean;
  isStarred?: boolean;
  labels?: string[];
  hasAttachments?: boolean;
  attachmentNames?: string[];
}

const A = 'p_email_accounts';
const M = 'p_email_messages';
export const FOLDERS = ['inbox', 'starred', 'sent', 'drafts', 'archive', 'trash'] as const;

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version >= 2) return;
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${A} (
    id TEXT PRIMARY KEY, address TEXT NOT NULL, display_name TEXT, provider TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'demo', status TEXT NOT NULL DEFAULT 'ok',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${M} (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder TEXT NOT NULL, thread_id TEXT,
    subject TEXT NOT NULL DEFAULT '', from_name TEXT, from_addr TEXT,
    to_list TEXT NOT NULL DEFAULT '[]', cc_list TEXT NOT NULL DEFAULT '[]',
    body_text TEXT NOT NULL DEFAULT '', date INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0,
    labels TEXT NOT NULL DEFAULT '[]', has_attachments INTEGER NOT NULL DEFAULT 0,
    attachments TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
  await ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS p_email_idx_folder ON ${M}(account_id, folder, date DESC)`);
  const columns = await ctx.storage.sql.all<{ name: string }>(`PRAGMA table_info(${M})`);
  if (!columns.some((c) => c.name === 'remote_key')) await ctx.storage.sql.exec(`ALTER TABLE ${M} ADD COLUMN remote_key TEXT`);
  await ctx.storage.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS p_email_idx_remote ON ${M}(account_id, remote_key)`);
  await ctx.storage.set('__schema_version', 2);
}

export async function listAccounts(ctx: PluginContext): Promise<AccountRecord[]> {
  return await ctx.storage.sql.all<AccountRecord>(`SELECT * FROM ${A} WHERE deleted_at IS NULL ORDER BY created_at`);
}

export async function addAccount(ctx: PluginContext, address: string, displayName: string, kind = 'demo'): Promise<AccountRecord> {
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${A} (id, address, display_name, provider, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, address, displayName, kind, kind, nowMs(), nowMs()]
  );
  return { id, address, display_name: displayName, provider: kind, kind };
}

export async function removeAccount(ctx: PluginContext, id: string): Promise<void> {
  // Delete the credential first. A vault error must not silently orphan a password.
  await ctx.secrets.delete(`mail.password.${id}`);
  await ctx.storage.sql.exec(`UPDATE ${A} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
  await ctx.storage.sql.exec(`DELETE FROM ${M} WHERE account_id = ?`, [id]);
  await ctx.storage.delete(`mail.config.${id}`);
  await ctx.storage.set('ui.openMessageId', null);
  ctx.events.emit('mail:accounts-changed', {});
  ctx.events.emit('mail:changed', {});
}

export async function cacheRemoteMessage(ctx: PluginContext, remoteKey: string, seed: MessageSeed): Promise<void> {
  const account = await ctx.storage.sql.one(`SELECT id FROM ${A} WHERE id = ? AND deleted_at IS NULL`, [seed.accountId]);
  if (!account) throw new Error('邮箱账户已删除');
  const existing = await ctx.storage.sql.one<{ id: string }>(`SELECT id FROM ${M} WHERE account_id = ? AND remote_key = ?`, [seed.accountId, remoteKey]);
  // Preserve local read/star/archive/trash state when fetching the same UID again.
  if (existing) return;
  await addMessage(ctx, { ...seed, remoteKey });
}

export async function addMessage(ctx: PluginContext, seed: MessageSeed): Promise<string> {
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${M} (id, account_id, folder, thread_id, subject, from_name, from_addr, to_list, cc_list, body_text, date, is_read, is_starred, labels, has_attachments, attachments, created_at, updated_at, remote_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, remote_key) DO NOTHING`,
    [
      id,
      seed.accountId,
      seed.folder,
      uuidv7(),
      seed.subject,
      seed.fromName,
      seed.fromAddr,
      JSON.stringify(seed.toList),
      seed.bodyText,
      seed.date,
      seed.isRead ? 1 : 0,
      seed.isStarred ? 1 : 0,
      JSON.stringify(seed.labels ?? []),
      seed.hasAttachments ? 1 : 0,
      JSON.stringify(seed.attachmentNames ?? []),
      nowMs(),
      nowMs(),
      seed.remoteKey ?? null,
    ]
  );
  return id;
}

export async function listMessages(ctx: PluginContext, accountId: string, folder: string): Promise<MessageRecord[]> {
  if (folder === 'starred') {
    return await ctx.storage.sql.all<MessageRecord>(
      `SELECT * FROM ${M} WHERE account_id = ? AND is_starred = 1 AND deleted_at IS NULL ORDER BY date DESC`,
      [accountId]
    );
  }
  return await ctx.storage.sql.all<MessageRecord>(
    `SELECT * FROM ${M} WHERE account_id = ? AND folder = ? AND deleted_at IS NULL ORDER BY date DESC`,
    [accountId, folder]
  );
}

export async function searchMessages(ctx: PluginContext, q: string, limit: number): Promise<MessageRecord[]> {
  const like = `%${q}%`;
  return await ctx.storage.sql.all<MessageRecord>(
    `SELECT * FROM ${M} WHERE deleted_at IS NULL AND (subject LIKE ? OR body_text LIKE ? OR from_name LIKE ? OR from_addr LIKE ?)
     ORDER BY date DESC LIMIT ?`,
    [like, like, like, like, limit]
  );
}

export async function getMessage(ctx: PluginContext, id: string): Promise<MessageRecord | null> {
  return (await ctx.storage.sql.one<MessageRecord>(`SELECT * FROM ${M} WHERE id = ?`, [id])) ?? null;
}

export async function setMessageFlags(ctx: PluginContext, id: string, flags: { isRead?: boolean; isStarred?: boolean; folder?: string }): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [nowMs()];
  if (flags.isRead !== undefined) {
    sets.push('is_read = ?');
    params.push(flags.isRead ? 1 : 0);
  }
  if (flags.isStarred !== undefined) {
    sets.push('is_starred = ?');
    params.push(flags.isStarred ? 1 : 0);
  }
  if (flags.folder !== undefined) {
    sets.push('folder = ?');
    params.push(flags.folder);
  }
  await ctx.storage.sql.exec(`UPDATE ${M} SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export async function deleteMessage(ctx: PluginContext, id: string): Promise<void> {
  const msg = await getMessage(ctx, id);
  if (msg?.folder === 'trash') {
    await ctx.storage.sql.exec(`UPDATE ${M} SET deleted_at = ? WHERE id = ?`, [nowMs(), id]);
  } else {
    await setMessageFlags(ctx, id, { folder: 'trash' });
  }
}

/* ------------------------------- 演示邮箱数据 ------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export async function seedDemoData(ctx: PluginContext): Promise<void> {
  const existing = await ctx.storage.sql.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${A}`);
  if ((existing?.n ?? 0) > 0) return;

  const work = await addAccount(ctx, 'wei.lin@university.edu', '林伟 · 校园邮箱', 'demo');
  const personal = await addAccount(ctx, 'linwei@mail.example', '林伟 · 个人邮箱', 'demo');
  const now = Date.now();
  const seeds: MessageSeed[] = [
    {
      accountId: work.id, folder: 'inbox', subject: 'New research highlights — 本周研究亮点:多模态学习',
      fromName: 'Nature', fromAddr: 'alerts@nature.com', toList: ['wei.lin@university.edu'],
      bodyText: '本周《自然》精选:1) 跨模态注意力在红外-可见光融合中的最新进展;2) 知识蒸馏用于视觉 Transformer 压缩;3) 开放评审制度的三年回顾。点击查看全文与引用格式。',
      date: now - 2 * HOUR, labels: ['期刊速递'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Re: conference paper(会议论文修改意见)',
      fromName: 'Prof. Smith', fromAddr: 'smith@university.edu', toList: ['wei.lin@university.edu'],
      bodyText: 'Wei,\n\n审稿人希望 Fig.4 的说明里明确写出融合策略,并补充与基线的公平比较。另外 GB/T 7714 格式的引用版本也要在中文版里核对一遍。周五前给我看 v3 吗?\n\n— Smith',
      date: now - 5 * HOUR, isStarred: true, labels: ['论文'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: '您的论文有新的引用(New citations for your paper)',
      fromName: 'Google Scholar', fromAddr: 'scholaralerts-noreply@google.com', toList: ['wei.lin@university.edu'],
      bodyText: '您 2024 年发表的《A Survey on Multimodal Image Fusion》新增 3 次引用。查看引用您的最新文章:Cross-Modal Distillation…、Infrared-Visible Fusion via…',
      date: now - DAY, isRead: true, labels: ['引用提醒'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: '组会安排(本周四 15:00, A302)',
      fromName: '合作导师', fromAddr: 'zhang@university.edu', toList: ['wei.lin@university.edu'],
      bodyText: 'Wei:\n\n周四组会请你汇报多模态融合课题进展(15 分钟),重点讲消融实验。另外把新同学的文献阅读清单也带上。\n\n张老师',
      date: now - DAY - 3 * HOUR, isStarred: true, labels: ['组会'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'CVPR 2025 Submission — 投稿确认',
      fromName: '会议通知', fromAddr: 'no-reply@thecvf.com', toList: ['wei.lin@university.edu'],
      bodyText: '您的投稿《Multimodal Image Fusion with Cross-Attention Distillation》(Paper #2147) 已收到。 OpenReview 链接与Rebuttal 时间安排见邮件附件。',
      date: now - 11 * DAY, isRead: true, hasAttachments: true, attachmentNames: ['submission-receipt.pdf'], labels: ['会议'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'GPU 集群本周六维护通知',
      fromName: '校园信息中心', fromAddr: 'hpc-support@university.edu', toList: ['hpc-users@university.edu'],
      bodyText: 'GPU 集群将于周六 08:00-18:00 停机维护,运行中的任务将自动保存断点。请合理安排长时间训练。',
      date: now - 2 * DAY, isRead: true,
    },
    {
      accountId: work.id, folder: 'inbox', subject: '审稿邀请:IEEE TIP 特刊「多模态图像融合」',
      fromName: 'IEEE TIP 编辑部', fromAddr: 'tip-editor@ieee.org', toList: ['wei.lin@university.edu'],
      bodyText: '鉴于您在多模态图像融合方面的工作,诚邀您审阅投稿《Cross-Modal Distillation for Infrared-Visible Fusion》。审稿周期两周,可在系统内接受或推荐审稿人。',
      date: now - 3 * DAY, labels: ['审稿'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: '项目进展报告截止提醒',
      fromName: '科研管理处', fromAddr: 'grants@university.edu', toList: ['wei.lin@university.edu'],
      bodyText: '温馨提示:2024-117 课题半年度进展报告将于本月底截止,请包含论文清单与 GPU 使用统计。',
      date: now - 4 * DAY, isRead: true,
    },
    {
      accountId: personal.id, folder: 'inbox', subject: '周六徒步计划',
      fromName: 'Yuki', fromAddr: 'yuki@example.com', toList: ['linwei@mail.example'],
      bodyText: '周六天气不错!高尾山 7 点出发?记得带上相机,秋叶应该正好看。',
      date: now - 9 * HOUR,
    },
    {
      accountId: work.id, folder: 'sent', subject: 'Re: conference paper(已发送修改稿 v3)',
      fromName: '林伟', fromAddr: 'wei.lin@university.edu', toList: ['smith@university.edu'],
      bodyText: 'Smith 教授:\n\n已按要求更新 Fig.4 说明并补充公平比较,修订版在共享盘 revisions/v3。\n\n林伟',
      date: now - 4 * HOUR, isRead: true,
    },
    {
      accountId: work.id, folder: 'sent', subject: 'Re: 组会安排(收到,准时参加)',
      fromName: '林伟', fromAddr: 'wei.lin@university.edu', toList: ['zhang@university.edu'],
      bodyText: '张老师好,周四组会我会汇报融合课题进展并带上文献清单。',
      date: now - DAY + 2 * HOUR, isRead: true,
    },
    {
      accountId: work.id, folder: 'drafts', subject: 'Re: GPU 集群本周六维护通知',
      fromName: '林伟', fromAddr: 'wei.lin@university.edu', toList: ['hpc-support@university.edu'],
      bodyText: '您好,请问维护窗口能否调整到 18:00 之后?我有一个融合消融实验需要长跑…',
      date: now - 2 * DAY + HOUR,
    },
    {
      accountId: work.id, folder: 'archive', subject: '融合数据集镜像访问已开通',
      fromName: '数据服务', fromAddr: 'data@university.edu', toList: ['wei.lin@university.edu'],
      bodyText: '已为您的课题组开通 TNO + MSRS 融合数据集镜像访问,路径 /data/fusion/。',
      date: now - 10 * DAY, isRead: true,
    },
    {
      accountId: work.id, folder: 'trash', subject: '限时优惠!期刊续订八折!!!',
      fromName: '出版社市场部', fromAddr: 'marketing@publisher.example', toList: ['wei.lin@university.edu'],
      bodyText: '机构订阅限时续订优惠,过期恢复原价…',
      date: now - 12 * DAY, isRead: true,
    },
    {
      accountId: personal.id, folder: 'starred', subject: '航班确认 — 东京 → 柏林(ICCV)',
      fromName: '航空公司', fromAddr: 'no-reply@airline.example', toList: ['linwei@mail.example'],
      bodyText: '预订确认:10 月 12 日 08:40 出发,10 月 24 日返程。预订编号 QX7P2L。',
      date: now - 7 * DAY, isStarred: true,
    },
  ];
  const task = ctx.storage.sql; void task;
  for (const s of seeds) await addMessage(ctx, s);
  ctx.log.info('演示邮箱数据已就绪');
}
