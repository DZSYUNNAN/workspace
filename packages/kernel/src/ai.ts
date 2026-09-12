import type { AiResult, AiRunOptions, ContextChunk } from '@mpw/shared';

/**
 * AI gateway (PRODUCT_SPEC §4.5). Providers are pluggable adapters; the user's
 * key/baseUrl/model live in SecretStore + Settings, never in code or SQLite.
 */
export interface AiCompleteParams {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  system?: string;
  prompt: string;
  context?: string;
  temperature?: number;
  maxTokens?: number;
  requestJson?: AiRequestTransport;
}

export type AiRequestTransport = (url: string, init: RequestInit) => Promise<unknown>;

export interface AiProviderAdapter {
  id: string;
  label: string;
  defaultModel: string;
  requiresKey: boolean;
  defaultBaseUrl?: string;
  complete(params: AiCompleteParams): Promise<AiResult>;
}

export class AiConfigError extends Error {}

/* ------------------------------------------------------------------ */
/* Offline demo provider — deterministic transformations, no network. */
/* ------------------------------------------------------------------ */

const sentences = (s: string): string[] =>
  s
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？])\s+/)
    .filter((x) => x.trim().length > 0);

export const demoProvider: AiProviderAdapter = {
  id: 'demo',
  label: 'Demo (offline)',
  defaultModel: 'demo-1',
  requiresKey: false,
  async complete(params: AiCompleteParams): Promise<AiResult> {
    const instruction = (params.system ?? '').toLowerCase() + '\n' + params.prompt.slice(0, 200).toLowerCase();
    const body = params.context || params.prompt;
    let out: string;
    if (instruction.includes('summar')) {
      const ss = sentences(body);
      out = ss.slice(0, Math.min(3, ss.length)).join(' ');
    } else if (instruction.includes('keyword')) {
      const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'this', 'that', 'we', 'our', 'by', 'as', 'from', 'at']);
      const freq = new Map<string, number>();
      for (const w of body.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? []) {
        if (!stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
      }
      out = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w]) => w)
        .join(', ');
    } else if (instruction.includes('shorten')) {
      out = sentences(body).slice(0, Math.max(1, Math.ceil(sentences(body).length / 2))).join(' ');
    } else if (instruction.includes('expand')) {
      out = body + ' Furthermore, this point can be elaborated with additional supporting evidence and concrete examples.';
    } else if (instruction.includes('polish') || instruction.includes('grammar')) {
      out = body.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([.!?])\s*([a-z])/g, (_m, p, c) => `${p} ${String(c).toUpperCase()}`).trim();
    } else if (instruction.includes('latex')) {
      out = '\\section{' + (sentences(body)[0] ?? 'Section').slice(0, 60) + '}\n' + body;
    } else if (instruction.includes('chinese') || instruction.includes('中文') || /[\u4e00-\u9fff]/.test(instruction)) {
      out = `[中译] ${body}`;
    } else if (instruction.includes('translate') || instruction.includes('english')) {
      out = `[EN] ${body}`;
    } else {
      out = `Here is a draft response (offline demo provider):\n\n${body.slice(0, 600)}`;
    }
    return { text: out, provider: 'demo', model: 'demo-1' };
  },
};

/* --------------------------- network providers --------------------------- */

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI provider HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as unknown;
}

function buildUserContent(p: AiCompleteParams): string {
  return p.context ? `${p.prompt}\n\n<context>\n${p.context}\n</context>` : p.prompt;
}

export const openAiProvider: AiProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: 'https://api.openai.com/v1',
  requiresKey: true,
  async complete(p) {
    const data = (await (p.requestJson ?? fetchJson)(`${p.baseUrl ?? this.defaultBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey ?? ''}` },
      body: JSON.stringify({
        model: p.model ?? this.defaultModel,
        temperature: p.temperature ?? 0.7,
        ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
        messages: [
          ...(p.system ? [{ role: 'system', content: p.system }] : []),
          { role: 'user', content: buildUserContent(p) },
        ],
      }),
    })) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      provider: this.id,
      model: p.model ?? this.defaultModel,
      usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens },
    };
  },
};

export const openAiCompatibleProvider: AiProviderAdapter = {
  ...openAiProvider,
  id: 'openai-compatible',
  label: 'OpenAI-compatible API',
  defaultModel: 'gpt-3.5-turbo',
  defaultBaseUrl: undefined,
  requiresKey: true,
};

