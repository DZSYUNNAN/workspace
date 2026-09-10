import { describe, expect, it } from 'vitest';
import { parseBibtex, parseRis, makeCitationKey } from '../src/parsers';

const BIB = `
@article{okafor2026fusion,
  title = {Infrared and Visible Image Fusion via {Cross-Attention} Networks},
  author = {Okafor, Chidi and Lin, Wei and Tanaka, Ken},
  journal = {Information Fusion},
  year = {2026},
  volume = {97},
  number = {3},
  pages = {101--115},
  doi = {10.1000/fusion.2026},
  keywords = {fusion, infrared},
  abstract = {A study of fusion.}
}

@inproceedings{smith2024distill,
  title = "Distilling Vision Transformers",
  author = "Smith, Ada",
  booktitle = "CVPR",
  year = 2024
}`;

const RIS = `TY  - JOUR
TI  - Deep Learning for Image Fusion
AU  - Kim, Minjun
AU  - Rossi, Elena
JO  - Pattern Recognition
PY  - 2025
DO  - 10.1000/pr.2025
AB  - A survey of fusion methods.
KW  - deep learning
KW  - fusion
VL  - 120
IS  - 2
SP  - 55
ER  -`;

describe('BibTeX parser', () => {
  it('parses entries with nested braces and full metadata', () => {
    const refs = parseBibtex(BIB);
    expect(refs).toHaveLength(2);
    const first = refs[0]!;
    expect(first.entryType).toBe('article');
    expect(first.citationKey).toBe('okafor2026fusion');
    expect(first.title).toBe('Infrared and Visible Image Fusion via Cross-Attention Networks');
    expect(first.authors).toEqual([
      { family: 'Okafor', given: 'Chidi' },
      { family: 'Lin', given: 'Wei' },
      { family: 'Tanaka', given: 'Ken' },
    ]);
    expect(first.year).toBe(2026);
    expect(first.volume).toBe('97');
    expect(first.pages).toBe('101–115');
    expect(first.keywords).toEqual(['fusion', 'infrared']);
  });

  it('maps booktitle to venue for inproceedings', () => {
    const refs = parseBibtex(BIB);
    const second = refs[1]!;
    expect(second.entryType).toBe('inproceedings');
    expect(second.venue).toBe('CVPR');
    expect(second.year).toBe(2024);
  });

  it('ignores @comment/@string/@preamble and survives empty input', () => {
    expect(parseBibtex('@comment{hi} @string{x = "{y}"}')).toHaveLength(0);
    expect(parseBibtex('')).toHaveLength(0);
  });
});

describe('RIS parser', () => {
  it('parses records with multi-value authors and keywords', () => {
    const refs = parseRis(RIS);
    expect(refs).toHaveLength(1);
    const r = refs[0]!;
    expect(r.title).toBe('Deep Learning for Image Fusion');
    expect(r.authors).toEqual([
      { family: 'Kim', given: 'Minjun' },
      { family: 'Rossi', given: 'Elena' },
    ]);
    expect(r.venue).toBe('Pattern Recognition');
    expect(r.year).toBe(2025);
    expect(r.keywords).toEqual(['deep learning', 'fusion']);
    expect(r.pages).toBe('55');
  });

  it('returns nothing for garbage input', () => {
    expect(parseRis('not an ris file at all\njust text')).toHaveLength(0);
  });
});

describe('citation keys', () => {
  it('derives family+year+firstword keys', () => {
    expect(makeCitationKey({ ...(parseBibtex(BIB)[0]!) })).toBe('okafor2026infrared');
  });
});
