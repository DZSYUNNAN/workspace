import { decodeDocument, type EditableDocument } from './documents';
export interface LocalFile { id: string; name: string; path: string; bytes: Uint8Array; stamp: string }
export type TexEngine = 'xelatex' | 'lualatex' | 'pdflatex';
export interface LocalTexResult { ok: boolean; pdfBase64?: string | null; log: string }
export interface LocalFileAdapter {
  open(): Promise<LocalFile | null>;
  read(id: string): Promise<LocalFile>;
  write(id: string, bytes: Uint8Array, expected: string): Promise<string>;
  compile?(id: string, source: string, engine: TexEngine, expected: string): Promise<LocalTexResult>;
}
export class LocalDocumentSession {
  codec: EditableDocument;
  texts: string[];
  phase: 'saved' | 'saving' | 'error' = 'saved';
  error = '';
  private revision = 0; private committed = 0; private pending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(public file: LocalFile, private adapter: LocalFileAdapter, private changed: () => void) {
    this.codec = decodeDocument(file.name, file.bytes); this.texts = this.codec.blocks.map((b) => b.text);
  }
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private notify(): void { this.listeners.forEach((fn) => fn()); this.changed(); }
  edit(index: number, text: string): void {
    if (!this.codec.blocks[index]?.editable) return;
    this.texts = this.texts.map((v, i) => i === index ? text : v); this.revision++;
    // An external conflict stays paused until an explicit retry/reload.
    if (this.phase !== 'error') { this.phase = 'saving'; clearTimeout(this.timer); this.timer = setTimeout(() => void this.flush().catch(() => {}), 450); }
    this.notify();
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (this.revision === this.committed) return;
    this.phase = 'saving'; this.error = ''; this.notify();
    this.pending = Promise.resolve().then(async () => {
      while (this.revision !== this.committed) {
        const revision = this.revision; const bytes = this.codec.encode(this.texts);
        this.file.stamp = await this.adapter.write(this.file.id, bytes, this.file.stamp);
        this.committed = revision;
      }
      this.phase = 'saved';
    }).catch((e: unknown) => { this.phase = 'error'; this.error = String(e instanceof Error ? e.message : e); throw e; })
      .finally(() => { this.pending = null; this.notify(); });
    return this.pending;
  }
  async reload(): Promise<void> {
    clearTimeout(this.timer); if (this.pending) await this.pending.catch(() => {});
    const file = await this.adapter.read(this.file.id); const codec = decodeDocument(file.name, file.bytes);
    this.file = file; this.codec = codec; this.texts = codec.blocks.map((b) => b.text);
    this.revision = this.committed = 0; this.phase = 'saved'; this.error = ''; this.notify();
  }
  snapshot(): Uint8Array { return this.codec.encode(this.texts); }
  async compile(engine: TexEngine): Promise<LocalTexResult> {
    if (!this.file.name.toLowerCase().endsWith('.tex')) throw new Error('请打开 LaTeX 主文件（.tex）');
    if (!this.adapter.compile) throw new Error('本地 TeX 编译需要 Windows 桌面版和 TeX Live / MiKTeX');
    await this.flush();
    return this.adapter.compile(this.file.id, this.texts[0], engine, this.file.stamp);
  }
  async stop(): Promise<void> { clearTimeout(this.timer); if (this.pending) await this.pending.catch(() => {}); clearTimeout(this.timer); }
}
export class LocalDocuments {
  sessions: LocalDocumentSession[] = [];
  private listeners = new Set<() => void>();
  constructor(private adapter: LocalFileAdapter) {}
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private notify = (): void => { this.listeners.forEach((fn) => fn()); };
  get unsaved(): boolean { return this.sessions.some((s) => s.phase !== 'saved'); }
  async open(): Promise<LocalDocumentSession | null> {
    const file = await this.adapter.open(); if (!file) return null;
    const found = this.sessions.find((s) => s.file.id === file.id); if (found) return found;
    const session = new LocalDocumentSession(file, this.adapter, this.notify); this.sessions = [...this.sessions, session]; this.notify(); return session;
  }
  async flush(): Promise<void> {
    const results = await Promise.allSettled(this.sessions.map((s) => s.flush()));
    const failed = results.find((r) => r.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  }
  async detach(session: LocalDocumentSession): Promise<void> {
    await session.stop(); this.sessions = this.sessions.filter((s) => s !== session); this.notify();
  }
}
