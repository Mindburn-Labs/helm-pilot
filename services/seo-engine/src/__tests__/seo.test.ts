import { describe, expect, it } from 'vitest';
import { GeoAnalyzer, SeoEngine, TraditionalSeoAnalyzer } from '../index.js';

describe('TraditionalSeoAnalyzer', () => {
  const analyzer = new TraditionalSeoAnalyzer();

  it('scores a 55-char title at 100', () => {
    const title = 'x'.repeat(55);
    const result = analyzer.analyze({
      title,
      description: 'y'.repeat(140),
    });
    expect(result.titleTag.score).toBe(100);
  });

  it('scores a 120-char title low', () => {
    const title = 'x'.repeat(120);
    const result = analyzer.analyze({
      title,
      description: 'y'.repeat(140),
    });
    expect(result.titleTag.score).toBeLessThan(50);
  });
});

describe('GeoAnalyzer', () => {
  const analyzer = new GeoAnalyzer();

  it('gives higher factualDensity to number-rich text', () => {
    const richHtml =
      '<p>In 2024, revenue grew 47% to $120M across 15 markets. The CEO announced 3 new products on March 15, 2025.</p>';
    const plainHtml =
      '<p>The company grew last year across several markets and announced some new products.</p>';
    const rich = analyzer.analyze({ title: 'T', description: 'D', html: richHtml });
    const plain = analyzer.analyze({ title: 'T', description: 'D', html: plainHtml });
    expect(rich.factualDensity).toBeGreaterThan(plain.factualDensity);
  });

  it('generates valid FAQPage JSON-LD', () => {
    const out = analyzer.generateSchemaMarkup({
      type: 'FAQPage',
      data: {
        qas: [
          { question: 'What is GEO?', answer: 'Generative Engine Optimization.' },
          { question: 'Why does it matter?', answer: 'AI search engines cite structured content.' },
        ],
      },
    });
    const parsed = JSON.parse(out) as {
      '@context': string;
      '@type': string;
      mainEntity: Array<{
        '@type': string;
        name: string;
        acceptedAnswer: { '@type': string; text: string };
      }>;
    };
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('FAQPage');
    expect(parsed.mainEntity).toHaveLength(2);
    const first = parsed.mainEntity[0];
    expect(first?.['@type']).toBe('Question');
    expect(first?.name).toBe('What is GEO?');
    expect(first?.acceptedAnswer['@type']).toBe('Answer');
  });

  it('detects 3+ column comparison tables', () => {
    const html = `
      <table>
        <tr><th>Feature</th><th>Plan A</th><th>Plan B</th><th>Plan C</th></tr>
        <tr><td>Price</td><td>$10</td><td>$20</td><td>$30</td></tr>
      </table>`;
    const result = analyzer.analyze({ title: 'T', description: 'D', html });
    expect(result.comparisonTables).toBeGreaterThan(0);
  });
});

describe('SeoEngine', () => {
  const engine = new SeoEngine();

  it('sorts recommendations by priority (high first)', async () => {
    const result = await engine.audit({
      title: 't',
      description: 'short',
      html: '<p>minimal</p>',
      keywords: ['missing-keyword'],
    });
    const priorities = result.recommendations.map((r) => r.priority);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const asNums = priorities.map((p) => rank[p]);
    const sorted = [...asNums].sort((a, b) => a - b);
    expect(asNums).toEqual(sorted);
  });

  it('keeps both traditional and GEO scores in [0, 100]', async () => {
    const result = await engine.audit({
      title: 'Generative Engine Optimization: The Complete 2026 Guide',
      description:
        'Learn how to make your content discoverable by ChatGPT, Perplexity, Gemini, and Claude with this practical guide.',
      html:
        '<h1>What is GEO?</h1><h2>How does it work?</h2><p>In 2026, 47% of search traffic comes from AI engines like ChatGPT and Perplexity. By Jane Doe, PhD.</p><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>',
      keywords: ['GEO', 'generative engine optimization'],
    });
    expect(result.traditional.overall).toBeGreaterThanOrEqual(0);
    expect(result.traditional.overall).toBeLessThanOrEqual(100);
    expect(result.geo.overall).toBeGreaterThanOrEqual(0);
    expect(result.geo.overall).toBeLessThanOrEqual(100);
  });

  it('returns sensible (non-NaN) scores for empty content', async () => {
    const result = await engine.audit({
      title: '',
      description: '',
    });
    expect(Number.isFinite(result.traditional.overall)).toBe(true);
    expect(Number.isFinite(result.geo.overall)).toBe(true);
    expect(result.traditional.overall).toBeGreaterThanOrEqual(0);
    expect(result.geo.overall).toBeGreaterThanOrEqual(0);
  });
});
