import type { GeoScore, SeoAuditRequest } from './types.js';

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const scoreFactualDensity = (text: string): number => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const numbers = countMatches(text, /\b\d[\d,.]*\b/g);
  const dates = countMatches(
    text,
    /\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
  );
  const percentages = countMatches(text, /\b\d+(?:\.\d+)?%/g);
  const currency = countMatches(text, /\$\d|\b\d+\s*(?:usd|eur|gbp)\b/gi);
  const factLikeUnits = numbers + dates + percentages + currency;
  const per100 = (factLikeUnits / words.length) * 100;
  return clamp(per100 * 10);
};

const scoreCitationReadiness = (text: string): number => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const properNouns = countMatches(text, /\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*\b/g);
  const specificMetrics = countMatches(text, /\b\d+(?:\.\d+)?\s*(?:x|%|ms|s|gb|mb|kb|k|m|b|bn|usd)\b/gi);
  const hasQuotes = /"[^"]{10,}"|\u201c[^\u201d]{10,}\u201d/.test(text) ? 1 : 0;
  const raw = (properNouns / Math.max(words.length, 1)) * 100 * 2 + specificMetrics * 3 + hasQuotes * 10;
  return clamp(raw);
};

const scoreQuestionAnswerStructure = (html: string, text: string): number => {
  const headingTexts = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) =>
    (m[1] ?? '').replace(/<[^>]+>/g, '').trim(),
  );
  const questionHeadings = headingTexts.filter((h) =>
    /^\s*(what|why|how|when|where|who|should|can|is|are|does|do)\b.+\?/i.test(h),
  ).length;
  const totalHeadings = headingTexts.length;
  const headingRatio = totalHeadings > 0 ? questionHeadings / totalHeadings : 0;
  const inlineQuestions = countMatches(text, /\b(?:what|why|how|when|where|who)\s+[a-z][^.!?]{5,}\?/gi);
  const raw = headingRatio * 80 + Math.min(inlineQuestions * 5, 20);
  return clamp(raw);
};

const scoreStructuredData = (html: string): number => {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks || blocks.length === 0) return 0;
  const bonusTypes = ['FAQPage', 'HowTo', 'Article', 'Product', 'Organization', 'BreadcrumbList', 'Person'];
  const typeHits = bonusTypes.filter((t) =>
    blocks.some((b) => new RegExp(`"@type"\\s*:\\s*"${t}"`, 'i').test(b)),
  ).length;
  const raw = 40 + blocks.length * 10 + typeHits * 8;
  return clamp(raw);
};

const scoreExpertSignaling = (html: string, text: string): number => {
  const byAuthor = countMatches(text, /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g);
  const authorSchema = /"author"\s*:\s*\{[^}]*"@type"\s*:\s*"Person"/i.test(html) ? 1 : 0;
  const credentials = countMatches(
    text,
    /\b(?:PhD|Ph\.D\.|MD|M\.D\.|CEO|CTO|CFO|Professor|Dr\.|Director|Head of|VP\s+of|Lead|Principal)\b/g,
  );
  const yearsExp = countMatches(text, /\b\d+\+?\s+years?\s+(?:of\s+)?(?:experience|expertise)\b/gi);
  const bioMarker = /<[^>]*class=["'][^"']*(?:author|bio|byline)[^"']*["']/i.test(html) ? 1 : 0;
  const raw = byAuthor * 15 + authorSchema * 25 + Math.min(credentials * 8, 30) + yearsExp * 10 + bioMarker * 20;
  return clamp(raw);
};

const scoreComparisonTables = (html: string): number => {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  if (tables.length === 0) return 0;
  const qualifying = tables.filter((m) => {
    const body = m[1] ?? '';
    const firstRow = body.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    if (!firstRow || !firstRow[1]) return false;
    const cellCount = countMatches(firstRow[1], /<t[hd]\b/gi);
    if (cellCount < 3) return false;
    const hasComparisonSignal = /\b(?:vs\.?|versus|compare|comparison|feature|price|pros|cons|plan|tier)\b/i.test(
      body,
    );
    return hasComparisonSignal;
  }).length;
  const raw = qualifying === 0 ? tables.length * 15 : qualifying * 40;
  return clamp(raw);
};

export class GeoAnalyzer {
  analyze(req: SeoAuditRequest): GeoScore {
    const html = req.html ?? '';
    const text = stripHtml(html) || `${req.title} ${req.description}`;

    const factualDensity = scoreFactualDensity(text);
    const citationReadiness = scoreCitationReadiness(text);
    const questionAnswerStructure = scoreQuestionAnswerStructure(html, text);
    const structuredData = scoreStructuredData(html);
    const expertSignaling = scoreExpertSignaling(html, text);
    const comparisonTables = scoreComparisonTables(html);

    const overall = clamp(
      (factualDensity +
        citationReadiness +
        questionAnswerStructure +
        structuredData +
        expertSignaling +
        comparisonTables) /
        6,
    );

    return {
      overall,
      factualDensity,
      citationReadiness,
      questionAnswerStructure,
      structuredData,
      expertSignaling,
      comparisonTables,
    };
  }

  generateSchemaMarkup(params: {
    type: 'FAQPage' | 'HowTo' | 'Article' | 'Product' | 'Organization';
    data: Record<string, unknown>;
  }): string {
    const { type, data } = params;
    const base: Record<string, unknown> = { '@context': 'https://schema.org', '@type': type };

    const payload: Record<string, unknown> = (() => {
      if (type === 'FAQPage') {
        const qas = Array.isArray(data['qas'])
          ? (data['qas'] as Array<{ question: string; answer: string }>)
          : [];
        return {
          ...base,
          mainEntity: qas.map((qa) => ({
            '@type': 'Question',
            name: qa.question,
            acceptedAnswer: { '@type': 'Answer', text: qa.answer },
          })),
        };
      }
      if (type === 'HowTo') {
        const steps = Array.isArray(data['steps'])
          ? (data['steps'] as Array<{ name: string; text: string }>)
          : [];
        return {
          ...base,
          ...(data['name'] ? { name: data['name'] } : {}),
          step: steps.map((s, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: s.name,
            text: s.text,
          })),
        };
      }
      if (type === 'Article') {
        return {
          ...base,
          ...(data['headline'] ? { headline: data['headline'] } : {}),
          ...(data['author'] ? { author: { '@type': 'Person', name: data['author'] } } : {}),
          ...(data['datePublished'] ? { datePublished: data['datePublished'] } : {}),
          ...(data['description'] ? { description: data['description'] } : {}),
        };
      }
      if (type === 'Product') {
        return {
          ...base,
          ...(data['name'] ? { name: data['name'] } : {}),
          ...(data['description'] ? { description: data['description'] } : {}),
          ...(data['brand'] ? { brand: { '@type': 'Brand', name: data['brand'] } } : {}),
          ...(data['offers'] ? { offers: data['offers'] } : {}),
        };
      }
      return {
        ...base,
        ...(data['name'] ? { name: data['name'] } : {}),
        ...(data['url'] ? { url: data['url'] } : {}),
        ...(data['logo'] ? { logo: data['logo'] } : {}),
      };
    })();

    return JSON.stringify(payload, null, 2);
  }
}
