export type PaperTask =
  | 'free-output' | 'zh-en' | 'en-zh' | 'polish-en' | 'polish-zh' | 'review' | 'structure'
  | 'rewrite-all' | 'rewrite-abstract' | 'rewrite-introduction' | 'rewrite-related-work'
  | 'rewrite-method' | 'rewrite-experiments' | 'rewrite-conclusion' | 'rewrite';

export type PaperActionMode = 'input-first' | 'input-or-context' | 'context-with-instruction';

export interface PaperAiAction {
  id: PaperTask;
  label: string;
  icon: string;
  description: string;
  inputMode: PaperActionMode;
  insert: 'replace' | 'none';
}

export const PAPER_AI_ACTIONS: PaperAiAction[] = [
  { id: 'free-output', label: '自由指令', icon: 'sparkles', description: '执行输入区指令，结果只显示在对话中', inputMode: 'input-first', insert: 'none' },
  { id: 'zh-en', label: '中译英', icon: 'link', description: '翻译输入区中文学术文本', inputMode: 'input-first', insert: 'none' },
  { id: 'en-zh', label: '英译中', icon: 'link', description: '翻译输入区英文学术文本', inputMode: 'input-first', insert: 'none' },
  { id: 'polish-en', label: '学术英文润色', icon: 'sparkles', description: '润色输入区英文并给出修改说明', inputMode: 'input-first', insert: 'none' },
  { id: 'polish-zh', label: '中文学术润色', icon: 'sparkles', description: '润色输入区中文并给出修改说明', inputMode: 'input-first', insert: 'none' },
  { id: 'structure', label: '解释当前论文结构', icon: 'book', description: '读取当前 TeX 并说明结构、缺口和下一步修改', inputMode: 'context-with-instruction', insert: 'none' },
  { id: 'review', label: '审稿风险检查', icon: 'search', description: '优先检查输入区文本；输入为空时检查当前 TeX', inputMode: 'input-or-context', insert: 'none' },
  { id: 'rewrite-all', label: '一键写出全部章节', icon: 'pen', description: '按当前证据重写论文主要章节', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-abstract', label: '摘要', icon: 'pen', description: '重写摘要', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-introduction', label: '介绍', icon: 'pen', description: '重写 Introduction', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-related-work', label: '相关工作', icon: 'pen', description: '按技术主题组织相关工作', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-method', label: '方法', icon: 'pen', description: '重写方法与训练目标', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-experiments', label: '实验分析', icon: 'pen', description: '基于已有证据重写实验分析', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite-conclusion', label: '结论', icon: 'pen', description: '重写有边界的结论', inputMode: 'context-with-instruction', insert: 'replace' },
  { id: 'rewrite', label: '章节改写', icon: 'pen', description: '按输入区要求改写当前选区或章节', inputMode: 'context-with-instruction', insert: 'replace' },
];

const OUTPUT_TASKS: Partial<Record<PaperTask, { skill: string; task: string }>> = {
  'free-output': {
    skill: 'Use the most relevant available nature skill when useful.',
    task: "Respond to the user's instruction from the input area. If it asks for translation, polishing, explanation, critique, or drafting advice, produce a directly usable answer. For this send action, do not modify files; return the result in Markdown only.",
  },
  'zh-en': {
    skill: 'Use the nature-polishing skill.',
    task: "Translate the user's Chinese academic text into clear, publication-ready English. Preserve technical terms, equations, citations and LaTeX commands. Return only the translated text plus a short terminology note if needed.",
  },
  'en-zh': {
    skill: 'Use the nature-polishing skill.',
    task: "Translate the user's English academic text into accurate Chinese. Preserve technical meaning, citations, equations and LaTeX commands. Return only the translated text plus a short terminology note if needed.",
  },
  'polish-en': {
    skill: 'Use the nature-polishing skill.',
    task: "Polish the user's English academic prose toward a concise Nature-style register. Improve clarity, logic, grammar, and flow without adding unsupported claims. Return the polished paragraph first, followed by concise revision notes.",
  },
  'polish-zh': {
    skill: 'Use the nature-polishing skill.',
    task: "Polish the user's Chinese academic prose for clarity, rigor and concision. Preserve technical meaning and do not add unsupported claims. Return the polished Chinese text first, followed by concise revision notes.",
  },
};

