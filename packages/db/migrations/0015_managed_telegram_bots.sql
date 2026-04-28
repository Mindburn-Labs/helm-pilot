-- Founder-owned Telegram Managed Bots for launch/support intake.

CREATE TABLE IF NOT EXISTS "managed_telegram_bots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "creator_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "creator_telegram_id" text NOT NULL,
  "telegram_bot_id" text NOT NULL,
  "telegram_bot_username" text NOT NULL,
  "telegram_bot_name" text NOT NULL,
  "purpose" text NOT NULL DEFAULT 'launch_support',
  "status" text NOT NULL DEFAULT 'active',
  "response_mode" text NOT NULL DEFAULT 'approval_required',
  "token_secret_ref" text NOT NULL,
  "webhook_secret_hash" text,
  "welcome_copy" text NOT NULL DEFAULT 'Welcome. Join the launch list or send a support message.',
  "launch_url" text,
  "support_prompt" text DEFAULT 'Send your question and we will follow up.',
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "managed_telegram_bots_workspace_idx"
  ON "managed_telegram_bots" ("workspace_id");
CREATE INDEX IF NOT EXISTS "managed_telegram_bots_status_idx"
  ON "managed_telegram_bots" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "managed_telegram_bots_telegram_id_unique"
  ON "managed_telegram_bots" ("telegram_bot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "managed_telegram_bots_one_active_per_workspace_idx"
  ON "managed_telegram_bots" ("workspace_id")
  WHERE "status" = 'active' AND "purpose" = 'launch_support';

CREATE TABLE IF NOT EXISTS "managed_telegram_bot_provisioning_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "creator_telegram_id" text NOT NULL,
  "suggested_username" text NOT NULL,
  "suggested_name" text NOT NULL,
  "manager_bot_username" text NOT NULL,
  "creation_url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "managed_bot_id" uuid REFERENCES "managed_telegram_bots"("id") ON DELETE set null,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mtg_provisioning_workspace_idx"
  ON "managed_telegram_bot_provisioning_requests" ("workspace_id");
CREATE INDEX IF NOT EXISTS "mtg_provisioning_creator_status_idx"
  ON "managed_telegram_bot_provisioning_requests" ("creator_telegram_id", "status");
CREATE INDEX IF NOT EXISTS "mtg_provisioning_expires_idx"
  ON "managed_telegram_bot_provisioning_requests" ("expires_at");

CREATE TABLE IF NOT EXISTS "managed_telegram_bot_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "managed_bot_id" uuid NOT NULL REFERENCES "managed_telegram_bots"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "telegram_chat_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "telegram_username" text,
  "name" text,
  "source" text NOT NULL DEFAULT 'telegram_launch_bot',
  "status" text NOT NULL DEFAULT 'captured',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mtg_leads_workspace_idx"
  ON "managed_telegram_bot_leads" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mtg_leads_bot_user_unique"
  ON "managed_telegram_bot_leads" ("managed_bot_id", "telegram_user_id");

CREATE TABLE IF NOT EXISTS "managed_telegram_bot_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "managed_bot_id" uuid NOT NULL REFERENCES "managed_telegram_bots"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "telegram_chat_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "telegram_username" text,
  "telegram_first_name" text,
  "inbound_text" text NOT NULL,
  "inbound_message_id" integer,
  "intent" text NOT NULL DEFAULT 'support',
  "ai_draft" text,
  "approval_id" uuid REFERENCES "approvals"("id") ON DELETE set null,
  "reply_text" text,
  "reply_status" text NOT NULL DEFAULT 'none',
  "sent_message_id" text,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "replied_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "mtg_messages_workspace_idx"
  ON "managed_telegram_bot_messages" ("workspace_id");
CREATE INDEX IF NOT EXISTS "mtg_messages_bot_idx"
  ON "managed_telegram_bot_messages" ("managed_bot_id");
CREATE INDEX IF NOT EXISTS "mtg_messages_approval_idx"
  ON "managed_telegram_bot_messages" ("approval_id");
CREATE INDEX IF NOT EXISTS "mtg_messages_status_idx"
  ON "managed_telegram_bot_messages" ("reply_status");
