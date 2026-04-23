import {
  A2AError,
  type AgentCard,
  type Task,
  type TaskSendRequest,
} from './types.js';

// ─── A2A client (Phase 15 Track J) ───
//
// Consumer-side driver for peer A2A agents. Minimal JSON-RPC 2.0
// transport over HTTPS — no websocket, no streaming (yet). Matches
// the Pilot-as-consumer half of the A2A protocol:
//
//   1. Discovery: fetchAgentCard() → AgentCard
//   2. Authorization: bearerToken in constructor (if the card asks)
//   3. Communication: sendTask / getTask / cancelTask
//
// The Pilot-as-server half is wired in services/gateway/src/routes/a2a.ts.

const DEFAULT_TIMEOUT_MS = 30_000;
const CARD_PATH = '/.well-known/agent-card.json';

export interface A2AClientConfig {
  /** Base URL of the remote agent, without trailing slash. */
  baseUrl: string;
  /** Optional bearer token for `authentication.schemes=['bearer']` agents. */
  bearerToken?: string;
  /** Override JSON-RPC path relative to baseUrl (default `/a2a`). */
  rpcPath?: string;
  /** Hard timeout per RPC call. Default 30s. */
  timeoutMs?: number;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class A2AClient {
  private nextId = 1;

  constructor(private readonly cfg: A2AClientConfig) {
    if (!cfg.baseUrl) {
      throw new A2AError('baseUrl is required', 'not_configured');
    }
  }

  /** Discovery step — fetch the public agent card. */
  async fetchAgentCard(): Promise<AgentCard> {
    const url = joinUrl(this.cfg.baseUrl, CARD_PATH);
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET' });
    } catch (err) {
      throw new A2AError(
        `Agent card fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        'transport_error',
        err,
      );
    }
    if (!response.ok) {
      throw new A2AError(`Agent card HTTP ${response.status}`, 'transport_error');
    }
    return (await response.json()) as AgentCard;
  }

  async sendTask(req: TaskSendRequest): Promise<Task> {
    const envelope = await this.rpc<{ task: Task }>('tasks/send', req);
    return envelope.task;
  }

  async getTask(id: string): Promise<Task> {
    const envelope = await this.rpc<{ task: Task }>('tasks/get', { id });
    return envelope.task;
  }

  async cancelTask(id: string): Promise<Task> {
    const envelope = await this.rpc<{ task: Task }>('tasks/cancel', { id });
    return envelope.task;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const rpcPath = this.cfg.rpcPath ?? '/a2a';
    const url = joinUrl(this.cfg.baseUrl, rpcPath);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.cfg.bearerToken) {
      headers['Authorization'] = `Bearer ${this.cfg.bearerToken}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new A2AError(
        `A2A rpc transport error: ${err instanceof Error ? err.message : String(err)}`,
        'transport_error',
        err,
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw new A2AError(`A2A auth failed (HTTP ${response.status})`, 'auth_error');
    }
    if (!response.ok) {
      throw new A2AError(`A2A HTTP ${response.status}`, 'transport_error');
    }
    const envelope = (await response.json()) as JsonRpcResponse<T>;
    if (envelope.error) {
      throw new A2AError(
        `A2A ${method} error: ${envelope.error.message}`,
        'protocol_error',
      );
    }
    if (envelope.result === undefined) {
      throw new A2AError(`A2A ${method} returned no result`, 'protocol_error');
    }
    return envelope.result;
  }
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}
