import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorRegistry } from '../index.js';
import { encryptToken } from '../token-store.js';

// ─── Mock DB helper ─────────────────────────────────────────────────────────

type ResolveCallback = (v: unknown[]) => void;

function createMockDb() {
  let nextResult: unknown[] = [];

  const chainable = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning', 'onConflictDoNothing', 'set']) {
      chain[m] = vi.fn(() => chainable());
    }
    chain['then'] = (resolve: ResolveCallback) => resolve(nextResult);
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

/**
 * Creates a mock DB that returns a different result for each sequential
 * select() call, used for methods that issue multiple queries.
 */
function createSequentialMockDb(results: unknown[][]) {
  let callCount = 0;

  const chainableForSelect = (): Record<string, unknown> => {
    const result = results[callCount] ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning', 'onConflictDoNothing', 'set']) {
      chain[m] = vi.fn(() => chainableForSelect());
    }
    chain['then'] = (resolve: ResolveCallback) => {
      callCount++;
      resolve(result);
    };
    return chain;
  };

  // Insert/update chains always return the last result in the sequence
  const insertChainable = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning', 'onConflictDoNothing', 'set']) {
      chain[m] = vi.fn(() => insertChainable());
    }
    chain['then'] = (resolve: ResolveCallback) => {
      resolve(results[results.length - 1] ?? []);
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => chainableForSelect()),
    insert: vi.fn(() => ({ values: vi.fn(() => insertChainable()) })),
    update: vi.fn(() => ({ set: vi.fn(() => insertChainable()) })),
    delete: vi.fn(() => insertChainable()),
  };

  return db;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ConnectorRegistry', () => {
  let db: ReturnType<typeof createMockDb>;
  let registry: ConnectorRegistry;

  beforeEach(() => {
    db = createMockDb();
    registry = new ConnectorRegistry(db as never);
  });

  // --- In-memory registration ---

  it('registers the default connector set on construction', () => {
    const all = registry.listConnectors();
    expect(all).toHaveLength(8);
    const ids = all.map((c) => c.id);
    expect(ids).toContain('github');
    expect(ids).toContain('gmail');
    expect(ids).toContain('gdrive');
    expect(ids).toContain('linear');
    expect(ids).toContain('yc');
    expect(ids).toContain('telegram');
    expect(ids).toContain('browser');
    expect(ids).toContain('files');
  });

  it('listConnectors returns all registered', () => {
    const all = registry.listConnectors();
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const c of all) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('authType');
      expect(c).toHaveProperty('requiredScopes');
    }
  });

  it('getConnector returns registered connector', () => {
    const gh = registry.getConnector('github');
    expect(gh).toBeDefined();
    expect(gh!.name).toBe('GitHub');
    expect(gh!.requiredScopes).toContain('repo');
  });

  it('getConnector returns undefined for unknown', () => {
    expect(registry.getConnector('jira')).toBeUndefined();
  });

  it('registerConnector adds a new connector', () => {
    registry.registerConnector({
      id: 'slack',
      name: 'Slack',
      description: 'Messaging',
      authType: 'oauth2',
      requiredScopes: ['chat:write'],
      requiresApproval: true,
    });
    expect(registry.getConnector('slack')).toBeDefined();
    expect(registry.listConnectors()).toHaveLength(9);
  });

  // --- DB operations ---

  it('ensureDbRecord returns existing ID when found', async () => {
    db._setResult([{ id: 'c-1', name: 'github' }]);
    const id = await registry.ensureDbRecord(registry.getConnector('github')!);
    expect(id).toBe('c-1');
  });

  it('ensureDbRecord creates new when not found', async () => {
    // First select returns empty (not found), insert returns new row
    const seqDb = createSequentialMockDb([[], [{ id: 'c-2' }]]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    const id = await seqRegistry.ensureDbRecord(seqRegistry.getConnector('github')!);
    expect(id).toBe('c-2');
    expect(seqDb.insert).toHaveBeenCalled();
  });

  it('grantConnector returns existing active grant', async () => {
    // First select: connector lookup, second select: existing grant
    const seqDb = createSequentialMockDb([
      [{ id: 'c-1', name: 'github' }],
      [{ id: 'g-1', workspaceId: 'ws-1', connectorId: 'c-1', isActive: true }],
    ]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    const grantId = await seqRegistry.grantConnector('ws-1', 'github');
    expect(grantId).toBe('g-1');
  });

  it('grantConnector creates new grant when none exists', async () => {
    // First select: connector, second select: no existing grant, insert returns new
    const seqDb = createSequentialMockDb([
      [{ id: 'c-1', name: 'github' }],
      [],
      [{ id: 'g-2' }],
    ]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    const grantId = await seqRegistry.grantConnector('ws-1', 'github', ['repo']);
    expect(grantId).toBe('g-2');
    expect(seqDb.insert).toHaveBeenCalled();
  });

  it('grantConnector throws for unknown connector', async () => {
    db._setResult([]);
    await expect(registry.grantConnector('ws-1', 'jira')).rejects.toThrow('Unknown connector: jira');
  });

  it('revokeConnector sets isActive to false', async () => {
    // First select: connector found
    const seqDb = createSequentialMockDb([[{ id: 'c-1', name: 'github' }]]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    await seqRegistry.revokeConnector('ws-1', 'github');
    expect(seqDb.update).toHaveBeenCalled();
  });

  it('hasGrant returns true for active grant', async () => {
    const seqDb = createSequentialMockDb([
      [{ id: 'c-1', name: 'github' }],
      [{ id: 'g-1', isActive: true }],
    ]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    const result = await seqRegistry.hasGrant('ws-1', 'github');
    expect(result).toBe(true);
  });

  it('hasGrant returns false when no grant', async () => {
    const seqDb = createSequentialMockDb([
      [{ id: 'c-1', name: 'github' }],
      [],
    ]);
    const seqRegistry = new ConnectorRegistry(seqDb as never);
    const result = await seqRegistry.hasGrant('ws-1', 'github');
    expect(result).toBe(false);
  });

  it('hasGrant returns false when connector not found', async () => {
    db._setResult([]);
    const result = await registry.hasGrant('ws-1', 'unknown');
    expect(result).toBe(false);
  });

  // --- Token management ---

  it('storeToken encrypts and inserts when no existing token', async () => {
    // select returns empty (no existing token)
    db._setResult([]);
    await registry.storeToken('g-1', 'my-access-token', 'my-refresh');
    expect(db.insert).toHaveBeenCalled();
  });

  it('storeToken updates when token already exists', async () => {
    // select returns existing token row
    db._setResult([{ id: 't-1', grantId: 'g-1', accessTokenEnc: 'old' }]);
    await registry.storeToken('g-1', 'new-access-token');
    expect(db.update).toHaveBeenCalled();
  });

  it('getToken decrypts stored token', async () => {
    const plaintext = 'ghp_superSecretToken123';
    const encrypted = encryptToken(plaintext);
    db._setResult([{ accessTokenEnc: encrypted, grantId: 'g-1' }]);
    const result = await registry.getToken('g-1');
    expect(result).toBe(plaintext);
  });

  it('getToken returns null when no token found', async () => {
    db._setResult([]);
    const result = await registry.getToken('g-1');
    expect(result).toBeNull();
  });

  // --- Session management ---

  it('storeSession encrypts and inserts when no existing session exists', async () => {
    db._setResult([]);
    await registry.storeSession('g-1', { cookies: [] }, 'storage_state');
    expect(db.insert).toHaveBeenCalled();
  });

  it('getSession decrypts stored session payload', async () => {
    const payload = { cookies: [{ name: 'session', value: 'abc' }] };
    const encrypted = encryptToken(JSON.stringify(payload));
    db._setResult([{ sessionDataEnc: encrypted, grantId: 'g-1' }]);
    const result = await registry.getSession('g-1');
    expect(result).toEqual(payload);
  });

  it('deleteSession deletes stored sessions for a grant', async () => {
    await registry.deleteSession('g-1');
    expect(db.delete).toHaveBeenCalled();
  });
});
