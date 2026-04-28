import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { workspaces } from './workspace.js';
import { approvals } from './audit.js';

// ─── Telegram Managed Bot Domain ───
//
// Founder-owned child bots created through Telegram's Managed Bots flow.
// Tokens are never stored here; `tokenSecretRef` points to tenantSecrets.

export const managedTelegramBots = pgTable(
  'managed_telegram_bots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    creatorUserId: uuid('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    creatorTelegramId: text('creator_telegram_id').notNull(),
    telegramBotId: text('telegram_bot_id').notNull(),
    telegramBotUsername: text('telegram_bot_username').notNull(),
    telegramBotName: text('telegram_bot_name').notNull(),
    purpose: text('purpose').notNull().default('launch_support'),
    status: text('status').notNull().default('active'),
    responseMode: text('response_mode').notNull().default('approval_required'),
    tokenSecretRef: text('token_secret_ref').notNull(),
    webhookSecretHash: text('webhook_secret_hash'),
    welcomeCopy: text('welcome_copy')
      .notNull()
      .default('Welcome. Join the launch list or send a support message.'),
    launchUrl: text('launch_url'),
    supportPrompt: text('support_prompt').default('Send your question and we will follow up.'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => [
    index('managed_telegram_bots_workspace_idx').on(table.workspaceId),
    index('managed_telegram_bots_status_idx').on(table.status),
    uniqueIndex('managed_telegram_bots_telegram_id_unique').on(table.telegramBotId),
  ],
);

export const managedTelegramBotProvisioningRequests = pgTable(
  'managed_telegram_bot_provisioning_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    creatorTelegramId: text('creator_telegram_id').notNull(),
    suggestedUsername: text('suggested_username').notNull(),
    suggestedName: text('suggested_name').notNull(),
    managerBotUsername: text('manager_bot_username').notNull(),
    creationUrl: text('creation_url').notNull(),
    status: text('status').notNull().default('pending'),
    managedBotId: uuid('managed_bot_id').references(() => managedTelegramBots.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mtg_provisioning_workspace_idx').on(table.workspaceId),
    index('mtg_provisioning_creator_status_idx').on(table.creatorTelegramId, table.status),
    index('mtg_provisioning_expires_idx').on(table.expiresAt),
  ],
);

export const managedTelegramBotLeads = pgTable(
  'managed_telegram_bot_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    managedBotId: uuid('managed_bot_id')
      .notNull()
      .references(() => managedTelegramBots.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    telegramUsername: text('telegram_username'),
    name: text('name'),
    source: text('source').notNull().default('telegram_launch_bot'),
    status: text('status').notNull().default('captured'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mtg_leads_workspace_idx').on(table.workspaceId),
    uniqueIndex('mtg_leads_bot_user_unique').on(table.managedBotId, table.telegramUserId),
  ],
);

export const managedTelegramBotMessages = pgTable(
  'managed_telegram_bot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    managedBotId: uuid('managed_bot_id')
      .notNull()
      .references(() => managedTelegramBots.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    telegramUsername: text('telegram_username'),
    telegramFirstName: text('telegram_first_name'),
    inboundText: text('inbound_text').notNull(),
    inboundMessageId: integer('inbound_message_id'),
    intent: text('intent').notNull().default('support'),
    aiDraft: text('ai_draft'),
    approvalId: uuid('approval_id').references(() => approvals.id, { onDelete: 'set null' }),
    replyText: text('reply_text'),
    replyStatus: text('reply_status').notNull().default('none'),
    sentMessageId: text('sent_message_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
  },
  (table) => [
    index('mtg_messages_workspace_idx').on(table.workspaceId),
    index('mtg_messages_bot_idx').on(table.managedBotId),
    index('mtg_messages_approval_idx').on(table.approvalId),
    index('mtg_messages_status_idx').on(table.replyStatus),
  ],
);
