import { z } from 'zod';
import { ProductModeSchema, OperatorRoleSchema, TaskStatusSchema } from './enums.js';

// ─── Workspace ───
export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  currentMode: ProductModeSchema,
  ownerId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

// ─── Founder Profile ───
export const FounderProfileSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  background: z.string().optional(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  interests: z.array(z.string()),
  experience: z.string().optional(),
  startupVector: z.string().optional(), // inferred direction
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type FounderProfile = z.infer<typeof FounderProfileSchema>;

// ─── Operator ───
export const OperatorSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  role: OperatorRoleSchema,
  goal: z.string(),
  constraints: z.array(z.string()),
  tools: z.array(z.string()),
  createdAt: z.date(),
});
export type Operator = z.infer<typeof OperatorSchema>;

// ─── Task ───
export const TaskSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  operatorId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  mode: ProductModeSchema,
  parentTaskId: z.string().uuid().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ─── Opportunity ───
export const OpportunitySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  source: z.string(),
  sourceUrl: z.string().url().optional(),
  title: z.string(),
  description: z.string(),
  score: z.number().min(0).max(100).optional(),
  founderFitScore: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()),
  discoveredAt: z.date(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

// ─── Artifact ───
export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  type: z.enum(['landing_page', 'pdf', 'code', 'design', 'copy', 'pitch_deck', 'application']),
  name: z.string(),
  storagePath: z.string(),
  version: z.number().int().min(1),
  createdAt: z.date(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ─── Knowledge Page (GBrain-style) ───
export const KnowledgePageSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['person', 'company', 'opportunity', 'concept', 'source', 'project']),
  title: z.string(),
  compiledTruth: z.string(), // canonical summary
  tags: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type KnowledgePage = z.infer<typeof KnowledgePageSchema>;
