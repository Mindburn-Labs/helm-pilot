import { describe, it, expect, vi } from 'vitest';
import type { LlmProvider } from '@helm-pilot/shared/llm';
import { SpecGenerator } from '../spec-generator.js';
import { ScaffoldGenerator } from '../scaffolding.js';
import type { ProductSpec, StructuredSpec } from '../types.js';

// ── Mock LLM ──

const mockLlmResponse = (structured: object): LlmProvider => ({
  complete: vi.fn().mockResolvedValue(JSON.stringify(structured)),
  completeWithUsage: vi.fn().mockResolvedValue({
    content: JSON.stringify(structured),
    usage: { tokensIn: 100, tokensOut: 200, model: 'test-model' },
  }),
});

const sampleStructured: StructuredSpec = {
  problem: 'Freelancers struggle to track invoices',
  targetUser: 'Solo freelancers earning $50-200k',
  userJourney: ['Sign up', 'Create first invoice', 'Get paid'],
  features: [
    { title: 'Invoice builder', description: 'Create and send invoices', priority: 'must' },
    { title: 'Payment tracking', description: 'Track payment status', priority: 'must' },
    { title: 'Reports', description: 'Monthly revenue reports', priority: 'should' },
    { title: 'Recurring invoices', description: 'Auto-generate recurring invoices', priority: 'could' },
  ],
  techStack: ['TypeScript', 'Next.js', 'PostgreSQL'],
  openQuestions: ['Which payment processors to integrate?'],
  acceptanceCriteria: ['User can create and send an invoice in under 2 minutes'],
};

// ── Tests ──

describe('SpecGenerator', () => {
  it('generates markdown with all sections', async () => {
    const llm = mockLlmResponse(sampleStructured);
    const gen = new SpecGenerator(llm);

    const spec = await gen.generateSpec({ opportunity: 'Invoice tracking for freelancers' });

    expect(spec.version).toBe(1);
    expect(spec.markdown).toContain('# Product Spec:');
    expect(spec.markdown).toContain('## Problem');
    expect(spec.markdown).toContain('## Target User');
    expect(spec.markdown).toContain('## User Journey');
    expect(spec.markdown).toContain('## Features');
    expect(spec.markdown).toContain('## Tech Stack');
    expect(spec.markdown).toContain('## Open Questions');
    expect(spec.markdown).toContain('## Acceptance Criteria');
    expect(spec.generatedAt).toBeTruthy();
  });

  it('revision increments version number', async () => {
    const llm = mockLlmResponse(sampleStructured);
    const gen = new SpecGenerator(llm);

    const v1 = await gen.generateSpec({ opportunity: 'Invoice tracking' });
    expect(v1.version).toBe(1);

    const v2 = await gen.reviseSpec({
      previousSpec: v1,
      feedback: 'Add Stripe integration',
    });
    expect(v2.version).toBe(2);

    const v3 = await gen.reviseSpec({
      previousSpec: v2,
      feedback: 'Simplify onboarding',
    });
    expect(v3.version).toBe(3);
  });

  it('handles missing founder profile', async () => {
    const llm = mockLlmResponse(sampleStructured);
    const gen = new SpecGenerator(llm);

    const spec = await gen.generateSpec({
      opportunity: 'Pet sitting marketplace',
      // no founderProfile
    });

    expect(spec.structured.problem).toBe(sampleStructured.problem);
    // Prompt should not have blown up
    const promptArg = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(promptArg).not.toContain('Founder profile:');
  });

  it('features include at least one must priority', async () => {
    const llm = mockLlmResponse(sampleStructured);
    const gen = new SpecGenerator(llm);

    const spec = await gen.generateSpec({ opportunity: 'Task management' });

    const mustFeatures = spec.structured.features.filter((f) => f.priority === 'must');
    expect(mustFeatures.length).toBeGreaterThanOrEqual(1);
  });

  it('scaffold for nextjs-landing includes package.json and page.tsx', () => {
    const scaffold = new ScaffoldGenerator();
    const spec: ProductSpec = {
      version: 1,
      markdown: '',
      structured: sampleStructured,
      generatedAt: new Date().toISOString(),
    };

    const result = scaffold.generateScaffold('nextjs-landing', spec);

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('app/page.tsx');
    expect(result.template).toBe('nextjs-landing');
    expect(result.files.length).toBeGreaterThanOrEqual(8);
    expect(result.files.length).toBeLessThanOrEqual(15);
  });

  it('graceful without LLM (template-based output)', async () => {
    const gen = new SpecGenerator(); // no LLM

    const spec = await gen.generateSpec({
      opportunity: 'AI-powered resume builder',
      founderProfile: 'Technical founder with HR tech background',
    });

    expect(spec.version).toBe(1);
    expect(spec.structured.problem).toBe('AI-powered resume builder');
    expect(spec.structured.features.length).toBeGreaterThanOrEqual(3);
    expect(spec.structured.features.some((f) => f.priority === 'must')).toBe(true);
    expect(spec.markdown).toContain('## Problem');
    expect(spec.markdown).toContain('AI-powered resume builder');
  });
});
