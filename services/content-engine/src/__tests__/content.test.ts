import { describe, it, expect, vi } from 'vitest';
import {
  ContentEngine,
  AuthenticityAudit,
  HeadlineImpactScorer,
  type ContentRequest,
  type LlmProvider,
} from '../index.js';

// ─── Helpers ───

function createMockLlm(responses: string | readonly string[]): LlmProvider {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const fn = vi.fn().mockImplementation(async () => {
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  });
  return {
    complete: fn,
    completeWithUsage: async (prompt: string) => ({
      content: await fn(prompt),
      usage: { tokensIn: 0, tokensOut: 0, model: 'mock' },
    }),
  };
}

const BLOG_REQUEST: ContentRequest = {
  contentType: 'blog_post',
  topic: 'shipping a product in 30 days',
  audience: 'early-stage founders',
  keywords: ['speed', 'MVP'],
};

// ─── Tests ───

describe('AuthenticityAudit', () => {
  it('detects ai_phrases in classic AI-tell prose', () => {
    const audit = new AuthenticityAudit();
    const result = audit.audit(
      "Let's delve into the fast-paced world of leveraging synergy to unlock the potential of our tapestry of solutions.",
    );

    const aiPhrases = result.signals.find((s) => s.name === 'ai_phrases');
    expect(aiPhrases).toBeDefined();
    expect(aiPhrases!.detected).toBe(true);
    expect(result.verdict === 'ai_tell' || result.verdict === 'generic').toBe(true);
    expect(result.overall).toBeLessThan(80);
  });

  it('authentic text scores above 80', () => {
    const audit = new AuthenticityAudit();
    const result = audit.audit(
      'I shipped 3 features in 10 days. We measured 40% adoption from 200 users. The case study is documented in our changelog.',
    );

    expect(result.overall).toBeGreaterThan(80);
    expect(result.verdict).toBe('authentic');
  });
});

describe('HeadlineImpactScorer', () => {
  it('scores a specific, benefit-driven headline high on specificity and benefit_clarity', () => {
    const scorer = new HeadlineImpactScorer();
    const result = scorer.score('How to Get 100 Users in 30 Days Without Ads');

    expect(result.dimensions.specificity).toBeGreaterThanOrEqual(75);
    expect(result.dimensions.benefit_clarity).toBeGreaterThanOrEqual(75);
    expect(result.dimensions.brevity).toBe(100);
  });

  it('penalizes a 20-word headline on brevity', () => {
    const scorer = new HeadlineImpactScorer();
    const twentyWords =
      'This is a very long headline that goes on and on and on and really keeps going past twelve words clearly';
    expect(twentyWords.split(/\s+/).length).toBeGreaterThanOrEqual(20);

    const result = scorer.score(twentyWords);
    expect(result.dimensions.brevity).toBeLessThanOrEqual(45);
  });
});

describe('ContentEngine.generate', () => {
  it('returns all required fields for a blog_post', async () => {
    const llm = createMockLlm([
      'Shipping Faster: 3 Lessons From 30 Days',
      'I shipped my MVP in 30 days. Here are 3 lessons from measuring 200 user sessions across 5 releases.',
    ]);
    const engine = new ContentEngine(llm);

    const result = await engine.generate(BLOG_REQUEST);

    expect(result.contentType).toBe('blog_post');
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.title).toBeDefined();
    expect(result.title!.length).toBeGreaterThan(0);
    expect(result.authenticityScore).toBeDefined();
    expect(result.authenticityScore.signals.length).toBeGreaterThan(0);
    expect(result.headlineScore).toBeDefined();
    expect(result.headlineScore!.overall).toBeGreaterThanOrEqual(0);
    expect(result.headlineScore!.overall).toBeLessThanOrEqual(100);
    expect(result.nextAction).toBeDefined();
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.promptVersion).toBe('content-engine/v1');
    expect(result.method).toBe('llm');
  });

  it('includes a nextAction in every result', async () => {
    const llm = createMockLlm('Clean authentic output from real founders.');
    const engine = new ContentEngine(llm);

    const types: ContentRequest['contentType'][] = [
      'blog_post',
      'email',
      'social_post',
      'video_script',
      'landing_copy',
    ];

    for (const contentType of types) {
      const result = await engine.generate({
        contentType,
        topic: 'launch',
        audience: 'founders',
      });

      expect(result.nextAction.title.length).toBeGreaterThan(0);
      expect(result.nextAction.description.length).toBeGreaterThan(0);
      expect(result.nextAction.cta.length).toBeGreaterThan(0);
    }
  });
});

describe('ContentEngine.rewriteForAuthenticity', () => {
  it('reduces AI-tell signals in the rewrite', async () => {
    const audit = new AuthenticityAudit();
    const original =
      "Let's delve into the fast-paced world of leveraging synergy to unlock the potential of our tapestry.";
    const originalScore = audit.audit(original);

    const llm = createMockLlm(
      'I tested 4 approaches with 20 customers. The winning one shipped in 6 days and measured 35% better retention.',
    );
    const engine = new ContentEngine(llm);
    const result = await engine.rewriteForAuthenticity(original, 'Remove AI phrases, add numbers.');

    const originalAiPhrases =
      originalScore.signals.find((s) => s.name === 'ai_phrases')?.detected ?? false;
    const rewrittenAiPhrases =
      result.authenticityScore.signals.find((s) => s.name === 'ai_phrases')?.detected ?? false;

    expect(originalAiPhrases).toBe(true);
    expect(rewrittenAiPhrases).toBe(false);
    expect(result.authenticityScore.overall).toBeGreaterThan(originalScore.overall);
  });
});

describe('ContentEngine without LLM', () => {
  it('falls back gracefully and reports method=heuristic', async () => {
    const engine = new ContentEngine();

    const result = await engine.generate({
      contentType: 'social_post',
      topic: 'launching a new tool',
      audience: 'indie hackers',
    });

    expect(result.method).toBe('heuristic');
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.authenticityScore).toBeDefined();
    expect(result.authenticityScore.verdict).toBe('generic');
    expect(result.nextAction).toBeDefined();
  });
});
