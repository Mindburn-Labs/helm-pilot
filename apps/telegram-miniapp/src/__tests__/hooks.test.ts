import { describe, it, expect } from 'vitest';

// @testing-library/react is not available in this project, so we verify
// the module exports are correct and the hook signature matches expectations.
// A full integration test with renderHook would require adding that dependency.

describe('useAsync module', () => {
  it('exports useAsync as a function', async () => {
    const mod = await import('../hooks.js');
    expect(typeof mod.useAsync).toBe('function');
  });

  it('useAsync accepts two parameters (fn and deps)', async () => {
    const mod = await import('../hooks.js');
    // Function.length reports the number of declared parameters
    // useAsync(fn, deps = []) — default param means length is 1
    expect(mod.useAsync.length).toBeGreaterThanOrEqual(1);
  });

  it('is the only named export', async () => {
    const mod = await import('../hooks.js');
    const exports = Object.keys(mod);
    expect(exports).toContain('useAsync');
    expect(exports).toHaveLength(1);
  });
});
