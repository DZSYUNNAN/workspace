import { describe, expect, it } from 'vitest';
import { renderLatex } from '../src/latex';

describe('latex subset renderer', () => {
  it('renders title block, sections, formatting and math', () => {
    const src = `\\title{Multimodal Fusion}
\\author{W. Lin}
\\date{September 2026}
\\maketitle

\\section{Introduction}
Image fusion is \\textbf{important} and \\emph{delicate}. The weight is $\\alpha \\in [0,1]$.
\\subsection{Contributions}
We list them:
\\begin{itemize}
  \\item A unified \\textit{framework}
  \\item Strong results
\\end{itemize}

\\begin{equation}
  \\mathcal{L} = \\mathcal{L}_{task} + \\lambda \\mathcal{L}_{distill}
\\end{equation}`;
    const { html, errors } = renderLatex(src);
    expect(errors).toEqual([]);
    expect(html).toContain('<h1>Multimodal Fusion</h1>');
    expect(html).toContain('W. Lin · September 2026');
    expect(html).toContain('<h2>Introduction</h2>');
    expect(html).toContain('<b>important</b>');
    expect(html).toContain('<i>delicate</i>');
    expect(html).toContain('<h3>Contributions</h3>');
    expect(html).toContain('<ul>');
    expect(html).toContain('katex'); // both inline and display math
    expect(html).toContain('class="eq"');
  });

  it('renders tabular environments as tables', () => {
    const { html } = renderLatex(`\\begin{tabular}{l|c}
Method & PSNR \\\\
Ours & 42.1 \\\\
\\end{tabular}`);
    expect(html).toContain('<table');
    expect(html).toContain('PSNR');
    expect(html).toContain('42.1');
  });

  it('renders cite chips and figures', () => {
    const { html } = renderLatex(`As shown in \\cite{okafor2026fusion}.

\\begin{figure}
  \\includegraphics[width=0.8\\textwidth]{figs/arch.pdf}
  \\caption{Architecture overview}
\\end{figure}`);
    expect(html).toContain('[okafor2026fusion]');
    expect(html).toContain('[figure: figs/arch.pdf]');
    expect(html).toContain('Architecture overview');
  });

  it('collects unsupported commands into the error panel without crashing', () => {
    const { html, errors } = renderLatex('\\section{X}\n\\mysteriouscommand here');
    expect(html).toContain('X');
    expect(errors.join('\n')).toContain('mysteriouscommand');
  });

  it('strips comments', () => {
    const { html } = renderLatex('\\section{A} % a comment\nvisible');
    expect(html).not.toContain('comment');
    expect(html).toContain('visible');
  });
});
