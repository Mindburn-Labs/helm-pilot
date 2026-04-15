import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry, type Tool } from '../tools.js';

// Minimal mocks — db is an empty object since built-in tools
// that use db require dynamic imports we don't exercise here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {} as any;

function createRegistry(opts: { memory?: unknown } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ToolRegistry(mockDb as any, opts.memory as any);
}

describe('ToolRegistry', () => {
  // ─── Registration ───

  describe('register()', () => {
    it('adds a tool that appears in listTools()', () => {
      const registry = createRegistry();
      const tool: Tool = {
        name: 'custom_tool',
        description: 'A custom tool for testing',
        execute: async () => ({ ok: true }),
      };

      registry.register(tool);

      const tools = registry.listTools();
      const found = tools.find((t) => t.name === 'custom_tool');
      expect(found).toBeDefined();
      expect(found!.description).toBe('A custom tool for testing');
    });

    it('overwrites a tool with the same name', () => {
      const registry = createRegistry();

      registry.register({
        name: 'dup',
        description: 'first',
        execute: async () => ({ v: 1 }),
      });
      registry.register({
        name: 'dup',
        description: 'second',
        execute: async () => ({ v: 2 }),
      });

      const tools = registry.listTools();
      const dups = tools.filter((t) => t.name === 'dup');
      expect(dups).toHaveLength(1);
      expect(dups[0]!.description).toBe('second');
    });
  });

  // ─── Listing ───

  describe('listTools()', () => {
    it('returns tool definitions with name and description', () => {
      const registry = createRegistry();
      const tools = registry.listTools();

      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
      }
    });

    it('includes all built-in tools', () => {
      const registry = createRegistry();
      const tools = registry.listTools();
      const names = tools.map((t) => t.name);

      // Universal tools
      expect(names).toContain('search_knowledge');
      expect(names).toContain('create_note');
      expect(names).toContain('scrapling_fetch');
      expect(names).toContain('draft_text');
      expect(names).toContain('analyze');
      expect(names).toContain('get_workspace_context');
      expect(names).toContain('send_notification');

      // Discover mode tools
      expect(names).toContain('list_opportunities');
      expect(names).toContain('create_opportunity');
      expect(names).toContain('score_opportunity');
      expect(names).toContain('search_yc');

      // Decide mode tools
      expect(names).toContain('get_founder_profile');

      // Build mode tools
      expect(names).toContain('create_task');
      expect(names).toContain('update_task_status');
      expect(names).toContain('list_tasks');
      expect(names).toContain('create_plan');
      expect(names).toContain('create_artifact');

      // Apply mode tools
      expect(names).toContain('create_application_draft');

      expect(tools.length).toBe(27);
    });
  });

  // ─── Mode-aware filtering ───

  describe('listToolsForMode()', () => {
    it('discover mode includes universal + discover tools', () => {
      const registry = createRegistry();
      const tools = registry.listToolsForMode('discover');
      const names = tools.map((t) => t.name);

      // Universal (no modes restriction)
      expect(names).toContain('search_knowledge');
      expect(names).toContain('create_note');
      expect(names).toContain('scrapling_fetch');
      expect(names).toContain('draft_text');
      expect(names).toContain('analyze');
      expect(names).toContain('get_workspace_context');
      expect(names).toContain('send_notification');

      // Discover-specific
      expect(names).toContain('list_opportunities');
      expect(names).toContain('create_opportunity');
      expect(names).toContain('score_opportunity');
      expect(names).toContain('search_yc');

      // Should NOT include build-only tools
      expect(names).not.toContain('create_task');
      expect(names).not.toContain('update_task_status');
      expect(names).not.toContain('create_plan');
    });

    it('build mode includes universal + build tools', () => {
      const registry = createRegistry();
      const tools = registry.listToolsForMode('build');
      const names = tools.map((t) => t.name);

      expect(names).toContain('create_task');
      expect(names).toContain('update_task_status');
      expect(names).toContain('list_tasks');
      expect(names).toContain('create_plan');
      expect(names).toContain('create_artifact');
      expect(names).toContain('scrapling_fetch');

      // Should NOT include discover-only tools
      expect(names).not.toContain('list_opportunities');
      expect(names).not.toContain('create_opportunity');
      expect(names).not.toContain('score_opportunity');
    });

    it('apply mode includes universal + apply + shared tools', () => {
      const registry = createRegistry();
      const tools = registry.listToolsForMode('apply');
      const names = tools.map((t) => t.name);

      expect(names).toContain('create_application_draft');
      expect(names).toContain('search_yc');
      expect(names).toContain('scrapling_fetch');
      expect(names).toContain('draft_text');

      // Should NOT include build-only tools
      expect(names).not.toContain('create_task');
    });

    it('decide mode includes universal + decide tools', () => {
      const registry = createRegistry();
      const tools = registry.listToolsForMode('decide');
      const names = tools.map((t) => t.name);

      expect(names).toContain('get_founder_profile');
      expect(names).toContain('search_knowledge');

      // Should NOT include build or discover tools
      expect(names).not.toContain('create_task');
      expect(names).not.toContain('list_opportunities');
    });

    it('launch mode includes universal + launch tools', () => {
      const registry = createRegistry();
      const tools = registry.listToolsForMode('launch');
      const names = tools.map((t) => t.name);

      expect(names).toContain('create_artifact');
      expect(names).toContain('list_tasks');
      expect(names).toContain('scrapling_fetch');
      expect(names).toContain('send_notification');

      // Should NOT include discover-only or apply-only tools
      expect(names).not.toContain('list_opportunities');
      expect(names).not.toContain('create_application_draft');
    });
  });

  // ─── Execution dispatch ───

  describe('execute()', () => {
    it('calls the correct tool with the provided input', async () => {
      const registry = createRegistry();
      const executeFn = vi.fn(async (input: unknown) => ({ received: input }));

      registry.register({
        name: 'echo',
        description: 'Echoes input',
        execute: executeFn,
      });

      const result = await registry.execute('echo', { msg: 'hello' });

      expect(executeFn).toHaveBeenCalledOnce();
      expect(executeFn).toHaveBeenCalledWith({ msg: 'hello' });
      expect(result).toEqual({ received: { msg: 'hello' } });
    });

    it('returns error object for unregistered tools', async () => {
      const registry = createRegistry();
      const result = await registry.execute('nonexistent_tool', {});

      expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' });
    });

    it('catches errors from tool.execute and returns error message', async () => {
      const registry = createRegistry();

      registry.register({
        name: 'failing_tool',
        description: 'Always fails',
        execute: async () => {
          throw new Error('Something went wrong');
        },
      });

      const result = await registry.execute('failing_tool', {});
      expect(result).toEqual({ error: 'Something went wrong' });
    });

    it('returns generic message for non-Error throws', async () => {
      const registry = createRegistry();

      registry.register({
        name: 'throws_string',
        description: 'Throws a string',
        execute: async () => {
          throw 'raw string error'; // eslint-disable-line no-throw-literal
        },
      });

      const result = await registry.execute('throws_string', {});
      expect(result).toEqual({ error: 'Tool execution failed' });
    });
  });

  // ─── Built-in tool behaviors ───

  describe('built-in: draft_text', () => {
    it('returns purpose, draft, and length', async () => {
      const registry = createRegistry();
      const result = await registry.execute('draft_text', {
        purpose: 'landing page headline',
        draft: 'Ship faster with HELM',
      });

      expect(result).toEqual({
        purpose: 'landing page headline',
        draft: 'Ship faster with HELM',
        length: 21,
      });
    });

    it('calculates length from the draft string', async () => {
      const registry = createRegistry();
      const result = await registry.execute('draft_text', {
        purpose: 'test',
        draft: 'abc',
      });

      expect(result).toEqual({
        purpose: 'test',
        draft: 'abc',
        length: 3,
      });
    });
  });

  describe('built-in: analyze', () => {
    it('returns the input as passthrough', async () => {
      const registry = createRegistry();
      const input = {
        topic: 'Market sizing',
        findings: 'TAM is $5B',
        confidence: 'high',
      };

      const result = await registry.execute('analyze', input);
      expect(result).toEqual(input);
    });

    it('passes through arbitrary input shapes', async () => {
      const registry = createRegistry();
      const input = { arbitrary: true, nested: { value: 42 } };

      const result = await registry.execute('analyze', input);
      expect(result).toEqual(input);
    });
  });

  describe('built-in: search_knowledge', () => {
    it('returns error when memory service is not available', async () => {
      const registry = createRegistry(); // no memory
      const result = await registry.execute('search_knowledge', { query: 'test' });

      expect(result).toEqual({ error: 'Memory service not available' });
    });

    it('calls memory.search with query and default limit', async () => {
      const mockMemory = {
        search: vi.fn(async () => [{ id: '1', title: 'Result' }]),
      };
      const registry = createRegistry({ memory: mockMemory });

      const result = await registry.execute('search_knowledge', { query: 'funding' });

      expect(mockMemory.search).toHaveBeenCalledWith('funding', { limit: 5 });
      expect(result).toEqual([{ id: '1', title: 'Result' }]);
    });

    it('respects custom limit', async () => {
      const mockMemory = {
        search: vi.fn(async () => []),
      };
      const registry = createRegistry({ memory: mockMemory });

      await registry.execute('search_knowledge', { query: 'test', limit: 10 });

      expect(mockMemory.search).toHaveBeenCalledWith('test', { limit: 10 });
    });
  });

  describe('built-in: create_note', () => {
    it('returns error when memory service is not available', async () => {
      const registry = createRegistry(); // no memory
      const result = await registry.execute('create_note', {
        title: 'Test',
        content: 'Body',
      });

      expect(result).toEqual({ error: 'Memory service not available' });
    });

    it('calls memory.upsertPage and returns id + title', async () => {
      const mockMemory = {
        search: vi.fn(),
        upsertPage: vi.fn(async () => 'page-123'),
      };
      const registry = createRegistry({ memory: mockMemory });

      const result = await registry.execute('create_note', {
        title: 'Insight',
        content: 'Some important finding',
        tags: ['research'],
      });

      expect(mockMemory.upsertPage).toHaveBeenCalledWith({
        type: 'concept',
        title: 'Insight',
        compiledTruth: 'Some important finding',
        tags: ['research'],
        content: 'Some important finding',
      });
      expect(result).toEqual({ id: 'page-123', title: 'Insight' });
    });

    it('truncates compiledTruth to 500 characters', async () => {
      const mockMemory = {
        search: vi.fn(),
        upsertPage: vi.fn(async () => 'page-456'),
      };
      const registry = createRegistry({ memory: mockMemory });

      const longContent = 'x'.repeat(1000);
      await registry.execute('create_note', {
        title: 'Long',
        content: longContent,
      });

      const call = (mockMemory.upsertPage.mock.calls as unknown[][])[0]![0] as { compiledTruth: string; content: string };
      expect(call.compiledTruth).toHaveLength(500);
      expect(call.content).toHaveLength(1000);
    });
  });
});
