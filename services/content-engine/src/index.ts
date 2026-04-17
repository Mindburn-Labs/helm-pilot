import type { LlmProvider } from '@helm-pilot/shared/llm';
import { AuthenticityAudit } from './authenticity-audit.js';
import { HeadlineImpactScorer } from './headline-impact.js';
import type {
  AuthenticityScore,
  ContentRequest,
  ContentResult,
  ContentType,
  HeadlineScore,
  NextAction,
} from './types.js';

export type {
  AuthenticityScore,
  AuthenticitySignal,
  AuthenticitySignalName,
  AuthenticityVerdict,
  ContentRequest,
  ContentResult,
  ContentType,
  HeadlineDimensions,
  HeadlineScore,
  NextAction,
} from './types.js';
export { AuthenticityAudit } from './authenticity-audit.js';
export { HeadlineImpactScorer } from './headline-impact.js';
export type { LlmProvider } from '@helm-pilot/shared/llm';

const PROMPT_VERSION = 'content-engine/v1';

const TYPES_WITH_HEADLINE: ReadonlySet<ContentType> = new Set([
  'blog_post',
  'email',
  'landing_copy',
  'video_script',
]);

export class ContentEngine {
  private readonly audit: AuthenticityAudit;
  private readonly headliner: HeadlineImpactScorer;

  constructor(private readonly llm?: LlmProvider) {
    this.audit = new AuthenticityAudit();
    this.headliner = new HeadlineImpactScorer();
  }

  async generate(req: ContentRequest): Promise<ContentResult> {
    const method: 'llm' | 'heuristic' = this.llm ? 'llm' : 'heuristic';

    const { title, body } = this.llm
      ? await this.generateWithLlm(req, this.llm)
      : this.generateHeuristic(req);

    const authenticityScore = this.audit.audit(body);
    const headlineScore =
      title && TYPES_WITH_HEADLINE.has(req.contentType)
        ? this.headliner.score(title)
        : undefined;

    return this.assemble({
      contentType: req.contentType,
      body,
      title,
      authenticityScore,
      headlineScore,
      method,
    });
  }

  async rewriteForAuthenticity(
    original: string,
    feedback: string,
  ): Promise<ContentResult> {
    const method: 'llm' | 'heuristic' = this.llm ? 'llm' : 'heuristic';
    const body = this.llm
      ? await this.llm.complete(buildRewritePrompt(original, feedback))
      : stripAiTells(original);

    const authenticityScore = this.audit.audit(body);

    return this.assemble({
      contentType: 'blog_post',
      body,
      title: undefined,
      authenticityScore,
      headlineScore: undefined,
      method,
    });
  }

  private async generateWithLlm(
    req: ContentRequest,
    llm: LlmProvider,
  ): Promise<{ title?: string; body: string }> {
    const needsTitle = TYPES_WITH_HEADLINE.has(req.contentType);

    if (needsTitle) {
      const title = truncate(await llm.complete(buildTitlePrompt(req)), 140).trim();
      const body = truncateMaybe(await llm.complete(buildBodyPrompt(req, title)), req.maxLength);
      return { title, body };
    }

    const body = truncateMaybe(await llm.complete(buildBodyPrompt(req)), req.maxLength);
    return { body };
  }

  private generateHeuristic(req: ContentRequest): { title?: string; body: string } {
    const needsTitle = TYPES_WITH_HEADLINE.has(req.contentType);
    const title = needsTitle ? `${capitalize(req.topic)} — Notes for ${req.audience}` : undefined;
    const body = renderTemplate(req);
    return { title, body };
  }

  private assemble(parts: {
    contentType: ContentType;
    body: string;
    title?: string;
    authenticityScore: AuthenticityScore;
    headlineScore?: HeadlineScore;
    method: 'llm' | 'heuristic';
  }): ContentResult {
    return {
      contentType: parts.contentType,
      body: parts.body,
      title: parts.title,
      authenticityScore: parts.authenticityScore,
      headlineScore: parts.headlineScore,
      nextAction: nextActionFor(parts.contentType),
      generatedAt: new Date(),
      promptVersion: PROMPT_VERSION,
      method: parts.method,
    };
  }
}

// ─── Prompt builders ───

