import { describe, it, expect } from 'vitest';
import { Kernel, openMemoryDb } from '@mpw/kernel';
describe('AI configuration isolation', () => {
  it('migrates the previous endpoint only to its owning provider and clears optional values safely', async () => {
    const db = await openMemoryDb(); const first = new Kernel({ db }); await first.boot();
    first.settings.set('ai.provider', 'openai-compatible'); first.settings.set('ai.baseUrl', 'https://example.invalid/v1');
    const second = new Kernel({ db }); await second.boot();
    expect(second.settings.get('ai.providers.openai-compatible.baseUrl', '')).toBe('https://example.invalid/v1');
    expect(second.settings.get('ai.providers.openai.baseUrl', '')).toBe('');
    expect(second.settings.has('ai.baseUrl')).toBe(false);
    second.settings.set('ai.providers.openai-compatible.baseUrl', undefined);
    expect(second.settings.has('ai.providers.openai-compatible.baseUrl')).toBe(false);
    db.close();
  });
});
