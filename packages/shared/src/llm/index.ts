/**
 * Lightweight LLM provider — OpenRouter primary, Anthropic/OpenAI fallback.
 *
 * No heavy SDKs. Uses fetch() directly for minimal dependencies.
 * Task-class routing: different models for different cost/quality tradeoffs.
 */

/** Token usage returned from each LLM call. */
export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  model: string;
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
}

export interface LlmConfig {
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
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
  throw new Error('No LLM API key configured. Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.');
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
      usage?: { input_tokens?: number; output_tokens?: number };
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
