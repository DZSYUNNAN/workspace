export type EventHandler = (payload: unknown) => void;

/**
 * Synchronous publish/subcribe bus. Cross-plugin communication contract #1.
 * System event types used by core: 'settings:changed' | 'theme:changed' |
 * 'layout:changed' | 'workspace:changed' | 'plugins:changed' | 'notify'.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcard = new Set<EventHandler>();

  on(type: string, handler: EventHandler): () => void {
    if (type === '*') {
      this.wildcard.add(handler);
      return () => this.wildcard.delete(handler);
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.handlers.delete(type);
    };
  }

  emit(type: string, payload?: unknown): void {
    const set = this.handlers.get(type);
    if (set) for (const h of [...set]) h(payload);
    for (const h of [...this.wildcard]) h({ type, payload });
  }

  listenerCount(type: string): number {
    return (this.handlers.get(type)?.size ?? 0) + this.wildcard.size;
  }

  clear(): void {
    this.handlers.clear();
    this.wildcard.clear();
  }
}
