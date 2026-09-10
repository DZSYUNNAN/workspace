import type { CommandContribution, CommandHandler } from './types';

/** Command bus — cross-plugin communication contract #2. Powers the Ctrl+K palette. */
export class CommandBus {
  private handlers = new Map<string, CommandHandler>();
  private meta = new Map<string, CommandContribution>();

  register(meta: CommandContribution, handler: CommandHandler): () => void {
    if (!meta.id.includes('.')) {
      throw new Error(`command id "${meta.id}" must be namespaced: "<pluginId>.<commandId>"`);
    }
    this.handlers.set(meta.id, handler);
    this.meta.set(meta.id, meta);
    return () => {
      this.handlers.delete(meta.id);
      this.meta.delete(meta.id);
    };
  }

  async execute(id: string, args?: unknown): Promise<unknown> {
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`unknown command: ${id}`);
    return await handler(args);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  list(): CommandContribution[] {
    return [...this.meta.values()];
  }

  clear(): void {
    this.handlers.clear();
    this.meta.clear();
  }
}
