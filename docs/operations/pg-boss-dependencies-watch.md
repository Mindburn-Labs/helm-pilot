# pg-boss Dependencies Watch

Status: no upgrade yet.

Linear: MIN-239

## Decision

Do not bump `pg-boss` for first-class dependencies yet. PR #747 is still open and unreleased, and the maintainer discussion is still resolving transaction, cache, and query-plan concerns.

Primary source:

- https://github.com/timgit/pg-boss/pull/747

## Current Safe Path

HELM Pilot keeps the single-process invariant and existing queues:

- `task.resume` remains the approval-resume queue.
- Workflow sequencing stays in the orchestrator until pg-boss has a released dependency API.
- Any future dependency migration must preserve the existing queue names and avoid multi-worker scale-out assumptions.

## Revisit Gate

Revisit only when all are true:

- PR #747 or successor is merged.
- A pg-boss release contains the dependency API.
- Release notes document transaction behavior for parent/child insertion.
- A local migration spike proves mixed dependent/non-dependent jobs do not add completion-query overhead to regular queues.
