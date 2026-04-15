import { describe, it, expect } from 'vitest';
import { CofounderEngine, type StrengthInput } from '../index.js';

const mockDb = {} as any;

function engine() {
  return new CofounderEngine(mockDb);
}

describe('CofounderEngine.scoreComplement', () => {
  // ─── Dimension-to-role mapping ───

  it('maps technical → engineering', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 50 }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.roleName).toBe('engineering');
  });

  it('maps sales → growth', async () => {
    const result = await engine().scoreComplement([{ dimension: 'sales', score: 50 }]);
    expect(result[0]!.roleName).toBe('growth');
  });

  it('maps design → design', async () => {
    const result = await engine().scoreComplement([{ dimension: 'design', score: 50 }]);
    expect(result[0]!.roleName).toBe('design');
  });

  it('maps ops → ops', async () => {
    const result = await engine().scoreComplement([{ dimension: 'ops', score: 50 }]);
    expect(result[0]!.roleName).toBe('ops');
  });

  it('maps domain → product', async () => {
    const result = await engine().scoreComplement([{ dimension: 'domain', score: 50 }]);
    expect(result[0]!.roleName).toBe('product');
  });

  // ─── Gap calculation ───

  it('calculates gap as 100 - score', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 30 }]);
    expect(result[0]!.gap).toBe(70);
    expect(result[0]!.founderScore).toBe(30);
  });

  it('calculates gap of 0 when score is 100', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 100 }]);
    expect(result[0]!.gap).toBe(0);
  });

  it('calculates gap of 100 when score is 0', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 0 }]);
    expect(result[0]!.gap).toBe(100);
  });

  // ─── Priority thresholds ───

  it('assigns critical when gap >= 60', async () => {
    // score 40 → gap 60
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 40 }]);
    expect(result[0]!.priority).toBe('critical');
  });

  it('assigns critical when gap > 60', async () => {
    // score 10 → gap 90
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 10 }]);
    expect(result[0]!.priority).toBe('critical');
  });

  it('assigns recommended when gap >= 40 and < 60', async () => {
    // score 60 → gap 40
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 60 }]);
    expect(result[0]!.priority).toBe('recommended');
  });

  it('assigns recommended at gap exactly 40', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 60 }]);
    expect(result[0]!.gap).toBe(40);
    expect(result[0]!.priority).toBe('recommended');
  });

  it('assigns recommended at gap 59 (boundary)', async () => {
    // score 41 → gap 59
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 41 }]);
    expect(result[0]!.gap).toBe(59);
    expect(result[0]!.priority).toBe('recommended');
  });

  it('assigns optional when gap < 40', async () => {
    // score 80 → gap 20
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 80 }]);
    expect(result[0]!.priority).toBe('optional');
  });

  it('assigns optional at gap 39 (boundary)', async () => {
    // score 61 → gap 39
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 61 }]);
    expect(result[0]!.gap).toBe(39);
    expect(result[0]!.priority).toBe('optional');
  });

  // ─── All low scores (all critical) ───

  it('returns all critical when all scores are low', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 10 },
      { dimension: 'sales', score: 20 },
      { dimension: 'design', score: 15 },
      { dimension: 'ops', score: 5 },
      { dimension: 'domain', score: 25 },
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result).toHaveLength(5);
    for (const item of result) {
      expect(item.priority).toBe('critical');
    }
  });

  // ─── All high scores (all optional) ───

  it('returns all optional when all scores are high', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 90 },
      { dimension: 'sales', score: 85 },
      { dimension: 'design', score: 95 },
      { dimension: 'ops', score: 80 },
      { dimension: 'domain', score: 88 },
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result).toHaveLength(5);
    for (const item of result) {
      expect(item.priority).toBe('optional');
    }
  });

  // ─── Mixed scores ───

  it('returns mixed priorities for mixed scores', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 10 },  // gap 90 → critical
      { dimension: 'sales', score: 55 },      // gap 45 → recommended
      { dimension: 'design', score: 90 },     // gap 10 → optional
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result).toHaveLength(3);

    const priorities = result.map((r) => r.priority);
    expect(priorities).toContain('critical');
    expect(priorities).toContain('recommended');
    expect(priorities).toContain('optional');
  });

  // ─── Sorting by gap descending ───

  it('sorts results by gap descending', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 80 },  // gap 20
      { dimension: 'sales', score: 10 },      // gap 90
      { dimension: 'design', score: 50 },     // gap 50
      { dimension: 'ops', score: 30 },        // gap 70
      { dimension: 'domain', score: 60 },     // gap 40
    ];
    const result = await engine().scoreComplement(strengths);

    const gaps = result.map((r) => r.gap);
    expect(gaps).toEqual([90, 70, 50, 40, 20]);
  });

  it('first element always has the largest gap', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 95 },
      { dimension: 'sales', score: 5 },
      { dimension: 'design', score: 50 },
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result[0]!.gap).toBe(95);
    expect(result[0]!.roleName).toBe('growth');
  });

  // ─── Empty input ───

  it('returns empty array for empty strengths', async () => {
    const result = await engine().scoreComplement([]);
    expect(result).toEqual([]);
  });

  // ─── Unknown dimensions are skipped ───

  it('skips unknown dimensions', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'underwater_basket_weaving', score: 10 },
      { dimension: 'telepathy', score: 20 },
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result).toEqual([]);
  });

  it('only returns mapped dimensions, skipping unknowns', async () => {
    const strengths: StrengthInput[] = [
      { dimension: 'technical', score: 30 },
      { dimension: 'unknown', score: 50 },
      { dimension: 'sales', score: 70 },
    ];
    const result = await engine().scoreComplement(strengths);
    expect(result).toHaveLength(2);

    const roleNames = result.map((r) => r.roleName);
    expect(roleNames).toContain('engineering');
    expect(roleNames).toContain('growth');
  });

  // ─── Reason text ───

  it('includes critical reason text for large gaps', async () => {
    const result = await engine().scoreComplement([{ dimension: 'technical', score: 10 }]);
    expect(result[0]!.reason).toContain('critical gap');
    expect(result[0]!.reason).toContain('10/100');
    expect(result[0]!.reason).toContain('engineering');
  });

  it('includes recommended reason text for moderate gaps', async () => {
    const result = await engine().scoreComplement([{ dimension: 'sales', score: 55 }]);
    expect(result[0]!.reason).toContain('Moderate gap');
    expect(result[0]!.reason).toContain('growth');
  });

  it('includes optional reason text for small gaps', async () => {
    const result = await engine().scoreComplement([{ dimension: 'design', score: 90 }]);
    expect(result[0]!.reason).toContain('optional');
    expect(result[0]!.reason).toContain('design');
  });

  // ─── Single dimension ───

  it('handles single dimension input correctly', async () => {
    const result = await engine().scoreComplement([{ dimension: 'ops', score: 45 }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      roleName: 'ops',
      founderScore: 45,
      gap: 55,
      priority: 'recommended',
      reason: expect.stringContaining('Moderate gap'),
    });
  });
});
