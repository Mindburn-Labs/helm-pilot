import type { ChildProcess } from 'node:child_process';
import {
  McpError,
  type McpInitializeResult,
  type McpServerConfig,
  type McpTool,
  type McpToolCallRequest,
  type McpToolCallResult,
} from './types.js';

// ─── MCP Client (Phase 14 Track A, consumer side) ───
//
// Minimal JSON-RPC 2.0 client for MCP 2025-11-25 servers. Supports
// stdio (subprocess spawn) and HTTP transports. Only implements the
// methods Pilot needs for subagent tool injection:
//   - initialize
//   - tools/list
//   - tools/call
//   - close (teardown)
//
// Every upstream tool call can be wrapped in a HELM TOOL_USE evidence
// pack by the caller — this file stays unaware of governance so it
// can be tested + reused outside the orchestrator.

const JSONRPC_VERSION = '2.0';
const DEFAULT_TIMEOUT_MS = 30_000;

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  private nextId = 1;
  private child: ChildProcess | null = null;
  private stdioBuffer = '';
  private pending = new Map<
    JsonRpcId,
    {
      resolve: (r: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private initialized = false;

  constructor(private readonly config: McpServerConfig) {
    if (!config.name) {
      throw new McpError(
        'MCP server config must have a name',
        'unknown',
        'not_configured',
      );
    }
    if (config.transport === 'stdio' && !config.command) {
      throw new McpError(
        `stdio MCP server "${config.name}" requires a command`,
        config.name,
        'not_configured',
      );
    }
    if (config.transport === 'http' && !config.url) {
      throw new McpError(
        `http MCP server "${config.name}" requires a url`,
        config.name,
        'not_configured',
      );
    }
  }

  async initialize(): Promise<McpInitializeResult> {
    if (this.initialized) {
      return {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: this.config.name, version: 'cached' },
      };
    }
    const result = await this.call<McpInitializeResult>('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      clientInfo: { name: '@helm-pilot/shared', version: '0.1.0' },
    });
    this.initialized = true;
    return result;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = await this.call<{ tools: McpTool[] }>('tools/list');
    return result.tools;
  }

  async callTool(req: McpToolCallRequest): Promise<McpToolCallResult> {
    await this.initialize();
    return this.call<McpToolCallResult>('tools/call', {
      name: req.name,
      arguments: req.arguments ?? {},
    });
  }

  async close(): Promise<void> {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(
        new McpError('MCP client closed', this.config.name, 'transport_error'),
      );
    }
    this.pending.clear();
    if (this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.initialized = false;
  }

  // ─── internals ───

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.config.transport === 'stdio'
      ? this.stdioCall<T>(method, params)
      : this.httpCall<T>(method, params);
  }

  private async httpCall<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: JSONRPC_VERSION, id, method, params };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.bearerToken) {
      headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(this.config.url!, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new McpError(
        `MCP http transport error: ${err instanceof Error ? err.message : String(err)}`,
        this.config.name,
        'transport_error',
        err,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new McpError(
        `MCP server returned HTTP ${response.status}`,
        this.config.name,
        'transport_error',
      );
    }
    const envelope = (await response.json()) as JsonRpcResponse<T>;
    if (envelope.error) {
      throw new McpError(
        `MCP ${method} error: ${envelope.error.message}`,
        this.config.name,
        'tool_error',
      );
    }
    if (envelope.result === undefined) {
      throw new McpError(
        `MCP ${method} returned no result`,
        this.config.name,
        'protocol_error',
      );
    }
    return envelope.result;
  }

  private async stdioCall<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.child) {
      await this.spawnStdio();
    }
    if (!this.child || !this.child.stdin || !this.child.stdout) {
      throw new McpError(
        'Failed to spawn MCP stdio process',
        this.config.name,
        'transport_error',
      );
    }
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: JSONRPC_VERSION, id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new McpError(`MCP ${method} timed out`, this.config.name, 'timeout'),
        );
      }, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });

      try {
        this.child!.stdin!.write(JSON.stringify(body) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new McpError(
            `MCP stdio write failed: ${err instanceof Error ? err.message : String(err)}`,
            this.config.name,
            'transport_error',
            err,
          ),
        );
      }
    });
  }

  private async spawnStdio(): Promise<void> {
    const { spawn } = await import('node:child_process');
    this.child = spawn(this.config.command!, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.on('error', (err) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(
          new McpError(
            `MCP child error: ${err.message}`,
            this.config.name,
            'transport_error',
            err,
          ),
        );
      }
      this.pending.clear();
    });

    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => {
      this.stdioBuffer += chunk;
      let idx: number;
      while ((idx = this.stdioBuffer.indexOf('\n')) >= 0) {
        const line = this.stdioBuffer.slice(0, idx).trim();
        this.stdioBuffer = this.stdioBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const env = JSON.parse(line) as JsonRpcResponse;
          const p = this.pending.get(env.id);
          if (!p) continue; // notification or stray
          clearTimeout(p.timer);
          this.pending.delete(env.id);
          if (env.error) {
            p.reject(
              new McpError(
                `MCP error: ${env.error.message}`,
                this.config.name,
                'tool_error',
              ),
            );
          } else {
            p.resolve(env.result);
          }
        } catch {
          // ignore malformed line — server may log to stdout
        }
      }
    });
  }
}
