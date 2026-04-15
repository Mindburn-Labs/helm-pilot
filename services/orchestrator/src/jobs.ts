import PgBoss from 'pg-boss';
import { and, eq, lt } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { opportunityScores, opportunities, tasks, taskRuns } from '@helm-pilot/db/schema';
import { type MemoryService } from '@helm-pilot/memory';
import { type LlmProvider } from '@helm-pilot/shared/llm';
import { type ActionRecord } from './agent-loop.js';
import { createLogger } from '@helm-pilot/shared/logger';
import { type Orchestrator } from './index.js';

const log = createLogger('jobs');

export interface JobDeps {
  db: Db;
  memory?: MemoryService;
  llm?: LlmProvider;
  orchestrator?: Orchestrator;
}

/**
 * Register background job handlers on a pg-boss instance.
 */
export async function registerJobHandlers(boss: PgBoss, deps: JobDeps): Promise<void> {
  // ─── Opportunity Scoring ───
  boss.work('opportunity.score', async (jobs: PgBoss.Job<{ opportunityId: string }>[]) => {
    for (const job of jobs) {
      const { opportunityId } = job.data;
      log.info({ opportunityId }, 'Scoring opportunity');

      const [opp] = await deps.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);

      if (!opp) {
        log.warn({ opportunityId }, 'Opportunity not found');
        continue;
      }

      if (!deps.llm) {
        log.warn('No LLM configured, skipping scoring');
        continue;
      }

      const prompt = `Score this startup opportunity on these dimensions (0-100 each):
- overall: Overall opportunity quality
- founderFit: How well this fits a typical solo/technical founder
- marketSignal: Strength of market demand signals
- feasibility: Technical and operational feasibility
- timing: How good is the timing right now

Opportunity: ${opp.title}
Description: ${opp.description}

Respond with JSON only: {"overall":N,"founderFit":N,"marketSignal":N,"feasibility":N,"timing":N}`;

      try {
        const response = await deps.llm.complete(prompt);
        const scores = JSON.parse(response) as Record<string, number>;

        await deps.db.insert(opportunityScores).values({
          opportunityId,
          overallScore: scores['overall'] ?? null,
          founderFitScore: scores['founderFit'] ?? null,
          marketSignal: scores['marketSignal'] ?? null,
          feasibility: scores['feasibility'] ?? null,
          timing: scores['timing'] ?? null,
          scoringMethod: 'llm',
        });

        await deps.db
          .update(opportunities)
          .set({ status: 'scored' })
          .where(eq(opportunities.id, opportunityId));

        log.info({ opportunityId }, 'Opportunity scored');
      } catch (err) {
        log.error({ err, opportunityId }, 'Failed to score opportunity');
        throw err;
      }
    }
  });

  // ─── Knowledge Recompilation ───
  boss.work('knowledge.recompile', async (jobs: PgBoss.Job<{ pageId: string }>[]) => {
    for (const job of jobs) {
      const { pageId } = job.data;
      log.info({ pageId }, 'Recompiling knowledge page');

      if (!deps.memory) {
        log.warn('Memory service not available');
        continue;
      }

      try {
        await deps.memory.recompileTruth(pageId);
        log.info({ pageId }, 'Knowledge page recompiled');
      } catch (err) {
        log.error({ err, pageId }, 'Failed to recompile knowledge page');
        throw err;
      }
    }
  });

  // ─── Task Resume (after approval) ───
  boss.work('task.resume', async (jobs: PgBoss.Job<{ taskId: string; workspaceId: string; operatorId?: string; context: string }>[]) => {
    for (const job of jobs) {
      const { taskId, workspaceId, operatorId, context } = job.data;
      log.info({ taskId }, 'Resuming task after approval');

      if (!deps.orchestrator) {
        log.warn('Orchestrator not available for task resume');
        continue;
      }

      try {
        // Load prior action history from task_runs
        const { taskRuns } = await import('@helm-pilot/db/schema');
        const runs = await deps.db
          .select()
          .from(taskRuns)
          .where(eq(taskRuns.taskId, taskId));

        const priorActions = runs
          .filter((r) => r.actionTool)
          .map((r, i) => ({
            tool: r.actionTool ?? 'unknown',
            input: r.actionInput ?? {},
            output: r.actionOutput ?? null,
            verdict: r.verdict ?? (r.status === 'awaiting_approval' ? 'require_approval' : 'allow'),
            iteration: r.iterationsUsed ?? i + 1,
          })) as ActionRecord[];

        const result = await deps.orchestrator.resumeTask({
          taskId,
          workspaceId,
          operatorId,
          context,
          priorActions,
        });

        log.info({ taskId, status: result.status, iterations: result.iterationsUsed }, 'Task resumed');
      } catch (err) {
        log.error({ err, taskId }, 'Failed to resume task');
        throw err;
      }
    }
  });

  // ─── Pipeline Execution (Python scripts) ───
  //
  // Security: Only scripts in the allowlist can be executed.
  // Paths are resolved relative to cwd and validated against traversal.
  const PIPELINE_ALLOWLIST: Record<string, string> = {
    'pipeline.yc-scrape': 'pipelines/yc-scraper/scrape_yc.py',
    'pipeline.startup-school': 'pipelines/yc-scraper/scrape_startup_school.py',
    'pipeline.ingest-knowledge': 'pipelines/intelligence/ingest_ccunpacked.py',
  };
  const PIPELINE_TIMEOUT = 900_000; // 15 min (Startup school scrape can take time)

  async function runPipeline(name: string, extraArgs: string[] = []): Promise<void> {
    const scriptPath = PIPELINE_ALLOWLIST[name];
    if (!scriptPath) {
      throw new Error(`Pipeline ${name} is not in the allowlist`);
    }

    // Guard against path traversal
    const { resolve, relative } = await import('node:path');
    const cwd = process.cwd();
    const resolved = resolve(cwd, scriptPath);
    const rel = relative(cwd, resolved);
    if (rel.startsWith('..') || resolve(cwd, rel) !== resolved) {
      throw new Error(`Pipeline path traversal blocked: ${scriptPath}`);
    }

    // Verify the script file exists before execution
    const { access } = await import('node:fs/promises');
    await access(resolved).catch(() => {
      throw new Error(`Pipeline script not found: ${resolved}`);
    });

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    log.info({ pipeline: name, script: scriptPath, extraArgs }, 'Running pipeline');
    const args = [resolved, ...extraArgs];
    const { stdout, stderr } = await execFileAsync('python3', args, {
      timeout: PIPELINE_TIMEOUT,
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      maxBuffer: 20 * 1024 * 1024, // 20MB max output
    });
    if (stderr) log.warn({ stderr: stderr.slice(0, 500), pipeline: name }, 'Pipeline stderr');
    log.info({ stdout: stdout.slice(0, 200), pipeline: name }, 'Pipeline completed');
  }

  boss.work('pipeline.yc-scrape', async (jobs: PgBoss.Job<{ replayPath?: string }>[]) => {
    for (const job of jobs) {
      try {
        const args = job.data?.replayPath ? ['--replay', job.data.replayPath] : [];
        await runPipeline('pipeline.yc-scrape', args);
      } catch (err) {
        log.error({ err }, 'YC scraper pipeline failed');
        throw err;
      }
    }
  });

  boss.work('pipeline.startup-school', async (jobs: PgBoss.Job<{ replayPath?: string }>[]) => {
    for (const job of jobs) {
      try {
        const args = job.data?.replayPath ? ['--replay', job.data.replayPath] : [];
        await runPipeline('pipeline.startup-school', args);
      } catch (err) {
        log.error({ err }, 'Startup School pipeline failed');
        throw err;
      }
    }
  });

  boss.work('pipeline.ingest-knowledge', async (jobs: PgBoss.Job[]) => {
    for (const _job of jobs) {
      try {
        await runPipeline('pipeline.ingest-knowledge');
      } catch (err) {
        log.error({ err }, 'Knowledge ingestion pipeline failed');
        throw err;
      }
    }
  });

  // ─── Crashed-Task Reaper ───
  // If the gateway/orchestrator crashes mid-agent-loop, a task row stays in
  // 'running' forever. This job reaps anything stuck for >10min.
  boss.work('tasks.reap_stuck', async (jobs: PgBoss.Job[]) => {
    for (const _job of jobs) {
      try {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000);
        const stuck = await deps.db
          .update(tasks)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(tasks.status, 'running'), lt(tasks.updatedAt, cutoff)))
          .returning({ id: tasks.id });

        if (stuck.length === 0) continue;

        for (const row of stuck) {
          await deps.db.insert(taskRuns).values({
            taskId: row.id,
            status: 'failed',
            verdict: 'reaped',
            error: 'Task reaped after 10min without progress — presumed crashed',
            completedAt: new Date(),
          });
        }
        log.warn({ count: stuck.length, taskIds: stuck.map((r) => r.id) }, 'Reaped stuck tasks');
      } catch (err) {
        log.error({ err }, 'Task reaper failed');
        throw err;
      }
    }
  });

  // ─── Scheduled Jobs ───
  // pg-boss v10 requires queues to exist before scheduling. createQueue is idempotent
  // on already-existing queues but errors if not called first for a new queue.
  const scheduledJobs: Array<[string, string]> = [
    ['pipeline.yc-scrape', '0 3 * * 0'],       // Weekly Sunday 3am UTC
    ['pipeline.startup-school', '0 4 * * 0'],  // Weekly Sunday 4am UTC
    ['tasks.reap_stuck', '*/5 * * * *'],       // Every 5 minutes
  ];
  for (const [name, cron] of scheduledJobs) {
    try {
      await boss.createQueue(name);
    } catch {
      // Queue already exists — continue to schedule
    }
    try {
      await boss.schedule(name, cron, {}, { tz: 'UTC' });
    } catch (err) {
      log.warn({ err, name, cron }, 'Failed to schedule job — continuing without it');
    }
  }

  log.info('Background job handlers registered');
}
