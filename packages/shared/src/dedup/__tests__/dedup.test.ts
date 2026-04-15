import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  contentHash,
  cosineSimilarity,
  dedup,
  dedupBatch,
  type DedupCandidate,
  type ExistingOpportunity,
} from '../index.js';

describe('contentHash', () => {
  it('is deterministic for the same input', () => {
    const a = contentHash('AI contract review', 'Uses LLMs for legal');
    const b = contentHash('AI contract review', 'Uses LLMs for legal');
    expect(a).toBe(b);
  });

  it('normalises case, whitespace, and punctuation', () => {
    const a = contentHash('AI Contract Review!', '  Uses  LLMs  for  Legal.  ');
    const b = contentHash('ai contract review', 'uses llms for legal');
    expect(a).toBe(b);
  });

  it('differs for semantically different content', () => {
    const a = contentHash('AI contract review', 'Uses LLMs for legal');
    const b = contentHash('Blockchain payments', 'Crypto wallet for merchants');
    expect(a).not.toBe(b);
  });

  it('is a valid SHA-256 hex string', () => {
    const hash = contentHash('test', 'test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns NaN for zero-length vectors', () => {
    expect(cosineSimilarity([], [])).toBeNaN();
  });

  it('returns NaN for zero-magnitude vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBeNaN();
  });

  it('is commutative (property-based)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -100, max: 100, noNaN: true }), { minLength: 3, maxLength: 3 }),
        fc.array(fc.float({ min: -100, max: 100, noNaN: true }), { minLength: 3, maxLength: 3 }),
        (a, b) => {
          const ab = cosineSimilarity(a, b);
          const ba = cosineSimilarity(b, a);
          if (Number.isNaN(ab)) return Number.isNaN(ba);
          return Math.abs(ab - ba) < 1e-6;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('result is in [-1, 1] for non-degenerate vectors (property-based)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }), { minLength: 3, maxLength: 3 }),
        fc.array(fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }), { minLength: 3, maxLength: 3 }),
        (a, b) => {
          const sim = cosineSimilarity(a, b);
          return sim >= -1 - 1e-6 && sim <= 1 + 1e-6;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('dedup', () => {
  const base: DedupCandidate = {
    title: 'AI contract review',
    description: 'Uses LLMs for legal contracts',
    source: 'hn',
  };

  const existing: ExistingOpportunity[] = [
    {
      id: 'opp-1',
      contentHash: contentHash('AI contract review', 'Uses LLMs for legal contracts'),
      embedding: [0.1, 0.9, 0.3],
      title: 'AI contract review',
      source: 'producthunt',
    },
    {
      id: 'opp-2',
      contentHash: contentHash('Blockchain payments', 'Crypto wallet'),
      embedding: [0.8, 0.1, 0.2],
      title: 'Blockchain payments',
      source: 'reddit',
    },
  ];

  it('detects exact duplicate by content hash', () => {
    const result = dedup(base, existing);
    expect(result.kind).toBe('exact_duplicate');
    if (result.kind === 'exact_duplicate') {
      expect(result.existingId).toBe('opp-1');
    }
  });

  it('detects near-duplicate by embedding similarity', () => {
    // Same embedding as opp-1 but slightly different text
    const candidate: DedupCandidate = {
      title: 'AI legal contract analyzer',
      description: 'Language model-based legal review tool',
      source: 'hn',
      embedding: [0.1, 0.89, 0.31], // very similar to opp-1's [0.1, 0.9, 0.3]
    };
    const result = dedup(candidate, existing, 0.99);
    expect(result.kind).toBe('near_duplicate');
    if (result.kind === 'near_duplicate') {
      expect(result.existingId).toBe('opp-1');
      expect(result.similarity).toBeGreaterThan(0.99);
    }
  });

  it('returns novel when no match', () => {
    const candidate: DedupCandidate = {
      title: 'Quantum computing IDE',
      description: 'A completely different opportunity',
      source: 'github',
      embedding: [0.5, 0.5, 0.5],
    };
    const result = dedup(candidate, existing);
    expect(result.kind).toBe('novel');
  });

  it('returns novel for empty existing set', () => {
    expect(dedup(base, []).kind).toBe('novel');
  });

  it('handles missing embedding gracefully (hash-only dedup)', () => {
    const candidate: DedupCandidate = {
      title: 'Unique opportunity',
      description: 'No embedding available',
      source: 'manual',
      // no embedding
    };
    const result = dedup(candidate, existing);
    expect(result.kind).toBe('novel');
  });
});

describe('dedupBatch', () => {
  it('processes multiple candidates in one pass', () => {
    const existing: ExistingOpportunity[] = [
      {
        id: 'opp-1',
        contentHash: contentHash('AI review', 'Legal tool'),
        title: 'AI review',
        source: 'hn',
      },
    ];
    const candidates: DedupCandidate[] = [
      { title: 'AI review', description: 'Legal tool', source: 'ph' }, // exact dup
      { title: 'Blockchain', description: 'Payments', source: 'reddit' }, // novel
    ];
    const results = dedupBatch(candidates, existing);
    expect(results.get(0)?.kind).toBe('exact_duplicate');
    expect(results.get(1)?.kind).toBe('novel');
  });

  it('property: every candidate gets a verdict', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (n) => {
          const candidates = Array.from({ length: n }, (_, i) => ({
            title: `opp-${i}`,
            description: `desc-${i}`,
            source: 'test',
          }));
          const results = dedupBatch(candidates, []);
          return results.size === n;
        },
      ),
      { numRuns: 50 },
    );
  });
});
