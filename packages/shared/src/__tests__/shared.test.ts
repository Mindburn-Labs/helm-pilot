import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// ─── Enums ───
import {
  ProductModeSchema,
  OperatorRoleSchema,
  TaskStatusSchema,
  VerdictSchema,
  UxSectionSchema,
  IngestionSourceTypeSchema,
  WorkspaceRoleSchema,
  SideEffectRiskSchema,
} from '../schemas/enums.js';

// ─── Models ───
import {
  WorkspaceSchema,
  FounderProfileSchema,
  OperatorSchema,
  TaskSchema,
  OpportunitySchema,
  ArtifactSchema,
  KnowledgePageSchema,
} from '../schemas/models.js';

// ─── Validators ───
import {
  MAX_ITERATION_BUDGET,
  CreateFounderProfileInput,
  CreateTaskInput,
  CreateOperatorInput,
  CreateOpportunityInput,
  CreateKnowledgePageInput,
  CreateTimelineEntryInput,
} from '../schemas/validators.js';

// ─── Policy ───
import {
  BudgetLimitsSchema,
  PolicyConfigSchema,
  TrustBoundaryResultSchema,
} from '../schemas/policy.js';

// ─── Events ───
import {
  BaseEventSchema,
  OpportunityDiscoveredSchema,
  TaskCreatedSchema,
  TaskCompletedSchema,
  OperatorCreatedSchema,
  ModeTransitionSchema,
  ApprovalRequestedSchema,
  ApprovalResolvedSchema,
} from '../events/index.js';

// ─── Config ───
import { AppConfigSchema, loadConfig } from '../config/index.js';

// ─── LLM ───
import { createLlmProvider } from '../llm/index.js';

// ─── Logger ───
import { createLogger } from '../logger.js';

// ── Helpers ──

const uuid = () => randomUUID();
const now = () => new Date();

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    workspaceId: uuid(),
    timestamp: now(),
    source: 'test-service',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Enum Schemas
// ────────────────────────────────────────────────────────────────────────────

