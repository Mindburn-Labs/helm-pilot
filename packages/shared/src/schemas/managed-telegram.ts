import { z } from 'zod';

export const ManagedTelegramBotResponseModeSchema = z.enum([
  'intake_only',
  'approval_required',
  'autonomous_helm',
]);
export type ManagedTelegramBotResponseMode = z.infer<typeof ManagedTelegramBotResponseModeSchema>;

export const ManagedTelegramBotStatusSchema = z.enum(['active', 'disabled', 'error']);
export type ManagedTelegramBotStatus = z.infer<typeof ManagedTelegramBotStatusSchema>;

export const ManagedTelegramBotSettingsInput = z.object({
  responseMode: ManagedTelegramBotResponseModeSchema.optional(),
  welcomeCopy: z.string().trim().min(1).max(1000).optional(),
  launchUrl: z.string().trim().url().max(2048).nullable().optional(),
  supportPrompt: z.string().trim().min(1).max(1000).nullable().optional(),
});
export type ManagedTelegramBotSettings = z.infer<typeof ManagedTelegramBotSettingsInput>;

export const ManagedTelegramBotSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  telegramBotId: z.string(),
  telegramBotUsername: z.string(),
  telegramBotName: z.string(),
  purpose: z.literal('launch_support'),
  status: ManagedTelegramBotStatusSchema,
  responseMode: ManagedTelegramBotResponseModeSchema,
  welcomeCopy: z.string(),
  launchUrl: z.string().nullable(),
  supportPrompt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  disabledAt: z.string().nullable(),
});
export type ManagedTelegramBotSummary = z.infer<typeof ManagedTelegramBotSummarySchema>;

export const ManagedTelegramProvisioningResponseSchema = z.object({
  id: z.string().uuid(),
  creationUrl: z.string().url(),
  suggestedUsername: z.string(),
  suggestedName: z.string(),
  managerBotUsername: z.string(),
  expiresAt: z.string(),
});
export type ManagedTelegramProvisioningResponse = z.infer<
  typeof ManagedTelegramProvisioningResponseSchema
>;

export const ManagedTelegramLeadSchema = z.object({
  id: z.string().uuid(),
  managedBotId: z.string().uuid(),
  telegramUserId: z.string(),
  telegramUsername: z.string().nullable(),
  name: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});
export type ManagedTelegramLead = z.infer<typeof ManagedTelegramLeadSchema>;

export const ManagedTelegramMessageSchema = z.object({
  id: z.string().uuid(),
  managedBotId: z.string().uuid(),
  telegramUserId: z.string(),
  telegramUsername: z.string().nullable(),
  telegramFirstName: z.string().nullable(),
  inboundText: z.string(),
  aiDraft: z.string().nullable(),
  replyText: z.string().nullable(),
  replyStatus: z.string(),
  approvalId: z.string().uuid().nullable(),
  createdAt: z.string(),
  repliedAt: z.string().nullable(),
});
export type ManagedTelegramMessage = z.infer<typeof ManagedTelegramMessageSchema>;

export const ManagedTelegramStateSchema = z.object({
  bot: ManagedTelegramBotSummarySchema.nullable(),
  pendingRequest: ManagedTelegramProvisioningResponseSchema.nullable(),
  leads: z.array(ManagedTelegramLeadSchema),
  messages: z.array(ManagedTelegramMessageSchema),
});
export type ManagedTelegramState = z.infer<typeof ManagedTelegramStateSchema>;

export const ManagedTelegramReplyInput = z.object({
  text: z.string().trim().min(1).max(4096),
});
export type ManagedTelegramReply = z.infer<typeof ManagedTelegramReplyInput>;
