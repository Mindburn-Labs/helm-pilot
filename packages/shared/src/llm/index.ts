/**
 * Lightweight LLM provider — OpenRouter primary, Anthropic/OpenAI fallback.
 *
 * No heavy SDKs. Uses fetch() directly for minimal dependencies.
 * Task-class routing: different models for different cost/quality tradeoffs.
 */
import { OllamaProvider } from './ollama.js';

/** Token usage returned from each LLM call. */
export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  model: string;
  /** Phase 14 Track H — prompt-caching stats from providers that support it. */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Phase 14 Track H — structured prompt split into cacheable system prefix
 * and dynamic user suffix. Providers that support prompt caching (Anthropic)
 * apply `cache_control: {type: "ephemeral"}` to the system block. Others
 * concatenate transparently via the fallback in AgentLoop.
 */
export interface StructuredPrompt {
  system: string;
  user: string;
  /** Default true on Anthropic. Set false to force no-cache (useful for eval). */
  cacheSystem?: boolean;
}

/**
 * Governance anchor for an LLM call. Populated by providers that route through
 * HELM (the HelmLlmProvider); absent on direct providers (OpenRouter, etc.).
 * Downstream consumers (AgentLoop) persist this into evidence_packs and the
 * task_runs.helm_* columns to build the audit chain.
 */
export interface LlmGovernance {
  decisionId: string;
  verdict: 'ALLOW' | 'DENY' | 'ESCALATE';
  policyVersion: string;
  decisionHash?: string;
  reason?: string;
  principal: string;
  /** Raw signed blob when HELM returns one — stored verbatim for offline verify. */
  signedBlob?: unknown;
}

/** Result of an LLM completion including content and usage metrics. */
export interface LlmResult {
  content: string;
  usage: LlmUsage;
  /** Governance receipt when the call was routed through HELM. */
  governance?: LlmGovernance;
}

export interface LlmProvider {
  /** Returns content string (backward-compatible). */
  complete(prompt: string): Promise<string>;
  /** Returns content + usage metrics for cost tracking. */
  completeWithUsage(prompt: string): Promise<LlmResult>;
  /**
   * Phase 14 Track H — structured prompt path with prompt caching.
   * Providers that support it (Anthropic) split the prompt and apply
   * cache_control to the system block. Providers that don't leave this
   * undefined; the AgentLoop falls back to `completeWithUsage` with
   * `system + "\n\n" + user` concatenated.
   */
  completeStructured?(prompt: StructuredPrompt): Promise<LlmResult>;
}

export interface LlmConfig {
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Phase 16 Track Q — Ollama base URL (e.g. http://localhost:11434). */
  ollamaBaseUrl?: string;
  /** Phase 16 Track Q — Ollama model id (e.g. llama3.1:8b). Required when ollamaBaseUrl is set. */
  ollamaModel?: string;
  model?: string;
}

/**
 * Create an LLM provider from available API keys.
 * Tries OpenRouter first, then Anthropic, then OpenAI.
 */
export function createLlmProvider(config: LlmConfig): LlmProvider {
  if (config.openrouterApiKey) {
    return new OpenRouterProvider(
      config.openrouterApiKey,
      config.model ?? 'anthropic/claude-sonnet-4',
    );
  }
  if (config.anthropicApiKey) {
    return new AnthropicProvider(
      config.anthropicApiKey,
      config.model ?? 'claude-sonnet-4-20250514',
    );
  }
  if (config.openaiApiKey) {
    return new OpenAIProvider(config.openaiApiKey, config.model ?? 'gpt-4o-mini');
  }
  if (config.ollamaBaseUrl) {
    if (!config.ollamaModel) {
      throw new Error('OLLAMA_MODEL is required when OLLAMA_BASE_URL is set.');
    }
    return new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
    });
  }
  throw new Error(
    'No LLM API key configured. Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_BASE_URL + OLLAMA_MODEL.',
  );
}

class OpenRouterProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const result = await this.completeWithUsage(prompt);
    return result.content;
  }

  async completeWithUsage(prompt: string): Promise<LlmResult> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://helm-pilot.dev',
        'X-Title': 'HELM Pilot',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenRouter');
    return {
      content,
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        model: data.model ?? this.model,
      },
    };
  }
}

class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const result = await this.completeWithUsage(prompt);
    return result.content;
  }

  async completeWithUsage(prompt: string): Promise<LlmResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content?: { type: string; text: string }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      model?: string;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('Empty response from Anthropic');
    return {
      content: text,
      usage: {
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
        model: data.model ?? this.model,
      },
    };
  }

  /**
   * Phase 14 Track H — structured prompt with `cache_control: ephemeral`
   * on the system block. Saves 30-90% tokens on iterative agent loops
   * where the system prompt is reused across calls.
   *
   * Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   */
  async completeStructured(prompt: StructuredPrompt): Promise<LlmResult> {
    const useCache = prompt.cacheSystem !== false;
    const systemBlock = useCache
      ? [
          {
            type: 'text' as const,
            text: prompt.system,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : [{ type: 'text' as const, text: prompt.system }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        system: systemBlock,
        messages: [{ role: 'user', content: prompt.user }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content?: { type: string; text: string }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      model?: string;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('Empty response from Anthropic');
    return {
      content: text,
      usage: {
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
        model: data.model ?? this.model,
        cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

class OpenAIProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const result = await this.completeWithUsage(prompt);
    return result.content;
  }

  async completeWithUsage(prompt: string): Promise<LlmResult> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');
    return {
      content,
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        model: data.model ?? this.model,
      },
    };
  }
}
