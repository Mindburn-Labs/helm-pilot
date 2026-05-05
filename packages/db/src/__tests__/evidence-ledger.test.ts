import { describe, expect, it, vi } from 'vitest';
import { appendEvidenceItem } from '../evidence-ledger.js';
import { evidenceItems } from '../schema/index.js';

describe('appendEvidenceItem', () => {
  it('persists a canonical evidence item and returns its id', async () => {
    const inserted: Array<{ table: unknown; value: unknown }> = [];
    const db = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserted.push({ table, value });
          return {
            returning: vi.fn(async () => [{ id: 'evidence-item-1' }]),
          };
        }),
      })),
    };

    const id = await appendEvidenceItem(db as never, {
      workspaceId: 'workspace-1',
      evidenceType: 'helm_receipt',
      sourceType: 'helm_client',
      title: 'HELM TOOL_USE ALLOW',
    });

    expect(id).toBe('evidence-item-1');
    expect(inserted).toEqual([
      {
        table: evidenceItems,
        value: {
          workspaceId: 'workspace-1',
          evidenceType: 'helm_receipt',
          sourceType: 'helm_client',
          title: 'HELM TOOL_USE ALLOW',
          metadata: {},
        },
      },
    ]);
  });

  it('fails closed when the ledger row id is not returned', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    };

    await expect(
      appendEvidenceItem(db as never, {
        workspaceId: 'workspace-1',
        evidenceType: 'browser_observation',
        sourceType: 'browser_operator',
        title: 'Browser read',
      }),
    ).rejects.toThrow('evidence_items insert did not return id');
  });
});
