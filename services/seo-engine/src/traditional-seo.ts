import type { SeoAuditRequest, TraditionalSeoScore } from './types.js';

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const scoreTitle = (title: string): { score: number; findings: string[] } => {
  const findings: string[] = [];
  const len = title.trim().length;
  if (len === 0) {
    findings.push('Title is empty');
    return { score: 0, findings };
  }
  if (len < 30) {
    findings.push(`Title is ${len} chars — target 30-60`);
    return { score: clamp((len / 30) * 70), findings };
  }
  if (len > 60) {
    findings.push(`Title is ${len} chars — target 30-60, risks truncation in SERPs`);
    const over = len - 60;
    return { score: clamp(100 - over * 2), findings };
  }
  findings.push(`Title length ${len} chars is optimal`);
  return { score: 100, findings };
};

const scoreMeta = (desc: string): { score: number; findings: string[] } => {
  const findings: string[] = [];
  const len = desc.trim().length;
  if (len === 0) {
    findings.push('Meta description is empty');
    return { score: 0, findings };
  }
  if (len < 120) {
    findings.push(`Meta description is ${len} chars — target 120-160`);
    return { score: clamp((len / 120) * 70), findings };
  }
  if (len > 160) {
    findings.push(`Meta description is ${len} chars — target 120-160, risks truncation`);
    const over = len - 160;
    return { score: clamp(100 - over * 2), findings };
  }
  findings.push(`Meta description length ${len} chars is optimal`);
  return { score: 100, findings };
};

const scoreHeadings = (html: string): { score: number; findings: string[] } => {
  const findings: string[] = [];
  if (!html) {
    findings.push('No HTML provided');
    return { score: 50, findings };
  }
  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  const h2Count = countMatches(html, /<h2\b[^>]*>/gi);
  const h3Count = countMatches(html, /<h3\b[^>]*>/gi);

  const h1Score = h1Count === 1 ? 50 : h1Count === 0 ? 0 : 20;
  if (h1Count === 1) findings.push('Exactly one H1 — optimal');
  else if (h1Count === 0) findings.push('Missing H1 tag');
  else findings.push(`${h1Count} H1 tags found — use exactly one`);

  const h2Score = h2Count >= 1 ? 30 : 0;
  if (h2Count >= 1) findings.push(`${h2Count} H2 sections provide structure`);
  else findings.push('No H2 tags — add subsections');

  const h3Score = h3Count >= 1 ? 20 : 0;
  if (h3Count >= 1) findings.push(`${h3Count} H3 tags deepen hierarchy`);

  return { score: clamp(h1Score + h2Score + h3Score), findings };
};

const scoreKeywords = (req: SeoAuditRequest): { score: number; findings: string[] } => {
  const findings: string[] = [];
  const keywords = req.keywords ?? [];
  if (keywords.length === 0) {
    findings.push('No target keywords specified');
    return { score: 50, findings };
  }
  const primary = keywords[0]?.toLowerCase() ?? '';
  if (!primary) {
    findings.push('Primary keyword is empty');
    return { score: 30, findings };
  }
  const titleLower = req.title.toLowerCase();
  const titleHit = titleLower.includes(primary);
  if (titleHit) findings.push(`Primary keyword "${primary}" appears in title`);
  else findings.push(`Primary keyword "${primary}" missing from title`);

  const html = req.html ?? '';
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match && h1Match[1] ? h1Match[1].toLowerCase() : '';
  const h1Hit = h1Text.includes(primary);
  if (h1Hit) findings.push('Primary keyword appears in H1');
  else if (html) findings.push('Primary keyword not in H1');

  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const first100 = plain.trim().split(/\s+/).slice(0, 100).join(' ').toLowerCase();
  const leadHit = first100.includes(primary);
  if (leadHit) findings.push('Primary keyword in first 100 words');
  else if (plain) findings.push('Primary keyword missing from opening paragraph');

  const score = (titleHit ? 40 : 0) + (h1Hit ? 30 : 0) + (leadHit ? 30 : 0);
  return { score: clamp(score), findings };
};

const scoreSchema = (html: string): { score: number; findings: string[] } => {
  const findings: string[] = [];
  if (!html) {
    findings.push('No HTML provided');
    return { score: 0, findings };
  }
  const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi);
  if (!jsonLdMatches || jsonLdMatches.length === 0) {
    findings.push('No JSON-LD schema.org markup detected');
    return { score: 0, findings };
  }
  findings.push(`${jsonLdMatches.length} JSON-LD block(s) detected`);
  return { score: clamp(60 + jsonLdMatches.length * 15), findings };
};

const scorePageSpeed = (html: string): { score: number; findings: string[] } => {
  const findings: string[] = [];
  if (!html) {
    findings.push('No HTML provided — skipping page speed heuristics');
    return { score: 60, findings };
  }
  const inlineStyleBytes = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).reduce(
    (sum, block) => sum + block.length,
    0,
  );
  const cssPenalty = inlineStyleBytes > 50_000 ? 30 : 0;
  if (cssPenalty > 0) findings.push(`${inlineStyleBytes} bytes of inline CSS — consider externalizing`);

  const imgCount = countMatches(html, /<img\b/gi);
  const imgPenalty = imgCount > 20 ? 20 : 0;
  if (imgPenalty > 0) findings.push(`${imgCount} images — consider lazy loading`);

  const scriptCount = countMatches(html, /<script\b/gi);
  const scriptPenalty = scriptCount > 15 ? 15 : 0;
  if (scriptPenalty > 0) findings.push(`${scriptCount} script tags — review for bloat`);

  if (findings.length === 0) findings.push('Page weight heuristics look healthy');
  return { score: clamp(100 - cssPenalty - imgPenalty - scriptPenalty), findings };
};

export class TraditionalSeoAnalyzer {
  analyze(req: SeoAuditRequest): TraditionalSeoScore {
    const html = req.html ?? '';
    const titleTag = scoreTitle(req.title);
    const metaDescription = scoreMeta(req.description);
    const headings = scoreHeadings(html);
    const keywordUsage = scoreKeywords(req);
    const schemaMarkup = scoreSchema(html);
    const pageSpeed = scorePageSpeed(html);

    const overall = clamp(
      (titleTag.score +
        metaDescription.score +
        headings.score +
        keywordUsage.score +
        schemaMarkup.score +
        pageSpeed.score) /
        6,
    );

    return {
      overall,
      titleTag,
      metaDescription,
      headings,
      keywordUsage,
      schemaMarkup,
      pageSpeed,
    };
  }
}
