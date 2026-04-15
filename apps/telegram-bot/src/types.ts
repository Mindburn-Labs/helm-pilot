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
}
