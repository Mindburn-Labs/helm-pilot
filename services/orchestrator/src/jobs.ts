import PgBoss from 'pg-boss';
import { and, eq, lt } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { opportunityScores, opportunities, tasks, taskRuns, workspaces, workspaceDeletions, founderProfiles, founderStrengths } from '@helm-pilot/db/schema';
import { isNull } from 'drizzle-orm';
import { scoreOpportunity } from '@helm-pilot/shared/scoring';
import { type MemoryService } from '@helm-pilot/memory';
import { type LlmProvider } from '@helm-pilot/shared/llm';
import {
  type OAuthFlowManager,
  type RefreshNotifier,
  registerRefreshJobs,
} from '@helm-pilot/connectors';
import { type ActionRecord } from './agent-loop.js';
import { createLogger } from '@helm-pilot/shared/logger';
import { type Orchestrator } from './index.js';

const log = createLogger('jobs');

export interface JobDeps {
  db: Db;
  memory?: MemoryService;
  llm?: LlmProvider;
  orchestrator?: Orchestrator;
  /**
   * OAuth flow manager. When present, the connector-refresh background worker
   * is registered alongside the other jobs. When absent, no refresh worker
   * runs — appropriate for tests and dev instances without OAuth configured.
   */
  oauth?: OAuthFlowManager;
  /**
   * Notifier for permanent refresh failures. When a grant hits
   * PERMANENT_AFTER_ATTEMPTS the worker calls `notifier.reauthRequired(
   * workspaceId, connectorName)` so the re-auth banner surfaces.
   */
  refreshNotifier?: RefreshNotifier;
}

/**
 * Register background job handlers on a pg-boss instance.
 */
