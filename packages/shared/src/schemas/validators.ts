import { z } from 'zod';
import { ProductModeSchema, OperatorRoleSchema } from './enums.js';

/** Max agent loop iterations allowed via API */
export const MAX_ITERATION_BUDGET = 100;

// ─── Route Input Validators ───

export const CreateFounderProfileInput = z.object({
  name: z.string().min(1).max(200),
  background: z.string().max(5000).optional(),
  experience: z.string().max(5000).optional(),
  interests: z.array(z.string().max(100)).max(20).default([]),
});

export const AnalyzeFounderInput = z.object({
  rawText: z.string().min(1).max(20000),
});

export const CreateTaskInput = z.object({
  workspaceId: z.string().uuid(),
  operatorId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(''),
  mode: ProductModeSchema.default('build'),
  autoRun: z.boolean().default(false),
  iterationBudget: z.number().int().min(1).max(MAX_ITERATION_BUDGET).default(50),
});

export const CreateOperatorInput = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  role: OperatorRoleSchema,
  goal: z.string().min(1).max(2000),
  constraints: z.array(z.string().max(500)).max(20).default([]),
  tools: z.array(z.string().max(100)).max(50).default([]),
});

export const UpdateOperatorInput = z.object({
  goal: z.string().min(1).max(2000).optional(),
  isActive: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  constraints: z.array(z.string().max(500)).max(20).optional(),
  tools: z.array(z.string().max(100)).max(50).optional(),
});

export const CreateOpportunityInput = z.object({
  workspaceId: z.string().uuid().optional(),
  source: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000).optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000),
});

export const CreateKnowledgePageInput = z.object({
  workspaceId: z.string().uuid().optional(),
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(500),
  compiledTruth: z.string().max(50000).optional(),
  tags: z.array(z.string().max(100)).max(50).default([]),
  content: z.string().max(500000).optional(),
});

export const CreateTimelineEntryInput = z.object({
  eventType: z.string().min(1).max(100),
  content: z.string().min(1).max(50000),
  source: z.string().max(200).default('api'),
});

export const CreateCofounderCandidateInput = z.object({
  source: z.string().min(1).max(100).default('manual'),
  externalId: z.string().max(200).optional(),
  profileUrl: z.string().url().max(2000).optional(),
  name: z.string().min(1).max(200),
  headline: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  bio: z.string().max(10000).optional(),
  strengths: z.array(z.string().max(200)).max(30).default([]),
  interests: z.array(z.string().max(200)).max(30).default([]),
  preferredRoles: z.array(z.string().max(100)).max(10).default([]),
  rawProfile: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateCofounderNoteInput = z.object({
  noteType: z.string().min(1).max(100).default('note'),
  content: z.string().min(1).max(10000),
});

export const CreateCofounderOutreachDraftInput = z.object({
  channel: z.string().min(1).max(100).default('email'),
  subject: z.string().max(500).optional(),
  content: z.string().min(1).max(20000),
});

export const SaveConnectorSessionInput = z.object({
  grantId: z.string().uuid(),
  sessionType: z.enum(['browser_storage_state', 'cookie_jar']).default('browser_storage_state'),
  sessionData: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ValidateConnectorSessionInput = z.object({
  grantId: z.string().uuid(),
  action: z.enum(['validate', 'sync']).default('validate'),
  limit: z.number().int().min(1).max(200).optional(),
});

export const YcPublicIngestionInput = z.object({
  source: z.enum(['companies', 'library', 'all']).default('all'),
  batch: z.string().max(10).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const YcPrivateIngestionInput = z.object({
  grantId: z.string().uuid(),
  action: z.enum(['validate', 'sync']).default('sync'),
  limit: z.number().int().min(1).max(200).optional(),
});

export const YcReplayIngestionInput = z.object({
  source: z.enum(['companies', 'library']).default('companies'),
  replayPath: z.string().min(1).max(5000).optional(),
  ingestionRecordId: z.string().uuid().optional(),
}).refine((value) => Boolean(value.replayPath || value.ingestionRecordId), {
  message: 'replayPath or ingestionRecordId is required',
});
