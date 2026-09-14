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
    await expect(gateway('nonexistent').run('hi')).rejects.toBeInstanceOf(AiConfigError);
  });

  it('secret store round-trips and deletes', async () => {
    const s = new MemorySecretStore();
    await s.set('ai.key.openai', 'sk-test');
    await expect(s.get('ai.key.openai')).resolves.toBe('sk-test');
    await s.delete('ai.key.openai');
    await expect(s.get('ai.key.openai')).resolves.toBeNull();
  });

  it('uses an injected desktop transport for network providers', async () => {
    const ai = gateway('openai', 'secret');
    let requested = '';
    ai.setRequestTransport(async (url) => {
      requested = url;
      return { choices: [{ message: { content: '桌面连接正常' } }] };
    });
    await expect(ai.run('hello')).resolves.toMatchObject({ text: '桌面连接正常', provider: 'openai' });
    expect(requested).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('provides the DeepSeek V4 Flash preset without storing a key in code', async () => {
    const ai = gateway('deepseek-v4-flash', 'private-key');
    let requested = ''; let requestBody = '';
    ai.setRequestTransport(async (url, init) => { requested = url; requestBody = String(init.body); return { choices: [{ message: { content: 'ok' } }] }; });
    await expect(ai.run('hello')).resolves.toMatchObject({ provider: 'deepseek-v4-flash', model: 'deepseek-v4-flash' });
    expect(requested).toBe('https://model.jsnu.edu.cn/v1/chat/completions');
    expect(JSON.parse(requestBody)).toMatchObject({ model: 'deepseek-v4-flash' });
  });
});
