import { GeoAnalyzer } from './geo-analyzer.js';
import { TraditionalSeoAnalyzer } from './traditional-seo.js';
import type {
  GeoScore,
  SeoAuditRequest,
  SeoAuditResult,
  SeoRecommendation,
  TraditionalSeoScore,
} from './types.js';

export { GeoAnalyzer } from './geo-analyzer.js';
export { TraditionalSeoAnalyzer } from './traditional-seo.js';
export type {
  GeoScore,
  SeoAuditRequest,
  SeoAuditResult,
  SeoRecommendation,
  TraditionalSeoScore,
} from './types.js';

const priorityRank = (p: SeoRecommendation['priority']): number =>
  p === 'high' ? 0 : p === 'medium' ? 1 : 2;

const buildTraditionalRecs = (t: TraditionalSeoScore): SeoRecommendation[] => {
  const recs: SeoRecommendation[] = [];
  if (t.titleTag.score < 80) {
    recs.push({
      category: 'traditional',
      priority: t.titleTag.score < 40 ? 'high' : 'medium',
      title: 'Optimize title tag length',
      description: t.titleTag.findings.join(' '),
    });
  }
  if (t.metaDescription.score < 80) {
    recs.push({
      category: 'traditional',
      priority: t.metaDescription.score < 40 ? 'high' : 'medium',
      title: 'Rewrite meta description',
      description: t.metaDescription.findings.join(' '),
    });
  }
  if (t.headings.score < 70) {
    recs.push({
      category: 'traditional',
      priority: 'medium',
      title: 'Fix heading hierarchy',
      description: t.headings.findings.join(' '),
    });
  }
  if (t.keywordUsage.score < 60) {
    recs.push({
      category: 'traditional',
      priority: 'high',
      title: 'Place primary keyword prominently',
      description: t.keywordUsage.findings.join(' '),
    });
  }
  return recs;
};

const buildGeoRecs = (g: GeoScore): SeoRecommendation[] => {
  const recs: SeoRecommendation[] = [];
  if (g.structuredData < 60) {
    recs.push({
      category: 'geo',
      priority: 'high',
      title: 'Add JSON-LD structured data',
      description:
        'AI search engines (ChatGPT, Perplexity, Gemini, Claude) preferentially cite pages with rich schema.org markup. Add FAQPage, Article, or HowTo schema.',
      codeSnippet: new GeoAnalyzer().generateSchemaMarkup({
        type: 'FAQPage',
        data: {
          qas: [
            { question: 'What is this page about?', answer: 'Describe the page in one sentence.' },
          ],
        },
      }),
    });
  }
  if (g.factualDensity < 50) {
    recs.push({
      category: 'geo',
      priority: 'medium',
      title: 'Increase factual density',
      description:
        'Add more specific numbers, dates, percentages, and verifiable claims. AI engines cite pages that read like primary sources.',
    });
  }
  if (g.citationReadiness < 50) {
    recs.push({
      category: 'geo',
      priority: 'medium',
      title: 'Improve citation readiness',
      description:
        'Include proper nouns, named entities, and direct quotes. LLMs preferentially surface content with attributable details.',
    });
  }
  if (g.questionAnswerStructure < 40) {
    recs.push({
      category: 'geo',
      priority: 'medium',
      title: 'Add Q&A heading structure',
      description:
        'Convert headings to question form ("What is X?", "How do I Y?"). AI search engines match these directly to user queries.',
    });
  }
  if (g.expertSignaling < 40) {
    recs.push({
      category: 'geo',
      priority: 'low',
      title: 'Add expert signaling',
      description:
        'Include author bio, credentials, years of experience. AI engines weight E-E-A-T signals when selecting citations.',
    });
  }
  if (g.comparisonTables < 30) {
    recs.push({
      category: 'geo',
      priority: 'low',
      title: 'Add comparison tables',
      description:
        'Tables comparing 3+ options with features/pricing are disproportionately cited by AI search engines for "X vs Y" queries.',
    });
  }
  return recs;
};

const pickNextAction = (
  t: TraditionalSeoScore,
  g: GeoScore,
  recs: SeoRecommendation[],
): { title: string; description: string; cta: string } => {
  const top = recs[0];
  if (!top) {
    return {
      title: 'Site looks healthy',
      description: `Traditional SEO ${t.overall}/100, GEO ${g.overall}/100. Keep publishing.`,
      cta: 'Publish more content',
    };
  }
  return {
    title: top.title,
    description: top.description,
    cta: top.priority === 'high' ? 'Fix now' : 'Schedule',
  };
};

export class SeoEngine {
  private readonly traditional = new TraditionalSeoAnalyzer();
  private readonly geo = new GeoAnalyzer();

  constructor() {}

  async audit(req: SeoAuditRequest): Promise<SeoAuditResult> {
    const traditional = this.traditional.analyze(req);
    const geo = this.geo.analyze(req);
    const stub: SeoAuditResult = {
      traditional,
      geo,
      recommendations: [],
      nextAction: { title: '', description: '', cta: '' },
      generatedAt: new Date(),
    };
    const recommendations = this.suggestImprovements(stub);
    const nextAction = pickNextAction(traditional, geo, recommendations);
    return {
      traditional,
      geo,
      recommendations,
      nextAction,
      generatedAt: new Date(),
    };
  }

  suggestImprovements(audit: SeoAuditResult): SeoRecommendation[] {
    const recs = [...buildTraditionalRecs(audit.traditional), ...buildGeoRecs(audit.geo)];
    return recs.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  }
}
