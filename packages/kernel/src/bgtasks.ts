/**
 * Background task tracker — powers the status-bar "N 个后台任务" indicator
 * (ModuDesk 设计稿). Long operations (mail sync, LaTeX compile, blob import)
 * register here; completion/failure is broadcast on the event bus.
 */
export interface BgTask {
  id: string;
  label: string;
  startedAt: number;
  progress?: number; // 0..1, undefined = indeterminate
}

export interface BgTaskHandle {
  id: string;
  setProgress(fraction: number): void;
  finish(err?: string): void;
}

export class BgTaskRegistry {
  private tasks = new Map<string, BgTask>();
  private seq = 0;
  private onChange: () => void = () => {};

  /** Kernel wires this to the event bus. */
  setNotifier(fn: () => void): void {
    this.onChange = fn;
  }

  begin(label: string): BgTaskHandle {
    const id = `t${++this.seq}`;
    this.tasks.set(id, { id, label, startedAt: Date.now() });
    this.onChange();
    return {
      id,
      setProgress: (fraction: number) => {
        const t = this.tasks.get(id);
        if (t) t.progress = Math.min(1, Math.max(0, fraction));
        this.onChange();
      },
      finish: (err?: string) => {
        this.tasks.delete(id);
        this.onChange();
        void err;
      },
    };
  }

  list(): BgTask[] {
    return [...this.tasks.values()];
  }

  count(): number {
    return this.tasks.size;
  }
}
