import { describe, expect, it, vi } from 'vitest';
import { auditLog, complianceAttestations, evidenceItems, workspaces } from '@pilot/db/schema';
import { complianceRoutes } from '../../routes/compliance.js';
import { createMockDeps, expectJson, testApp } from '../helpers.js';

describe('complianceRoutes', () => {
  const wsHeader = { 'X-Workspace-Id': 'ws-1' };

  it('enables frameworks with audit-linked evidence', async () => {
    const deps = createMockDeps();
    deps.db._setResult([{ enabled: ['soc2_type2'] }]);
    const inserts: Array<{ table: unknown; value: unknown }> = [];
    const updates: Array<{ table: unknown; value: unknown }> = [];

    deps.db.insert = vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return {
          returning: vi.fn(async () =>
            table === evidenceItems ? [{ id: 'evidence-compliance-1' }] : [],
          ),
          then: (r: any) => r([]),
        };
      }),
    })) as any;
    deps.db.update = vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updates.push({ table, value });
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        };
      }),
    })) as any;

    const { fetch } = testApp(complianceRoutes, deps);
    const res = await fetch('POST', '/frameworks', { code: 'iso_42001' }, wsHeader);
    const body = await expectJson<{ enabled: string[] }>(res, 200);

    expect(body.enabled).toEqual(['soc2_type2', 'iso_42001']);
    expect(updates.find((update) => update.table === workspaces)?.value).toMatchObject({
      complianceFrameworks: ['soc2_type2', 'iso_42001'],
    });
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    expect(auditInsert).toMatchObject({
      workspaceId: 'ws-1',
      action: 'COMPLIANCE_FRAMEWORK_ENABLED',
      target: 'iso_42001',
      metadata: {
        evidenceType: 'compliance_framework_enabled',
        framework: 'iso_42001',
        enabledCount: 2,
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId: 'ws-1',
      auditEventId: auditInsert.id,
      evidenceType: 'compliance_framework_enabled',
      sourceType: 'gateway_compliance',
      metadata: {
        framework: 'iso_42001',
        enabledCount: 2,
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-compliance-1',
      },
    });
  });

  it('fails closed when framework evidence cannot be persisted', async () => {
    const deps = createMockDeps();
    deps.db._setResult([{ enabled: [] }]);
    deps.db.insert = vi.fn((table: unknown) => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          if (table === evidenceItems) throw new Error('evidence unavailable');
          return [];
        }),
        then: (r: any) => r([]),
      })),
    })) as any;

    const { fetch } = testApp(complianceRoutes, deps);
    const res = await fetch('POST', '/frameworks', { code: 'soc2_type2' }, wsHeader);
    const body = await expectJson<{ error: string }>(res, 500);

    expect(body.error).toBe('failed to enable framework');
  });

  it('disables frameworks with audit-linked evidence', async () => {
    const deps = createMockDeps();
    deps.db._setResult([{ enabled: ['soc2_type2', 'iso_42001'] }]);
    const inserts: Array<{ table: unknown; value: unknown }> = [];
    const updates: Array<{ table: unknown; value: unknown }> = [];

    deps.db.insert = vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return {
          returning: vi.fn(async () =>
            table === evidenceItems ? [{ id: 'evidence-compliance-2' }] : [],
          ),
          then: (r: any) => r([]),
        };
      }),
    })) as any;
    deps.db.update = vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updates.push({ table, value });
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        };
      }),
    })) as any;

    const { fetch } = testApp(complianceRoutes, deps);
    const res = await fetch('DELETE', '/frameworks/iso_42001', undefined, wsHeader);
    const body = await expectJson<{ enabled: string[] }>(res, 200);

    expect(body.enabled).toEqual(['soc2_type2']);
    expect(updates.find((update) => update.table === workspaces)?.value).toMatchObject({
      complianceFrameworks: ['soc2_type2'],
    });
    expect(inserts.find((insert) => insert.table === auditLog)?.value).toMatchObject({
      workspaceId: 'ws-1',
      action: 'COMPLIANCE_FRAMEWORK_DISABLED',
      target: 'iso_42001',
      metadata: {
        evidenceType: 'compliance_framework_disabled',
        framework: 'iso_42001',
        enabledCount: 1,
      },
    });
  });

  it('creates attestations with audit-linked evidence', async () => {
    const deps = createMockDeps({
      helmClient: {
        exportSoc2: vi.fn(async () => ({ manifestHash: 'bundle-hash-1' })),
      } as any,
    });
    const attestation = {
      id: 'attestation-1',
      workspaceId: 'ws-1',
      framework: 'soc2_type2',
      bundleHash: 'bundle-hash-1',
    };
    const inserts: Array<{ table: unknown; value: unknown }> = [];
    const updates: Array<{ table: unknown; value: unknown }> = [];

    deps.db.insert = vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return {
          returning: vi.fn(async () => {
            if (table === complianceAttestations) return [attestation];
            if (table === evidenceItems) return [{ id: 'evidence-compliance-3' }];
            return [];
          }),
          then: (r: any) => r([]),
        };
      }),
    })) as any;
    deps.db.update = vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updates.push({ table, value });
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
            then: (r: any) => r([]),
          })),
        };
      }),
    })) as any;

    const { fetch } = testApp(complianceRoutes, deps);
    const res = await fetch('POST', '/attest', { framework: 'soc2_type2' }, wsHeader);
    const body = await expectJson<{ id: string; framework: string; bundleHash: string }>(res, 200);

    expect(body).toMatchObject({
      id: 'attestation-1',
      framework: 'soc2_type2',
      bundleHash: 'bundle-hash-1',
    });
    expect(deps.helmClient?.exportSoc2).toHaveBeenCalledWith('ws-1');
    const auditInsert = inserts.find((insert) => insert.table === auditLog)?.value as {
      id: string;
    };
    expect(auditInsert).toMatchObject({
      workspaceId: 'ws-1',
      action: 'COMPLIANCE_ATTESTATION_CREATED',
      target: 'attestation-1',
      metadata: {
        evidenceType: 'compliance_attestation_created',
        framework: 'soc2_type2',
        attestationId: 'attestation-1',
        bundleHash: 'bundle-hash-1',
      },
    });
    expect(inserts.find((insert) => insert.table === evidenceItems)?.value).toMatchObject({
      workspaceId: 'ws-1',
      auditEventId: auditInsert.id,
      evidenceType: 'compliance_attestation_created',
      sourceType: 'gateway_compliance',
      metadata: {
        framework: 'soc2_type2',
        attestationId: 'attestation-1',
        bundleHash: 'bundle-hash-1',
      },
    });
    expect(updates.find((update) => update.table === auditLog)?.value).toMatchObject({
      metadata: {
        evidenceItemId: 'evidence-compliance-3',
      },
    });
  });

  it('fails closed when attestation evidence cannot be persisted', async () => {
    const deps = createMockDeps();
    deps.db.insert = vi.fn((table: unknown) => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          if (table === complianceAttestations) return [{ id: 'attestation-1' }];
          if (table === evidenceItems) throw new Error('evidence unavailable');
          return [];
        }),
        then: (r: any) => r([]),
      })),
    })) as any;

    const { fetch } = testApp(complianceRoutes, deps);
    const res = await fetch('POST', '/attest', { framework: 'soc2_type2' }, wsHeader);
    const body = await expectJson<{ error: string }>(res, 500);

    expect(body.error).toBe('failed to create compliance attestation');
  });
});
