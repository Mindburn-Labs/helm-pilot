import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClient, McpError } from '../mcp/index.js';

// ─── McpClient tests (Phase 14 Track A) ───
//
// No real network + no real subprocess — every HTTP transport path
// is exercised via vi.stubGlobal('fetch', …). stdio spawn behaviour
// is covered at integration level when the orchestrator wires
// McpClient against a real upstream server.

describe('McpClient config validation', () => {
  it('rejects configs missing a name', () => {
    expect(
      () =>
        new McpClient({
          // @ts-expect-error — intentionally missing name
          name: undefined,
          transport: 'http',
          url: 'https://example.test/mcp',
        }),
    ).toThrow(McpError);
  });

  it('rejects stdio transport without command', () => {
    expect(() => new McpClient({ name: 'x', transport: 'stdio' })).toThrow(
      /requires a command/,
    );
  });

  it('rejects http transport without url', () => {
    expect(() => new McpClient({ name: 'x', transport: 'http' })).toThrow(
      /requires a url/,
    );
  });
});

describe('McpClient http transport', () => {
  const base = {
    name: 'test-server',
    transport: 'http' as const,
    url: 'https://example.test/mcp',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initialize → tools/list → tools/call happy path', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              serverInfo: { name: 'test', version: '0.0.1' },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'echo it back',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            result: {
              content: [{ type: 'text', text: 'hello back' }],
            },
          }),
          { status: 200 },
        ),
      );

    const client = new McpClient(base);
    const init = await client.initialize();
    expect(init.protocolVersion).toBe('2025-11-25');

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('echo');

    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'hi' },
    });
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello back' });
  });

  it('maps HTTP 5xx into transport_error McpError', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));

    const client = new McpClient(base);
    await expect(client.initialize()).rejects.toMatchObject({
      name: 'McpError',
      code: 'transport_error',
    });
  });

  it('maps JSON-RPC error envelope into tool_error McpError', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
        { status: 200 },
      ),
    );

    const client = new McpClient(base);
    await expect(client.initialize()).rejects.toMatchObject({
      name: 'McpError',
      code: 'tool_error',
    });
  });

  it('attaches Authorization header when bearerToken is set', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 't', version: '0' },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new McpClient({ ...base, bearerToken: 'secret-token' });
    await client.initialize();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-token');
  });

  it('initialize is idempotent (cached)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 't', version: '0' },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new McpClient(base);
    await client.initialize();
    await client.initialize();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
