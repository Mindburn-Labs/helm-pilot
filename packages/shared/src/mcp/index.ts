// ─── MCP consumer public surface (Phase 14 Track A) ───
//
// Barrel re-export for `@pilot/shared/mcp`. Consumers that need
// to drive an upstream MCP 2025-11-25 server (stdio or HTTP) import
// `McpClient` + the protocol types from here.
//
// Example:
//   import { McpClient, type McpServerConfig } from '@pilot/shared/mcp';

export {
  type McpServerConfig,
  type McpTransport,
  type McpTool,
  type McpResource,
  type McpToolCallRequest,
  type McpToolCallResult,
  type McpInitializeResult,
  McpError,
} from './types.js';

export { McpClient } from './client.js';
export { McpServerRegistry, type McpServerConfigMap } from './registry.js';
