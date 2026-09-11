import { describe, it, expect } from 'vitest';
import { File } from 'node:buffer';
import { Kernel, openMemoryDb, type PluginContext } from '@mpw/kernel';
import references from '../src/index';
import { createCollection, getRef, listRefs } from '../src/store';
import { importLibraryDocument } from '../src/documents';
describe('local library documents', () => {
  it('imports PDF, Word and Markdown into the selected library with original bytes', async () => {
    const db = await openMemoryDb(); const kernel = new Kernel({ db }); kernel.registerBuiltins([references]); await kernel.boot();
    const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.references');
    const a = await createCollection(ctx, '研究库'); const b = await createCollection(ctx, '另一文献库');
    for (const [name, content] of [['paper.pdf', '%PDF-1.4\nfixture'], ['research.docx', 'Word fixture bytes'], ['notes.md', '# 研究笔记']]) {
      const file = new File([content], name) as unknown as globalThis.File;
      const id = await importLibraryDocument(ctx, file, a.id); const ref = (await getRef(ctx, id))!;
      expect(ref.file_name).toBe(name); expect(ref.title).toBe(name.replace(/\.[^.]+$/, ''));
      expect(new TextDecoder().decode((await ctx.blobs.get(ref.blob_ref))!.bytes)).toBe(content);
    }
    expect(await listRefs(ctx, a.id)).toHaveLength(3); expect(await listRefs(ctx, b.id)).toHaveLength(0);
    await expect(importLibraryDocument(ctx, new File(['wrong'], 'fake.pdf') as unknown as globalThis.File, a.id)).rejects.toThrow('PDF');
    await expect(importLibraryDocument(ctx, new File(['bad'], 'run.exe') as unknown as globalThis.File, a.id)).rejects.toThrow('类型');
    expect(await listRefs(ctx, a.id)).toHaveLength(3); db.close();
  });
});
