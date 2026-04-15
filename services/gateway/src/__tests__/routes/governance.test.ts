import { describe, it, expect } from 'vitest';
import { governanceRoutes } from '../../routes/governance.js';
import { testApp, expectJson, createMockDeps } from '../helpers.js';

describe('governanceRoutes', () => {
  // ── GET /status ──

  describe('GET /status', () => {
    it('reports helmConfigured=false when no helm-client is provided', async () => {
      const { fetch } = testApp(governanceRoutes);
      const res = await fetch('GET', '/status');
      const body = await expectJson<{ helmConfigured: boolean; live: unknown; latestSnapshot: unknown }>(
        res,
        200,
      );
      expect(body.helmConfigured).toBe(false);
      expect(body.live).toBeNull();
    });

    it('returns latest snapshot from the mock db when no client is supplied', async () => {
      const deps = createMockDeps();
      const snapshot = {
        id: 'snap-1',
        checkedAt: new Date('2026-04-15T10:00:00Z').toISOString(),
        gatewayOk: true,
        latencyMs: 12,
        version: '0.3.0',
        error: null,
      };
      deps.db._setResult([snapshot]);

      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/status');
      const body = await expectJson<{ latestSnapshot: typeof snapshot | null }>(res, 200);
      expect(body.latestSnapshot).toEqual(snapshot);
    });

    it('probes the live helm-client when one is configured', async () => {
      const deps = createMockDeps();
      deps.db._setResult([]);
      (deps as Record<string, unknown>).helmClient = {
        health: async () => ({
          gatewayOk: true,
          latencyMs: 7,
          version: '0.3.0',
          checkedAt: new Date(),
        }),
      };

      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/status');
      const body = await expectJson<{
        helmConfigured: boolean;
        live: { ok: boolean; latencyMs: number; version: string };
      }>(res, 200);
      expect(body.helmConfigured).toBe(true);
      expect(body.live.ok).toBe(true);
      expect(body.live.version).toBe('0.3.0');
    });
  });

  // ── GET /receipts ──

  describe('GET /receipts', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(governanceRoutes);
      const res = await fetch('GET', '/receipts');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns receipts scoped to a workspace with no cursor when the page is short', async () => {
      const deps = createMockDeps();
      const now = new Date('2026-04-15T12:00:00Z');
      deps.db._setResult([
        {
          id: 'ep-1',
          workspaceId: 'ws-1',
          decisionId: 'dec-1',
          taskRunId: null,
          verdict: 'ALLOW',
          reasonCode: null,
          policyVersion: 'founder-ops-v1',
          decisionHash: 'sha256:abc',
          action: 'LLM_INFERENCE',
          resource: 'gpt-4',
          principal: 'workspace:ws-1',
          signedBlob: null,
          receivedAt: now,
          verifiedAt: null,
        },
      ]);

      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/receipts?workspaceId=ws-1');
      const body = await expectJson<{
        receipts: Array<{ decisionId: string; verdict: string }>;
        nextCursor: string | null;
      }>(res, 200);
      expect(body.receipts.length).toBe(1);
      expect(body.receipts[0]!.decisionId).toBe('dec-1');
      expect(body.nextCursor).toBeNull();
    });

    it('returns a cursor when the page is full', async () => {
      const deps = createMockDeps();
      const receipts = Array.from({ length: 25 }, (_, i) => ({
        id: `ep-${i}`,
        workspaceId: 'ws-1',
        decisionId: `dec-${i}`,
        taskRunId: null,
        verdict: 'ALLOW',
        reasonCode: null,
        policyVersion: 'v1',
        decisionHash: null,
        action: 'LLM_INFERENCE',
        resource: 'gpt-4',
        principal: 'workspace:ws-1',
        signedBlob: null,
        receivedAt: new Date(Date.now() - i * 1000),
        verifiedAt: null,
      }));
      deps.db._setResult(receipts);

      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/receipts?workspaceId=ws-1&limit=25');
      const body = await expectJson<{ nextCursor: string | null }>(res, 200);
      expect(body.nextCursor).not.toBeNull();
    });
  });

  // ── GET /receipts/:decisionId ──

  describe('GET /receipts/:decisionId', () => {
    it('returns 400 when workspaceId is missing', async () => {
      const { fetch } = testApp(governanceRoutes);
      const res = await fetch('GET', '/receipts/dec-1');
      const body = await expectJson<{ error: string }>(res, 400);
      expect(body.error).toContain('workspaceId');
    });

    it('returns 404 when no receipt matches', async () => {
      const deps = createMockDeps();
      deps.db._setResult([]);
      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/receipts/dec-unknown?workspaceId=ws-1');
      await expectJson(res, 404);
    });

    it('returns a single receipt with the signed blob on hit', async () => {
      const deps = createMockDeps();
      const now = new Date();
      const row = {
        id: 'ep-42',
        workspaceId: 'ws-1',
        decisionId: 'dec-42',
        taskRunId: null,
        verdict: 'DENY',
        reasonCode: 'budget_exceeded',
        policyVersion: 'founder-ops-v1',
        decisionHash: 'sha256:xyz',
        action: 'LLM_INFERENCE',
        resource: 'gpt-4',
        principal: 'workspace:ws-1/operator:engineering',
        signedBlob: { signature: 'ed25519:...', payload: '...' },
        receivedAt: now,
        verifiedAt: null,
      };
      deps.db._setResult([row]);

      const { fetch } = testApp(governanceRoutes, deps);
      const res = await fetch('GET', '/receipts/dec-42?workspaceId=ws-1');
      const body = await expectJson<{
        receipt: { decisionId: string; verdict: string };
        signedBlob: { signature: string };
      }>(res, 200);
      expect(body.receipt.decisionId).toBe('dec-42');
      expect(body.receipt.verdict).toBe('DENY');
      expect(body.signedBlob.signature).toBe('ed25519:...');
    });
  });
});
