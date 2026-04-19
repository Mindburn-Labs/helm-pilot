import {
  SandboxError,
  type ExecParams,
  type ExecResult,
  type ProvisionParams,
  type SandboxHandle,
  type SandboxProvider,
} from './types.js';

// ─── E2B sandbox provider (Phase 14 Track C) ───
//
// Wraps `@e2b/code-interpreter` (optional peer dep). Activates when
// both are true:
//   - `E2B_API_KEY` env var (or per-tenant token via TenantSecretStore
//     kind `sandbox_e2b_key`) is set.
//   - `@e2b/code-interpreter` is installed in the deployment image.
//
// Absent either, the factory in `./index.ts` falls back to the noop
// provider (HELM treats that as a hard deny).
//
// Reference: https://e2b.dev/docs

interface E2bSandboxLike {
  sandboxId: string;
  runCode?(
    code: string,
  ): Promise<{ stdout?: string; stderr?: string; text?: string }>;
  commands?: {
    run(
      cmd: string,
      opts?: { cwd?: string; timeoutMs?: number },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  files?: {
    write(path: string, content: string | Uint8Array): Promise<void>;
    read(path: string): Promise<string | Uint8Array>;
  };
  kill(): Promise<void>;
}

interface E2bModuleLike {
  Sandbox?: {
    create(opts: {
      apiKey: string;
      template?: string;
      timeoutMs?: number;
    }): Promise<E2bSandboxLike>;
  };
}

let cachedModule: E2bModuleLike | null | undefined;

async function loadE2bModule(): Promise<E2bModuleLike | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule =
      ((await import('@e2b/code-interpreter' as string).catch(
        () => null,
      )) as E2bModuleLike | null) ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly name = 'e2b' as const;
  private readonly sessions = new Map<string, E2bSandboxLike>();

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new SandboxError('E2B apiKey is required', 'e2b', 'not_configured');
    }
  }

  async provision(params: ProvisionParams): Promise<SandboxHandle> {
    const mod = await loadE2bModule();
    if (!mod?.Sandbox) {
      throw new SandboxError(
        '@e2b/code-interpreter is not installed in this deployment. Install it or unset E2B_API_KEY to fall back to the noop sandbox.',
        'e2b',
        'not_configured',
      );
    }
    const timeout = params.timeoutMs ?? 15 * 60_000;
    let session: E2bSandboxLike;
    try {
      session = await mod.Sandbox.create({
        apiKey: this.apiKey,
        template: params.image ?? 'base',
        timeoutMs: timeout,
      });
    } catch (err) {
      throw new SandboxError(
        `E2B provision failed: ${err instanceof Error ? err.message : String(err)}`,
        'e2b',
        'provision_failed',
      );
    }
    this.sessions.set(session.sandboxId, session);
    const now = new Date();
    return {
      id: session.sandboxId,
      provider: 'e2b',
      image: params.image ?? 'e2b-code-interpreter:base',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeout).toISOString(),
      workspaceId: params.workspaceId,
    };
  }

  async exec(handle: SandboxHandle, params: ExecParams): Promise<ExecResult> {
    const session = this.sessions.get(handle.id);
    if (!session) {
      throw new SandboxError(
        `Unknown E2B session ${handle.id}`,
        'e2b',
        'exec_failed',
      );
    }
    const started = Date.now();
    try {
      if (params.language === 'python' || params.language === 'node') {
        if (!session.runCode) {
          throw new SandboxError('E2B SDK lacks runCode', 'e2b', 'exec_failed');
        }
        const result = await session.runCode(params.cmd);
        return {
          stdout: result.stdout ?? result.text ?? '',
          stderr: result.stderr ?? '',
          exitCode: 0,
          durationMs: Date.now() - started,
        };
      }
      if (!session.commands) {
        throw new SandboxError('E2B SDK lacks commands', 'e2b', 'exec_failed');
      }
      const r = await session.commands.run(params.cmd, {
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
      });
      return {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      throw new SandboxError(
        `E2B exec failed: ${err instanceof Error ? err.message : String(err)}`,
        'e2b',
        'exec_failed',
      );
    }
  }

  async writeFile(
    handle: SandboxHandle,
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const session = this.sessions.get(handle.id);
    if (!session?.files) {
      throw new SandboxError('E2B SDK lacks files surface', 'e2b', 'exec_failed');
    }
    await session.files.write(path, bytes);
  }

  async readFile(handle: SandboxHandle, path: string): Promise<Uint8Array> {
    const session = this.sessions.get(handle.id);
    if (!session?.files) {
      throw new SandboxError('E2B SDK lacks files surface', 'e2b', 'exec_failed');
    }
    const content = await session.files.read(path);
    if (typeof content === 'string') {
      return new TextEncoder().encode(content);
    }
    return content;
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const session = this.sessions.get(handle.id);
    if (!session) return;
    this.sessions.delete(handle.id);
    try {
      await session.kill();
    } catch {
      // teardown failures are never fatal
    }
  }
}
