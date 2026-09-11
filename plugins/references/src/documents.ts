import type { PluginContext } from '@mpw/kernel';
import { documentMime, extension, DOCUMENT_ACCEPT } from '@mpw/shared';
import { addToCollection, insertRef, softDeleteRef, updateRef } from './store';

export async function importLibraryDocument(ctx: PluginContext, file: File, collectionId: string | null): Promise<string> {
  if (!DOCUMENT_ACCEPT.split(',').includes(`.${extension(file.name)}`)) throw new Error('不支持此文档类型');
  if (file.size > 100 * 1024 * 1024) throw new Error('单个入库文档不能超过 100 MB');
  if (!file.size) throw new Error('文件为空');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension(file.name) === 'pdf' && !new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('文件不是有效的 PDF');
  const blob = await ctx.blobs.put(`references/${file.name}`, bytes, documentMime(file.name));
  const row = await insertRef(ctx, { title: file.name.replace(/\.[^.]+$/, ''), entryType: 'misc', citationKey: `local_${blob.ref.slice(-12)}`, authors: [], venue: '', year: null, doi: '', abstract: '', keywords: [], volume: '', number: '', pages: '', publisher: '' });
  try {
    await updateRef(ctx, row.id, { blob_ref: blob.ref, file_name: file.name });
    if (collectionId) await addToCollection(ctx, collectionId, row.id);
    return row.id;
  } catch (e) { await softDeleteRef(ctx, row.id); throw e; }
}
