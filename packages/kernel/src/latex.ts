/**
 * LaTeX compilation service (ROADMAP Phase 2).
 *  - Web 预览方案:fallback adapter,返回结构化错误(子集渲染器诊断)。
 *  - 桌面方案:Tauri shell 注入 native adapter(XeLaTeX / LuaLaTeX / pdfLaTeX),
 *    通过 `kernel.latex.register()` 在启动时替换。插件经 ctx.latex 调用,
 *    需要声明 'native' 权限。
 */
import type { BgTaskRegistry } from './bgtasks';

export type LatexEngine = 'xelatex' | 'lualatex' | 'pdflatex';

export interface LatexCompileRequest {
  source: string;
  engine?: LatexEngine;
  jobName?: string;
}

export interface LatexCompileResult {
  ok: boolean;
  pdfBytes: Uint8Array | null;
  log: string;
  engine: LatexEngine;
  /** where did this run: 'preview' (browser approximation) | 'native' (TeX toolchain) */
  via: 'preview' | 'native';
}

export interface LatexCompilerAdapter {
  readonly engine: LatexEngine;
  readonly available: boolean;
  readonly via: 'preview' | 'native';
  compile(req: LatexCompileRequest): Promise<LatexCompileResult>;
}

/** Browser fallback: honest failure with diagnostics — the preview renderer stays the visual tool. */
export class PreviewFallbackAdapter implements LatexCompilerAdapter {
  readonly engine: LatexEngine = 'xelatex';
  readonly available = false;
  readonly via = 'preview' as const;

  async compile(req: LatexCompileRequest): Promise<LatexCompileResult> {
    const problems: string[] = [];
    if (!/\\begin\{document\}/.test(req.source)) problems.push('缺少 \\begin{document}');
    if (!/\\documentclass/.test(req.source)) problems.push('缺少 \\documentclass');
    if (/\\includegraphics/.test(req.source)) problems.push('包含 \\includegraphics — 桌面端编译前请确认图片路径');
    const unmatched = (req.source.match(/\\begin\{/g)?.length ?? 0) - (req.source.match(/\\end\{/g)?.length ?? 0);
    if (unmatched !== 0) problems.push(`\\begin/\\end 不匹配(相差 ${Math.abs(unmatched)})`);
    return {
      ok: false,
      pdfBytes: null,
      engine: req.engine ?? this.engine,
      via: 'preview',
      log: problems.length > 0
        ? `Web 预置检查未通过(正式编译需桌面端 TeX 工具链):\n- ${problems.join('\n- ')}`
        : 'Web 环境无本地 TeX 工具链。请在桌面版(ModuDesk for Windows)中使用「本地编译」,或使用实时预览。',
    };
  }
}

export class LatexService {
  private adapter: LatexCompilerAdapter = new PreviewFallbackAdapter();

  constructor(private bgTasks: BgTaskRegistry) {}

  register(adapter: LatexCompilerAdapter): void {
    this.adapter = adapter;
  }

  current(): LatexCompilerAdapter {
    return this.adapter;
  }

  async compile(req: LatexCompileRequest): Promise<LatexCompileResult> {
    const task = this.bgTasks.begin(`LaTeX 编译(${req.engine ?? this.adapter.engine})`);
    try {
      return await this.adapter.compile(req);
    } finally {
      task.finish();
    }
  }
}
