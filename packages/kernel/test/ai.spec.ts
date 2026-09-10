import { describe, expect, it } from 'vitest';
import { AiGateway, AiConfigError, demoProvider, MemorySecretStore } from '@mpw/kernel';

function gateway(providerId: string, key: string | null = null): AiGateway {
  return new AiGateway(
    () => ({ providerId, baseUrl: undefined, model: undefined }),
    async () => key
  );
}

describe('AI gateway & demo provider', () => {
  it('demo provider summarizes deterministically', async () => {
    const res = await demoProvider.complete({
      system: 'summarize this text.',
      prompt: 'x',
      context: 'Fusion models combine infrared and visible images. They preserve thermal contrast. They also retain texture details. Many architectures exist.',
    });
    expect(res.provider).toBe('demo');
    expect(res.text.split('.').length).toBeLessThanOrEqual(4);
  });

  it('demo provider extracts keywords', async () => {
    const res = await demoProvider.complete({
      system: 'extract keywords this text.',
      prompt: 'x',
      context: 'Multimodal image fusion knowledge distillation transformer attention infrared visible alignment registration fusion distillation',
    });
    expect(res.text).toContain('fusion');
    expect(res.text).toContain('distillation');
  });

  it('routes through the configured provider', async () => {
    const res = await gateway('demo').run('hello');
    expect(res.text).toContain('demo provider');
  });

  it('throws a config error when a key-requiring provider lacks a key', async () => {
    await expect(gateway('openai', null).run('hi')).rejects.toBeInstanceOf(AiConfigError);
    // unknown provider falls back to demo
    const res = await gateway('nonexistent').run('hi');
    expect(res.provider).toBe('demo');
  });

  it('secret store round-trips and deletes', async () => {
    const s = new MemorySecretStore();
    await s.set('ai.key.openai', 'sk-test');
    await expect(s.get('ai.key.openai')).resolves.toBe('sk-test');
    await s.delete('ai.key.openai');
    await expect(s.get('ai.key.openai')).resolves.toBeNull();
  });
});
