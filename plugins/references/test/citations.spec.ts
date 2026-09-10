import { describe, expect, it } from 'vitest';
import { formatApa, formatBibtex, formatCitation, formatGbt7714, formatIeee, type CitationRecord } from '../src/citations';

const rec: CitationRecord = {
  citationKey: 'okafor2026fusion',
  entryType: 'article',
  title: 'Infrared and Visible Image Fusion via Cross-Attention Networks',
  authors: [
    { family: 'Okafor', given: 'Chidi' },
    { family: 'Lin', given: 'Wei' },
    { family: 'Tanaka', given: 'Ken' },
    { family: 'Smith', given: 'Ada' },
  ],
  venue: 'Information Fusion',
  year: 2026,
  doi: '10.1000/fusion.2026',
  volume: '97',
  number: '3',
  pages: '101–115',
  publisher: '',
};

describe('citation formatters', () => {
  it('formats IEEE', () => {
    const s = formatIeee(rec, 3);
    expect(s).toMatch(/^\[3\] C\. Okafor, W\. Lin, K\. Tanaka, A\. Smith, “.+,” \*Information Fusion\*, vol\. 97, no\. 3, pp\. 101–115, 2026, doi: 10\.1000\/fusion\.2026\.$/);
  });

  it('formats APA', () => {
    const s = formatApa(rec);
    expect(s).toContain('Okafor, C., & Lin, W.');
    expect(s).toContain('(2026)');
    expect(s).toContain('*Information Fusion*, 97(3)');
    expect(s).toContain('https://doi.org/10.1000/fusion.2026');
  });

  it('formats GB/T 7714 with et al after 3 authors', () => {
    const s = formatGbt7714(rec);
    expect(s).toContain('OKAFOR C, LIN W, TANAKA K, et al');
    expect(s).toContain('Information Fusion, 2026, 97(3): 101–115');
    expect(s).toContain('[J]');
  });

  it('round-trips to valid BibTeX', () => {
    const s = formatBibtex(rec);
    expect(s).toContain('@article{okafor2026fusion,');
    expect(s).toContain('author = {Okafor, Chidi and Lin, Wei and Tanaka, Ken and Smith, Ada}');
    expect(s.trim().endsWith('}')).toBe(true);
    expect((s.match(/,/g)?.length ?? 0) % 1).toBe(0);
  });

  it('dispatches through formatCitation', () => {
    expect(formatCitation('ieee', rec, 1)).toBe(formatIeee(rec, 1));
    expect(formatCitation('apa', rec)).toBe(formatApa(rec));
    expect(formatCitation('gbt7714', rec)).toBe(formatGbt7714(rec));
    expect(formatCitation('bibtex', rec)).toBe(formatBibtex(rec));
  });
});