export async function registerJobHandlers(boss: PgBoss, deps: JobDeps): Promise<void> {
  // ─── Opportunity Scoring (Phase 3a) ───
  // Uses the versioned scoring engine in @helm-pilot/shared/scoring with
  // the founder's profile + strengths plumbed through for founder-fit.
  // Falls through to heuristic scoring when the LLM is absent or the
  // response is unparseable, so Discover never serves null scores.
  boss.work('opportunity.score', async (jobs: PgBoss.Job<{ opportunityId: string }>[]) => {
    for (const job of jobs) {
      const { opportunityId } = job.data;
      log.info({ opportunityId }, 'Scoring opportunity');

      // lint-tenancy: ok — opportunityId is workspace-scoped by the job
      //   producer (enqueuers verify the opportunity belongs to the caller's
      //   workspace before calling boss.send). The founder-profile join below
      //   is explicitly scoped by opp.workspaceId after the initial lookup.
      const [opp] = await deps.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);

      if (!opp) {
        log.warn({ opportunityId }, 'Opportunity not found');
        continue;
      }

      // Pull founder profile + strengths so the scoring engine can compute
      // a meaningful founder-fit number. Optional — heuristic score fires
      // without them. founderStrengths is keyed by founderId, so two
      // sequential queries are cheaper than a join that returns
      // workspaceId multiple times.
      let profile: typeof founderProfiles.$inferSelect | undefined;
      let strengths: Array<{ dimension: string; score: number }> = [];
      if (opp.workspaceId) {
        const profileRows = await deps.db
          .select()
          .from(founderProfiles)
          .where(eq(founderProfiles.workspaceId, opp.workspaceId))
          .limit(1);
        profile = profileRows[0];
        if (profile) {
          const strengthRows = await deps.db
            .select()
            .from(founderStrengths)
            .where(eq(founderStrengths.founderId, profile.id));
          strengths = strengthRows.map((r) => ({
            dimension: r.dimension,
            score: Number(r.score ?? 0),
          }));
        }
      }

      try {
        const result = await scoreOpportunity(
          {
            title: opp.title,
            description: opp.description,
            source: opp.source,
            sourceUrl: opp.sourceUrl ?? null,
            founderProfile: profile
              ? {
                  background: profile.background ?? null,
                  experience: profile.experience ?? null,
                  interests: (profile.interests as string[] | null) ?? null,
                  startupVector: profile.startupVector ?? null,
                }
              : null,
            founderStrengths: strengths,
          },
          deps.llm,
        );

        await deps.db.insert(opportunityScores).values({
          opportunityId,
          overallScore: result.overall,
          founderFitScore: result.founderFit,
          marketSignal: result.marketSignal,
          feasibility: result.feasibility,
          timing: result.timing,
          scoringMethod: result.method,
        });

        await deps.db
          .update(opportunities)
          .set({ status: 'scored' })
          .where(eq(opportunities.id, opportunityId));

        log.info(
          { opportunityId, method: result.method, overall: result.overall, promptVersion: result.promptVersion },
          'Opportunity scored',
        );
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
    'pipeline.yc-private': 'pipelines/yc-scraper/scrape_yc_private.py',
    'pipeline.ingest-knowledge': 'pipelines/intelligence/ingest_ccunpacked.py',
    'pipeline.cluster': 'pipelines/intelligence/cluster.py',
  };
  const PIPELINE_TIMEOUT = 900_000; // 15 min (Startup school scrape can take time)
  const pythonBin = process.env.PYTHON_BIN || 'python3';

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
    const { stdout, stderr } = await execFileAsync(pythonBin, args, {
      timeout: PIPELINE_TIMEOUT,
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      maxBuffer: 20 * 1024 * 1024, // 20MB max output
    });
    if (stderr) log.warn({ stderr: stderr.slice(0, 500), pipeline: name }, 'Pipeline stderr');
    log.info({ stdout: stdout.slice(0, 200), pipeline: name }, 'Pipeline completed');
  }

  boss.work('pipeline.yc-scrape', async (jobs: PgBoss.Job<{ replayPath?: string; batch?: string; limit?: number; workspaceId?: string }>[]) => {
    for (const job of jobs) {
      try {
        const args = [
          ...(job.data?.replayPath ? ['--replay', job.data.replayPath] : []),
          ...(job.data?.batch ? ['--batch', job.data.batch] : []),
          ...(job.data?.limit ? ['--limit', String(job.data.limit)] : []),
          ...(job.data?.workspaceId ? ['--workspace-id', job.data.workspaceId] : []),
        ];
        await runPipeline('pipeline.yc-scrape', args);
      } catch (err) {
        log.error({ err }, 'YC scraper pipeline failed');
        throw err;
      }
    }
  });

  boss.work('pipeline.startup-school', async (jobs: PgBoss.Job<{ replayPath?: string; limit?: number; workspaceId?: string }>[]) => {
    for (const job of jobs) {
      try {
        const args = [
          ...(job.data?.replayPath ? ['--replay', job.data.replayPath] : []),
          ...(job.data?.limit ? ['--limit', String(job.data.limit)] : []),
          ...(job.data?.workspaceId ? ['--workspace-id', job.data.workspaceId] : []),
        ];
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

  boss.work('pipeline.yc-private', async (jobs: PgBoss.Job<{ grantId: string; action?: 'validate' | 'sync'; limit?: number; workspaceId?: string }>[]) => {
    for (const job of jobs) {
      try {
        const args = [
          '--grant-id',
          job.data.grantId,
          '--action',
          job.data.action ?? 'sync',
          ...(job.data.limit ? ['--limit', String(job.data.limit)] : []),
          ...(job.data.workspaceId ? ['--workspace-id', job.data.workspaceId] : []),
        ];
        await runPipeline('pipeline.yc-private', args);
      } catch (err) {
        log.error({ err }, 'YC private pipeline failed');
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

  // ─── Tenant Hard-Delete Sweep (Phase 2d) ───
  // Looks for workspaces whose `hard_delete_after` window has passed and
  // tears them down with a single cascading DELETE. Runs on a schedule so
  // operators don't have to poke the admin endpoint; the admin endpoint
  // calls the same logic for manual drills.
  boss.work('tenant.hard-delete-sweep', async (jobs: PgBoss.Job<{ limit?: number }>[]) => {
    for (const job of jobs) {
      const limit = Math.max(1, Math.min(500, job.data?.limit ?? 50));
      try {
        const pending = await deps.db
          .select()
          .from(workspaceDeletions)
          .where(and(isNull(workspaceDeletions.hardDeletedAt), lt(workspaceDeletions.hardDeleteAfter, new Date())))
          .limit(limit);
        let deleted = 0;
        for (const row of pending) {
          // lint-tenancy: ok — scheduled platform cleanup is the only task
          //   allowed to issue cross-tenant hard deletes.
          await deps.db.delete(workspaces).where(eq(workspaces.id, row.workspaceId));
          deleted++;
        }
        if (deleted > 0) log.info({ deleted, pending: pending.length }, 'tenant hard-delete sweep');
      } catch (err) {
        log.error({ err }, 'tenant hard-delete sweep failed');
        throw err;
      }
    }
  });

  // ─── Cluster Generation (Phase 3b) ───
  // Rebuilds opportunity clusters for every workspace that has ≥3 scored
  // opportunities. Runs nightly at 2am UTC via cron. Can also be triggered
  // ad-hoc via `POST /api/opportunities/cluster` which enqueues a job
  // with a specific workspaceId.
  boss.work('pipeline.cluster', async (jobs: PgBoss.Job<{ workspaceId?: string }>[]) => {
    for (const job of jobs) {
      const workspaceId = job.data?.workspaceId;
      if (!workspaceId) {
        // Cron trigger — run for all workspaces (admin operation)
        log.info('Cluster cron: enumerating workspaces for cluster rebuild');
        const allWorkspaces = await deps.db.select({ id: workspaces.id }).from(workspaces);
        for (const ws of allWorkspaces) {
          try {
            await runPipeline('pipeline.cluster', ['--workspace-id', ws.id]);
          } catch (err) {
            log.error({ err, workspaceId: ws.id }, 'Cluster generation failed for workspace');
          }
        }
        return;
      }
      try {
        await runPipeline('pipeline.cluster', ['--workspace-id', workspaceId]);
        log.info({ workspaceId }, 'Cluster generation complete');
      } catch (err) {
        log.error({ err, workspaceId }, 'Cluster generation failed');
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
    ['pipeline.cluster', '0 2 * * *'],         // Daily 2am UTC — rebuild workspace clusters
    ['tasks.reap_stuck', '*/5 * * * *'],       // Every 5 minutes
    ['tenant.hard-delete-sweep', '0 5 * * *'], // Daily 5am UTC — past-grace hard delete
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

  // ─── Connector token refresh worker (Phase 13, Track B) ───
  // Runs only when OAuth is configured. Idempotent — registers the two
  // refresh queues + schedules the tick cron.
  if (deps.oauth) {
    try {
      await registerRefreshJobs(boss, {
        db: deps.db,
        oauth: deps.oauth,
        notifier: deps.refreshNotifier,
      });
    } catch (err) {
      log.warn({ err }, 'Failed to register connector refresh worker — continuing');
    }
  }

  log.info('Background job handlers registered');
}
