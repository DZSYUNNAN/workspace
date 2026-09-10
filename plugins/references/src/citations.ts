import type { AuthorRef } from '@mpw/shared';

/** Canonical in-plugin record shape used by formatters (DATABASE.md §3). */
export interface CitationRecord {
  citationKey: string;
  entryType: string;
  title: string;
  authors: AuthorRef[];
  venue: string;
  year: number | null;
  doi: string;
  volume: string;
  number: string;
  pages: string;
  publisher: string;
}

function surname(a: AuthorRef): string {
  return a.family ?? a.literal ?? '';
}

function initials(a: AuthorRef): string {
  if (a.literal) return a.literal;
  return (a.given ?? '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0]}.`)
    .join(' ');
}

/* --------------------------------- IEEE --------------------------------- */
export function formatIeee(r: CitationRecord, index = 1): string {
  const a = r.authors.map((x) => `${initials(x)} ${surname(x)}`).join(', ');
  const authors = a ? `${a}, ` : '';
  const venue = r.venue ? ` *${r.venue}*` : '';
  const vol = r.volume ? `, vol. ${r.volume}` : '';
  const num = r.number ? `, no. ${r.number}` : '';
  const pages = r.pages ? `, pp. ${r.pages}` : '';
  const year = r.year ?? 'n.d.';
  const doi = r.doi ? `, doi: ${r.doi}` : '';
  return `[${index}] ${authors}“${r.title},”${venue}${vol}${num}${pages}, ${year}${doi}.`;
}

/* ---------------------------------- APA ---------------------------------- */
export function formatApa(r: CitationRecord): string {
  const authors = r.authors
    .map((x) => (x.literal ? x.literal : `${surname(x)}, ${initials(x)}`))
    .join(', & ');
  const year = r.year ?? 'n.d.';
  const venue = r.venue ? ` *${r.venue}*${r.volume ? `, ${r.volume}` : ''}${r.number ? `(${r.number})` : ''}${r.pages ? `, ${r.pages}` : ''}` : '';
  const doi = r.doi ? ` https://doi.org/${r.doi}` : '';
  return `${authors}${authors ? ' ' : ''}(${year}). ${r.title}.${venue}.${doi}`;
}

/* -------------------------------- GB/T 7714 ------------------------------- */
export function formatGbt7714(r: CitationRecord): string {
  const authors = r.authors
    .map((x) => (x.literal ? x.literal.toUpperCase() : `${surname(x).toUpperCase()} ${initials(x).replace(/\./g, '').trim()}`))
    .slice(0, 3)
    .join(', ');
  const more = r.authors.length > 3 ? ', et al' : '';
  const kind = r.entryType === 'inproceedings' ? 'C' : r.entryType === 'book' ? 'M' : 'J';
  const venue = r.venue ? ` ${r.venue}` : '';
  const vol = r.volume ? `, ${r.volume}` : '';
  const num = r.number ? `(${r.number})` : '';
  const year = r.year ?? 'n.d.';
  const pages = r.pages ? `: ${r.pages}` : '';
  return `${authors}${more}. ${r.title}[${kind}].${venue}, ${year}${vol}${num}${pages}.`;
}

/* --------------------------------- BibTeX --------------------------------- */
function bibtexValue(s: string): string {
  return `{${s.replace(/[{}]/g, '')}}`;
}

export function formatBibtex(r: CitationRecord): string {
  const lines: string[] = [];
  lines.push(`@${r.entryType}{${r.citationKey || 'unnamed'},`);
  if (r.title) lines.push(`  title = ${bibtexValue(r.title)},`);
  if (r.authors.length > 0) {
    const a = r.authors.map((x) => (x.literal ? x.literal : `${x.family}, ${x.given ?? ''}`)).join(' and ');
    lines.push(`  author = ${bibtexValue(a)},`);
  }
  if (r.venue) lines.push(`  ${r.entryType === 'inproceedings' ? 'booktitle' : 'journal'} = ${bibtexValue(r.venue)},`);
  if (r.year) lines.push(`  year = ${bibtexValue(String(r.year))},`);
  if (r.volume) lines.push(`  volume = ${bibtexValue(r.volume)},`);
  if (r.number) lines.push(`  number = ${bibtexValue(r.number)},`);
  if (r.pages) lines.push(`  pages = ${bibtexValue(r.pages)},`);
  if (r.publisher) lines.push(`  publisher = ${bibtexValue(r.publisher)},`);
  if (r.doi) lines.push(`  doi = ${bibtexValue(r.doi)},`);
  // drop trailing comma on the last line
  const last = lines[lines.length - 1] as string;
  lines[lines.length - 1] = last.endsWith(',') ? last.slice(0, -1) : last;
  lines.push('}');
  return lines.join('\n');
}

export type CitationStyle = 'bibtex' | 'ieee' | 'apa' | 'gbt7714';

export function formatCitation(style: CitationStyle, r: CitationRecord, index = 1): string {
  switch (style) {
    case 'bibtex':
      return formatBibtex(r);
    case 'ieee':
      return formatIeee(r, index);
    case 'apa':
      return formatApa(r);
    case 'gbt7714':
      return formatGbt7714(r);
  }
}
