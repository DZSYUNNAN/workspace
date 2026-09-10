import { describe, expect, it } from 'vitest';
import { LatexService, PreviewFallbackAdapter } from '@mpw/kernel';

describe('LaTeX 编译服务(Phase 2)', () => {
  it('Web 回退适配器给出诚实的结构化诊断', async () => {
    const svc = new LatexService({ begin: () => ({ id: 'x', setProgress: () => {}, finish: () => {} }), setNotifier: () => {}, list: () => [], count: () => 0 } as never);
    const res = await svc.compile({ source: '\\documentclass{article}\n\\begin{document}\nhi\\end{document}' });
    expect(res.ok).toBe(false);
    expect(res.via).toBe('preview');
    expect(res.log).toContain('Web');
  });

  it('检测缺失 documentclass 与环境不匹配', async () => {
    const a = new PreviewFallbackAdapter();
    const bad = await a.compile({ source: '\\section{X}\n\\begin{itemize}\nitem' });
    expect(bad.log).toContain('documentclass');
    expect(bad.log).toContain('不匹配');
  });

  it('自定义适配器可注册(桌面端注入点)', async () => {
    const svc = new LatexService({ begin: () => ({ id: 'x', setProgress: () => {}, finish: () => {} }), setNotifier: () => {}, list: () => [], count: () => 0 } as never);
    svc.register({
      engine: 'lualatex', available: true, via: 'native',
      async compile() { return { ok: true, pdfBytes: new Uint8Array([1, 2, 3]), log: 'ok', engine: 'lualatex', via: 'native' }; },
    });
    const res = await svc.compile({ source: 'x' });
    expect(res.ok).toBe(true);
    expect(res.via).toBe('native');
  });
});
