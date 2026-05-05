ALTER TABLE "browser_actions"
ADD COLUMN "helm_document_version_pins" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "computer_actions"
ADD COLUMN "helm_document_version_pins" jsonb DEFAULT '{}'::jsonb NOT NULL;
