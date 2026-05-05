import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { type Db } from '@pilot/db/client';
import { taskRuns, tasks } from '@pilot/db/schema';
import { type ActionRecord } from './agent-loop.js';

export interface ParentRunHistoryParams {
  taskId: string;
  workspaceId: string;
}

export interface ParentRunHistoryResult {
  taskFound: boolean;
  priorActions: ActionRecord[];
}

/**
 * Load replay history for an approval resume.
 *
 * Gate 1 invariant: resume only replays the intended parent task history,
 * ordered by durable sequence, and excludes conductor/subagent child rows.
 */
export async function loadParentRunHistory(
  db: Db,
  params: ParentRunHistoryParams,
): Promise<ParentRunHistoryResult> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.workspaceId, params.workspaceId)))
    .limit(1);

  if (!task) {
    return { taskFound: false, priorActions: [] };
  }

  const runs = await db
    .select()
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.taskId, params.taskId),
        eq(taskRuns.lineageKind, 'parent_action'),
        isNull(taskRuns.parentTaskRunId),
        isNotNull(taskRuns.actionTool),
      ),
    )
    .orderBy(asc(taskRuns.runSequence), asc(taskRuns.startedAt), asc(taskRuns.id));

  return {
    taskFound: true,
    priorActions: runs.map((run, index) => ({
      tool: run.actionTool ?? 'unknown',
      input: run.actionInput ?? {},
      actionHash: run.actionHash ?? undefined,
      output: run.actionOutput ?? null,
      verdict: run.verdict ?? (run.status === 'awaiting_approval' ? 'require_approval' : 'allow'),
      iteration: run.runSequence || run.iterationsUsed || index + 1,
      taskRunId: run.id,
    })),
  };
}
