import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  currentWorkspace,
  currentWorkspaceId,
  runWithWorkspace,
  tryCurrentWorkspace,
  type WorkspaceContext,
} from '../middleware/workspace.js';

/**
 * Property-based tests for the workspace-context primitive.
 *
 * The guarantee we want: for any two workspace contexts A and B opened in
 * parallel async tasks, no frame ever observes the other's workspaceId.
 * AsyncLocalStorage gives us this from Node itself — these tests lock the
 * behaviour in so a refactor that swaps the implementation can't silently
 * regress.
 */

function uuidArb(): fc.Arbitrary<string> {
  return fc.uuid({ version: 4 });
}

function workspaceContextArb(): fc.Arbitrary<WorkspaceContext> {
  return fc.record({
    workspaceId: uuidArb(),
    userId: uuidArb(),
    openedAt: fc.date().map((d) => new Date(d.getTime())),
  });
}

describe('tenancy — workspace context isolation (property-based)', () => {
  it('currentWorkspaceId always matches the frame it was opened under', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceContextArb(), async (ctx) => {
        return runWithWorkspace(ctx, async () => {
          const observed = currentWorkspaceId();
          return observed === ctx.workspaceId;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('currentWorkspace returns the same ctx regardless of async depth', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceContextArb(), fc.integer({ min: 1, max: 8 }), async (ctx, depth) => {
        return runWithWorkspace(ctx, async () => {
          let observed: WorkspaceContext | null = null;
          async function deep(n: number): Promise<void> {
            if (n === 0) {
              observed = currentWorkspace();
              return;
            }
            await Promise.resolve();
            await deep(n - 1);
          }
          await deep(depth);
          return observed !== null && observed!.workspaceId === ctx.workspaceId;
        });
      }),
      { numRuns: 50 },
    );
  });

  it('parallel contexts never cross over — two tenants sharing a node run stay isolated', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceContextArb(), workspaceContextArb(), async (a, b) => {
        fc.pre(a.workspaceId !== b.workspaceId);

        const [resA, resB] = await Promise.all([
          runWithWorkspace(a, async () => {
            await Promise.resolve();
            await Promise.resolve();
            return currentWorkspaceId();
          }),
          runWithWorkspace(b, async () => {
            await Promise.resolve();
            await Promise.resolve();
            return currentWorkspaceId();
          }),
        ]);

        return resA === a.workspaceId && resB === b.workspaceId;
      }),
      { numRuns: 100 },
    );
  });

  it('nested contexts shadow parent — inner frame observes its own workspaceId', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceContextArb(), workspaceContextArb(), async (outer, inner) => {
        fc.pre(outer.workspaceId !== inner.workspaceId);

        return runWithWorkspace(outer, async () => {
          const observedOuter = currentWorkspaceId();
          const observedInner = await runWithWorkspace(inner, async () => currentWorkspaceId());
          const observedAfter = currentWorkspaceId();

          return (
            observedOuter === outer.workspaceId &&
            observedInner === inner.workspaceId &&
            observedAfter === outer.workspaceId
          );
        });
      }),
      { numRuns: 50 },
    );
  });

  it('tryCurrentWorkspace returns null outside any frame, ctx inside', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceContextArb(), async (ctx) => {
        const outside = tryCurrentWorkspace();
        const inside = await runWithWorkspace(ctx, async () => tryCurrentWorkspace());
        return outside === null && inside !== null && inside!.workspaceId === ctx.workspaceId;
      }),
      { numRuns: 50 },
    );
  });

  it('currentWorkspaceId throws outside a frame', () => {
    expect(() => currentWorkspaceId()).toThrow(/outside a requireWorkspace/);
  });

  it('concurrent thrashing — 20 tenants on one event loop, all observe correct id', async () => {
    const contexts = Array.from({ length: 20 }, (_, i) => ({
      workspaceId: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
      userId: `00000000-0000-4000-9000-${i.toString().padStart(12, '0')}`,
      openedAt: new Date(),
    }));

    const results = await Promise.all(
      contexts.map((ctx) =>
        runWithWorkspace(ctx, async () => {
          // Interleave microtasks to force AsyncLocalStorage to serve each
          // frame correctly across yields.
          await Promise.resolve();
          const a = currentWorkspaceId();
          await Promise.resolve();
          await Promise.resolve();
          const b = currentWorkspaceId();
          return { expected: ctx.workspaceId, a, b };
        }),
      ),
    );

    for (const r of results) {
      expect(r.a).toBe(r.expected);
      expect(r.b).toBe(r.expected);
    }
  });
});
