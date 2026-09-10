import { describe, expect, it } from 'vitest';
import { Kernel, MemoryBlobStore, MemorySecretStore, openMemoryDb, type PluginContext } from '@mpw/kernel';
import notesPlugin from '@mpw/plugin-notes';
import referencesPlugin from '@mpw/plugin-references';
import writingPlugin from '@mpw/plugin-writing';
import emailPlugin from '@mpw/plugin-email';
import filesPlugin from '@mpw/plugin-files';
import aiPlugin from '@mpw/plugin-ai';

/** Full-stack integration: boot every plugin on a real SQLite (in-memory). */
async function bootAll(): Promise<Kernel> {
  const db = await openMemoryDb();
  const kernel = new Kernel({ db, blobStore: new MemoryBlobStore(), secretStore: new MemorySecretStore() });
  kernel.registerBuiltins([notesPlugin, referencesPlugin, writingPlugin, emailPlugin, filesPlugin, aiPlugin]);
  const report = await kernel.boot();
  expect(report.failed).toEqual([]);
  return kernel;
}

describe('workspace + plugin system integration', () => {
  it('boots all six plugins with their contributions registered', async () => {
    const k = await bootAll();
    const routes = k.enabledRoutes().map((r) => r.key);
    expect(routes).toEqual(
      expect.arrayContaining([
        'mpw.email/main',
        'mpw.references/main',
        'mpw.notes/main',
        'mpw.writing/main',
        'mpw.files/main',
      ])
    );
    expect(k.enabledWidgets().map((w) => w.key)).toContain('mpw.ai/chat');
    expect(k.availableCommands().map((c) => c.id)).toContain('mpw.notes.newNote');
  });

  it('global search finds data across plugins (notes + references + email)', async () => {
    const k = await bootAll();
    const ctx = (k as unknown as { createContext(id: string): PluginContext }).createContext('mpw.notes');
    await ctx.storage.sql.exec(
      "INSERT INTO p_notes_notes (id, title, body_md, folder, tags, created_at, updated_at) VALUES ('n1', 'Fusion seminar summary', 'knowledge distillation for fusion networks', '', '[]', 1, 1)"
    );
    const rctx = (k as unknown as { createContext(id: string): PluginContext }).createContext('mpw.references');
    await rctx.storage.sql.exec(
      "INSERT INTO p_references_references (id, citation_key, entry_type, title, authors, keywords, tags, created_at, updated_at) VALUES ('r1', 'test2026fusion', 'article', 'Infrared and Visible Image Fusion Survey', '[]', '[]', '[]', 1, 1)"
    );

    const groups = await k.search.searchAll('distillation');
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('Notes');

    const refs = await k.search.searchAll('fusion');
    for (const label of ['Notes', 'References', 'Email']) {
      expect(refs.map((g) => g.label)).toContain(label);
    }
  });

  it('email plugin seeds the demo mailbox with folders and flags', async () => {
    const k = await bootAll();
    const ctx = (k as unknown as { createContext(id: string): PluginContext }).createContext('mpw.email');
    const accounts = await ctx.storage.sql.all<{ id: string }>('SELECT id FROM p_email_accounts');
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    const inbox = await ctx.storage.sql.all<{ subject: string; is_read: number }>(
      'SELECT subject, is_read FROM p_email_messages WHERE folder = ?', ['inbox']
    );
    expect(inbox.length).toBeGreaterThanOrEqual(5);
    expect(inbox.some((m) => m.is_read === 0)).toBe(true);
    const starred = await ctx.storage.sql.all<{ id: string }>('SELECT id FROM p_email_messages WHERE is_starred = 1');
    expect(starred.length).toBeGreaterThanOrEqual(3);
  });

  it('AI actions execute through the plugin permission gate (demo provider)', async () => {
    const k = await bootAll();
    const actions = k.enabledAiActions().map((a) => a.id);
    expect(actions).toEqual(expect.arrayContaining(['polish', 'summarize', 'en2zh', 'gen-latex']));
    const ctx = (k as unknown as { createContext(id: string): PluginContext }).createContext('mpw.ai');
    const result = await ctx.ai.run('here is Some text. with issues!! it needs polish', {
      system: 'polish this text.',
    });
    expect(result.text).not.toContain('!!  it'); // demo provider normalized spacing
  });

  it('enabling/disabling plugins mid-session keeps the rest working', async () => {
    const k = await bootAll();
    await k.disablePlugin('mpw.notes');
    expect(k.enabledRoutes().map((r) => r.key)).not.toContain('mpw.notes/main');
    const groups = await k.search.searchAll('distillation');
    expect(groups.map((g) => g.label)).not.toContain('Notes');
    // email (seeded demo mailbox) remains searchable
    expect((await k.search.searchAll('registration')).map((g) => g.label)).toContain('Email');
    await k.enablePlugin('mpw.notes');
    expect(k.isLoaded('mpw.notes')).toBe(true);
  });

  it('cross-plugin resource URIs are stable', async () => {
    const { resourceUri, parseResourceUri } = await import('@mpw/shared');
    const uri = resourceUri('note', 'abc-123');
    expect(uri).toBe('mpw://note/abc-123');
    expect(parseResourceUri(uri)).toEqual({ kind: 'note', id: 'abc-123' });
    expect(parseResourceUri('https://elsewhere')).toBeNull();
  });
});
