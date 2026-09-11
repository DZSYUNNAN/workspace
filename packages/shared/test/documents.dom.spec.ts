import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { decodeDocument } from '../src/documents';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = () => zipSync({
  'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> Beta</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p><w:sectPr/></w:body></w:document>`),
  'word/media/image.png': new Uint8Array([1, 2, 3, 4]), 'word/styles.xml': strToU8('<styles>original</styles>'),
});
describe('local document codecs', () => {
  it('preserves UTF-8 BOM and Windows line endings', () => {
    const doc = decodeDocument('研究.md', new Uint8Array([239, 187, 191, ...strToU8('第一行\r\n第二行')]));
    expect(doc.blocks[0].text).toBe('第一行\n第二行');
    expect([...doc.encode(['新行\n第二行'])]).toEqual([...new Uint8Array([239, 187, 191, ...strToU8('新行\r\n第二行')])]);
  });
  it('preserves UTF-16 and rejects invalid text encodings', () => {
    const doc = decodeDocument('test.txt', new Uint8Array([255, 254, 65, 0]));
    expect([...doc.encode(['中'])]).toEqual([255, 254, 45, 78]);
    expect(() => decodeDocument('test.txt', new Uint8Array([255, 1]))).toThrow('编码');
    expect(() => decodeDocument('test.pdf', new Uint8Array())).toThrow('PDF');
  });
  it('edits Word paragraphs without rebuilding styles, tables or media', () => {
    const doc = decodeDocument('paper.docx', fixture());
    expect(doc.blocks.map((b) => b.editable)).toEqual([true, true, false]);
    const out = doc.encode(['Alpha new Beta', '新单元格', '']); const parts = unzipSync(out);
    const dom = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(dom.getElementsByTagNameNS(W, 'b')).toHaveLength(1);
    expect(dom.getElementsByTagNameNS(W, 'i')).toHaveLength(1);
    expect(dom.getElementsByTagNameNS(W, 'tbl')).toHaveLength(1);
    expect(dom.getElementsByTagNameNS(W, 'drawing')).toHaveLength(1);
    expect([...parts['word/media/image.png']]).toEqual([1, 2, 3, 4]);
    expect(strFromU8(parts['word/styles.xml'])).toBe('<styles>original</styles>');
    expect(decodeDocument('paper.docx', out).blocks.map((b) => b.text)).toEqual(['Alpha new Beta', '新单元格', '']);
  });
  it('round trips edits across runs, Unicode, newlines, tabs, deletion and empty paragraphs', () => {
    for (const text of ['A Beta', 'Hello', '', 'Alpha Beta!', '前缀Alpha Beta', 'Alpha\n新行\t😀 Beta']) {
      const doc = decodeDocument('paper.docx', fixture());
      expect(decodeDocument('paper.docx', doc.encode([text, 'Cell', ''])).blocks[0].text).toBe(text);
    }
  });
  it('refuses complex paragraph edits, signatures, protection and invalid archives', () => {
    const doc = decodeDocument('paper.docx', fixture()); expect(() => doc.encode(['Alpha Beta', 'Cell', 'replace drawing'])).toThrow('复杂');
    const parts = unzipSync(fixture()); parts['_xmlsignatures/sig.xml'] = strToU8('signature');
    expect(() => decodeDocument('paper.docx', zipSync(parts))).toThrow('签名');
    delete parts['_xmlsignatures/sig.xml']; parts['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}"><w:documentProtection/></w:settings>`);
    expect(() => decodeDocument('paper.docx', zipSync(parts))).toThrow('保护');
    expect(() => decodeDocument('paper.docx', strToU8('broken'))).toThrow();
  });
});
