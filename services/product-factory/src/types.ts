/** MoSCoW priority for feature items. */
export type MoSCoWPriority = 'must' | 'should' | 'could' | 'wont';

/** A single feature with MoSCoW prioritization. */
export interface FeatureItem {
  title: string;
  description: string;
  priority: MoSCoWPriority;
}

/** Structured breakdown within a ProductSpec. */
export interface StructuredSpec {
  problem: string;
  targetUser: string;
  userJourney: string[];
  features: FeatureItem[];
  techStack: string[];
  openQuestions: string[];
  acceptanceCriteria: string[];
}

/** Full product specification output. */
export interface ProductSpec {
  version: number;
  markdown: string;
  structured: StructuredSpec;
  generatedAt: string;
}

/** Parameters for generating a new spec. */
export interface SpecParams {
  opportunity: string;
  founderProfile?: string;
  operatorRole?: string;
}

/** Parameters for revising an existing spec. */
export interface RevisionParams {
  previousSpec: ProductSpec;
  feedback: string;
}

/** A single file entry in a scaffold result. */
export interface ScaffoldFile {
  path: string;
  description: string;
  contentHint: string;
}

/** Result of scaffold generation. */
export interface ScaffoldResult {
  template: ScaffoldTemplate;
  files: ScaffoldFile[];
  generatedAt: string;
}

/** Supported scaffold templates. */
export type ScaffoldTemplate = 'nextjs-landing' | 'fastify-api' | 'expo-mobile';
