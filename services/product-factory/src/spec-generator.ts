import type { LlmProvider } from '@pilot/shared/llm';
import type { ProductSpec, SpecParams, RevisionParams, StructuredSpec } from './types.js';

/**
 * Generates and revises product specifications.
 * When an LlmProvider is supplied, uses it for richer output.
 * Without one, returns a deterministic template-based spec.
 */
export class SpecGenerator {
  constructor(private readonly llm?: LlmProvider) {}

  /** Generate a new product spec from an opportunity description. */
  async generateSpec(params: SpecParams): Promise<ProductSpec> {
    const structured = this.llm
      ? await this.generateWithLlm(params)
      : this.generateTemplate(params);

    const markdown = this.renderMarkdown(structured, params);

    return {
      version: 1,
      markdown,
      structured,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Revise an existing spec based on feedback, incrementing version. */
  async reviseSpec(params: RevisionParams): Promise<ProductSpec> {
    const { previousSpec, feedback } = params;

    const structured = this.llm
      ? await this.reviseWithLlm(previousSpec, feedback)
      : this.reviseTemplate(previousSpec, feedback);

    const markdown = this.renderMarkdown(structured, {
      opportunity: previousSpec.structured.problem,
    });

    return {
      version: previousSpec.version + 1,
      markdown,
      structured,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── LLM-backed generation ──

  private async generateWithLlm(params: SpecParams): Promise<StructuredSpec> {
    const contextBlock = this.wrapContext(params);
    const prompt = [
      'You are a product spec generator. Produce a JSON object (no markdown fences) with this exact shape:',
      '{ "problem": string, "targetUser": string, "userJourney": string[], "features": [{ "title": string, "description": string, "priority": "must"|"should"|"could"|"wont" }], "techStack": string[], "openQuestions": string[], "acceptanceCriteria": string[] }',
      '',
      'Include at least one feature with priority "must". Features should have 3-6 items.',
      '',
      contextBlock,
    ].join('\n');

    const raw = await this.llm!.complete(prompt);
    return this.parseLlmResponse(raw);
  }

  private async reviseWithLlm(
    spec: ProductSpec,
    feedback: string,
  ): Promise<StructuredSpec> {
    const contextBlock = [
      '<context>',
      `Previous spec (v${spec.version}):`,
      JSON.stringify(spec.structured, null, 2),
      '',
      `Feedback: ${feedback}`,
      '</context>',
    ].join('\n');

    const prompt = [
      'You are a product spec reviser. Given the previous spec and feedback, produce an updated JSON object (no markdown fences) with the same shape:',
      '{ "problem": string, "targetUser": string, "userJourney": string[], "features": [{ "title": string, "description": string, "priority": "must"|"should"|"could"|"wont" }], "techStack": string[], "openQuestions": string[], "acceptanceCriteria": string[] }',
      '',
      'Incorporate the feedback while preserving existing decisions that are not contradicted.',
      '',
      contextBlock,
    ].join('\n');

    const raw = await this.llm!.complete(prompt);
    return this.parseLlmResponse(raw);
  }

  // ── Template-based fallback ──

  private generateTemplate(params: SpecParams): StructuredSpec {
    const { opportunity, founderProfile, operatorRole } = params;
    return {
      problem: opportunity,
      targetUser: founderProfile ?? '[To be defined]',
      userJourney: [
        'User discovers the product',
        'User signs up and completes onboarding',
        'User reaches primary value moment',
      ],
      features: [
        { title: 'Core value delivery', description: `Implement the primary solution for: ${opportunity}`, priority: 'must' },
        { title: 'User onboarding', description: 'Guided first-run experience', priority: 'must' },
        { title: 'Dashboard', description: 'Overview of key metrics and status', priority: 'should' },
        { title: 'Notifications', description: 'Email and in-app alerts for key events', priority: 'could' },
      ],
      techStack: ['TypeScript', 'Node.js', 'PostgreSQL'],
      openQuestions: [
        'What is the primary monetization model?',
        'What are the key integration requirements?',
        ...(operatorRole ? [`How does the ${operatorRole} role interact with the system?`] : []),
      ],
      acceptanceCriteria: [
        'User can complete the primary workflow end-to-end',
        'Response times under 500ms for core operations',
        'All user input is validated and sanitized',
      ],
    };
  }

  private reviseTemplate(spec: ProductSpec, feedback: string): StructuredSpec {
    return {
      ...spec.structured,
      openQuestions: [
        ...spec.structured.openQuestions,
        `Feedback received: ${feedback}`,
      ],
    };
  }

  // ── Helpers ──

  /** Wrap user-supplied content in context tags for injection safety. */
  private wrapContext(params: SpecParams): string {
    const lines = ['<context>'];
    lines.push(`Opportunity: ${params.opportunity}`);
    if (params.founderProfile) {
      lines.push(`Founder profile: ${params.founderProfile}`);
    }
    if (params.operatorRole) {
      lines.push(`Operator role: ${params.operatorRole}`);
    }
    lines.push('</context>');
    return lines.join('\n');
  }

  private parseLlmResponse(raw: string): StructuredSpec {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
    const parsed = JSON.parse(cleaned) as StructuredSpec;
    return parsed;
  }

  private renderMarkdown(structured: StructuredSpec, params: { opportunity: string }): string {
    const lines: string[] = [];

    lines.push(`# Product Spec: ${params.opportunity}`);
    lines.push('');
    lines.push('## Problem');
    lines.push(structured.problem);
    lines.push('');
    lines.push('## Target User');
    lines.push(structured.targetUser);
    lines.push('');
    lines.push('## User Journey');
    for (const step of structured.userJourney) {
      lines.push(`1. ${step}`);
    }
    lines.push('');
    lines.push('## Features');
    for (const f of structured.features) {
      lines.push(`- **[${f.priority.toUpperCase()}]** ${f.title}: ${f.description}`);
    }
    lines.push('');
    lines.push('## Tech Stack');
    for (const t of structured.techStack) {
      lines.push(`- ${t}`);
    }
    lines.push('');
    lines.push('## Open Questions');
    for (const q of structured.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push('');
    lines.push('## Acceptance Criteria');
    for (const c of structured.acceptanceCriteria) {
      lines.push(`- ${c}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}
