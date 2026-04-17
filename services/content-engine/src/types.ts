export type ContentType = 'blog_post' | 'email' | 'social_post' | 'video_script' | 'landing_copy';

export interface ContentRequest {
  readonly contentType: ContentType;
  readonly topic: string;
  readonly audience: string;
  readonly founderVoice?: { readonly tone?: string; readonly examples?: readonly string[] };
  readonly keywords?: readonly string[];
  readonly maxLength?: number;
  readonly language?: 'en' | 'es' | 'zh-CN' | 'ja' | string;
}

export interface ContentResult {
  readonly contentType: ContentType;
  readonly body: string;
  readonly title?: string;
  readonly authenticityScore: AuthenticityScore;
  readonly headlineScore?: HeadlineScore;
  readonly nextAction: NextAction;
  readonly generatedAt: Date;
  readonly promptVersion: string;
  readonly method: 'llm' | 'heuristic';
}

export interface NextAction {
  readonly title: string;
  readonly description: string;
  readonly cta: string;
}

export type AuthenticityVerdict = 'authentic' | 'generic' | 'salesy' | 'ai_tell';

export interface AuthenticityScore {
  readonly overall: number;
  readonly signals: readonly AuthenticitySignal[];
  readonly verdict: AuthenticityVerdict;
}

export type AuthenticitySignalName =
  | 'specific_examples'
  | 'personal_voice'
  | 'vague_claims'
  | 'ai_phrases'
  | 'buzzwords'
  | 'clichés'
  | 'passive_voice'
  | 'long_sentences'
  | 'empty_adjectives'
  | 'fake_urgency'
  | 'missing_evidence'
  | 'stock_opener';

export interface AuthenticitySignal {
  readonly name: AuthenticitySignalName;
  readonly detected: boolean;
  readonly notes?: string;
}

export interface HeadlineScore {
  readonly overall: number;
  readonly dimensions: HeadlineDimensions;
}

export interface HeadlineDimensions {
  readonly specificity: number;
  readonly benefit_clarity: number;
  readonly curiosity: number;
  readonly brevity: number;
  readonly power_words: number;
}
