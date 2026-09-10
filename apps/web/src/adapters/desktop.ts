/**
 * 桌面壳(Tauri)探测与本地能力注入。
 * Web 配置:什么都不做,LateX 走 PreviewFallbackAdapter。
 * 桌面配置(Tauri 2 注入 window.__TAURI__):注册 native 编译适配器,
 * 调用 Rust 侧 `compile_latex` 命令(XeLaTeX / LuaLaTeX / pdfLaTeX)。
 */
import type { Kernel, LatexCompilerAdapter, LatexCompileRequest, LatexCompileResult } from '@mpw/kernel';

interface TauriGlobal {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function detectDesktopShell(kernel: Kernel): void {
  if (!isTauri()) return;
  const tauri = (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__;
  const invoke = tauri?.invoke;
  if (!invoke) return;
  const adapter: LatexCompilerAdapter = {
    engine: 'xelatex',
    available: true,
    via: 'native',
    async compile(req: LatexCompileRequest): Promise<LatexCompileResult> {
      const res = (await invoke('compile_latex', {
        source: req.source,
        engine: req.engine ?? 'xelatex',
        jobName: req.jobName ?? 'modudesk-job',
      })) as { ok: boolean; pdfBase64?: string; log: string };
      const pdfBytes = res.pdfBase64 ? Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0)) : null;
      return { ok: res.ok, pdfBytes, log: res.log, engine: req.engine ?? 'xelatex', via: 'native' };
    },
  };
  kernel.latex.register(adapter);
  kernel.settings.set('desktop.shell', 'tauri');
}
