import { describe, expect, it } from 'vitest';
import { Kernel, MemoryBlobStore, MemorySecretStore, openMemoryDb, type PluginContext } from '@mpw/kernel';
import plugin from '@mpw/plugin-notes';
import { extractLinks } from '../src/store';
import { renderMarkdown } from '../src/markdown';

async function bootWithNotes(): Promise<{ kernel: Kernel; ctx: PluginContext }> {
  const db = await openMemoryDb();
  const kernel = new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
  kernel.registerBuiltins([plugin]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  // recreate a context through the same factory used at activation for tests
  const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.notes');
  return { kernel, ctx };
}

describe('notes plugin', () => {
  it('activates through the kernel and registers its contributions', async () => {
    const { kernel } = await bootWithNotes();
    expect(kernel.isLoaded('mpw.notes')).toBe(true);
    expect(kernel.enabledRoutes().map((r) => r.key)).toContain('mpw.notes/main');
    expect(kernel.search.listProviders().map((p) => p.id)).toContain('notes');
    expect(kernel.context.list().map((c) => c.id)).toContain('current');
  });

  it('creates, updates and lists notes (CRUD)', async () => {
    const { ctx } = await bootWithNotes();
    const { createNote, listNotes, updateNote, softDeleteNote } = await import('../src/store');
    const n = await createNote(ctx, 'Meeting', 'Discussed [[Fusion Paper]] ideas');
    expect((await listNotes(ctx)).map((x) => x.title)).toContain('Meeting');
    await updateNote(ctx, n.id, { body_md: 'updated body' });
    const notes = await listNotes(ctx);
    expect(notes.find((x) => x.id === n.id)?.body_md).toBe('updated body');
    await softDeleteNote(ctx, n.id);
    expect((await listNotes(ctx)).find((x) => x.id === n.id)).toBeUndefined();
  });

  it('extracts wikilinks and finds backlinks', async () => {
    const { ctx } = await bootWithNotes();
    const { createNote, backlinks } = await import('../src/store');
    await createNote(ctx, 'Hub', 'Links to [[Alpha]] and [[Beta|the beta note]]');
    await createNote(ctx, 'Alpha', 'Content');
    expect(extractLinks('see [[Alpha]] and [[Beta|alias]]')).toEqual(['Alpha', 'Beta']);
    const hubLinks = await backlinks(ctx, 'Alpha');
    expect(hubLinks.map((n) => n.title)).toEqual(['Hub']);
  });

  it('renders markdown with math, code and wikilinks (sanitized)', async () => {
    const html = renderMarkdown('# Title\n\n$x^2 + 1$ and [[Target]]\n\n```js\nconst a = "$notmath$";\n```\n\n<script>alert(1)</script>');
    expect(html).toContain('<h1>');
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('katex');
    expect(html).not.toContain('<script>');
    // $ inside a code fence must stay literal, not become math
    expect(html).toContain('const a');
    // exactly one math span was rendered (the $x^2+1$ outside the fence)
    expect(html.match(/class="katex"/g)?.length).toBe(1);
  });

  it('searches via the global search provider contract', async () => {
    const { kernel } = await bootWithNotes();
    const { createNote } = await import('../src/store');
    const ctx = (kernel as unknown as { createContext(id: string): PluginContext }).createContext('mpw.notes');
    await createNote(ctx, 'Knowledge Distillation survey', 'distillation methods for vision transformers');
    const groups = await kernel.search.searchAll('distillation');
    const notesGroup = groups.find((g) => g.label === '笔记');
    expect(notesGroup?.hits.length).toBeGreaterThan(0);
    expect(notesGroup?.hits[0]?.title).toBe('Knowledge Distillation survey');
  });
});