export const anthropicProvider: AiProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-3-5-haiku-latest',
  defaultBaseUrl: 'https://api.anthropic.com',
  requiresKey: true,
  async complete(p) {
    const data = (await (p.requestJson ?? fetchJson)(`${p.baseUrl ?? this.defaultBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': p.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: p.model ?? this.defaultModel,
        max_tokens: p.maxTokens ?? 2048,
        temperature: p.temperature ?? 0.7,
        ...(p.system ? { system: p.system } : {}),
        messages: [{ role: 'user', content: buildUserContent(p) }],
      }),
    })) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return {
      text: (data.content ?? []).map((c) => c.text ?? '').join(''),
      provider: this.id,
      model: p.model ?? this.defaultModel,
      usage: { promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens },
    };
  },
};

export const googleProvider: AiProviderAdapter = {
  id: 'google',
  label: 'Google AI',
  defaultModel: 'gemini-1.5-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  requiresKey: true,
  async complete(p) {
    const model = p.model ?? this.defaultModel;
    const data = (await (p.requestJson ?? fetchJson)(`${p.baseUrl ?? this.defaultBaseUrl}/models/${model}:generateContent?key=${p.apiKey ?? ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: p.system ? { parts: [{ text: p.system }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: buildUserContent(p) }] }],
        generationConfig: { temperature: p.temperature ?? 0.7 },
      }),
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return {
      text: (data.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join(''),
      provider: this.id,
      model,
    };
  },
};

export const ollamaProvider: AiProviderAdapter = {
  id: 'ollama',
  label: 'Ollama (local)',
  defaultModel: 'llama3.1',
  defaultBaseUrl: 'http://localhost:11434',
  requiresKey: false,
  async complete(p) {
    const data = (await (p.requestJson ?? fetchJson)(`${p.baseUrl ?? this.defaultBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: p.model ?? this.defaultModel,
        prompt: buildUserContent(p),
        system: p.system,
        stream: false,
      }),
    })) as { response?: string };
    return { text: data.response ?? '', provider: this.id, model: p.model ?? this.defaultModel };
  },
};

export const BUILTIN_AI_PROVIDERS: AiProviderAdapter[] = [
  demoProvider,
  openAiProvider,
  openAiCompatibleProvider,
  anthropicProvider,
  googleProvider,
  ollamaProvider,
];

/* --------------------------------- gateway --------------------------------- */

export class AiGateway {
  private providers = new Map<string, AiProviderAdapter>();
  private requestTransport?: AiRequestTransport;

  constructor(
    private resolveConfig: () => { providerId: string; baseUrl?: string; model?: string },
    private resolveKey: (providerId: string) => Promise<string | null>
  ) {
    for (const p of BUILTIN_AI_PROVIDERS) this.providers.set(p.id, p);
  }

  registerProvider(adapter: AiProviderAdapter): void {
    this.providers.set(adapter.id, adapter);
  }

  setRequestTransport(transport: AiRequestTransport): void {
    this.requestTransport = transport;
  }

  listProviders(): { id: string; label: string; requiresKey: boolean; defaultModel: string }[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      label: p.label,
      requiresKey: p.requiresKey,
      defaultModel: p.defaultModel,
    }));
  }

  async run(prompt: string, opts?: AiRunOptions): Promise<AiResult> {
    const cfg = this.resolveConfig();
    const provider = this.providers.get(cfg.providerId);
    if (!provider) throw new AiConfigError('没有可用的 AI 服务，请在“设置 → AI 服务”中重新选择');
    if (provider.id === 'openai-compatible' && !cfg.baseUrl) throw new AiConfigError('请填写兼容服务的 Base URL');
    const apiKey = provider.requiresKey ? await this.resolveKey(provider.id) : null;
    if (provider.requiresKey && !apiKey) {
      throw new AiConfigError(
        `“${provider.label}”尚未配置 API 密钥，请前往“设置 → AI 服务”保存密钥并测试连接。`
      );
    }
    const contextText = (opts?.context ?? []).map((c) => c.content).join('\n\n---\n\n') || undefined;
    const result = await provider.complete({
      baseUrl: cfg.baseUrl?.replace(/\/+$/, ''),
      model: cfg.model,
      apiKey: apiKey ?? undefined,
      system: opts?.system,
      prompt,
      context: contextText,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
      requestJson: this.requestTransport,
    });
    if (!result.text.trim()) throw new AiConfigError('服务返回了空内容，请检查模型名称和接口地址');
    return result;
  }
}

export function chunkToText(c: ContextChunk): string {
  return `[${c.label}]\n${c.content}`;
}