describe('Enum Schemas', () => {
  const enumCases: [string, z.ZodEnum<[string, ...string[]]>, string[], string[]][] = [
    [
      'ProductModeSchema',
      ProductModeSchema,
      ['discover', 'decide', 'build', 'launch', 'apply'],
      ['invalid', '', 'BUILD', 'Discover'],
    ],
    [
      'OperatorRoleSchema',
      OperatorRoleSchema,
      ['engineering', 'product', 'growth', 'design', 'ops'],
      ['eng', 'developer', '', 'Engineering'],
    ],
    [
      'TaskStatusSchema',
      TaskStatusSchema,
      ['pending', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'],
      ['done', 'started', '', 'PENDING'],
    ],
    [
      'VerdictSchema',
      VerdictSchema,
      ['allow', 'deny', 'require_approval'],
      ['approve', 'block', '', 'ALLOW'],
    ],
    [
      'UxSectionSchema',
      UxSectionSchema,
      ['discover', 'build', 'operators', 'memory', 'applications', 'settings'],
      ['home', 'dashboard', '', 'Discover'],
    ],
    [
      'IngestionSourceTypeSchema',
      IngestionSourceTypeSchema,
      ['scrape', 'import', 'upload', 'api', 'authorized_session'],
      ['download', 'manual', '', 'API'],
    ],
    [
      'WorkspaceRoleSchema',
      WorkspaceRoleSchema,
      ['owner', 'partner', 'member'],
      ['admin', 'viewer', '', 'Owner'],
    ],
    [
      'SideEffectRiskSchema',
      SideEffectRiskSchema,
      ['safe', 'low', 'approval_required'],
      ['high', 'medium', '', 'Safe'],
    ],
  ];

  for (const [name, schema, validValues, invalidValues] of enumCases) {
    describe(name, () => {
      for (const val of validValues) {
        it(`accepts "${val}"`, () => {
          expect(schema.parse(val)).toBe(val);
        });
      }
      for (const val of invalidValues) {
        it(`rejects "${val}"`, () => {
          expect(() => schema.parse(val)).toThrow();
        });
      }
      it('rejects null and undefined', () => {
        expect(() => schema.parse(null)).toThrow();
        expect(() => schema.parse(undefined)).toThrow();
      });
      it('rejects number input', () => {
        expect(() => schema.parse(42)).toThrow();
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Model Schemas
// ────────────────────────────────────────────────────────────────────────────

describe('Model Schemas', () => {
  describe('WorkspaceSchema', () => {
    const valid = () => ({
      id: uuid(),
      name: 'My Startup',
      currentMode: 'discover' as const,
      ownerId: uuid(),
      createdAt: now(),
      updatedAt: now(),
    });

    it('accepts valid workspace', () => {
      const data = valid();
      expect(WorkspaceSchema.parse(data)).toEqual(data);
    });

    it('rejects empty name', () => {
      expect(() => WorkspaceSchema.parse({ ...valid(), name: '' })).toThrow();
    });

    it('rejects name exceeding 100 chars', () => {
      expect(() => WorkspaceSchema.parse({ ...valid(), name: 'x'.repeat(101) })).toThrow();
    });

    it('rejects invalid uuid for id', () => {
      expect(() => WorkspaceSchema.parse({ ...valid(), id: 'not-a-uuid' })).toThrow();
    });

    it('rejects invalid uuid for ownerId', () => {
      expect(() => WorkspaceSchema.parse({ ...valid(), ownerId: '123' })).toThrow();
    });

    it('rejects invalid currentMode', () => {
      expect(() => WorkspaceSchema.parse({ ...valid(), currentMode: 'sleep' })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => WorkspaceSchema.parse({})).toThrow();
    });
  });

  describe('FounderProfileSchema', () => {
    const valid = () => ({
      id: uuid(),
      workspaceId: uuid(),
      name: 'Alice',
      strengths: ['coding'],
      weaknesses: ['marketing'],
      interests: ['AI'],
      createdAt: now(),
      updatedAt: now(),
    });

    it('accepts valid profile with optional fields omitted', () => {
      const data = valid();
      expect(FounderProfileSchema.parse(data)).toEqual(data);
    });

    it('accepts valid profile with all optional fields', () => {
      const data = {
        ...valid(),
        background: 'Engineer',
        experience: '10 years',
        startupVector: 'AI tooling',
      };
      expect(FounderProfileSchema.parse(data)).toEqual(data);
    });

    it('rejects empty name', () => {
      expect(() => FounderProfileSchema.parse({ ...valid(), name: '' })).toThrow();
    });

    it('rejects non-array strengths', () => {
      expect(() => FounderProfileSchema.parse({ ...valid(), strengths: 'coding' })).toThrow();
    });

    it('rejects invalid workspaceId', () => {
      expect(() => FounderProfileSchema.parse({ ...valid(), workspaceId: 'bad' })).toThrow();
    });
  });

  describe('OperatorSchema', () => {
    const valid = () => ({
      id: uuid(),
      workspaceId: uuid(),
      name: 'Growth Bot',
      role: 'growth' as const,
      goal: 'Increase signups',
      constraints: ['no spam'],
      tools: ['email_sender'],
      createdAt: now(),
    });

    it('accepts valid operator', () => {
      const data = valid();
      expect(OperatorSchema.parse(data)).toEqual(data);
    });

    it('rejects invalid role', () => {
      expect(() => OperatorSchema.parse({ ...valid(), role: 'cto' })).toThrow();
    });

    it('rejects empty name', () => {
      expect(() => OperatorSchema.parse({ ...valid(), name: '' })).toThrow();
    });

    it('accepts all valid roles', () => {
      for (const role of ['engineering', 'product', 'growth', 'design', 'ops'] as const) {
        expect(OperatorSchema.parse({ ...valid(), role })).toBeDefined();
      }
    });
  });

  describe('TaskSchema', () => {
    const valid = () => ({
      id: uuid(),
      workspaceId: uuid(),
      title: 'Build landing page',
      description: 'Create a conversion-optimized landing page',
      status: 'pending' as const,
      mode: 'build' as const,
      createdAt: now(),
      updatedAt: now(),
    });

    it('accepts valid task without optional fields', () => {
      const data = valid();
      expect(TaskSchema.parse(data)).toEqual(data);
    });

    it('accepts valid task with all optional fields', () => {
      const data = {
        ...valid(),
        operatorId: uuid(),
        parentTaskId: uuid(),
        completedAt: now(),
      };
      expect(TaskSchema.parse(data)).toEqual(data);
    });

    it('rejects empty title', () => {
      expect(() => TaskSchema.parse({ ...valid(), title: '' })).toThrow();
    });

    it('rejects invalid status', () => {
      expect(() => TaskSchema.parse({ ...valid(), status: 'done' })).toThrow();
    });

    it('rejects invalid mode', () => {
      expect(() => TaskSchema.parse({ ...valid(), mode: 'sleep' })).toThrow();
    });

    it('rejects non-uuid operatorId', () => {
      expect(() => TaskSchema.parse({ ...valid(), operatorId: 'bob' })).toThrow();
    });
  });

  describe('OpportunitySchema', () => {
    const valid = () => ({
      id: uuid(),
      source: 'hacker-news',
      title: 'AI Code Review',
      description: 'Automated code review using LLMs',
      tags: ['ai', 'devtools'],
      discoveredAt: now(),
    });

    it('accepts valid opportunity without optional fields', () => {
      const data = valid();
      expect(OpportunitySchema.parse(data)).toEqual(data);
    });

    it('accepts valid opportunity with optional fields', () => {
      const data = {
        ...valid(),
        workspaceId: uuid(),
        sourceUrl: 'https://example.com',
        score: 85,
        founderFitScore: 72,
      };
      expect(OpportunitySchema.parse(data)).toEqual(data);
    });

    it('rejects score below 0', () => {
      expect(() => OpportunitySchema.parse({ ...valid(), score: -1 })).toThrow();
    });

    it('rejects score above 100', () => {
      expect(() => OpportunitySchema.parse({ ...valid(), score: 101 })).toThrow();
    });

    it('rejects founderFitScore above 100', () => {
      expect(() => OpportunitySchema.parse({ ...valid(), founderFitScore: 150 })).toThrow();
    });

    it('rejects invalid sourceUrl', () => {
      expect(() => OpportunitySchema.parse({ ...valid(), sourceUrl: 'not-a-url' })).toThrow();
    });

    it('accepts boundary scores 0 and 100', () => {
      expect(OpportunitySchema.parse({ ...valid(), score: 0 })).toBeDefined();
      expect(OpportunitySchema.parse({ ...valid(), score: 100 })).toBeDefined();
    });
  });

  describe('ArtifactSchema', () => {
    const valid = () => ({
      id: uuid(),
      workspaceId: uuid(),
      type: 'landing_page' as const,
      name: 'Homepage v1',
      storagePath: '/artifacts/homepage-v1.html',
      version: 1,
      createdAt: now(),
    });

    it('accepts valid artifact', () => {
      const data = valid();
      expect(ArtifactSchema.parse(data)).toEqual(data);
    });

    it('accepts all valid artifact types', () => {
      const types = [
        'landing_page',
        'pdf',
        'code',
        'design',
        'copy',
        'pitch_deck',
        'application',
      ] as const;
      for (const type of types) {
        expect(ArtifactSchema.parse({ ...valid(), type })).toBeDefined();
      }
    });

    it('rejects invalid type', () => {
      expect(() => ArtifactSchema.parse({ ...valid(), type: 'video' })).toThrow();
    });

    it('rejects version below 1', () => {
      expect(() => ArtifactSchema.parse({ ...valid(), version: 0 })).toThrow();
    });

    it('rejects non-integer version', () => {
      expect(() => ArtifactSchema.parse({ ...valid(), version: 1.5 })).toThrow();
    });

    it('accepts optional taskId', () => {
      const data = { ...valid(), taskId: uuid() };
      expect(ArtifactSchema.parse(data)).toEqual(data);
    });
  });

  describe('KnowledgePageSchema', () => {
    const valid = () => ({
      id: uuid(),
      type: 'concept' as const,
      title: 'Product-Market Fit',
      compiledTruth: 'The degree to which a product satisfies a strong market demand.',
      tags: ['strategy'],
      createdAt: now(),
      updatedAt: now(),
    });

    it('accepts valid knowledge page', () => {
      const data = valid();
      expect(KnowledgePageSchema.parse(data)).toEqual(data);
    });

    it('accepts all valid page types', () => {
      const types = [
        'person',
        'company',
        'opportunity',
        'concept',
        'source',
        'project',
      ] as const;
      for (const type of types) {
        expect(KnowledgePageSchema.parse({ ...valid(), type })).toBeDefined();
      }
    });

    it('rejects invalid type', () => {
      expect(() => KnowledgePageSchema.parse({ ...valid(), type: 'note' })).toThrow();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Input Validators
// ────────────────────────────────────────────────────────────────────────────

describe('Input Validators', () => {
  describe('CreateFounderProfileInput', () => {
    it('accepts valid input with defaults', () => {
      const result = CreateFounderProfileInput.parse({ name: 'Alice' });
      expect(result.name).toBe('Alice');
      expect(result.interests).toEqual([]);
    });

    it('accepts full input', () => {
      const result = CreateFounderProfileInput.parse({
        name: 'Bob',
        background: 'Engineer',
        experience: '5 years',
        interests: ['AI', 'fintech'],
      });
      expect(result.interests).toEqual(['AI', 'fintech']);
    });

    it('rejects empty name', () => {
      expect(() => CreateFounderProfileInput.parse({ name: '' })).toThrow();
    });

    it('rejects name exceeding 200 chars', () => {
      expect(() => CreateFounderProfileInput.parse({ name: 'x'.repeat(201) })).toThrow();
    });

    it('rejects background exceeding 5000 chars', () => {
      expect(() =>
        CreateFounderProfileInput.parse({ name: 'A', background: 'x'.repeat(5001) }),
      ).toThrow();
    });

    it('rejects interests array exceeding 20 items', () => {
      const interests = Array.from({ length: 21 }, (_, i) => `interest-${i}`);
      expect(() => CreateFounderProfileInput.parse({ name: 'A', interests })).toThrow();
    });

    it('rejects interest string exceeding 100 chars', () => {
      expect(() =>
        CreateFounderProfileInput.parse({ name: 'A', interests: ['x'.repeat(101)] }),
      ).toThrow();
    });
  });

  describe('CreateTaskInput', () => {
    const valid = () => ({
      workspaceId: uuid(),
      title: 'Write copy',
      mode: 'build' as const,
    });

    it('accepts valid input with defaults', () => {
      const result = CreateTaskInput.parse(valid());
      expect(result.description).toBe('');
      expect(result.autoRun).toBe(false);
      expect(result.iterationBudget).toBe(50);
    });

    it('rejects empty title', () => {
      expect(() => CreateTaskInput.parse({ ...valid(), title: '' })).toThrow();
    });

    it('rejects title exceeding 500 chars', () => {
      expect(() => CreateTaskInput.parse({ ...valid(), title: 'x'.repeat(501) })).toThrow();
    });

    it('rejects description exceeding 10000 chars', () => {
      expect(() =>
        CreateTaskInput.parse({ ...valid(), description: 'x'.repeat(10001) }),
      ).toThrow();
    });

    it('rejects non-uuid workspaceId', () => {
      expect(() => CreateTaskInput.parse({ ...valid(), workspaceId: 'bad' })).toThrow();
    });

    it('rejects iterationBudget below 1', () => {
      expect(() => CreateTaskInput.parse({ ...valid(), iterationBudget: 0 })).toThrow();
    });

    it('rejects iterationBudget above MAX_ITERATION_BUDGET', () => {
      expect(() =>
        CreateTaskInput.parse({ ...valid(), iterationBudget: MAX_ITERATION_BUDGET + 1 }),
      ).toThrow();
    });

    it('accepts iterationBudget at boundaries', () => {
      expect(CreateTaskInput.parse({ ...valid(), iterationBudget: 1 }).iterationBudget).toBe(1);
      expect(
        CreateTaskInput.parse({ ...valid(), iterationBudget: MAX_ITERATION_BUDGET })
          .iterationBudget,
      ).toBe(MAX_ITERATION_BUDGET);
    });

    it('exports MAX_ITERATION_BUDGET as 100', () => {
      expect(MAX_ITERATION_BUDGET).toBe(100);
    });
  });

  describe('CreateOperatorInput', () => {
    const valid = () => ({
      workspaceId: uuid(),
      name: 'Design Bot',
      role: 'design' as const,
      goal: 'Create brand assets',
    });

    it('accepts valid input with defaults', () => {
      const result = CreateOperatorInput.parse(valid());
      expect(result.constraints).toEqual([]);
      expect(result.tools).toEqual([]);
    });

    it('rejects empty name', () => {
      expect(() => CreateOperatorInput.parse({ ...valid(), name: '' })).toThrow();
    });

    it('rejects name exceeding 200 chars', () => {
      expect(() => CreateOperatorInput.parse({ ...valid(), name: 'x'.repeat(201) })).toThrow();
    });

    it('rejects empty goal', () => {
      expect(() => CreateOperatorInput.parse({ ...valid(), goal: '' })).toThrow();
    });

    it('rejects goal exceeding 2000 chars', () => {
      expect(() => CreateOperatorInput.parse({ ...valid(), goal: 'x'.repeat(2001) })).toThrow();
    });

    it('rejects invalid role', () => {
      expect(() => CreateOperatorInput.parse({ ...valid(), role: 'ceo' })).toThrow();
    });

    it('rejects constraints array exceeding 20 items', () => {
      const constraints = Array.from({ length: 21 }, (_, i) => `c-${i}`);
      expect(() => CreateOperatorInput.parse({ ...valid(), constraints })).toThrow();
    });

    it('rejects tools array exceeding 50 items', () => {
      const tools = Array.from({ length: 51 }, (_, i) => `tool-${i}`);
      expect(() => CreateOperatorInput.parse({ ...valid(), tools })).toThrow();
    });

    it('rejects constraint string exceeding 500 chars', () => {
      expect(() =>
        CreateOperatorInput.parse({ ...valid(), constraints: ['x'.repeat(501)] }),
      ).toThrow();
    });

    it('rejects tool string exceeding 100 chars', () => {
      expect(() =>
        CreateOperatorInput.parse({ ...valid(), tools: ['x'.repeat(101)] }),
      ).toThrow();
    });
  });

  describe('CreateOpportunityInput', () => {
    const valid = () => ({
      source: 'manual',
      title: 'SaaS idea',
      description: 'A new SaaS product',
    });

    it('accepts valid input without optional fields', () => {
      const result = CreateOpportunityInput.parse(valid());
      expect(result.title).toBe('SaaS idea');
    });

    it('accepts valid input with all fields', () => {
      const result = CreateOpportunityInput.parse({
        ...valid(),
        workspaceId: uuid(),
        sourceUrl: 'https://example.com/idea',
      });
      expect(result.sourceUrl).toBe('https://example.com/idea');
    });

    it('rejects empty source', () => {
      expect(() => CreateOpportunityInput.parse({ ...valid(), source: '' })).toThrow();
    });

    it('rejects source exceeding 200 chars', () => {
      expect(() =>
        CreateOpportunityInput.parse({ ...valid(), source: 'x'.repeat(201) }),
      ).toThrow();
    });

    it('rejects empty title', () => {
      expect(() => CreateOpportunityInput.parse({ ...valid(), title: '' })).toThrow();
    });

    it('rejects description exceeding 10000 chars', () => {
      expect(() =>
        CreateOpportunityInput.parse({ ...valid(), description: 'x'.repeat(10001) }),
      ).toThrow();
    });

    it('rejects invalid sourceUrl', () => {
      expect(() =>
        CreateOpportunityInput.parse({ ...valid(), sourceUrl: 'not-a-url' }),
      ).toThrow();
    });

    it('rejects sourceUrl exceeding 2000 chars', () => {
      expect(() =>
        CreateOpportunityInput.parse({
          ...valid(),
          sourceUrl: `https://example.com/${'x'.repeat(2000)}`,
        }),
      ).toThrow();
    });
  });

  describe('CreateKnowledgePageInput', () => {
    const valid = () => ({
      type: 'concept',
      title: 'Market Sizing',
    });

    it('accepts valid input with defaults', () => {
      const result = CreateKnowledgePageInput.parse(valid());
      expect(result.tags).toEqual([]);
    });

    it('accepts full input', () => {
      const result = CreateKnowledgePageInput.parse({
        ...valid(),
        compiledTruth: 'TAM/SAM/SOM analysis',
        tags: ['strategy', 'market'],
        content: 'Detailed market sizing methodology...',
      });
      expect(result.tags).toEqual(['strategy', 'market']);
    });

    it('rejects empty type', () => {
      expect(() => CreateKnowledgePageInput.parse({ ...valid(), type: '' })).toThrow();
    });

    it('rejects type exceeding 50 chars', () => {
      expect(() =>
        CreateKnowledgePageInput.parse({ ...valid(), type: 'x'.repeat(51) }),
      ).toThrow();
    });

    it('rejects empty title', () => {
      expect(() => CreateKnowledgePageInput.parse({ ...valid(), title: '' })).toThrow();
    });

    it('rejects title exceeding 500 chars', () => {
      expect(() =>
        CreateKnowledgePageInput.parse({ ...valid(), title: 'x'.repeat(501) }),
      ).toThrow();
    });

    it('rejects tags exceeding 50 items', () => {
      const tags = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
      expect(() => CreateKnowledgePageInput.parse({ ...valid(), tags })).toThrow();
    });

    it('rejects compiledTruth exceeding 50000 chars', () => {
      expect(() =>
        CreateKnowledgePageInput.parse({ ...valid(), compiledTruth: 'x'.repeat(50001) }),
      ).toThrow();
    });

    it('rejects content exceeding 500000 chars', () => {
      expect(() =>
        CreateKnowledgePageInput.parse({ ...valid(), content: 'x'.repeat(500001) }),
      ).toThrow();
    });
  });

  describe('CreateTimelineEntryInput', () => {
    it('accepts valid input with default source', () => {
      const result = CreateTimelineEntryInput.parse({
        eventType: 'note',
        content: 'Something happened',
      });
      expect(result.source).toBe('api');
    });

    it('accepts custom source', () => {
      const result = CreateTimelineEntryInput.parse({
        eventType: 'milestone',
        content: 'Reached 100 users',
        source: 'system',
      });
      expect(result.source).toBe('system');
    });

    it('rejects empty eventType', () => {
      expect(() =>
        CreateTimelineEntryInput.parse({ eventType: '', content: 'text' }),
      ).toThrow();
    });

    it('rejects eventType exceeding 100 chars', () => {
      expect(() =>
        CreateTimelineEntryInput.parse({ eventType: 'x'.repeat(101), content: 'text' }),
      ).toThrow();
    });

    it('rejects empty content', () => {
      expect(() =>
        CreateTimelineEntryInput.parse({ eventType: 'note', content: '' }),
      ).toThrow();
    });

    it('rejects content exceeding 50000 chars', () => {
      expect(() =>
        CreateTimelineEntryInput.parse({ eventType: 'note', content: 'x'.repeat(50001) }),
      ).toThrow();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Policy Schemas
// ────────────────────────────────────────────────────────────────────────────

describe('Policy Schemas', () => {
  describe('BudgetLimitsSchema', () => {
    it('provides sane defaults', () => {
      const result = BudgetLimitsSchema.parse({});
      expect(result).toEqual({
        dailyTotalMax: 500,
        perTaskMax: 100,
        perOperatorMax: 200,
        emergencyKill: 1500,
        currency: 'EUR',
      });
    });

    it('accepts custom values', () => {
      const custom = {
        dailyTotalMax: 1000,
        perTaskMax: 50,
        perOperatorMax: 300,
        emergencyKill: 5000,
        currency: 'USD',
      };
      expect(BudgetLimitsSchema.parse(custom)).toEqual(custom);
    });

    it('rejects zero dailyTotalMax', () => {
      expect(() => BudgetLimitsSchema.parse({ dailyTotalMax: 0 })).toThrow();
    });

    it('rejects negative perTaskMax', () => {
      expect(() => BudgetLimitsSchema.parse({ perTaskMax: -1 })).toThrow();
    });

    it('rejects negative perOperatorMax', () => {
      expect(() => BudgetLimitsSchema.parse({ perOperatorMax: -10 })).toThrow();
    });

    it('rejects zero emergencyKill', () => {
      expect(() => BudgetLimitsSchema.parse({ emergencyKill: 0 })).toThrow();
    });
  });

  describe('PolicyConfigSchema', () => {
    it('provides sane defaults when budget is an empty object', () => {
      const result = PolicyConfigSchema.parse({ budget: {} });
      expect(result.killSwitch).toBe(false);
      expect(result.failClosed).toBe(true);
      expect(result.toolBlocklist).toEqual([]);
      expect(result.contentBans).toEqual([]);
      expect(result.connectorAllowlist).toEqual([]);
      expect(result.requireApprovalFor).toEqual([]);
      expect(result.budget.dailyTotalMax).toBe(500);
      expect(result.budget.perTaskMax).toBe(100);
      expect(result.budget.perOperatorMax).toBe(200);
      expect(result.budget.emergencyKill).toBe(1500);
      expect(result.budget.currency).toBe('EUR');
    });

    it('requires budget key to be present', () => {
      expect(() => PolicyConfigSchema.parse({})).toThrow();
    });

    it('accepts full custom config', () => {
      const config = {
        killSwitch: true,
        budget: { dailyTotalMax: 200, perTaskMax: 50, perOperatorMax: 100, emergencyKill: 600 },
        toolBlocklist: ['shell_exec'],
        contentBans: ['competitor_name'],
        connectorAllowlist: ['github', 'slack'],
        requireApprovalFor: ['external_email'],
        failClosed: false,
      };
      const result = PolicyConfigSchema.parse(config);
      expect(result.killSwitch).toBe(true);
      expect(result.failClosed).toBe(false);
      expect(result.toolBlocklist).toEqual(['shell_exec']);
    });

    it('rejects invalid budget nested values', () => {
      expect(() =>
        PolicyConfigSchema.parse({ budget: { dailyTotalMax: -1 } }),
      ).toThrow();
    });
  });

  describe('TrustBoundaryResultSchema', () => {
    it('accepts allow verdict', () => {
      const result = TrustBoundaryResultSchema.parse({
        verdict: 'allow',
        checkedAt: now(),
      });
      expect(result.verdict).toBe('allow');
    });

    it('accepts deny verdict with reason and policyRule', () => {
      const result = TrustBoundaryResultSchema.parse({
        verdict: 'deny',
        reason: 'Budget exceeded',
        policyRule: 'budget.daily_max',
        checkedAt: now(),
      });
      expect(result.reason).toBe('Budget exceeded');
      expect(result.policyRule).toBe('budget.daily_max');
    });

    it('accepts require_approval verdict', () => {
      const result = TrustBoundaryResultSchema.parse({
        verdict: 'require_approval',
        checkedAt: now(),
      });
      expect(result.verdict).toBe('require_approval');
    });

    it('rejects invalid verdict', () => {
      expect(() =>
        TrustBoundaryResultSchema.parse({ verdict: 'maybe', checkedAt: now() }),
      ).toThrow();
    });

    it('rejects missing checkedAt', () => {
      expect(() => TrustBoundaryResultSchema.parse({ verdict: 'allow' })).toThrow();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Event Schemas
// ────────────────────────────────────────────────────────────────────────────

describe('Event Schemas', () => {
  describe('BaseEventSchema', () => {
    it('accepts valid base event', () => {
      const data = baseEvent();
      expect(BaseEventSchema.parse(data)).toEqual(data);
    });

    it('rejects missing id', () => {
      const { id: _, ...rest } = baseEvent();
      expect(() => BaseEventSchema.parse(rest)).toThrow();
    });

    it('rejects non-uuid id', () => {
      expect(() => BaseEventSchema.parse(baseEvent({ id: '123' }))).toThrow();
    });

    it('rejects non-uuid workspaceId', () => {
      expect(() => BaseEventSchema.parse(baseEvent({ workspaceId: 'bad' }))).toThrow();
    });

    it('rejects missing timestamp', () => {
      const { timestamp: _, ...rest } = baseEvent();
      expect(() => BaseEventSchema.parse(rest)).toThrow();
    });

    it('rejects missing source', () => {
      const { source: _, ...rest } = baseEvent();
      expect(() => BaseEventSchema.parse(rest)).toThrow();
    });
  });

  describe('OpportunityDiscoveredSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'opportunity.discovered',
        opportunityId: uuid(),
      };
      const result = OpportunityDiscoveredSchema.parse(data);
      expect(result.type).toBe('opportunity.discovered');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        OpportunityDiscoveredSchema.parse({
          ...baseEvent(),
          type: 'task.created',
          opportunityId: uuid(),
        }),
      ).toThrow();
    });

    it('accepts optional score', () => {
      const data = {
        ...baseEvent(),
        type: 'opportunity.discovered',
        opportunityId: uuid(),
        score: 85,
      };
      expect(OpportunityDiscoveredSchema.parse(data).score).toBe(85);
    });

    it('rejects non-uuid opportunityId', () => {
      expect(() =>
        OpportunityDiscoveredSchema.parse({
          ...baseEvent(),
          type: 'opportunity.discovered',
          opportunityId: 'bad',
        }),
      ).toThrow();
    });
  });

  describe('TaskCreatedSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'task.created',
        taskId: uuid(),
        mode: 'build',
      };
      const result = TaskCreatedSchema.parse(data);
      expect(result.type).toBe('task.created');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        TaskCreatedSchema.parse({
          ...baseEvent(),
          type: 'opportunity.discovered',
          taskId: uuid(),
          mode: 'build',
        }),
      ).toThrow();
    });

    it('accepts optional operatorId', () => {
      const data = {
        ...baseEvent(),
        type: 'task.created',
        taskId: uuid(),
        mode: 'discover',
        operatorId: uuid(),
      };
      expect(TaskCreatedSchema.parse(data).operatorId).toBeDefined();
    });

    it('rejects non-uuid taskId', () => {
      expect(() =>
        TaskCreatedSchema.parse({
          ...baseEvent(),
          type: 'task.created',
          taskId: 'nope',
          mode: 'build',
        }),
      ).toThrow();
    });
  });

  describe('TaskCompletedSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'task.completed',
        taskId: uuid(),
      };
      expect(TaskCompletedSchema.parse(data).type).toBe('task.completed');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        TaskCompletedSchema.parse({
          ...baseEvent(),
          type: 'task.created',
          taskId: uuid(),
        }),
      ).toThrow();
    });

    it('accepts optional artifactIds', () => {
      const ids = [uuid(), uuid()];
      const data = {
        ...baseEvent(),
        type: 'task.completed',
        taskId: uuid(),
        artifactIds: ids,
      };
      expect(TaskCompletedSchema.parse(data).artifactIds).toEqual(ids);
    });

    it('rejects non-uuid values in artifactIds', () => {
      expect(() =>
        TaskCompletedSchema.parse({
          ...baseEvent(),
          type: 'task.completed',
          taskId: uuid(),
          artifactIds: ['bad-id'],
        }),
      ).toThrow();
    });
  });

  describe('OperatorCreatedSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'operator.created',
        operatorId: uuid(),
        role: 'engineering',
      };
      expect(OperatorCreatedSchema.parse(data).type).toBe('operator.created');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        OperatorCreatedSchema.parse({
          ...baseEvent(),
          type: 'task.created',
          operatorId: uuid(),
          role: 'engineering',
        }),
      ).toThrow();
    });
  });

  describe('ModeTransitionSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'mode.transition',
        from: 'discover',
        to: 'decide',
      };
      expect(ModeTransitionSchema.parse(data).type).toBe('mode.transition');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        ModeTransitionSchema.parse({
          ...baseEvent(),
          type: 'wrong.type',
          from: 'discover',
          to: 'decide',
        }),
      ).toThrow();
    });

    it('rejects missing from', () => {
      expect(() =>
        ModeTransitionSchema.parse({
          ...baseEvent(),
          type: 'mode.transition',
          to: 'decide',
        }),
      ).toThrow();
    });

    it('rejects missing to', () => {
      expect(() =>
        ModeTransitionSchema.parse({
          ...baseEvent(),
          type: 'mode.transition',
          from: 'discover',
        }),
      ).toThrow();
    });
  });

  describe('ApprovalRequestedSchema', () => {
    it('accepts valid event', () => {
      const data = {
        ...baseEvent(),
        type: 'approval.requested',
        taskId: uuid(),
        action: 'send_email',
        reason: 'External communication',
      };
      expect(ApprovalRequestedSchema.parse(data).type).toBe('approval.requested');
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        ApprovalRequestedSchema.parse({
          ...baseEvent(),
          type: 'approval.resolved',
          taskId: uuid(),
          action: 'send_email',
          reason: 'test',
        }),
      ).toThrow();
    });
  });

  describe('ApprovalResolvedSchema', () => {
    it('accepts valid approved event', () => {
      const data = {
        ...baseEvent(),
        type: 'approval.resolved',
        taskId: uuid(),
        approved: true,
        resolvedBy: 'founder@example.com',
      };
      const result = ApprovalResolvedSchema.parse(data);
      expect(result.approved).toBe(true);
      expect(result.resolvedBy).toBe('founder@example.com');
    });

    it('accepts valid denied event', () => {
      const data = {
        ...baseEvent(),
        type: 'approval.resolved',
        taskId: uuid(),
        approved: false,
        resolvedBy: 'admin',
      };
      expect(ApprovalResolvedSchema.parse(data).approved).toBe(false);
    });

    it('rejects wrong type literal', () => {
      expect(() =>
        ApprovalResolvedSchema.parse({
          ...baseEvent(),
          type: 'approval.requested',
          taskId: uuid(),
          approved: true,
          resolvedBy: 'admin',
        }),
      ).toThrow();
    });

    it('rejects missing approved field', () => {
      expect(() =>
        ApprovalResolvedSchema.parse({
          ...baseEvent(),
          type: 'approval.resolved',
          taskId: uuid(),
          resolvedBy: 'admin',
        }),
      ).toThrow();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Config
// ────────────────────────────────────────────────────────────────────────────

describe('AppConfigSchema', () => {
  it('accepts full valid config', () => {
    const result = AppConfigSchema.parse({
      port: 4000,
      nodeEnv: 'production',
      logLevel: 'warn',
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'super-secret-key-1234',
      allowedOrigins: 'https://example.com',
      telegram: {},
      llm: {},
      storage: {},
    });
    expect(result.port).toBe(4000);
    expect(result.nodeEnv).toBe('production');
  });

  it('applies defaults', () => {
    const result = AppConfigSchema.parse({
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'abcdefghijklmnop',
      telegram: {},
      llm: {},
      storage: {},
    });
    expect(result.port).toBe(3100);
    expect(result.nodeEnv).toBe('development');
    expect(result.logLevel).toBe('info');
    expect(result.allowedOrigins).toBe('');
    expect(result.storage.type).toBe('local');
  });

  it('coerces string port to number', () => {
    const result = AppConfigSchema.parse({
      port: '8080',
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'abcdefghijklmnop',
      telegram: {},
      llm: {},
      storage: {},
    });
    expect(result.port).toBe(8080);
  });

  it('rejects missing databaseUrl', () => {
    expect(() =>
      AppConfigSchema.parse({
        sessionSecret: 'abcdefghijklmnop',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('rejects invalid databaseUrl (not a url)', () => {
    expect(() =>
      AppConfigSchema.parse({
        databaseUrl: 'not-a-url',
        sessionSecret: 'abcdefghijklmnop',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('rejects missing sessionSecret', () => {
    expect(() =>
      AppConfigSchema.parse({
        databaseUrl: 'postgres://localhost:5432/db',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('rejects sessionSecret shorter than 16 chars', () => {
    expect(() =>
      AppConfigSchema.parse({
        databaseUrl: 'postgres://localhost:5432/db',
        sessionSecret: 'short',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('rejects invalid nodeEnv', () => {
    expect(() =>
      AppConfigSchema.parse({
        databaseUrl: 'postgres://localhost:5432/db',
        sessionSecret: 'abcdefghijklmnop',
        nodeEnv: 'staging',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('rejects invalid logLevel', () => {
    expect(() =>
      AppConfigSchema.parse({
        databaseUrl: 'postgres://localhost:5432/db',
        sessionSecret: 'abcdefghijklmnop',
        logLevel: 'trace',
        telegram: {},
        llm: {},
        storage: {},
      }),
    ).toThrow();
  });

  it('accepts optional telegram fields', () => {
    const result = AppConfigSchema.parse({
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'abcdefghijklmnop',
      telegram: {
        botToken: 'tok',
        webhookSecret: 'sec',
        ownerChatId: '12345',
      },
      llm: {},
      storage: {},
    });
    expect(result.telegram.botToken).toBe('tok');
  });

  it('accepts optional llm keys', () => {
    const result = AppConfigSchema.parse({
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'abcdefghijklmnop',
      telegram: {},
      llm: {
        openrouterApiKey: 'or-key',
        anthropicApiKey: 'ant-key',
        openaiApiKey: 'oai-key',
      },
      storage: {},
    });
    expect(result.llm.openrouterApiKey).toBe('or-key');
  });

  it('accepts s3 storage config', () => {
    const result = AppConfigSchema.parse({
      databaseUrl: 'postgres://localhost:5432/db',
      sessionSecret: 'abcdefghijklmnop',
      telegram: {},
      llm: {},
      storage: {
        type: 's3',
        s3Endpoint: 'https://s3.example.com',
        s3Bucket: 'my-bucket',
        s3AccessKey: 'access',
        s3SecretKey: 'secret',
      },
    });
    expect(result.storage.type).toBe('s3');
    expect(result.storage.s3Bucket).toBe('my-bucket');
  });
});

describe('loadConfig()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const setRequiredEnv = () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/helm_pilot';
    process.env['SESSION_SECRET'] = 'test-secret-at-least-16-chars';
  };

  it('loads valid config from env vars', () => {
    setRequiredEnv();
    const config = loadConfig();
    expect(config.databaseUrl).toBe('postgres://localhost:5432/helm_pilot');
    expect(config.sessionSecret).toBe('test-secret-at-least-16-chars');
    expect(config.port).toBe(3100);
    expect(config.storage.type).toBe('local');
  });

  it('reads PORT from env', () => {
    setRequiredEnv();
    process.env['PORT'] = '9000';
    const config = loadConfig();
    expect(config.port).toBe(9000);
  });

  it('reads LOG_LEVEL from env', () => {
    setRequiredEnv();
    process.env['LOG_LEVEL'] = 'debug';
    const config = loadConfig();
    expect(config.logLevel).toBe('debug');
  });

  it('reads NODE_ENV from env', () => {
    setRequiredEnv();
    process.env['NODE_ENV'] = 'production';
    const config = loadConfig();
    expect(config.nodeEnv).toBe('production');
  });

  it('reads telegram env vars', () => {
    setRequiredEnv();
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot-tok';
    process.env['TELEGRAM_WEBHOOK_SECRET'] = 'wh-sec';
    process.env['TELEGRAM_OWNER_CHAT_ID'] = '999';
    const config = loadConfig();
    expect(config.telegram.botToken).toBe('bot-tok');
    expect(config.telegram.webhookSecret).toBe('wh-sec');
    expect(config.telegram.ownerChatId).toBe('999');
  });

  it('reads llm env vars', () => {
    setRequiredEnv();
    process.env['OPENROUTER_API_KEY'] = 'or-key';
    process.env['ANTHROPIC_API_KEY'] = 'ant-key';
    process.env['OPENAI_API_KEY'] = 'oai-key';
    const config = loadConfig();
    expect(config.llm.openrouterApiKey).toBe('or-key');
    expect(config.llm.anthropicApiKey).toBe('ant-key');
    expect(config.llm.openaiApiKey).toBe('oai-key');
  });

  it('detects s3 storage when S3_ENDPOINT is set', () => {
    setRequiredEnv();
    process.env['S3_ENDPOINT'] = 'https://s3.example.com';
    process.env['S3_BUCKET'] = 'my-bucket';
    const config = loadConfig();
    expect(config.storage.type).toBe('s3');
    expect(config.storage.s3Endpoint).toBe('https://s3.example.com');
  });

  it('defaults to local storage when S3_ENDPOINT is not set', () => {
    setRequiredEnv();
    const config = loadConfig();
    expect(config.storage.type).toBe('local');
  });

  it('throws when DATABASE_URL is missing', () => {
    process.env['SESSION_SECRET'] = 'test-secret-at-least-16-chars';
    expect(() => loadConfig()).toThrow();
  });

  it('throws when SESSION_SECRET is missing', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    expect(() => loadConfig()).toThrow();
  });

  it('throws when SESSION_SECRET is too short', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['SESSION_SECRET'] = 'short';
    expect(() => loadConfig()).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. LLM Provider Factory
// ────────────────────────────────────────────────────────────────────────────

describe('createLlmProvider()', () => {
  it('throws when no API keys are provided', () => {
    expect(() => createLlmProvider({})).toThrow(
      'No LLM API key configured',
    );
  });

  it('throws with explicit undefined keys', () => {
    expect(() =>
      createLlmProvider({
        openrouterApiKey: undefined,
        anthropicApiKey: undefined,
        openaiApiKey: undefined,
      }),
    ).toThrow('No LLM API key configured');
  });

  it('returns a provider with complete() when openrouterApiKey is set', () => {
    const provider = createLlmProvider({ openrouterApiKey: 'or-test-key' });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe('function');
  });

  it('returns a provider with complete() when anthropicApiKey is set', () => {
    const provider = createLlmProvider({ anthropicApiKey: 'ant-test-key' });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe('function');
  });

  it('returns a provider with complete() when openaiApiKey is set', () => {
    const provider = createLlmProvider({ openaiApiKey: 'oai-test-key' });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe('function');
  });

  it('prefers OpenRouter over Anthropic and OpenAI', () => {
    const provider = createLlmProvider({
      openrouterApiKey: 'or-key',
      anthropicApiKey: 'ant-key',
      openaiApiKey: 'oai-key',
    });
    // OpenRouter provider should be selected; verify by checking the
    // constructor name on the prototype chain (private class, so we check indirectly)
    expect(provider).toBeDefined();

    // Spy on fetch to verify it calls the OpenRouter URL
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
        }),
      ),
    );
    provider.complete('test').catch(() => {});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });

  it('falls back to Anthropic when OpenRouter key is absent', () => {
    const provider = createLlmProvider({
      anthropicApiKey: 'ant-key',
      openaiApiKey: 'oai-key',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'hello' }],
        }),
      ),
    );
    provider.complete('test').catch(() => {});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });

  it('falls back to OpenAI when OpenRouter and Anthropic keys are absent', () => {
    const provider = createLlmProvider({ openaiApiKey: 'oai-key' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
        }),
      ),
    );
    provider.complete('test').catch(() => {});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });

  it('accepts a custom model override', () => {
    const provider = createLlmProvider({
      openrouterApiKey: 'key',
      model: 'meta-llama/llama-3-70b',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
        }),
      ),
    );
    provider.complete('test').catch(() => {});
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('meta-llama/llama-3-70b');
    fetchSpy.mockRestore();
  });

  describe('OpenRouter provider complete()', () => {
    it('returns content on success', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'The answer is 42' } }],
          }),
        ),
      );
      const provider = createLlmProvider({ openrouterApiKey: 'key' });
      const result = await provider.complete('What is the answer?');
      expect(result).toBe('The answer is 42');
      fetchSpy.mockRestore();
    });

    it('throws on HTTP error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('rate limited', { status: 429 }),
      );
      const provider = createLlmProvider({ openrouterApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('OpenRouter error 429');
      fetchSpy.mockRestore();
    });

    it('throws on empty response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ choices: [] })),
      );
      const provider = createLlmProvider({ openrouterApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('Empty response from OpenRouter');
      fetchSpy.mockRestore();
    });

    it('sends correct headers', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
          }),
        ),
      );
      const provider = createLlmProvider({ openrouterApiKey: 'my-key' });
      await provider.complete('hi');
      const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-key');
      expect(headers['X-Title']).toBe('HELM Pilot');
      fetchSpy.mockRestore();
    });
  });

  describe('Anthropic provider complete()', () => {
    it('returns text content on success', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'Hello from Claude' }],
          }),
        ),
      );
      const provider = createLlmProvider({ anthropicApiKey: 'key' });
      const result = await provider.complete('hi');
      expect(result).toBe('Hello from Claude');
      fetchSpy.mockRestore();
    });

    it('throws on HTTP error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('server error', { status: 500 }),
      );
      const provider = createLlmProvider({ anthropicApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('Anthropic error 500');
      fetchSpy.mockRestore();
    });

    it('throws on empty response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ content: [] })),
      );
      const provider = createLlmProvider({ anthropicApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('Empty response from Anthropic');
      fetchSpy.mockRestore();
    });

    it('sends correct headers including anthropic-version', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
          }),
        ),
      );
      const provider = createLlmProvider({ anthropicApiKey: 'ant-key' });
      await provider.complete('hi');
      const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('ant-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      fetchSpy.mockRestore();
    });
  });

  describe('OpenAI provider complete()', () => {
    it('returns content on success', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'GPT says hi' } }],
          }),
        ),
      );
      const provider = createLlmProvider({ openaiApiKey: 'key' });
      const result = await provider.complete('hi');
      expect(result).toBe('GPT says hi');
      fetchSpy.mockRestore();
    });

    it('throws on HTTP error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('unauthorized', { status: 401 }),
      );
      const provider = createLlmProvider({ openaiApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('OpenAI error 401');
      fetchSpy.mockRestore();
    });

    it('throws on empty response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ choices: [] })),
      );
      const provider = createLlmProvider({ openaiApiKey: 'key' });
      await expect(provider.complete('test')).rejects.toThrow('Empty response from OpenAI');
      fetchSpy.mockRestore();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Logger
// ────────────────────────────────────────────────────────────────────────────

describe('createLogger()', () => {
  it('returns a pino logger instance with the given name', () => {
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const logger = createLogger('test-service');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('respects LOG_LEVEL env var', () => {
    const originalLogLevel = process.env['LOG_LEVEL'];
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['LOG_LEVEL'] = 'error';
    process.env['NODE_ENV'] = 'production';
    const logger = createLogger('strict-service');
    expect(logger.level).toBe('error');
    process.env['LOG_LEVEL'] = originalLogLevel;
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('defaults to info level when LOG_LEVEL is not set', () => {
    const originalLogLevel = process.env['LOG_LEVEL'];
    const originalNodeEnv = process.env['NODE_ENV'];
    delete process.env['LOG_LEVEL'];
    process.env['NODE_ENV'] = 'production';
    const logger = createLogger('default-service');
    expect(logger.level).toBe('info');
    process.env['LOG_LEVEL'] = originalLogLevel;
    process.env['NODE_ENV'] = originalNodeEnv;
  });
});
