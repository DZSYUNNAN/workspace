import type { ContextChunk } from '@mpw/shared';
import type { ContextProviderContribution } from './types';

interface RegisteredProvider {
  pluginId: string;
  contrib: ContextProviderContribution;
}

/**
 * AI context system (PRODUCT_SPEC §4.5): plugins expose authorized context;
 * the user toggles each provider on/off (consent persisted in settings).
 */
export class ContextService {
  private providers = new Map<string, RegisteredProvider>(); // key: `${pluginId}/${id}`
  private enabledOverrides = new Set<string>();
  private disabledOverrides = new Set<string>();

  register(pluginId: string, contrib: ContextProviderContribution): () => void {
    const key = `${pluginId}/${contrib.id}`;
    this.providers.set(key, { pluginId, contrib });
    return () => this.providers.delete(key);
  }

  unregisterPlugin(pluginId: string): void {
    for (const key of [...this.providers.keys()]) {
      if (this.providers.get(key)?.pluginId === pluginId) this.providers.delete(key);
    }
  }

  list(): { key: string; pluginId: string; id: string; label: string; enabled: boolean }[] {
    return [...this.providers.entries()].map(([key, r]) => ({
      key,
      pluginId: r.pluginId,
      id: r.contrib.id,
      label: r.contrib.label,
      enabled: !this.disabledOverrides.has(key),
    }));
  }

  setEnabled(key: string, enabled: boolean): void {
    if (enabled) {
      this.disabledOverrides.delete(key);
      this.enabledOverrides.add(key);
    } else {
      this.disabledOverrides.add(key);
      this.enabledOverrides.delete(key);
    }
  }

  loadConsent(disabledKeys: string[]): void {
    this.disabledOverrides = new Set(disabledKeys);
  }

  consentSnapshot(): string[] {
    return [...this.disabledOverrides];
  }

  async getActiveContext(): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];
    for (const [key, r] of this.providers) {
      if (this.disabledOverrides.has(key)) continue;
      try {
        const chunk = await r.contrib.getContext();
        if (chunk) chunks.push({ ...chunk, source: r.pluginId });
      } catch {
        /* a failing provider must never break the assistant */
      }
    }
    return chunks;
  }
}
