import { createLlmProvider, type LlmConfig, type LlmProvider } from './index.js';

/**
 * Per-workspace LLM provider resolution.
 *
 * Phase 2b introduces founder-BYO-LLM-key: when a workspace has stored its
 * own OpenRouter / Anthropic / OpenAI / Cohere key under the tenant secret
 * envelope, the agent loop should spend the founder's credits, not the
 * platform's.
 *
 * Lookup priority (first match wins):
 *   1. tenantSecrets `llm_openrouter_key`  → OpenRouter
 *   2. tenantSecrets `llm_anthropic_key`   → Anthropic
 *   3. tenantSecrets `llm_openai_key`      → OpenAI
 *   4. Platform fallback (process.env keys)
 *
 * The fallback at (4) is deliberately optional — a production deployment
 * can disable it by not setting the platform env keys, forcing BYO-only.
 *
 * Note: providers are built lazily and cached per-workspace so two tasks in
 * flight for the same workspace share one provider instance.
 */
export interface TenantLlmResolver {
  /** Returns the LLM provider the workspace should use for this iteration. */
  resolve(workspaceId: string): Promise<LlmProvider | null>;
  /** Invalidate the cached provider for a workspace (call on secret change). */
  invalidate(workspaceId: string): void;
}

export interface TenantLlmResolverOptions {
  /** Fetches a secret plaintext for the given workspace. Returns null if absent. */
  getSecret: (workspaceId: string, kind: string) => Promise<string | null>;
  /** Optional platform-wide fallback provider. Used when the founder has no key. */
  platformFallback?: LlmProvider;
  /** Default model for the constructed provider. */
  model?: string;
}

export function createTenantLlmResolver(opts: TenantLlmResolverOptions): TenantLlmResolver {
  const cache = new Map<string, { provider: LlmProvider | null; at: number }>();
  // 5 min cache — keeps the hot path off the DB while limiting the window
  // between a secret rotation and a live task seeing the new value.
  const TTL_MS = 5 * 60 * 1000;

  return {
    async resolve(workspaceId: string): Promise<LlmProvider | null> {
      const hit = cache.get(workspaceId);
      if (hit && Date.now() - hit.at < TTL_MS) return hit.provider;

      const byoConfig: LlmConfig = {};
      const [openrouter, anthropic, openai] = await Promise.all([
        opts.getSecret(workspaceId, 'llm_openrouter_key'),
        opts.getSecret(workspaceId, 'llm_anthropic_key'),
        opts.getSecret(workspaceId, 'llm_openai_key'),
      ]);
      if (openrouter) byoConfig.openrouterApiKey = openrouter;
      if (anthropic) byoConfig.anthropicApiKey = anthropic;
      if (openai) byoConfig.openaiApiKey = openai;
      if (opts.model) byoConfig.model = opts.model;

      let provider: LlmProvider | null = null;
      if (openrouter || anthropic || openai) {
        try {
          provider = createLlmProvider(byoConfig);
        } catch {
          // Malformed key — fall through to platform fallback
        }
      }
      if (!provider && opts.platformFallback) provider = opts.platformFallback;

      cache.set(workspaceId, { provider, at: Date.now() });
      return provider;
    },
    invalidate(workspaceId: string) {
      cache.delete(workspaceId);
    },
  };
}
