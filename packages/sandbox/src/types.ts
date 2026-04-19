// ─── Sandbox abstraction (Phase 14 Track C) ───
//
// Pilot's Build mode generates code — scaffolding, landing pages,
// spec artifacts. Before that code leaves the trust boundary (e.g.
// commits to GitHub via the connector), it's validated in a sandbox:
// `npm install && tsc && test` inside a throwaway container.
//
// Two providers today:
//   - E2B   — `@e2b/code-interpreter`, 15-min timeout, fast cold-start,
//             good for Node/Python + file I/O.
//   - Modal — `modal` SDK, longer timeouts, good for heavier compute.
//
// Both are optional peer deps (dynamic-import gated). When neither is
// configured the `execute_code` tool returns a SandboxError — HELM
// governance treats that as a hard deny.

export type SandboxProviderName = 'e2b' | 'modal' | 'noop';

export interface SandboxHandle {
  /** Opaque provider-specific session id. */
  id: string;
  provider: SandboxProviderName;
  image: string;
  createdAt: string;
  /** ISO-8601 UTC — when the provider will reap this sandbox. */
  expiresAt: string;
  /** Workspace the sandbox belongs to (tenancy anchor). */
  workspaceId: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** When the provider reports it was truncated for log-length limits. */
  truncated?: boolean;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly provider: SandboxProviderName,
    readonly code:
      | 'not_configured'
      | 'provision_failed'
      | 'exec_failed'
      | 'timeout'
      | 'destroyed'
      | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

export interface ProvisionParams {
  workspaceId: string;
  image?: string;
  /** Hard timeout for the entire sandbox lifetime. Default 15 min. */
  timeoutMs?: number;
  /** Pre-installed packages (npm/pip) for faster cold-start. */
  preinstall?: string[];
  /** Environment variables (filtered through HELM EffectPermit upstream). */
  env?: Record<string, string>;
}

export interface ExecParams {
  cmd: string;
  language?: 'python' | 'node' | 'bash';
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
}

export type SnapshotId = string;

export interface SandboxProvider {
  readonly name: SandboxProviderName;
  provision(params: ProvisionParams): Promise<SandboxHandle>;
  exec(handle: SandboxHandle, params: ExecParams): Promise<ExecResult>;
  writeFile(handle: SandboxHandle, path: string, bytes: Uint8Array): Promise<void>;
  readFile(handle: SandboxHandle, path: string): Promise<Uint8Array>;
  destroy(handle: SandboxHandle): Promise<void>;
  /** Phase 14 Track C — optional snapshotting mirrors OpenAI SDK shape. */
  snapshot?(handle: SandboxHandle): Promise<SnapshotId>;
  restore?(id: SnapshotId, workspaceId: string): Promise<SandboxHandle>;
}
