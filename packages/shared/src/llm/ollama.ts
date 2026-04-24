import type { LlmProvider, LlmResult, StructuredPrompt } from './index.js';

// ─── Ollama LLM provider (Phase 16 Track Q) ───
//
// Calls an Ollama server's /api/chat endpoint. Default base URL:
// http://localhost:11434. No auth (Ollama runs on trusted local host).
// Works with any Ollama-hosted model: llama3, qwen2.5, phi4, mistral, etc.

const DEFAULT_BASE = 'http://localhost:11434';
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface OllamaConfig {
  /** Override `OLLAMA_BASE_URL`. */
  baseUrl?: string;
  /** Model id, e.g. `llama3.1:8b`. */
  model: string;
  /** Hard timeout per call. Default 120s. */
  timeoutMs?: number;
  /** Soft cap on output tokens. Default 2000. */
  maxTokens?: number;
}

export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(private readonly cfg: OllamaConfig) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeWithUsage(prompt)).content;
  }

  async completeWithUsage(prompt: string): Promise<LlmResult> {
    return this.chat([{ role: 'user', content: prompt }]);
  }

  async completeStructured(p: StructuredPrompt): Promise<LlmResult> {
    return this.chat([
      { role: 'system', content: p.system },
      { role: 'user', content: p.user },
    ]);
  }

  private async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ): Promise<LlmResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          stream: false,
          options: { num_predict: this.maxTokens },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `Ollama transport error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      message?: { role?: string; content?: string };
      eval_count?: number;
      prompt_eval_count?: number;
      model?: string;
    };
    const content = json.message?.content ?? '';
    return {
      content,
      usage: {
        tokensIn: Number(json.prompt_eval_count ?? 0),
        tokensOut: Number(json.eval_count ?? 0),
        model: json.model ?? this.cfg.model,
      },
    };
  }
}
