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
  if (version >= 1) return;
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
  await ctx.storage.set('__schema_version', 1);
}

export async function listAccounts(ctx: PluginContext): Promise<AccountRecord[]> {
  return await ctx.storage.sql.all<AccountRecord>(`SELECT * FROM ${A} WHERE deleted_at IS NULL ORDER BY created_at`);
}

export async function addAccount(ctx: PluginContext, address: string, displayName: string, kind = 'demo'): Promise<AccountRecord> {
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${A} (id, address, display_name, provider, kind, created_at, updated_at) VALUES (?, ?, ?, 'demo', ?, ?, ?)`,
    [id, address, displayName, kind, nowMs(), nowMs()]
  );
  return { id, address, display_name: displayName, provider: 'demo', kind };
}

export async function addMessage(ctx: PluginContext, seed: MessageSeed): Promise<string> {
  const id = uuidv7();
  await ctx.storage.sql.exec(
    `INSERT INTO ${M} (id, account_id, folder, thread_id, subject, from_name, from_addr, to_list, cc_list, body_text, date, is_read, is_starred, labels, has_attachments, attachments, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const params: unknown[] = [];
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
  await ctx.storage.sql.exec(`UPDATE ${M} SET ${sets.join(', ')} WHERE id = ?`, [...params, nowMs(), id]);
}

export async function deleteMessage(ctx: PluginContext, id: string): Promise<void> {
  const msg = await getMessage(ctx, id);
  if (msg?.folder === 'trash') {
    await ctx.storage.sql.exec(`UPDATE ${M} SET deleted_at = ? WHERE id = ?`, [nowMs(), id]);
  } else {
    await setMessageFlags(ctx, id, { folder: 'trash' });
  }
}

/* ------------------------------- demo seeding ------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

export async function seedDemoData(ctx: PluginContext): Promise<void> {
  const existing = await ctx.storage.sql.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${A}`);
  if ((existing?.n ?? 0) > 0) return;

  const work = await addAccount(ctx, 'lin.research@university.edu', 'Lin Wei (University)', 'demo');
  const personal = await addAccount(ctx, 'linwei@mail.example', 'Lin Wei (Personal)', 'demo');
  const now = Date.now();
  const seeds: MessageSeed[] = [
    {
      accountId: work.id, folder: 'inbox', subject: 'Review invitation: IEEE TIP special issue on multimodal fusion',
      fromName: 'IEEE TIP Editorial Office', fromAddr: 'tip-editor@ieee.org', toList: ['lin.research@university.edu'],
      bodyText: 'Dear Dr. Lin,\n\nGiven your recent work on multimodal image fusion, we would like to invite you to review a submission to the IEEE Transactions on Image Processing special issue.\n\nManuscript: "Cross-Modal Distillation for Infrared-Visible Fusion"\nReview deadline: two weeks from receipt.\n\nBest regards,\nEditorial Office',
      date: now - 2 * 3600 * 1000, labels: ['review-invitations'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'GPU cluster maintenance this weekend',
      fromName: 'Campus IT', fromAddr: 'hpc-support@university.edu', toList: ['hpc-users@university.edu'],
      bodyText: 'The GPU cluster will be under maintenance Saturday 08:00–18:00. Running jobs will be checkpointed. Please plan long experiments accordingly.',
      date: now - 6 * 3600 * 1000, isRead: true,
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Re: Paper revision — Fig. 4 caption',
      fromName: 'Prof. Zhang', fromAddr: 'zhang@university.edu', toList: ['lin.research@university.edu'],
      bodyText: 'Hi Wei,\n\nThe reviewer wants the Fig. 4 caption to explicitly mention the fusion strategy. Please also double-check the citation format (GB/T 7714 for the Chinese journal version).\n\nThanks,\nZhang',
      date: now - 26 * 3600 * 1000, isStarred: true, labels: ['paper'],
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Seminar: Knowledge Distillation for Efficient Vision Transformers',
      fromName: 'Dept. Seminar Committee', fromAddr: 'seminar@university.edu', toList: ['staff@university.edu'],
      bodyText: 'This Thursday 15:00, Room A302: "Knowledge Distillation for Efficient Vision Transformers" — speaker from TU Munich. Tea and coffee served.',
      date: now - 2 * DAY, isRead: true,
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Your conference registration — CVPR 2027',
      fromName: 'CVPR Registration', fromAddr: 'registration@thecvf.com', toList: ['lin.research@university.edu'],
      bodyText: 'Registration confirmed. Invoice attached for reimbursement.',
      date: now - 3 * DAY, hasAttachments: true, attachmentNames: ['invoice-cvpr27.pdf'], isRead: true,
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Deadline reminder: project progress report',
      fromName: 'Research Administration', fromAddr: 'grants@university.edu', toList: ['lin.research@university.edu'],
      bodyText: 'A friendly reminder that the semi-annual progress report for Grant #2024-117 is due at the end of this month. Please include the publication list and GPU usage summary.',
      date: now - 4 * DAY, isStarred: true,
    },
    {
      accountId: work.id, folder: 'inbox', subject: 'Re: BibTeX of our joint paper',
      fromName: 'Dr. Okafor', fromAddr: 'okafor@inst.org', toList: ['lin.research@university.edu'],
      bodyText: 'Hi Wei,\n\nHere is the BibTeX you asked for:\n\n@article{okafor2026fusion,\n  title = {Infrared and Visible Image Fusion via Cross-Attention},\n  author = {Okafor, C. and Lin, W.},\n  journal = {Information Fusion},\n  year = {2026}\n}\n\nBest,\nChidi',
      date: now - 5 * DAY, isRead: true, labels: ['paper'],
    },
    {
      accountId: personal.id, folder: 'inbox', subject: 'Weekend hike plan',
      fromName: 'Yuki', fromAddr: 'yuki@example.com', toList: ['linwei@mail.example'],
      bodyText: 'Weather looks great Saturday. Takao trail, 7am start? Bring the good camera — autumn colors should be peaking.',
      date: now - 9 * 3600 * 1000,
    },
    {
      accountId: personal.id, folder: 'inbox', subject: 'Invoice #4471 — cloud GPU credits',
      fromName: 'CloudGPU Inc.', fromAddr: 'billing@cloudgpu.example', toList: ['linwei@mail.example'],
      bodyText: 'Your September invoice for GPU credits is available. Amount due: ¥2,400.',
      date: now - 1 * DAY, hasAttachments: true, attachmentNames: ['invoice-4471.pdf'],
    },
    {
      accountId: work.id, folder: 'sent', subject: 'Re: Paper revision — Fig. 4 caption',
      fromName: 'Lin Wei', fromAddr: 'lin.research@university.edu', toList: ['zhang@university.edu'],
      bodyText: 'Dear Prof. Zhang,\n\nUpdated the caption and the citation format; the tracked-changes PDF is on the shared drive (revisions/v3).\n\nBest,\nWei',
      date: now - 25 * 3600 * 1000, isRead: true,
    },
    {
      accountId: work.id, folder: 'sent', subject: 'Review agreement — TIP special issue',
      fromName: 'Lin Wei', fromAddr: 'lin.research@university.edu', toList: ['tip-editor@ieee.org'],
      bodyText: 'Dear Editor,\n\nI am happy to review the manuscript. I will submit the report within two weeks.\n\nKind regards,\nWei Lin',
      date: now - 1 * 3600 * 1000, isRead: true,
    },
    {
      accountId: work.id, folder: 'drafts', subject: 'Re: GPU cluster maintenance this weekend',
      fromName: 'Lin Wei', fromAddr: 'lin.research@university.edu', toList: ['hpc-support@university.edu'],
      bodyText: 'Hello,\n\nCould the maintenance window be moved after 18:00? I have a long training run scheduled for the fusion ablation study…',
      date: now - 5 * 3600 * 1000,
    },
    {
      accountId: personal.id, folder: 'drafts', subject: 'Camera gear for Saturday',
      fromName: 'Lin Wei', fromAddr: 'linwei@mail.example', toList: ['yuki@example.com'],
      bodyText: 'Will bring the 24-70 and the tripod. Meet at the station 6:45?',
      date: now - 8 * 3600 * 1000,
    },
    {
      accountId: work.id, folder: 'archive', subject: 'Access granted: fusion dataset mirror',
      fromName: 'Data Services', fromAddr: 'data@university.edu', toList: ['lin.research@university.edu'],
      bodyText: 'Access to the TNO + MSRS fusion dataset mirror has been granted to your lab group. Path: /data/fusion/.',
      date: now - 10 * DAY, isRead: true,
    },
    {
      accountId: work.id, folder: 'trash', subject: 'Extend your journal subscription!!!',
      fromName: 'Publisher Marketing', fromAddr: 'marketing@publisher.example', toList: ['lin.research@university.edu'],
      bodyText: 'Time-limited offer to extend your institutional subscription…',
      date: now - 12 * DAY, isRead: true,
    },
    {
      accountId: personal.id, folder: 'starred', subject: 'Flight confirmation — Tokyo → Berlin (ICCV)',
      fromName: 'Airline Booking', fromAddr: 'no-reply@airline.example', toList: ['linwei@mail.example'],
      bodyText: 'Booking confirmed. Departure 12 Oct 08:40, return 24 Oct. Reference: QX7P2L.',
      date: now - 7 * DAY, isStarred: true,
    },
  ];
  for (const s of seeds) await addMessage(ctx, s);
  if (seeds.some((s) => s.folder === 'starred')) {
    // starred folder is virtual; nothing extra needed
  }
  ctx.log.info('seeded demo mailbox');
}
