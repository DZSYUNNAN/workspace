// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { copyChatText, resolveAiActionMaterial } from '../src/shell/AiPanel';

describe('shared AI panel actions', () => {
  it('uses composer text alone for input-first translation actions', () => {
    const material = resolveAiActionMaterial('input-first', '输入窗口文本', 'TeX 选区', '论文全文');
    expect(material).toEqual({ primaryText: '输入窗口文本', contextText: '', includeContext: false, hasRequiredInput: true });
  });

  it('falls back to the active paper only for actions designed to inspect context', () => {
    expect(resolveAiActionMaterial('input-or-context', '待检查段落', '', '论文全文')).toMatchObject({ primaryText: '待检查段落', includeContext: false });
    expect(resolveAiActionMaterial('input-or-context', '', '', '论文全文')).toMatchObject({ primaryText: '', contextText: '论文全文', includeContext: true });
    expect(resolveAiActionMaterial('context-with-instruction', '重写得更紧凑', '选中章节', '论文全文').contextText).toContain('选中章节');
  });

  it('copies the complete chat message through the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await copyChatText('完整 AI 回复');
    expect(writeText).toHaveBeenCalledWith('完整 AI 回复');
  });
});
