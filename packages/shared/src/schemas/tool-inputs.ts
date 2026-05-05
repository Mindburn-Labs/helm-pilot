import { z } from 'zod';

const UrlString = z.string().url().max(2048);
const OriginString = z.string().url().max(2048).refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.origin === value.replace(/\/$/u, '');
    } catch {
      return false;
    }
  },
  { message: 'must be a URL origin such as https://example.com' },
);

export const ScraplingFetchInput = z.object({
  url: UrlString,
  selector: z.string().min(1).max(200).optional(),
  strategy: z.enum(['auto', 'fetcher', 'dynamic', 'stealthy']).default('auto'),
  waitSelector: z.string().min(1).max(200).optional(),
  adaptiveDomain: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(25).default(5),
  convertMarkdown: z.boolean().default(false),
  developmentMode: z.boolean().default(false),
});

export type ScraplingFetch = z.infer<typeof ScraplingFetchInput>;

export const OperatorComputerUseInput = z.object({
  workspaceId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  objective: z.string().min(1).max(2000),
  targetUrl: UrlString.optional(),
  environment: z.enum(['browser', 'desktop']).default('browser'),
  maxSteps: z.number().int().min(1).max(50).default(12),
  approvalCheckpoint: z.string().max(500).optional(),
  evidencePackId: z.string().uuid().optional(),
});

export type OperatorComputerUse = z.infer<typeof OperatorComputerUseInput>;

export const CreateBrowserSessionInput = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  browser: z.string().min(1).max(100).default('unknown'),
  profileLabel: z.string().max(200).optional(),
  allowedOrigins: z.array(OriginString).max(25).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateBrowserSession = z.infer<typeof CreateBrowserSessionInput>;

export const CreateBrowserSessionGrantInput = z.object({
  workspaceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  ventureId: z.string().uuid().optional(),
  missionId: z.string().uuid().optional(),
  grantedToType: z.enum(['agent', 'operator', 'user']).default('agent'),
  grantedToId: z.string().uuid().optional(),
  scope: z.enum(['read_extract']).default('read_extract'),
  allowedOrigins: z.array(OriginString).min(1).max(25),
  expiresAt: z.string().datetime().optional(),
});

export type CreateBrowserSessionGrant = z.infer<typeof CreateBrowserSessionGrantInput>;

export const BrowserReadObservationInput = z.object({
  workspaceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  grantId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  actionId: z.string().uuid().optional(),
  objective: z.string().min(1).max(2000).optional(),
  url: UrlString,
  title: z.string().max(500).optional(),
  domSnapshot: z.string().min(1).max(500_000),
  screenshotHash: z.string().min(8).max(200).optional(),
  screenshotRef: z.string().max(2000).optional(),
  extractedData: z.record(z.string(), z.unknown()).default({}),
  redactions: z.array(z.string().max(300)).max(100).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BrowserReadObservation = z.infer<typeof BrowserReadObservationInput>;

export const DecisionCourtRequestInput = z.object({
  opportunityIds: z.array(z.string().min(1)).min(1).max(25),
  founderContext: z.string().max(8000).optional(),
  mode: z.enum(['heuristic_preview', 'governed_llm_court']).default('governed_llm_court'),
});

export type DecisionCourtRequest = z.infer<typeof DecisionCourtRequestInput>;
