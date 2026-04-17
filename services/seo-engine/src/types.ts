export interface SeoAuditRequest {
  url?: string;
  html?: string;
  title: string;
  description: string;
  keywords?: string[];
}

export interface SeoAuditResult {
  traditional: TraditionalSeoScore;
  geo: GeoScore;
  recommendations: SeoRecommendation[];
  nextAction: { title: string; description: string; cta: string };
  generatedAt: Date;
}

export interface TraditionalSeoScore {
  overall: number;
  titleTag: { score: number; findings: string[] };
  metaDescription: { score: number; findings: string[] };
  headings: { score: number; findings: string[] };
  keywordUsage: { score: number; findings: string[] };
  schemaMarkup: { score: number; findings: string[] };
  pageSpeed: { score: number; findings: string[] };
}

export interface GeoScore {
  overall: number;
  factualDensity: number;
  citationReadiness: number;
  questionAnswerStructure: number;
  structuredData: number;
  expertSignaling: number;
  comparisonTables: number;
}

export interface SeoRecommendation {
  category: 'traditional' | 'geo' | 'both';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  codeSnippet?: string;
}
