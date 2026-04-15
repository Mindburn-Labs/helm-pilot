import { z } from 'zod';

// ─── Product Modes (Section 12) ───
export const ProductModeSchema = z.enum([
  'discover', // Founder doesn't know what to build
  'decide', // Narrowing to one opportunity + operator structure
  'build', // Execution
  'launch', // Packaging and positioning
  'apply', // Application/fundraising materials
]);
export type ProductMode = z.infer<typeof ProductModeSchema>;

// ─── Operator Roles ───
export const OperatorRoleSchema = z.enum([
  'engineering',
  'product',
  'growth',
  'design',
  'ops',
]);
export type OperatorRole = z.infer<typeof OperatorRoleSchema>;

// ─── Task Status ───
export const TaskStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ─── Trust Boundary Verdicts ───
export const VerdictSchema = z.enum([
  'allow',
  'deny',
  'require_approval',
]);
export type Verdict = z.infer<typeof VerdictSchema>;

// ─── Canonical UX Sections (Section 38.9) ───
export const UxSectionSchema = z.enum([
  'discover', // Opportunity discovery + founder assessment
  'build', // Execution + artifacts
  'operators', // Digital co-founder management
  'memory', // Knowledge base + operational memory
  'applications', // YC/accelerator/funding materials
  'settings', // Config, connectors, workspace, admin
]);
export type UxSection = z.infer<typeof UxSectionSchema>;

// ─── Ingestion Source Type (Section 39.4) ───
export const IngestionSourceTypeSchema = z.enum([
  'scrape', // Automated web scraping
  'import', // File/data import
  'upload', // User file upload
  'api', // External API fetch
  'authorized_session', // User-authorized authenticated capture
]);
export type IngestionSourceType = z.infer<typeof IngestionSourceTypeSchema>;

// ─── Workspace Role (Section 39.2) ───
export const WorkspaceRoleSchema = z.enum([
  'owner', // Primary founder
  'partner', // Co-founder / partner (first-class, Section 39.2)
  'member', // Additional collaborator
]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

// ─── Side Effect Risk (Section 38.8) ───
// Outbound/external actions are approval-gated by default in V1
export const SideEffectRiskSchema = z.enum([
  'safe', // Internal only, no approval needed
  'low', // Minor external (read-only API calls)
  'approval_required', // Outbound, reputationally sensitive, or external writes
]);
export type SideEffectRisk = z.infer<typeof SideEffectRiskSchema>;
