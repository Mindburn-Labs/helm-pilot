import { z } from 'zod';

const UrlString = z.string().url().max(2048);

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
