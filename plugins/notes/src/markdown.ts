import MarkdownIt from 'markdown-it';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { escapeHtml } from '@mpw/shared';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

interface Span {
  token: string;
  html: string;
}

/** Extract math spans ($$…$$, $…$) so markdown-it never sees them. */
function extractMath(src: string): { text: string; spans: Span[] } {
  const spans: Span[] = [];
  const store = (tex: string, display: boolean): string => {
    const token = `MPWMATH${spans.length}END`;
    let html: string;
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
    } catch {
      html = `<code>${escapeHtml(tex)}</code>`;
    }
    spans.push({ token, html });
    return token;
  };
  let text = src.replace(/```[\s\S]*?```|`[^`\n]*`/g, (code) => code.replace(/\$/g, 'MPWDOLLAR'));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => store(tex.trim(), true));
  text = text.replace(/(?<!\\)\$([^$\n]+?)\$(?!\d)/g, (_m, tex: string) => store(tex.trim(), false));
  return { text, spans };
}

function restore(text: string, spans: Span[]): string {
  let out = text;
  for (const s of spans) out = out.replace(s.token, s.html);
  return out.replace(/MPWDOLLAR/g, '$');
}

/**
 * Markdown → safe HTML. Pipeline: extract math → markdown-it (raw HTML
 * disabled) → sanitize → inject KaTeX + wikilink spans. Rendering is safe
 * against imported markdown by construction.
 */
export function renderMarkdown(src: string): string {
  const { text, spans } = extractMath(src);
  // [[WikiLinks]] stay as literal text through markdown-it (raw HTML disabled)
  // and are converted to interactive spans AFTER rendering + sanitization.
  const rendered = md.render(text);
  const safe = typeof window !== 'undefined' && DOMPurify.isSupported ? DOMPurify.sanitize(rendered) : rendered;
  let out = restore(safe, spans);
  out = out.replace(/\[\[([^\]<]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim();
    return `<span class="wikilink" data-target="${encodeURIComponent(t)}" style="color:var(--accent);cursor:pointer;text-decoration:underline dotted">${escapeHtml(label ?? t)}</span>`;
  });
  return out;
}
