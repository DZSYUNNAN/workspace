import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.md,.markdown,.txt,.tex,.bib,.html,.htm,.rtf';
export const EDITABLE_EXTENSIONS = ['md', 'markdown', 'txt', 'tex', 'bib', 'html', 'htm', 'docx'];
export const extension = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';
export function documentMime(name: string): string {
  return ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', rtf: 'application/rtf' } as Record<string, string>)[extension(name)] ?? 'text/plain';
}
export interface DocumentBlock { text: string; editable: boolean }
export interface EditableDocument {
  kind: 'text' | 'docx'; blocks: DocumentBlock[];
  encode(texts: string[]): Uint8Array;
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (text: string): XMLDocument => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持包含实体声明的 Word 文档');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Word 文档结构损坏');
  return doc;
};
const wordElements = (el: Element, name: string): Element[] => [...el.getElementsByTagNameNS(W, name)];
const tokens = (p: Element): Element[] => [...p.getElementsByTagNameNS(W, '*')].filter((e) => ['t', 'tab', 'br', 'cr'].includes(e.localName));
const tokenText = (e: Element): string => e.localName === 't' ? e.textContent ?? '' : e.localName === 'tab' ? '\t' : '\n';

/** Patch only the changed text range. Retain run styles, paragraph properties and all other ZIP parts. */
function patchParagraph(p: Element, next: string): void {
  const nodes = tokens(p); const old = nodes.map(tokenText).join('');
  if (old === next) return;
  let start = 0; while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = old.length; let nextEnd = next.length;
  while (end > start && nextEnd > start && old[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  const inserted = next.slice(start, nextEnd); let offset = 0; let placed = false;
  const fragment = (text: string): DocumentFragment => {
    const f = p.ownerDocument.createDocumentFragment();
    for (const chunk of text.split(/([\n\t])/)) {
      if (!chunk) continue;
      const e = p.ownerDocument.createElementNS(W, chunk === '\n' ? 'w:br' : chunk === '\t' ? 'w:tab' : 'w:t');
      if (e.localName === 't') { e.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); e.textContent = chunk; }
      f.append(e);
    }
    return f;
  };
  for (const node of nodes) {
    const value = tokenText(node); const from = offset; const to = from + value.length; offset = to;
    if (to < start || from > end) continue;
    let text = value.slice(0, Math.max(0, start - from));
    if (!placed && from <= start && to >= start) { text += inserted; placed = true; }
    text += value.slice(Math.max(0, end - from));
    if (text !== value || node.localName !== 't') node.replaceWith(fragment(text));
  }
  if (!placed) {
    const run = p.ownerDocument.createElementNS(W, 'w:r'); run.append(fragment(inserted)); p.append(run);
  }
}

export function decodeDocument(name: string, bytes: Uint8Array): EditableDocument {
  if (bytes.length > 32 * 1024 * 1024) throw new Error('可编辑文档上限为 32 MB');
  if (!EDITABLE_EXTENSIONS.includes(extension(name))) throw new Error('支持编辑 DOCX、Markdown、TXT、TeX、BibTeX 和 HTML；旧版 DOC 请先另存为 DOCX，PDF 请在文献库阅读。');
  if (extension(name) !== 'docx') {
    const utf16 = bytes[0] === 255 && bytes[1] === 254;
    const be = bytes[0] === 254 && bytes[1] === 255;
    const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
    let text: string;
    try { text = new TextDecoder(utf16 ? 'utf-16le' : be ? 'utf-16be' : 'utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('文本编码无法识别，请先另存为 UTF-8 或带 BOM 的 UTF-16'); }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return { kind: 'text', blocks: [{ text: text.replace(/\r\n/g, '\n'), editable: true }], encode: ([value]) => {
      const normalized = value.replace(/\r\n/g, '\n').replace(/\n/g, eol);
      if (!utf16 && !be) { const data = strToU8(normalized); return bom ? new Uint8Array([239, 187, 191, ...data]) : data; }
      const out = new Uint8Array(2 + normalized.length * 2); out.set(utf16 ? [255, 254] : [254, 255]);
      const view = new DataView(out.buffer); for (let i = 0; i < normalized.length; i++) view.setUint16(2 + i * 2, normalized.charCodeAt(i), utf16);
      return out;
    } };
  }
  let size = 0;
  const parts = unzipSync(bytes, { filter: (f) => { size += f.originalSize; if (size > 64 * 1024 * 1024) throw new Error('Word 解压内容超过 64 MB'); return true; } });
  if (!parts['word/document.xml']) throw new Error('不是有效的 DOCX 文件');
  if (Object.keys(parts).some((n) => /_xmlsignatures|vbaProject/i.test(n))) throw new Error('不支持编辑签名或宏文档');
  const settings = parts['word/settings.xml'] ? xml(strFromU8(parts['word/settings.xml'])) : null;
  if (settings && (settings.getElementsByTagNameNS(W, 'documentProtection').length || settings.getElementsByTagNameNS(W, 'trackRevisions').length)) throw new Error('请先在 Word 中关闭文档保护/修订模式，再编辑');
  const source = strFromU8(parts['word/document.xml']); const dom = xml(source);
  const body = dom.getElementsByTagNameNS(W, 'body')[0]; if (!body) throw new Error('Word 正文缺失');
  const paragraphs = wordElements(body, 'p');
  const editable = (p: Element): boolean => {
    if (p.parentElement?.namespaceURI !== W || !['body', 'tc'].includes(p.parentElement.localName)) return false;
    return [...p.children].every((c) => c.namespaceURI === W && (c.localName === 'pPr' || c.localName === 'r' && [...c.children].every((r) => r.namespaceURI === W && ['rPr', 't', 'tab', 'br', 'cr'].includes(r.localName) && !(r.localName === 'br' && r.getAttributeNS(W, 'type') && r.getAttributeNS(W, 'type') !== 'textWrapping'))));
  };
  const blocks = paragraphs.map((p) => ({ text: tokens(p).map(tokenText).join(''), editable: editable(p) }));
  return { kind: 'docx', blocks, encode: (texts) => {
    if (texts.length !== blocks.length) throw new Error('Word 段落结构发生变化');
    const updated = xml(source); const ps = wordElements(updated.getElementsByTagNameNS(W, 'body')[0], 'p');
    texts.forEach((text, i) => { if (text !== blocks[i].text) { if (!blocks[i].editable) throw new Error('不能修改包含复杂对象的段落'); patchParagraph(ps[i], text); } });
    return zipSync({ ...parts, 'word/document.xml': strToU8(new XMLSerializer().serializeToString(updated)) });
  } };
}
