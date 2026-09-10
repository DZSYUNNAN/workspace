import type { AuthorRef } from '@mpw/shared';

export interface RawReference {
  entryType: string;
  citationKey: string;
  title: string;
  authors: AuthorRef[];
  venue: string;
  year: number | null;
  doi: string;
  abstract: string;
  keywords: string[];
  volume: string;
  number: string;
  pages: string;
  publisher: string;
}

function emptyRef(): RawReference {
  return {
    entryType: 'article',
    citationKey: '',
    title: '',
    authors: [],
    venue: '',
    year: null,
    doi: '',
    abstract: '',
    keywords: [],
    volume: '',
    number: '',
    pages: '',
    publisher: '',
  };
}

export function splitName(name: string): AuthorRef {
  const n = name.trim();
  if (!n) return { literal: '' };
  if (n.includes(',')) {
    const [family, given] = n.split(',');
    return { family: (family ?? '').trim(), given: (given ?? '').trim() };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { literal: n };
  return { family: parts[parts.length - 1] as string, given: parts.slice(0, -1).join(' ') };
}

function stripBraces(s: string): string {
  let out = s.trim();
  if (out.startsWith('{') && out.endsWith('}')) out = out.slice(1, -1);
  return out.replace(/\s+/g, ' ').replace(/[{}]/g, '').trim();
}

/** Balanced-brace reader for BibTeX values. */
function readBraced(src: string, start: number): { value: string; end: number } {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { value: src.slice(start + 1, i), end: i + 1 };
    }
    i++;
  }
  return { value: src.slice(start + 1), end: src.length };
}

/**
 * Parser for standard BibTeX entries (@article, @inproceedings, @book…).
 * Handles nested braces, quoted values, `and`-separated authors, months.
 */
export function parseBibtex(input: string): RawReference[] {
  const results: RawReference[] = [];
  const entryRe = /@(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(input)) !== null) {
    const type = (m[1] as string).toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    const braceStart = input.indexOf('{', m.index);
    if (braceStart < 0) continue;
    const { value: body, end } = readBraced(input, braceStart);
    entryRe.lastIndex = end;
    const comma = body.indexOf(',');
    const citationKey = (comma >= 0 ? body.slice(0, comma) : body).trim();
    const fieldsSrc = comma >= 0 ? body.slice(comma + 1) : '';
    const ref = emptyRef();
    ref.entryType = type === 'misc' ? 'misc' : type;
    ref.citationKey = citationKey;

    // split top-level commas (quote- and brace-aware)
    const fields: [string, string][] = [];
    let depth = 0;
    let inQuote = false;
    let cur = '';
    for (const ch of fieldsSrc) {
      if (ch === '"') {
        inQuote = !inQuote;
        cur += ch;
        continue;
      }
      if (!inQuote) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          fields.push(cur.includes('=') ? splitField(cur) : ['', cur]);
          cur = '';
          continue;
        }
      }
      cur += ch;
    }
    if (cur.trim()) fields.push(cur.includes('=') ? splitField(cur) : ['', cur]);

    for (const [name, rawValue] of fields) {
      const key = name.trim().toLowerCase();
      const value = stripBraces(rawValue.replace(/^"|"$/g, ''));
      switch (key) {
        case 'title':
          ref.title = value;
          break;
        case 'author':
        case 'authors':
          ref.authors = value.split(/\s+and\s+/).map(splitName);
          break;
        case 'journal':
        case 'booktitle':
          ref.venue = value;
          break;
        case 'year':
          ref.year = parseInt(value, 10) || null;
          break;
        case 'doi':
          ref.doi = value;
          break;
        case 'abstract':
        case 'summary':
          ref.abstract = value;
          break;
        case 'keywords':
          ref.keywords = value.split(/[;,]/).map((k) => k.trim()).filter(Boolean);
          break;
        case 'volume':
          ref.volume = value;
          break;
        case 'number':
          ref.number = value;
          break;
        case 'pages':
          ref.pages = value.replace(/--/g, '–');
          break;
        case 'publisher':
          ref.publisher = value;
          break;
      }
    }
    if (ref.title || ref.authors.length > 0) results.push(ref);
  }
  return results;

  function splitField(s: string): [string, string] {
    const eq = s.indexOf('=');
    return [s.slice(0, eq).trim(), s.slice(eq + 1).trim()];
  }
}

