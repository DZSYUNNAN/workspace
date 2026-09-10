/** Cross-plugin shared contracts (kept dependency-free: no React, no DOM APIs). */

export interface SearchHit {
  id: string;            // '<pluginId>:<type>:<entityId>'
  pluginId: string;
  type: string;          // 'note' | 'reference' | 'mail' | 'doc' | 'file' …
  title: string;
  snippet: string;
  icon?: string;
  score: number;
}

export interface ContextChunk {
  id: string;
  label: string;         // human-readable source label, e.g. "Note: Meeting notes"
  kind: 'text' | 'selection' | 'metadata';
  content: string;
  source: string;        // plugin id
}

export interface AiRunOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Context chunks gathered via ContextService, passed through to the provider. */
  context?: ContextChunk[];
}

export interface AiResult {
  text: string;
  provider: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** Stable cross-plugin resource identifiers (PLUGIN_SPEC §7). */
export type ResourceUri = `mpw://${string}/${string}`;

export function resourceUri(kind: string, id: string): ResourceUri {
  return `mpw://${kind}/${id}`;
}

export function parseResourceUri(uri: string): { kind: string; id: string } | null {
  const m = /^mpw:\/\/([a-z-]+)\/(.+)$/.exec(uri);
  return m ? { kind: m[1] as string, id: m[2] as string } : null;
}

/** Escape HTML for safe interpolation (used by all render paths before sanitization). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export interface AuthorRef {
  family?: string;
  given?: string;
  literal?: string;
}

export function formatAuthors(authors: AuthorRef[], max = 3): string {
  const names = authors.map((a) =>
    a.literal ?? [a.family, a.given].filter(Boolean).join(', ')
  );
  if (names.length <= max) return names.join('; ');
  return `${names.slice(0, max).join('; ')} et al.`;
}
