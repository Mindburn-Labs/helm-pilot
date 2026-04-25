import { describe, expect, it, vi } from 'vitest';
import { createTenantLlmResolver } from '../tenant-resolver.js';
import type { LlmProvider, LlmResult } from '../index.js';

const fallback: LlmProvider = {
  async complete() {
    return 'fallback';
  },
  async completeWithUsage(): Promise<LlmResult> {
    return {
      content: 'fallback',
      usage: { tokensIn: 0, tokensOut: 0, model: 'helm-governed' },
      governance: {
        decisionId: 'dec-1',
        verdict: 'ALLOW',
        policyVersion: 'test',
        principal: 'workspace:test/operator:system',
      },
    };
  },
};

describe('createTenantLlmResolver', () => {
  it('does not read direct tenant provider keys when disabled', async () => {
    const getSecret = vi.fn(async () => 'direct-key');
    const resolver = createTenantLlmResolver({
      getSecret,
      platformFallback: fallback,
      allowDirectTenantProviders: false,
    });

    await expect(resolver.resolve('workspace-1')).resolves.toBe(fallback);
    expect(getSecret).not.toHaveBeenCalled();
  });
});
