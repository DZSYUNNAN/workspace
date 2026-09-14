export type PaperTask = 'zh-en' | 'en-zh' | 'polish' | 'review' | 'structure' | 'rewrite';

export const PAPER_AI_ACTIONS: { id: PaperTask; label: string; icon: string }[] = [
  { id: 'zh-en', label: '中译英', icon: 'link' },
  { id: 'en-zh', label: '英译中', icon: 'link' },
  { id: 'polish', label: '学术润色', icon: 'sparkles' },
  { id: 'review', label: '审稿风险检查', icon: 'search' },
  { id: 'structure', label: '解释论文结构', icon: 'book' },
  { id: 'rewrite', label: '章节改写', icon: 'pen' },
];

export function buildPaperAiRequest(task: PaperTask, instruction: string, selection: string, source: string): { prompt: string; system: string } {
  const input = instruction.trim() || selection.trim() || source.slice(0, 45_000);
  const systems: Record<PaperTask, string> = {
    'zh-en': '将中文学术文本翻译为可投稿的英文。保留技术术语、公式、引用和 LaTeX 命令，只输出译文。',
    'en-zh': '将英文学术文本准确翻译为中文。保留技术含义、公式、引用和 LaTeX 命令，只输出译文。',
    polish: '润色学术文本，使表达简洁、严谨、连贯；不要增加未经支持的结论。先给可直接使用的版本，再列简短修改说明。',
    review: '以严格审稿人视角检查创新性表述、证据缺口、实验不足、引用缺口和 LaTeX 呈现问题，按优先级给出可执行建议。',
    structure: '解释这份 LaTeX 论文的章节结构、论证链、已有优势、缺失证据和下一步修改顺序。不要修改源码。',
    rewrite: '根据用户要求改写选中章节。返回可直接替换到 paper.tex 的完整 LaTeX 片段，不要使用 Markdown 代码围栏，不要虚构实验或引用。',
  };
  const prompt = task === 'review' || task === 'structure'
    ? `${instruction.trim()}\n\n当前 paper.tex：\n${source.slice(0, 45_000)}`
    : task === 'rewrite'
      ? `改写要求：${instruction.trim() || '提高逻辑、严谨性和可读性'}\n\n待改写内容：\n${selection.trim() || source.slice(0, 45_000)}`
      : input;
  return { prompt, system: systems[task] };
}

export function buildPaperActionPrompt(task: PaperTask, selection: string, contextText: string): string {
  const request = buildPaperAiRequest(task, '', selection, contextText);
  return `${request.system}\n\n${request.prompt}`;
}