function buildTitlePrompt(req: ContentRequest): string {
  const lines: string[] = [
    'You are writing a headline for a piece of content.',
    `Content type: ${req.contentType}.`,
    `Audience: ${req.audience}.`,
    `<context>`,
    `Topic: ${req.topic}`,
  ];
  if (req.keywords?.length) lines.push(`Keywords: ${req.keywords.join(', ')}`);
  if (req.founderVoice?.tone) lines.push(`Voice: ${req.founderVoice.tone}`);
  lines.push(`</context>`);
  lines.push(
    'Rules: 6-12 words. Include at least one specific number, named entity, or outcome. No buzzwords, no "delve into", no "leverage".',
    'Return only the headline, no quotes, no labels.',
  );
  return lines.join('\n');
}

function buildBodyPrompt(req: ContentRequest, title?: string): string {
  const sections: string[] = [
    `You are writing a ${req.contentType} for: ${req.audience}.`,
    `<context>`,
    `Topic: ${req.topic}`,
  ];
  if (title) sections.push(`Title: ${title}`);
  if (req.keywords?.length) sections.push(`Keywords: ${req.keywords.join(', ')}`);
  if (req.founderVoice?.tone) sections.push(`Tone: ${req.founderVoice.tone}`);
  if (req.founderVoice?.examples?.length) {
    sections.push(
      `Voice examples:\n${req.founderVoice.examples.map((e) => `- ${e}`).join('\n')}`,
    );
  }
  if (req.language) sections.push(`Language: ${req.language}`);
  if (req.maxLength) sections.push(`Max length: ${req.maxLength} characters.`);
  sections.push(`</context>`);
  sections.push(
    'Rules: Use concrete numbers. Use first person. Avoid "leverage", "synergy", "delve into", "in today\'s fast-paced". No fake urgency. Return only the body text.',
  );
  return sections.join('\n');
}

function buildRewritePrompt(original: string, feedback: string): string {
  return [
    'You are rewriting content to sound more authentic and less AI-generated.',
    '<original>',
    original,
    '</original>',
    '<feedback>',
    feedback,
    '</feedback>',
    'Rules: Remove phrases like "delve into", "leverage", "synergy", "in today\'s fast-paced". Replace vague claims with concrete numbers. Use first person. Return only the rewritten text.',
  ].join('\n');
}

// ─── Heuristic fallback ───

function renderTemplate(req: ContentRequest): string {
  const lines: string[] = [
    `Notes on ${req.topic} for ${req.audience}.`,
    '',
    `This is a placeholder draft generated without an LLM.`,
  ];
  if (req.keywords?.length) {
    lines.push(`Keywords to cover: ${req.keywords.join(', ')}.`);
  }
  lines.push(`Replace this with the real content.`);
  const out = lines.join('\n');
  return req.maxLength ? out.slice(0, req.maxLength) : out;
}

const AI_PHRASE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdelve into\b/gi, 'look at'],
  [/\bleverage\b/gi, 'use'],
  [/\bleveraging\b/gi, 'using'],
  [/\bsynergy\b/gi, 'fit'],
  [/\bin today's fast-paced (world|landscape|environment)\b/gi, 'today'],
  [/\bnavigate the landscape\b/gi, 'work through this'],
  [/\bit's important to note\b/gi, ''],
  [/\bfurthermore\b/gi, 'also'],
  [/\bmoreover\b/gi, 'also'],
];

function stripAiTells(text: string): string {
  return AI_PHRASE_REPLACEMENTS.reduce(
    (acc, [re, rep]) => acc.replace(re, rep),
    text,
  )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Next-action suggestions ───

function nextActionFor(type: ContentType): NextAction {
  switch (type) {
    case 'blog_post':
      return {
        title: 'Publish to blog',
        description: 'Push this draft to the CMS and queue it for review.',
        cta: 'Publish',
      };
    case 'email':
      return {
        title: 'Send to 10 leads',
        description: 'Pick 10 warm leads and send as a personalized 1:1.',
        cta: 'Send',
      };
    case 'social_post':
      return {
        title: 'Post to LinkedIn at 9am',
        description: 'Schedule for the next weekday morning window.',
        cta: 'Schedule',
      };
    case 'video_script':
      return {
        title: 'Record a 90-second take',
        description: 'One take, phone camera, ship the same day.',
        cta: 'Record',
      };
    case 'landing_copy':
      return {
        title: 'Swap on staging',
        description: 'Deploy to the staging landing page and A/B test.',
        cta: 'Deploy',
      };
  }
}

// ─── Utilities ───

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

function truncateMaybe(s: string, n?: number): string {
  return n ? truncate(s, n) : s;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
