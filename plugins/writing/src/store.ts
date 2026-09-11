import type { PluginContext } from '@mpw/kernel';
import { nowMs, uuidv7 } from '@mpw/shared';

export interface DocRecord {
  id: string;
  title: string;
  mode: 'rich' | 'latex'; // 模式 A(类 Word)| 模式 B(LaTeX)
  content: string; // rich: HTML · latex: 主文件兼容存储(v1 数据)
  folder: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

export interface FileRecord {
  id: string;
  doc_id: string;
  name: string;
  content: string;
  sort: number;
}

const T = 'p_writing_documents';
const F = 'p_writing_files';

export async function initSchema(ctx: PluginContext): Promise<void> {
  const version = await ctx.storage.get<number>('__schema_version', 0);
  if (version < 1) {
    await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${T} (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'rich',
      content TEXT NOT NULL DEFAULT '', folder TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`);
    await ctx.storage.set('__schema_version', 1);
  }
  if (version < 2) {
    // v2: LaTeX 多文件工程(main.tex / references.bib / sections/…)
    await ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${F} (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0)`);
    await ctx.storage.set('__schema_version', 2);
  }
}

const DEFAULT_LATEX_FILES: { name: string; content: string }[] = [
  {
    name: 'main.tex',
    content: `\\documentclass{ctexart}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{研究稿件}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{引言}
在这里开始撰写研究背景。

\\section{方法}
融合权重由交叉注意力计算:
\\begin{equation}
  W = \\mathrm{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d}}\\right)
\\end{equation}

% 通过「插入引用」从文献库添加真实参考文献。
\\bibliographystyle{ieeetr}
\\bibliography{references}

\\end{document}
`,
  },
  {
    name: 'references.bib',
    content: '% 从文献库插入的 BibTeX 条目会保存在这里。\n',
  },
];

export async function createDoc(ctx: PluginContext, title: string, mode: 'rich' | 'latex'): Promise<DocRecord> {
  const id = uuidv7();
  const now = nowMs();
  const content =
    mode === 'latex' ? DEFAULT_LATEX_FILES[0]?.content ?? '' : '<h1>未命名文档</h1><p></p>';
  await ctx.storage.sql.exec(
    `INSERT INTO ${T} (id, title, mode, content, folder, tags, created_at, updated_at) VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
    [id, title, mode, content, now, now]
  );
  if (mode === 'latex') {
    let sort = 0;
    for (const f of DEFAULT_LATEX_FILES) {
      await ctx.storage.sql.exec(`INSERT INTO ${F} (id, doc_id, name, content, sort) VALUES (?, ?, ?, ?, ?)`, [
        uuidv7(),
        id,
        f.name,
        f.content,
        sort++,
      ]);
    }
  }
  return { id, title, mode, content, folder: '', tags: '[]', created_at: now, updated_at: now };
}

export async function listDocs(ctx: PluginContext): Promise<DocRecord[]> {
  return await ctx.storage.sql.all<DocRecord>(`SELECT * FROM ${T} WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
}

export async function getDoc(ctx: PluginContext, id: string): Promise<DocRecord | null> {
  return (await ctx.storage.sql.one<DocRecord>(`SELECT * FROM ${T} WHERE id = ? AND deleted_at IS NULL`, [id])) ?? null;
}

export async function updateDoc(ctx: PluginContext, id: string, fields: Partial<Pick<DocRecord, 'title' | 'content' | 'mode'>>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (sets.length === 0) return;
  await ctx.storage.sql.exec(`UPDATE ${T} SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`, [...params, nowMs(), id]);
}

export async function softDeleteDoc(ctx: PluginContext, id: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${T} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowMs(), nowMs(), id]);
}

export async function searchDocs(ctx: PluginContext, q: string, limit: number): Promise<DocRecord[]> {
  const like = `%${q}%`;
  return await ctx.storage.sql.all<DocRecord>(
    `SELECT * FROM ${T} WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
    [like, like, limit]
  );
}

/* ---------------- LaTeX 工程文件 ---------------- */

export async function listFiles(ctx: PluginContext, docId: string): Promise<FileRecord[]> {
  return await ctx.storage.sql.all<FileRecord>(`SELECT * FROM ${F} WHERE doc_id = ? ORDER BY sort`, [docId]);
}

export async function saveFile(ctx: PluginContext, fileId: string, content: string): Promise<void> {
  await ctx.storage.sql.exec(`UPDATE ${F} SET content = ? WHERE id = ?`, [content, fileId]);
}

export async function addFile(ctx: PluginContext, docId: string, name: string): Promise<FileRecord> {
  const id = uuidv7();
  const rows = await listFiles(ctx, docId);
  const sort = rows.length;
  await ctx.storage.sql.exec(`INSERT INTO ${F} (id, doc_id, name, content, sort) VALUES (?, ?, ?, '', ?)`, [id, docId, name, sort]);
  return { id, doc_id: docId, name, content: '', sort };
}

export async function deleteFile(ctx: PluginContext, fileId: string): Promise<void> {
  await ctx.storage.sql.exec(`DELETE FROM ${F} WHERE id = ?`, [fileId]);
}
