import { serve } from '@hono/node-server';
import PgBoss from 'pg-boss';
import { createDb, runMigrations } from '@helm-pilot/db/client';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '@helm-pilot/orchestrator';
import { MemoryService } from '@helm-pilot/memory';
import { FounderIntelService } from '@helm-pilot/founder-intel';
import { ConnectorRegistry, OAuthFlowManager } from '@helm-pilot/connectors';
import { CofounderEngine } from '@helm-pilot/cofounder-engine';
import { type PolicyConfig } from '@helm-pilot/shared/schemas';
import { createLlmProvider, type LlmProvider } from '@helm-pilot/shared/llm';
import { createEmbeddingProvider } from '@helm-pilot/shared/embeddings';
import { createLogger } from '@helm-pilot/shared/logger';
import { HelmClient, HelmLlmProvider } from '@helm-pilot/helm-client';
import { createGateway } from './index.js';
import { configureRateLimit } from './middleware/rate-limit.js';
import { EventBus } from './events/bus.js';
import { createEmailProvider } from './services/email-provider.js';
import { initSentry, flushSentry } from '@helm-pilot/shared/errors/sentry';

const log = createLogger('helm-pilot');

async function main() {
  // Initialize Sentry first — captures errors even during startup
  await initSentry();

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    log.fatal('DATABASE_URL is required');
    process.exit(1);
  }

  // ─── Apply pending migrations (fail-fast) ───
  const runMigrationsEnv = (process.env['RUN_MIGRATIONS_ON_STARTUP'] ?? 'true').toLowerCase();
  if (runMigrationsEnv !== 'false') {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const migrationsFolder = resolve(here, '../../../packages/db/migrations');
      await runMigrations(databaseUrl, migrationsFolder);
      log.info('Migrations applied');
    } catch (err) {
      log.fatal({ err }, 'Migration failed — refusing to start');
      process.exit(1);
    }
  }

  // ─── Initialize services ───
  const { db, close: dbClose } = createDb(databaseUrl);

  // ─── Redis (optional, for distributed rate limiting) ───
  let redis: { quit: () => Promise<unknown> } | null = null;
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl) {
    try {
      const ioredis = await import('ioredis');
      const RedisCtor = ioredis.Redis ?? (ioredis as unknown as { default: typeof ioredis.Redis }).default;
      redis = new RedisCtor(redisUrl, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
      });
      log.info('Redis connected');
    } catch (err) {
      log.warn({ err }, 'Redis connection failed — falling back to in-memory rate limiter');
    }
  }
  configureRateLimit(redis as never);

  const defaultPolicy: PolicyConfig = {
    killSwitch: false,
    budget: {
      dailyTotalMax: Number(process.env['DAILY_BUDGET_MAX'] ?? '500'),
      perTaskMax: Number(process.env['PER_TASK_BUDGET_MAX'] ?? '100'),
      perOperatorMax: 200,
      emergencyKill: 1500,
      currency: 'EUR',
    },
    toolBlocklist: [],
    contentBans: [],
    connectorAllowlist: [],
    requireApprovalFor: [],
    failClosed: true,
  };

  const memory = new MemoryService(db);
  const connectors = new ConnectorRegistry(db);
  const oauth = new OAuthFlowManager(connectors, db);
  oauth.validateProviders(); // Fail-fast in prod if enabled connectors lack credentials

  // ─── HELM governance sidecar (optional but vision-critical) ───
  // When HELM_GOVERNANCE_URL is set, every LLM call is routed through the
  // HELM sidecar's Guardian pipeline. The orchestrator persists each receipt
  // to evidence_packs + task_runs for offline audit.
  let helmClient: HelmClient | undefined;
  const helmUrl = process.env['HELM_GOVERNANCE_URL'];
  if (helmUrl) {
    helmClient = new HelmClient({
      baseUrl: helmUrl,
      healthUrl: process.env['HELM_HEALTH_URL'],
      failClosed: process.env['HELM_FAIL_CLOSED'] !== '0',
    });
    log.info({ helmUrl }, 'HELM governance client configured');
  } else {
    log.warn(
      'HELM_GOVERNANCE_URL not set — LLM calls run without HELM Guardian. ' +
        'Production deployments MUST configure the sidecar.',
    );
  }

  // LLM provider (optional — gracefully degrades). When HELM is configured,
  // the provider is a HelmLlmProvider that routes every call through the
  // sidecar; otherwise falls back to direct OpenRouter/Anthropic/OpenAI.
  let llm: LlmProvider | undefined;
  let founderIntel: FounderIntelService | undefined;
  try {
    if (helmClient) {
      llm = new HelmLlmProvider({
        helm: helmClient,
        defaultPrincipal: 'workspace:pilot/operator:system',
        model: process.env['HELM_LLM_MODEL'] ?? 'anthropic/claude-sonnet-4',
      });
      log.info('LLM provider: HELM-governed (proxied through sidecar)');
    } else {
      llm = createLlmProvider({
        openrouterApiKey: process.env['OPENROUTER_API_KEY'],
        anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
        openaiApiKey: process.env['OPENAI_API_KEY'],
      });
      log.info('LLM provider: direct (no HELM)');
    }
    founderIntel = new FounderIntelService(db, llm);
    memory.setLlm(llm);
  } catch {
    log.warn('No LLM API key configured — agent loop + founder intake degraded');
  }

  // Embedding provider (optional — falls back to hash-based dev provider)
  const embeddings = createEmbeddingProvider({
    openaiApiKey: process.env['OPENAI_API_KEY'],
    voyageApiKey: process.env['VOYAGE_API_KEY'],
  });
  memory.setEmbeddings(embeddings);
  log.info({ model: embeddings.model }, 'Embedding provider configured');

  // ─── pg-boss background jobs ───
  const boss = new PgBoss(databaseUrl);
  await boss.start();
  log.info('pg-boss started');

  const orchestrator = new Orchestrator({
    db,
    policy: defaultPolicy,
    llm,
    memory,
    boss,
    helmClient,
  });
  const cofounderEngine = new CofounderEngine(db, llm);

  for (const connector of connectors.listConnectors()) {
    await connectors.ensureDbRecord(connector);
  }
  await cofounderEngine.seedRoles();

  // ─── Event bus (pg LISTEN/NOTIFY for real-time SSE) ───
  const eventBus = new EventBus(databaseUrl);
  try {
    await eventBus.start();
    log.info('Event bus connected (pg LISTEN/NOTIFY)');
  } catch (err) {
    log.warn({ err }, 'Event bus failed to start — SSE will fall back to polling');
  }

  // ─── Email provider (transactional emails: magic link, notifications) ───
  const emailProvider = createEmailProvider({
    provider: process.env['EMAIL_PROVIDER'] ?? 'noop',
    from: process.env['EMAIL_FROM'],
    resendApiKey: process.env['RESEND_API_KEY'],
    smtp: process.env['SMTP_HOST']
      ? {
          host: process.env['SMTP_HOST'],
          port: Number(process.env['SMTP_PORT'] ?? '587'),
          user: process.env['SMTP_USER'],
          pass: process.env['SMTP_PASS'],
          secure: process.env['SMTP_SECURE'] === 'true',
        }
      : undefined,
  });
  log.info({ emailProvider: emailProvider.kind }, 'Email provider configured');

  const app = createGateway({
    db,
    orchestrator,
    memory,
    founderIntel,
    connectors,
    oauth,
    cofounderEngine,
    eventBus,
    emailProvider,
    helmClient,
  });

  // ─── Telegram bot (webhook mode) ───
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (botToken) {
    const { webhookCallback } = await import('grammy');
    const { createBot } = await import('@helm-pilot/telegram-bot');
    const { NotificationService } = await import('@helm-pilot/telegram-bot/notifications');
    const bot = createBot(botToken, db, { founderIntel });
    await bot.init();

    // Wire approval push notifications via Telegram
    const notifications = new NotificationService(bot, db);
    orchestrator.agentLoop.setApprovalNotifier(
      (workspaceId, approvalId, action, reason) =>
        notifications.requestApproval(workspaceId, approvalId, action, reason),
    );
    log.info('Approval notifications enabled via Telegram');

    const handleUpdate = webhookCallback(bot, 'std/http');
    const webhookSecret = process.env['TELEGRAM_WEBHOOK_SECRET'];

    app.post('/api/telegram/webhook', async (c) => {
      // Validate webhook secret if configured
      if (webhookSecret) {
        const header = c.req.header('X-Telegram-Bot-Api-Secret-Token');
        if (header !== webhookSecret) {
          return c.json({ error: 'Forbidden' }, 403);
        }
      }
      const response = await handleUpdate(c.req.raw);
      return new Response(response.body, response);
    });

    log.info('Telegram bot embedded (webhook mode)');
  }

  // ─── Start server ───
  const port = Number(process.env['PORT'] ?? '3100');
  const server = serve({ fetch: app.fetch, port }, (info) => {
    log.info({ port: info.port }, 'HELM Pilot running');
  });

  // ─── Graceful shutdown ───
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');
    server.close();
    await boss.stop({ graceful: true });
    await eventBus.stop().catch(() => {});
    if (redis) {
      try { await redis.quit(); } catch { /* ignore */ }
    }
    await flushSentry();
    await dbClose();
    log.info('Shutdown complete');
    process.exit(0);
  };

  const hardTimeout = () => setTimeout(() => process.exit(1), 8000).unref();

  process.on('SIGTERM', () => {
    hardTimeout();
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    hardTimeout();
    shutdown('SIGINT');
  });
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start HELM Pilot');
  process.exit(1);
});
