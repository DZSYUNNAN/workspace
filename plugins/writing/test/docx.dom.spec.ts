import { describe, expect, it } from 'vitest';

// jsdom environment (see vitest.config environmentMatchGlobs: *.dom.spec.ts)
import { htmlToDocxBlob } from '../src/docx';

describe('html → docx export (Mode A)', () => {
  it('produces a valid .docx (ZIP) blob from editor HTML', async () => {
    const html = `
      <h1>Fusion Paper</h1>
      <p style="text-align:center">By <b>Wei Lin</b> and <i>colleagues</i></p>
      <h2>Method</h2>
      <p>Plain <u>underlined</u> text.</p>
      <ul><li>bullet one</li><li>bullet two</li></ul>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    `;
    const blob = await htmlToDocxBlob(html, 'Fusion Paper');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(4000); // a docx zip with content parts
    // jsdom Blob lacks .arrayBuffer() — read magic bytes via FileReader
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blob);
    });
    const head = new Uint8Array(buf.slice(0, 2));
    expect([head[0], head[1]]).toEqual([0x50, 0x4b]); // ZIP magic "PK"
  });

  it('never produces an empty document', async () => {
    const blob = await htmlToDocxBlob('<p></p>', 'empty');
    expect(blob.size).toBeGreaterThan(4000);
  });
});
