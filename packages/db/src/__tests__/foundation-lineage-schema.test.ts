import { describe, expect, it } from 'vitest';
import { a2aMessages, a2aThreads, taskRuns } from '../schema/index.js';

describe('Gate 1 foundation schema', () => {
  it('exports deterministic task run lineage columns', () => {
    expect(taskRuns.runSequence.name).toBe('run_sequence');
    expect(taskRuns.rootTaskRunId.name).toBe('root_task_run_id');
    expect(taskRuns.spawnedByActionId.name).toBe('spawned_by_action_id');
    expect(taskRuns.lineageKind.name).toBe('lineage_kind');
    expect(taskRuns.checkpointId.name).toBe('checkpoint_id');
  });

  it('exports durable A2A thread and message tables', () => {
    expect(a2aThreads.workspaceId.name).toBe('workspace_id');
    expect(a2aThreads.externalTaskId.name).toBe('external_task_id');
    expect(a2aThreads.pilotTaskId.name).toBe('pilot_task_id');
    expect(a2aMessages.threadId.name).toBe('thread_id');
    expect(a2aMessages.sequence.name).toBe('sequence');
  });
});
