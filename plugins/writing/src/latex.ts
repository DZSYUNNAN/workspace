import katex from 'katex';
import { escapeHtml } from '@mpw/shared';

/**
 * LaTeX subset preview renderer (Mode B). This is NOT a TeX engine — it is a
 * fast offline approximation for the editor's live preview. Real compilation
 * (XeLaTeX/LuaLaTeX/pdfLaTeX) goes through the LatexCompiler adapter in the
 * Tauri shell (ROADMAP Phase 2); the interface is identical.
 */
export interface LatexRenderResult {
  html: string;
  errors: string[];
}

function katexHtml(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

const COMMANDS = ['textbf', 'textit', 'emph', 'underline', 'texttt'];

function inline(s: string): string {
  let out = escapeHtml(s);
  // math spans first
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => katexHtml(tex, true));
  out = out.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => katexHtml(tex, false));
  for (const cmd of COMMANDS) {
    const re = new RegExp(`\\\\${cmd}\\{([^{}]*)\\}`, 'g');
    out = out.replace(re, (_m, arg: string) => {
      if (cmd === 'textbf') return `<b>${arg}</b>`;
      if (cmd === 'textit' || cmd === 'emph') return `<i>${arg}</i>`;
      if (cmd === 'underline') return `<u>${arg}</u>`;
      return `<code>${arg}</code>`;
    });
  }
  out = out.replace(/\\cite\{([^}]*)\}/g, '<span class="cite-chip" style="color:var(--accent);font-size:11px">[$1]</span>');
  out = out.replace(/\\(ref|label|eqref)\{([^}]*)\}/g, '<span style="color:var(--text-3);font-size:11px">$1:$2</span>');
  out = out.replace(/~/g, ' ');
  return out;
}

