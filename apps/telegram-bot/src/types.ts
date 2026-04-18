import { type Context, type SessionFlavor } from 'grammy';
import { type FounderIntelService } from '@helm-pilot/founder-intel';
import { type Db } from '@helm-pilot/db/client';

export interface SessionData {
  workspaceId?: string;
  userId?: string;
  awaitingProfileInput?: boolean;
  activeOperatorContext?: string; // ID of the operator user is currently chatting with
}

export type BotContext = Context & SessionFlavor<SessionData>;

export interface BotDeps {
  db: Db;
  founderIntel?: FounderIntelService;
  /** Phase 13 Track C4 — run a normal task through the orchestrator. */
  runTask?: (params: OrchestratorRunParams) => Promise<OrchestratorRunResult>;
  /** Phase 13 Track C4 — run a subagent-enabled conduct loop. */
  runConduct?: (params: OrchestratorRunParams) => Promise<OrchestratorRunResult>;
}

export interface OrchestratorRunParams {
  taskId: string;
  workspaceId: string;
  operatorId?: string;
  context: string;
  iterationBudget?: number;
}

export interface OrchestratorRunResult {
  status: 'completed' | 'budget_exhausted' | 'blocked' | 'awaiting_approval';
  iterationsUsed: number;
  iterationBudget: number;
  costUsd?: number;
  error?: string;
}
