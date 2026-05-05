import { describe, expect, it } from 'vitest';
import {
  a2aMessages,
  a2aThreads,
  agentHandoffs,
  browserObservations,
  browserSessionGrants,
  browserSessions,
  computerActions,
  taskRuns,
} from '../schema/index.js';

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

describe('Gate 3 runtime skill schema', () => {
  it('exports skill invocation metadata on task runs and handoffs', () => {
    expect(taskRuns.skillInvocations.name).toBe('skill_invocations');
    expect(agentHandoffs.workspaceId.name).toBe('workspace_id');
    expect(agentHandoffs.parentTaskRunId.name).toBe('parent_task_run_id');
    expect(agentHandoffs.childTaskRunId.name).toBe('child_task_run_id');
    expect(agentHandoffs.skillInvocations.name).toBe('skill_invocations');
  });
});

describe('Gate 6 browser operation schema', () => {
  it('exports browser sessions, grants, and observations', () => {
    expect(browserSessions.workspaceId.name).toBe('workspace_id');
    expect(browserSessions.allowedOrigins.name).toBe('allowed_origins');
    expect(browserSessionGrants.sessionId.name).toBe('session_id');
    expect(browserSessionGrants.scope.name).toBe('scope');
    expect(browserObservations.actionId.name).toBe('action_id');
    expect(browserObservations.evidencePackId.name).toBe('evidence_pack_id');
    expect(browserObservations.redactedDomSnapshot.name).toBe('redacted_dom_snapshot');
    expect(browserObservations.redactions.name).toBe('redactions');
  });
});

describe('Gate 7 computer operation schema', () => {
  it('exports safe computer action evidence columns', () => {
    expect(computerActions.workspaceId.name).toBe('workspace_id');
    expect(computerActions.toolActionId.name).toBe('tool_action_id');
    expect(computerActions.actionType.name).toBe('action_type');
    expect(computerActions.command.name).toBe('command');
    expect(computerActions.fileDiff.name).toBe('file_diff');
    expect(computerActions.evidencePackId.name).toBe('evidence_pack_id');
    expect(computerActions.replayIndex.name).toBe('replay_index');
  });
});
