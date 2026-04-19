// ─── MCP protocol types (Phase 14 Track A) ───
//
// Minimal TS surface for the Model Context Protocol 2025-11-25 wire
// format. We model only what Pilot actually needs:
//   - Tool listing + invocation (JSON-RPC 2.0: tools/list, tools/call)
//   - Server configuration (stdio or HTTP+SSE transports)
//
// Reference: https://modelcontextprotocol.io/specification/2025-11-25

export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  /** For `stdio` transport: the command to spawn. */
  command?: string;
  /** Args to the command (stdio) or extra HTTP headers (http). */
  args?: string[];
  /** For `http` transport: the server URL (POSTs JSON-RPC here). */
  url?: string;
  /** Environment variables forwarded into the child process. */
  env?: Record<string, string>;
  /** Bearer token for HTTP transport (injected as Authorization). */
  bearerToken?: string;
  /** Hard timeout on any single JSON-RPC call. Default 30s. */
  timeoutMs?: number;
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's `arguments` parameter. */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface McpToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
  /** Ordered content parts — MCP spec allows mixed text/image/resource blocks. */
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | {
        type: 'resource';
        resource: { uri: string; text?: string; mimeType?: string };
      }
  >;
  isError?: boolean;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { listChanged?: boolean; subscribe?: boolean };
    prompts?: { listChanged?: boolean };
  };
  serverInfo: { name: string; version: string };
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly server: string,
    readonly code:
      | 'not_configured'
      | 'transport_error'
      | 'tool_error'
      | 'protocol_error'
      | 'timeout'
      | 'unknown' = 'unknown',
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'McpError';
  }
}
