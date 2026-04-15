import { vi } from 'vitest';

/**
 * Creates a Drizzle-compatible mock DB for connector tests.
 */
export function createMockDb() {
  let nextResult: unknown[] = [];

  const chainable = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning', 'onConflictDoNothing', 'set']) {
      chain[m] = vi.fn(() => chainable());
    }
    chain['then'] = (resolve: (v: unknown[]) => void) => resolve(nextResult);
    return chain;
  };

  const db = {
    select: vi.fn(() => chainable()),
    insert: vi.fn(() => ({ values: vi.fn(() => chainable()) })),
    update: vi.fn(() => ({ set: vi.fn(() => chainable()) })),
    delete: vi.fn(() => chainable()),
    _setResult(result: unknown[]) {
      nextResult = result;
      return db;
    },
    _reset() {
      nextResult = [];
    },
  };

  return db;
}