export function renderLatex(src: string): LatexRenderResult {
  const errors: string[] = [];
  const lines = src.split('\n');
  const meta = { title: '', author: '', date: '' };
  let body = src;
  // comments (naive: unescaped % to end of line)
  body = body
    .split('\n')
    .map((l) => l.replace(/(?<!\\)%.*$/, ''))
    .join('\n');
  for (const [k, cmd] of [['title', 'title'], ['author', 'author'], ['date', 'date']] as const) {
    const m = new RegExp(`\\\\${cmd}\\{([^}]*)\\}`).exec(body);
    if (m) {
      meta[k] = (m[1] as string) ?? '';
      if (k !== 'title') body = body.replace(new RegExp(`\\\\${cmd}\\{[^}]*\\}`, 'g'), '');
    }
  }
  body = body.replace(/\\maketitle/g, '');
  body = body.replace(/\\newpage/g, '<hr style="border:none;border-top:1px dashed #bbb;margin:24px 0"/>');
  body = body.replace(/\\clearpage/g, '');

  // environments: equation/align/abstract/itemize/enumerate/tabular/figure/quote
  const envHtml: string[] = [];
  const takeEnv = (name: string, builder: (content: string) => string): string => {
    const re = new RegExp(`\\\\begin\\{${name}\\}([\\s\\S]*?)\\\\end\\{${name}\\}`, 'g');
    body = body.replace(re, (_m, content: string) => {
      const token = `MPWENV${envHtml.length}END`;
      envHtml.push(builder(content));
      return token;
    });
    return name;
  };

  takeEnv('equation', (c) => `<div class="eq">${katexHtml(c.trim(), true)}</div>`);
  takeEnv('align', (c) => `<div class="eq">${katexHtml(c.replace(/&|\\\\/g, ' ').trim(), true)}</div>`);
  takeEnv('abstract', (c) => `<blockquote style="margin:1em 2em;font-size:0.92em"><b>Abstract</b> — ${inline(c.trim())}</blockquote>`);
  takeEnv('quote', (c) => `<blockquote>${inline(c.trim())}</blockquote>`);
  takeEnv('itemize', (c) => {
    const items = c.split(/\\item/).slice(1).map((i) => `<li>${inline(i.trim())}</li>`);
    return `<ul>${items.join('')}</ul>`;
  });
  takeEnv('enumerate', (c) => {
    const items = c.split(/\\item/).slice(1).map((i) => `<li>${inline(i.trim())}</li>`);
    return `<ol>${items.join('')}</ol>`;
  });
  takeEnv('tabular', (c) => {
    const content = c.replace(/^\{[^}]*\}/, ''); // column spec
    const rows = content.split(/\\\\/).map((r) => r.trim()).filter(Boolean);
    const trs = rows.map((row, ri) => {
      const cells = row.split('&').map((cell) => `<td style="border:1px solid #999;padding:2px 10px">${inline(cell.trim())}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<table style="border-collapse:collapse;margin:1em auto"><tbody>${trs.join('')}</tbody></table>`;
  });
  takeEnv('figure', (c) => {
    const g = /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/.exec(c);
    const cap = /\\caption\{([^}]*)\}/.exec(c);
    return `<figure><div style="border:1.5px dashed #999;color:#777;padding:34px;font-size:12px">[figure: ${g?.[1] ?? 'graphic'}]</div>${cap ? `<figcaption>Figure: ${escapeHtml(cap[1] ?? '')}</figcaption>` : ''}</figure>`;
  });

  // display math
  body = body.replace(/\\\[((?:.|\n)+?)\\\]/g, (_m, tex: string) => katexHtml(tex.trim(), true));
  body = body.replace(/\\\(((?:.|\n)+?)\\\)/g, (_m, tex: string) => katexHtml(tex.trim(), false));

  // sections + paragraphs, line-based
  const html: string[] = [];
  if (meta.title || meta.author) {
    html.push(`<h1>${escapeHtml(meta.title)}</h1>`);
    if (meta.author || meta.date) {
      html.push(`<p style="text-align:center;color:#555">${escapeHtml([meta.author, meta.date].filter(Boolean).join(' · '))}</p>`);
    }
  }
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) {
      html.push(`<p>${inline(para.join(' ').trim())}</p>`);
      para = [];
    }
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const sec = /\\(section|subsection|subsubsection)\{(.*)\}\s*$/.exec(line);
    if (sec) {
      flush();
      const level = sec[1] === 'section' ? 2 : sec[1] === 'subsection' ? 3 : 4;
      html.push(`<h${level}>${inline(sec[2] ?? '')}</h${level}>`);
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();

  let out = html.join('\n');
  out = out.replace(/MPWENV(\d+)END/g, (_m, i: string) => envHtml[parseInt(i, 10)] ?? '');

  // unknown commands → error panel
  for (const m of body.matchAll(/\\([a-zA-Z]+)\s*[{\s]/g)) {
    const cmd = m[1] as string;
    if (!KNOWN.has(cmd)) errors.push(`unsupported command \\${cmd} (preview approximation)`);
  }
  void lines;
  return { html: out, errors: [...new Set(errors)].slice(0, 8) };
}

const KNOWN = new Set([
  'title', 'author', 'date', 'maketitle', 'section', 'subsection', 'subsubsection',
  'begin', 'end', 'item', 'cite', 'ref', 'eqref', 'label', 'includegraphics', 'caption',
  'textbf', 'textit', 'emph', 'underline', 'texttt', 'newpage', 'clearpage',
  'usepackage', 'documentclass', 'left', 'right', 'center', 'dot', 'alpha', 'beta', 'gamma',
  'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'omega', 'phi', 'sum', 'prod',
  'int', 'frac', 'sqrt', 'in', 'notin', 'leq', 'geq', 'neq', 'approx', 'times', 'cdot',
  'rightarrow', 'leftarrow', 'Rightarrow', 'infty', 'partial', 'nabla', 'mathbf', 'mathrm',
  'mathcal', 'hline', 'toprule', 'midrule', 'bottomrule', 'input', 'bibliography', 'bibliographystyle',
]);
