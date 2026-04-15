import { z } from 'zod';

// ─── App Config ───
export const AppConfigSchema = z.object({
  port: z.coerce.number().default(3100),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  databaseUrl: z.string().url(),
  sessionSecret: z.string().min(16),
  allowedOrigins: z.string().default(''),
  telegram: z.object({
    botToken: z.string().optional(),
    webhookSecret: z.string().optional(),
    ownerChatId: z.string().optional(),
  }),
  llm: z.object({
    openrouterApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
  }),
  storage: z.object({
    type: z.enum(['local', 's3']).default('local'),
    s3Endpoint: z.string().optional(),
    s3Bucket: z.string().optional(),
    s3AccessKey: z.string().optional(),
    s3SecretKey: z.string().optional(),
  }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Load and validate config from environment variables.
 * Fails closed: throws on missing required values.
 */
export function loadConfig(): AppConfig {
  return AppConfigSchema.parse({
    port: process.env['PORT'],
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
    databaseUrl: process.env['DATABASE_URL'],
    sessionSecret: process.env['SESSION_SECRET'],
    allowedOrigins: process.env['ALLOWED_ORIGINS'],
    telegram: {
      botToken: process.env['TELEGRAM_BOT_TOKEN'],
      webhookSecret: process.env['TELEGRAM_WEBHOOK_SECRET'],
      ownerChatId: process.env['TELEGRAM_OWNER_CHAT_ID'],
    },
    llm: {
      openrouterApiKey: process.env['OPENROUTER_API_KEY'],
      anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
      openaiApiKey: process.env['OPENAI_API_KEY'],
    },
    storage: {
      type: process.env['S3_ENDPOINT'] ? 's3' : 'local',
      s3Endpoint: process.env['S3_ENDPOINT'],
      s3Bucket: process.env['S3_BUCKET'],
      s3AccessKey: process.env['S3_ACCESS_KEY'],
      s3SecretKey: process.env['S3_SECRET_KEY'],
    },
  });
}
