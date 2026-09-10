/**
 * Mode A export: editor HTML → .docx via the `docx` library (PRODUCT_SPEC §8:
 * "use appropriate existing DOCX libraries instead of reimplementing Word").
 * Block-level mapping: h1–h3, p, ul/ol, blockquote, table; inline: b/i/u, spans.
 */

interface Run {
  text: string;
  bold: boolean;
  italics: boolean;
  underline: boolean;
}

function runsFromElement(el: Element, inherit: Partial<Run> = {}): Run[] {
  const runs: Run[] = [];
  const walk = (node: Node, style: Partial<Run>): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) {
        runs.push({
          text,
          bold: style.bold ?? false,
          italics: style.italics ?? false,
          underline: style.underline ?? false,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const next: Partial<Run> = { ...style };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italics = true;
    if (tag === 'u') next.underline = true;
    for (const child of Array.from(el.childNodes)) walk(child, next);
  };
  walk(el, inherit);
  return runs;
}

function blocks(root: Element): { kind: string; el: Element; level?: number }[] {
  const out: { kind: string; el: Element; level?: number }[] = [];
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) out.push({ kind: 'heading', el: child, level: parseInt(tag.slice(1), 10) });
    else if (tag === 'ul' || tag === 'ol') {
      for (const li of Array.from(child.children)) out.push({ kind: tag, el: li });
    } else if (tag === 'table') {
      out.push({ kind: 'table', el: child });
    } else if (tag === 'p' || tag === 'div' || tag === 'blockquote') {
      out.push({ kind: tag === 'div' ? 'p' : tag, el: child });
    } else if (tag === 'br') {
      out.push({ kind: 'p', el: child });
    } else {
      out.push({ kind: 'p', el: child });
    }
  }
  return out;
}

export async function htmlToDocxBlob(html: string, title: string): Promise<Blob> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } = docx;
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const root = dom.body;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];
  const alignments: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  };

  for (const block of blocks(root)) {
    if (block.kind === 'table') {
      const rows: InstanceType<typeof TableRow>[] = [];
      for (const tr of Array.from(block.el.querySelectorAll('tr'))) {
        const cells = Array.from(tr.children).map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: runsFromElement(cell).map(
                    (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, underline: {} })
                  ),
                }),
              ],
            })
        );
        if (cells.length > 0) rows.push(new TableRow({ children: cells }));
      }
      if (rows.length > 0) {
        children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      }
      continue;
    }
    const align = (block.el as HTMLElement).style?.textAlign;
    const alignMap: Record<string, string> = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
    const heading =
      block.kind === 'heading'
        ? block.level === 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3
        : undefined;
    const runs = runsFromElement(block.el);
    if (block.kind === 'ul') {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, underline: r.underline ? {} : undefined })),
        })
      );
      continue;
    }
    if (block.kind === 'ol') {
      children.push(
        new Paragraph({
          numbering: { reference: 'mpw-ordered', level: 0 },
          children: runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, underline: r.underline ? {} : undefined })),
        })
      );
      continue;
    }
    children.push(
      new Paragraph({
        heading,
        alignment: align && alignMap[align] ? (alignMap[align] as never) : block.kind === 'blockquote' ? AlignmentType.JUSTIFIED : undefined,
        children:
          runs.length > 0
            ? runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, underline: r.underline ? {} : undefined }))
            : [new TextRun('')],
        ...(block.kind === 'blockquote' ? { indent: { left: 360 } } : {}),
      })
    );
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'mpw-ordered',
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [
      {
        properties: {},
        children: (children.length > 0 ? children : [new Paragraph(title)]) as never,
      },
    ],
  });
  return await Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
