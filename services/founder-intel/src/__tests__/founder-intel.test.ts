import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FounderIntelService, type LlmProvider } from '../index.js';

// ─── Mock Db Factory ───

function createThenableChain(resolveValue: unknown = []): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

function createMockDb() {
  const insertedValues: Array<Record<string, unknown>> = [];

  const profileResult = {
    id: 'profile-001',
    workspaceId: 'ws-001',
    name: 'Test Founder',
    background: '',
    experience: '',
    interests: [],
    startupVector: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const db = {
    execute: vi.fn().mockResolvedValue([]),

    select: vi.fn().mockReturnValue(createThenableChain([])),

    insert: vi.fn().mockImplementation(() => {
      const valuesProxy = (val: unknown): Record<string, unknown> => {
        if (val && typeof val === 'object') {
          insertedValues.push(val as Record<string, unknown>);
        }
        return createThenableChain([profileResult]);
      };

      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve([profileResult]);
          }
          if (prop === 'values') {
            return vi.fn().mockImplementation(valuesProxy);
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        },
      };

      return new Proxy({}, handler);
    }),

    update: vi.fn().mockReturnValue(createThenableChain()),
    delete: vi.fn().mockReturnValue(createThenableChain()),

    // Test accessors
    _insertedValues: insertedValues,
    get _insertedStrengths() {
      return insertedValues.filter(
        (v) => 'dimension' in v,
      ) as Array<{ dimension: string; score: number; evidence: string }>;
    },
    _profileResult: profileResult,
  };

  return db;
}

// ─── Mock LLM ───

