-- 0028 - Managed Telegram governance metadata
--
-- Preserves the HELM policy/document pin metadata used to authorize
-- managed Telegram bot actions and outbound child-bot replies. Tokens remain
-- vault-referenced; these columns contain only governance receipts and policy
-- pin metadata.

ALTER TABLE "managed_telegram_bots"
  ADD COLUMN IF NOT EXISTS "governance_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "managed_telegram_bot_messages"
  ADD COLUMN IF NOT EXISTS "governance_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
