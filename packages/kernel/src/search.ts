import type { SearchHit } from '@mpw/shared';
import type { SearchProviderContribution } from './types';

interface RegisteredProvider {
  pluginId: string;
  contrib: SearchProviderContribution;
}

/** Global search — fans out to plugin-contributed providers, groups + ranks. */
export class SearchService {
  private providers = new Map<string, RegisteredProvider>(); // key: `${pluginId}/${id}`

  register(pluginId: string, contrib: SearchProviderContribution): () => void {
    const key = `${pluginId}/${contrib.id}`;
    this.providers.set(key, { pluginId, contrib });
    return () => this.providers.delete(key);
  }

  unregisterPlugin(pluginId: string): void {
    for (const key of [...this.providers.keys()]) {
      if (this.providers.get(key)?.pluginId === pluginId) this.providers.delete(key);
    }
  }

  listProviders(): { pluginId: string; id: string; label: string }[] {
    return [...this.providers.values()].map((r) => ({
      pluginId: r.pluginId,
      id: r.contrib.id,
      label: r.contrib.label,
    }));
  }

  async searchAll(
    q: string,
    limitPerProvider = 6
  ): Promise<{ label: string; hits: SearchHit[] }[]> {
    const query = q.trim();
    if (!query) return [];
    const results = await Promise.allSettled(
      [...this.providers.values()].map(async (r) => ({
        label: r.contrib.label,
        hits: (await r.contrib.search(query, limitPerProvider)).map((h) => ({ ...h, pluginId: r.pluginId })),
      }))
    );
    const groups: { label: string; hits: SearchHit[] }[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.hits.length > 0) {
        r.value.hits.sort((a, b) => b.score - a.score);
        groups.push(r.value);
      }
    }
    groups.sort((a, b) => (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0));
    return groups;
  }
}
