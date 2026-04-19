import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpClient } from './client.js';
import { McpError, type McpServerConfig } from './types.js';

// ─── MCP server registry (Phase 14 Track A) ───
//
// Resolver that maps the string names declared in a subagent's
// `mcp_servers:` frontmatter to live `McpClient` instances. Config
// comes from a JSON file on disk (path controlled by env var). Clients
// are lazy: first `get(name)` instantiates + initializes; subsequent
// calls return the same instance. `close()` tears down every client.
//
// Config file shape (`packs/mcp/servers.json` by default):
//   {
//     "github":     { "transport": "stdio", "command": "npx",
//                     "args": ["-y", "@modelcontextprotocol/server-github"],
//                     "env":  { "GITHUB_TOKEN": "..." } },
//     "filesystem": { "transport": "http", "url": "http://127.0.0.1:3200/mcp",
//                     "bearerToken": "...", "timeoutMs": 15000 }
//   }

export type McpServerConfigMap = Record<string, McpServerConfig>;

export class McpServerRegistry {
  private readonly configs: McpServerConfigMap;
  private readonly clients = new Map<string, McpClient>();

  constructor(configs: McpServerConfigMap) {
    // Normalize: ensure every config's `name` field matches its key so
    // McpClient error messages stay useful.
    this.configs = {};
    for (const [name, cfg] of Object.entries(configs)) {
      this.configs[name] = { ...cfg, name };
    }
  }

  /**
   * Load the registry from a JSON file on disk. Returns an empty
   * registry when the path doesn't exist — lets pilot boot without
   * any MCP servers configured.
   *
   * @param configPath  Absolute or cwd-relative path. Defaults to
   *                    $MCP_SERVERS_CONFIG_PATH, then
   *                    `<cwd>/packs/mcp/servers.json`.
   */
  static loadFromDisk(configPath?: string): McpServerRegistry {
    const resolved = resolve(
      configPath ??
        process.env['MCP_SERVERS_CONFIG_PATH'] ??
        'packs/mcp/servers.json',
    );
    if (!existsSync(resolved)) {
      return new McpServerRegistry({});
    }
    const raw = readFileSync(resolved, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new McpError(
        `Failed to parse MCP server config at ${resolved}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        'registry',
        'not_configured',
        err,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new McpError(
        `MCP server config at ${resolved} must be a JSON object of name → config`,
        'registry',
        'not_configured',
      );
    }
    return new McpServerRegistry(parsed as McpServerConfigMap);
  }

  /** Names of every configured server. */
  listNames(): string[] {
    return Object.keys(this.configs);
  }

  /** Whether `name` is configured (does not instantiate). */
  has(name: string): boolean {
    return name in this.configs;
  }

  /**
   * Return a live, initialized client for `name`. Throws
   * `McpError{code:'not_configured'}` if the name is unknown.
   * Subsequent calls return the cached instance.
   */
  async get(name: string): Promise<McpClient> {
    const existing = this.clients.get(name);
    if (existing) return existing;
    const cfg = this.configs[name];
    if (!cfg) {
      throw new McpError(
        `MCP server "${name}" is not configured in this deployment`,
        name,
        'not_configured',
      );
    }
    const client = new McpClient(cfg);
    await client.initialize();
    this.clients.set(name, client);
    return client;
  }

  /**
   * Best-effort teardown of every active client. Errors are swallowed
   * — shutdown must be idempotent and fail-open.
   */
  async close(): Promise<void> {
    const tasks = Array.from(this.clients.values()).map(async (c) => {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    });
    await Promise.all(tasks);
    this.clients.clear();
  }
}
