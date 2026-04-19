import {
  SandboxError,
  type ExecParams,
  type ExecResult,
  type ProvisionParams,
  type SandboxHandle,
  type SandboxProvider,
  type SnapshotId,
} from './types.js';

/**
 * Default sandbox provider when none is configured. Every method
 * throws a `SandboxError` with code `'not_configured'`. HELM
 * governance upstream treats sandbox failures as hard denies —
 * exactly the fail-closed posture we want.
 *
 * Operators flip on a real provider by:
 *   - installing `@e2b/code-interpreter` + setting E2B_API_KEY → E2B
 *   - installing `modal` + setting MODAL_TOKEN → Modal
 */
export class NoopSandboxProvider implements SandboxProvider {
  readonly name = 'noop' as const;

  async provision(_params: ProvisionParams): Promise<SandboxHandle> {
    throw new SandboxError(
      'No sandbox provider configured. Set E2B_API_KEY or MODAL_TOKEN and install the corresponding SDK.',
      'noop',
      'not_configured',
    );
  }

  async exec(_handle: SandboxHandle, _params: ExecParams): Promise<ExecResult> {
    throw new SandboxError('noop sandbox cannot exec', 'noop', 'not_configured');
  }

  async writeFile(
    _handle: SandboxHandle,
    _path: string,
    _bytes: Uint8Array,
  ): Promise<void> {
    throw new SandboxError('noop sandbox cannot writeFile', 'noop', 'not_configured');
  }

  async readFile(_handle: SandboxHandle, _path: string): Promise<Uint8Array> {
    throw new SandboxError('noop sandbox cannot readFile', 'noop', 'not_configured');
  }

  async destroy(_handle: SandboxHandle): Promise<void> {
    // idempotent teardown — no-op on noop
  }

  async snapshot(_handle: SandboxHandle): Promise<SnapshotId> {
    throw new SandboxError('noop sandbox cannot snapshot', 'noop', 'not_configured');
  }

  async restore(_id: SnapshotId, _workspaceId: string): Promise<SandboxHandle> {
    throw new SandboxError('noop sandbox cannot restore', 'noop', 'not_configured');
  }
}
