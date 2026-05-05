import { describe, it, expect, vi } from 'vitest';
import { conductRoutes } from '../../routes/conduct.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const wsHeader = { 'X-Workspace-Id': workspaceId };

describe('conductRoutes', () => {
  it('rejects conductor runs for member role', async () => {
    const deps = createMockDeps();
    deps.orchestrator.runConduct = vi.fn();
    const { fetch } = testApp(conductRoutes, deps as any);

    const res = await fetch(
      'POST',
      '/conduct',
      {
        taskId: '00000000-0000-4000-8000-000000000010',
        context: 'run the mission',
      },
      { ...wsHeader, 'X-Workspace-Role': 'member' },
    );
    const body = await expectJson<{ error: string; requiredRole: string }>(res, 403);

    expect(body.error).toBe('insufficient workspace role');
    expect(body.requiredRole).toBe('partner');
    expect(deps.orchestrator.runConduct).not.toHaveBeenCalled();
  });

  it('rejects foreign workspace operatorId before running conductor', async () => {
    const deps = createMockDeps();
    deps.orchestrator.runConduct = vi.fn();
    const { fetch } = testApp(conductRoutes, deps as any);

    const res = await fetch(
      'POST',
      '/conduct',
      {
        taskId: '00000000-0000-4000-8000-000000000010',
        operatorId: '00000000-0000-4000-8000-000000000099',
        context: 'run the mission',
      },
      wsHeader,
    );
    const body = await expectJson<{ error: string }>(res, 403);

    expect(body.error).toBe('operatorId does not belong to authenticated workspace');
    expect(deps.orchestrator.runConduct).not.toHaveBeenCalled();
  });
});