function createMockLlm(response: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

// ─── Valid LLM Response Fixtures ───

const VALID_LLM_JSON = JSON.stringify({
  name: 'Jane Doe',
  background: 'Stanford CS grad with 10 years at Google',
  experience: 'Built and sold a SaaS startup in 2020',
  interests: ['AI', 'healthcare', 'climate tech'],
  strengths: [
    { dimension: 'technical', score: 85, evidence: 'Deep engineering background' },
    { dimension: 'sales', score: 45, evidence: 'Some B2B experience' },
    { dimension: 'design', score: 30, evidence: 'Limited design exposure' },
    { dimension: 'ops', score: 60, evidence: 'Ran small team operations' },
    { dimension: 'domain', score: 70, evidence: 'Healthcare domain knowledge' },
  ],
  startupVector: 'AI-powered healthcare platform leveraging technical depth',
});

const VALID_LLM_WITH_FENCES = '```json\n' + VALID_LLM_JSON + '\n```';

const MALFORMED_LLM_RESPONSE = 'Sorry, I cannot parse the founder description properly.';

const PARTIAL_LLM_JSON = JSON.stringify({
  name: 'Bob',
  background: 'Self-taught developer',
  // Missing experience, interests, strengths, startupVector
});

// ─── Tests ───

describe('FounderIntelService', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // ─── processIntake() — valid JSON ───

  describe('processIntake() — valid LLM response', () => {
    it('parses clean JSON and returns structured profile', async () => {
      const llm = createMockLlm(VALID_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'I am Jane Doe...');

      expect(result.name).toBe('Jane Doe');
      expect(result.background).toBe('Stanford CS grad with 10 years at Google');
      expect(result.experience).toBe('Built and sold a SaaS startup in 2020');
      expect(result.interests).toEqual(['AI', 'healthcare', 'climate tech']);
      expect(result.strengths).toHaveLength(5);
      expect(result.strengths[0]).toEqual({
        dimension: 'technical',
        score: 85,
        evidence: 'Deep engineering background',
      });
      expect(result.startupVector).toBe(
        'AI-powered healthcare platform leveraging technical depth',
      );
    });

    it('calls llm.complete with a prompt containing the raw text', async () => {
      const llm = createMockLlm(VALID_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      await service.processIntake('ws-001', 'My background is in fintech');

      expect(llm.complete).toHaveBeenCalledTimes(1);
      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(prompt).toContain('My background is in fintech');
      expect(prompt).toContain('founder_description');
      expect(prompt).toContain('strengths');
    });

    it('inserts strength records into the database', async () => {
      const llm = createMockLlm(VALID_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      await service.processIntake('ws-001', 'I am Jane');

      // 5 strength dimensions should have been inserted
      expect(db._insertedStrengths.length).toBe(5);
      const dimensions = db._insertedStrengths.map((s) => s.dimension);
      expect(dimensions).toContain('technical');
      expect(dimensions).toContain('sales');
      expect(dimensions).toContain('design');
      expect(dimensions).toContain('ops');
      expect(dimensions).toContain('domain');
    });

    it('deletes existing strengths before inserting new ones', async () => {
      const llm = createMockLlm(VALID_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      await service.processIntake('ws-001', 'I am Jane');

      // delete() should have been called (to clear old strengths)
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ─── processIntake() — code fence stripping ───

  describe('processIntake() — code fence handling', () => {
    it('strips ```json ... ``` fences from LLM output', async () => {
      const llm = createMockLlm(VALID_LLM_WITH_FENCES);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'test input');

      // Should still parse correctly after stripping fences
      expect(result.name).toBe('Jane Doe');
      expect(result.strengths).toHaveLength(5);
      expect(result.interests).toEqual(['AI', 'healthcare', 'climate tech']);
    });

    it('handles fences without trailing newline', async () => {
      const noTrailingNewline = '```json' + VALID_LLM_JSON + '```';
      const llm = createMockLlm(noTrailingNewline);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'test input');

      expect(result.name).toBe('Jane Doe');
    });
  });

  // ─── processIntake() — malformed LLM output ───

  describe('processIntake() — malformed LLM output', () => {
    it('falls back to defaults when LLM returns non-JSON text', async () => {
      const llm = createMockLlm(MALFORMED_LLM_RESPONSE);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'some input');

      // Fallback values
      expect(result.name).toBe('Founder');
      expect(result.background).toBe(MALFORMED_LLM_RESPONSE.slice(0, 200));
      expect(result.experience).toBe('');
      expect(result.interests).toEqual([]);
      expect(result.startupVector).toBe('');
    });

    it('uses defaultStrengths() on parse failure — 5 dimensions, score 25', async () => {
      const llm = createMockLlm('this is not json at all');
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths).toHaveLength(5);
      const expectedDimensions = ['technical', 'sales', 'design', 'ops', 'domain'];
      for (let i = 0; i < 5; i++) {
        expect(result.strengths[i]!.dimension).toBe(expectedDimensions[i]);
        expect(result.strengths[i]!.score).toBe(25);
        expect(result.strengths[i]!.evidence).toBe('Not enough information to assess');
      }
    });

    it('truncates raw response to 200 chars for background fallback', async () => {
      const longGarbage = 'X'.repeat(500);
      const llm = createMockLlm(longGarbage);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.background).toBe('X'.repeat(200));
      expect(result.background.length).toBe(200);
    });
  });

  // ─── processIntake() — partial JSON ───

  describe('processIntake() — partial JSON', () => {
    it('fills in defaults for missing fields', async () => {
      const llm = createMockLlm(PARTIAL_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.name).toBe('Bob');
      expect(result.background).toBe('Self-taught developer');
      expect(result.experience).toBe('');
      expect(result.interests).toEqual([]);
      expect(result.startupVector).toBe('');
    });

    it('uses defaultStrengths when strengths array is missing', async () => {
      const llm = createMockLlm(PARTIAL_LLM_JSON);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths).toHaveLength(5);
      expect(result.strengths[0]!.score).toBe(25);
    });

    it('defaults name to "Founder" when name field is null', async () => {
      const llm = createMockLlm(JSON.stringify({ name: null }));
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.name).toBe('Founder');
    });

    it('converts non-array interests to empty array', async () => {
      const llm = createMockLlm(JSON.stringify({ interests: 'not an array' }));
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.interests).toEqual([]);
    });
  });

  // ─── processIntake() — score clamping ───

  describe('processIntake() — score clamping', () => {
    it('clamps scores above 100 to 100', async () => {
      const json = JSON.stringify({
        name: 'Max',
        strengths: [{ dimension: 'technical', score: 150, evidence: 'off the charts' }],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths[0]!.score).toBe(100);
    });

    it('clamps negative scores to 0', async () => {
      const json = JSON.stringify({
        name: 'Min',
        strengths: [{ dimension: 'sales', score: -20, evidence: 'anti-sales' }],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths[0]!.score).toBe(0);
    });

    it('non-numeric score results in NaN (Math.max/min does not coerce strings)', async () => {
      // Number('high') = NaN; Math.max(0, Math.min(100, NaN)) = NaN
      const json = JSON.stringify({
        name: 'NaN',
        strengths: [{ dimension: 'ops', score: 'high', evidence: 'verbal' }],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths[0]!.score).toBeNaN();
    });
  });

  // ─── getProfile() ───

  describe('getProfile()', () => {
    it('returns null for non-existent workspace', async () => {
      db.select.mockReturnValue(createThenableChain([]));
      const service = new FounderIntelService(db as never, createMockLlm(''));

      const result = await service.getProfile('nonexistent-ws');

      expect(result).toBeNull();
    });

    it('returns profile with strengths for existing workspace', async () => {
      const profileData = {
        id: 'p-1',
        workspaceId: 'ws-1',
        name: 'Found',
        background: 'bg',
        experience: 'exp',
        interests: [],
        startupVector: 'vec',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const strengthsData = [
        { id: 's-1', founderId: 'p-1', dimension: 'technical', score: 80, evidence: 'strong', updatedAt: new Date() },
      ];

      // First select call (profile) returns data, second (strengths) returns data
      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createThenableChain([profileData]);
        }
        return createThenableChain(strengthsData);
      });

      const service = new FounderIntelService(db as never, createMockLlm(''));
      const result = await service.getProfile('ws-1');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Found');
      expect(result!.strengths).toEqual(strengthsData);
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('handles empty string LLM response', async () => {
      const llm = createMockLlm('');
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      // Empty string fails JSON.parse, falls back to defaults
      expect(result.name).toBe('Founder');
      expect(result.strengths).toHaveLength(5);
    });

    it('handles LLM returning just "{}"', async () => {
      const llm = createMockLlm('{}');
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.name).toBe('Founder');
      expect(result.background).toBe('');
      expect(result.interests).toEqual([]);
      expect(result.strengths).toHaveLength(5);
      expect(result.strengths[0]!.score).toBe(25);
    });

    it('converts interest items to strings', async () => {
      const json = JSON.stringify({
        name: 'Mixed',
        interests: [42, true, 'AI', null],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.interests).toEqual(['42', 'true', 'AI', 'null']);
    });

    it('defaults strength dimension to "unknown" when missing', async () => {
      const json = JSON.stringify({
        strengths: [{ score: 50, evidence: 'some' }],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths[0]!.dimension).toBe('unknown');
    });

    it('defaults strength evidence to empty string when missing', async () => {
      const json = JSON.stringify({
        strengths: [{ dimension: 'tech', score: 50 }],
      });
      const llm = createMockLlm(json);
      const service = new FounderIntelService(db as never, llm);

      const result = await service.processIntake('ws-001', 'input');

      expect(result.strengths[0]!.evidence).toBe('');
    });
  });
});