/** Parser for RIS (Web of Science / EndNote) exports. */
export function parseRis(input: string): RawReference[] {
  const results: RawReference[] = [];
  let ref: RawReference | null = null;
  let lastTag = '';
  for (const line of input.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!m) {
      if (ref && lastTag && line.trim()) appendValue(ref, lastTag, line.trim());
      continue;
    }
    const tag = m[1] as string;
    const value = (m[2] as string).trim();
    if (tag === 'TY') {
      ref = emptyRef();
      ref.entryType = value.toLowerCase().includes('conf') ? 'inproceedings' : value === 'BOOK' ? 'book' : 'article';
      continue;
    }
    if (!ref) continue;
    if (tag === 'ER') {
      if (ref.title || ref.authors.length > 0) {
        if (!ref.citationKey) ref.citationKey = makeCitationKey(ref);
        results.push(ref);
      }
      ref = null;
      lastTag = '';
      continue;
    }
    lastTag = tag;
    appendValue(ref, tag, value);
  }
  return results;
}

function appendValue(ref: RawReference, tag: string, value: string): void {
  switch (tag) {
    case 'TI':
    case 'TT':
      ref.title = ref.title ? ref.title : value;
      break;
    case 'AU':
      ref.authors.push(splitName(value));
      break;
    case 'JO':
    case 'T2':
    case 'JA':
      ref.venue = ref.venue || value;
      break;
    case 'PY':
    case 'Y1':
      ref.year = parseInt(value.slice(0, 4), 10) || ref.year;
      break;
    case 'DO':
      ref.doi = ref.doi || value;
      break;
    case 'AB':
    case 'N2':
      ref.abstract = ref.abstract ? `${ref.abstract} ${value}` : value;
      break;
    case 'KW':
      ref.keywords.push(value);
      break;
    case 'VL':
      ref.volume = value;
      break;
    case 'IS':
      ref.number = value;
      break;
    case 'SP':
      ref.pages = value;
      break;
    case 'PB':
      ref.publisher = value;
      break;
  }
}

export function makeCitationKey(ref: RawReference): string {
  const family = ref.authors[0]?.family ?? ref.authors[0]?.literal ?? 'unknown';
  const year = ref.year ?? 'nd';
  const titleWord = (ref.title.split(/\s+/)[0] ?? 'title').replace(/[^a-zA-Z]/g, '');
  return `${family.toLowerCase()}${year}${titleWord.toLowerCase()}`;
}

/** DOI metadata via Crossref. Failure returns a descriptive error (offline-first safe). */
export async function fetchDoi(doi: string): Promise<RawReference> {
  const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`);
  if (!res.ok) throw new Error(`Crossref lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    message: {
      title?: string[];
      author?: { family?: string; given?: string; name?: string }[];
      'container-title'?: string[];
      published?: { 'date-parts'?: number[][] };
      DOI?: string;
      abstract?: string;
      volume?: string;
      issue?: string;
      page?: string;
      publisher?: string;
    };
  };
  const msg = data.message;
  const ref = emptyRef();
  ref.entryType = 'article';
  ref.title = (msg.title ?? [''])[0] ?? '';
  ref.authors = (msg.author ?? []).map((a) =>
    a.name ? { literal: a.name } : { family: a.family, given: a.given }
  );
  ref.venue = (msg['container-title'] ?? [])[0] ?? '';
  ref.year = msg.published?.['date-parts']?.[0]?.[0] ?? null;
  ref.doi = msg.DOI ?? clean;
  ref.abstract = (msg.abstract ?? '').replace(/<[^>]+>/g, '');
  ref.volume = msg.volume ?? '';
  ref.number = msg.issue ?? '';
  ref.pages = msg.page ?? '';
  ref.publisher = msg.publisher ?? '';
  ref.citationKey = makeCitationKey(ref);
  return ref;
}