const SECTION_TASKS: Partial<Record<PaperTask, { label: string; target: string; extra: string }>> = {
  'rewrite-all': { label: '全部章节', target: 'all major manuscript sections: abstract, introduction, related work, methodology, experiments, discussion if needed, and conclusion', extra: 'Rewrite the manuscript section by section. Preserve its LaTeX document structure and bibliography.' },
  'rewrite-abstract': { label: '摘要', target: 'the abstract environment', extra: 'Write a compact Nature-style technical abstract: context, gap, approach, strongest current evidence, implication, boundary.' },
  'rewrite-introduction': { label: '介绍', target: String.raw`\section{Introduction}`, extra: 'Use a controlled funnel: field need, bottleneck, prior attempts, unresolved gap, present study.' },
  'rewrite-related-work': { label: '相关工作', target: String.raw`\section{Related Work}`, extra: "Group prior work by technical topic, not paper-by-paper chronology. Connect each topic to the manuscript's stated gap." },
  'rewrite-method': { label: '方法', target: String.raw`\section{Methodology}`, extra: "Explain the manuscript's actual method components, their interaction, training objective, and implementation logic using only evidence present in the source." },
  'rewrite-experiments': { label: '实验分析', target: String.raw`\section{Experiments}`, extra: 'Use only available evidence and mark missing full comparisons or downstream results as bounded future additions.' },
  'rewrite-conclusion': { label: '结论', target: String.raw`\section{Conclusion}`, extra: 'Write a bounded conclusion: contribution, decisive current evidence, implication, limitation and next experiments.' },
  rewrite: { label: '当前章节', target: 'the selected or user-specified manuscript section', extra: 'Follow the user instruction while preserving technical meaning, citations, equations and LaTeX commands.' },
};

const clean = (value: string, limit = 45_000): string => value.trim().slice(0, limit);

export function buildPaperAiRequest(task: PaperTask, instruction: string, selection: string, source: string): { prompt: string; system: string } {
  const userText = clean(instruction) || clean(selection);
  const selectedText = clean(selection);
  const paper = clean(source);
  const output = OUTPUT_TASKS[task];
  if (output) {
    return {
      system: `${output.skill}\n\n${output.task}\n\nHard constraints:\n- Do not invent evidence, metrics, datasets, citations, or claims.\n- Preserve equations, citations and LaTeX commands exactly unless correction is requested.\n- Return a clean, directly usable answer.`,
      prompt: userText || 'No explicit input text was provided. Ask the user to paste the text in the input area.',
    };
  }
  if (task === 'structure') {
    return {
      system: 'Use the nature-writing skill. Explain the manuscript structure, current strengths, missing evidence, and concrete next edits. Do not invent evidence or modify the source.',
      prompt: `${userText ? `User focus:\n${userText}\n\n` : ''}Current paper.tex:\n${paper}`,
    };
  }
  if (task === 'review') {
    return {
      system: "Use the nature-writing skill. Audit the user's text or current paper.tex for high-impact-journal review risks: unsupported claims, missing experiments, unclear novelty, weak evidence, citation gaps and LaTeX presentation issues. Do not modify files. Return prioritized findings and suggested fixes.",
      prompt: userText || paper || 'No text is available. Ask the user to paste text or open a TeX document.',
    };
  }
  const section = SECTION_TASKS[task];
  if (!section) throw new Error(`Unknown paper task: ${task}`);
  return {
    system: `Use the nature-writing skill.\n\nRewrite ${section.target} as ready-to-paste LaTeX.\n\nRequirements:\n- Preserve valid LaTeX and the manuscript's existing document structure.\n- Base claims only on evidence in the supplied manuscript.\n- Do not invent experiments, statistical significance, datasets, metrics, citations, or SOTA claims.\n- Use cautious wording or explicit placeholders when evidence is missing.\n- Keep citations consistent with the existing bibliography.\n- ${section.extra}\n- Return the complete replacement LaTeX without a Markdown code fence, followed by a concise list of missing evidence if needed.`,
    prompt: `Requested section: ${section.label}\n\nUser notes:\n${userText || 'No additional user notes were provided.'}${selectedText ? `\n\nCurrent TeX selection:\n${selectedText}` : ''}\n\nCurrent paper.tex:\n${paper}`,
  };
}

export function buildPaperActionPrompt(task: PaperTask, primaryText: string, contextText: string): string {
  const request = buildPaperAiRequest(task, primaryText, '', contextText);
  return `${request.system}\n\n${request.prompt}`;
}
