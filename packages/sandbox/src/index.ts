export {
  type ExecParams,
  type ExecResult,
  type ProvisionParams,
  type SandboxHandle,
  type SandboxProvider,
  type SandboxProviderName,
  type SnapshotId,
  SandboxError,
} from './types.js';

export { NoopSandboxProvider } from './noop.js';
export { E2bSandboxProvider } from './e2b.js';

import { E2bSandboxProvider } from './e2b.js';
import { NoopSandboxProvider } from './noop.js';
import type { SandboxProvider, SandboxProviderName } from './types.js';

/**
 * Factory resolving the active sandbox provider. Call site owns
 * per-tenant key lookup (e.g. TenantSecretStore); caller passes the
 * apiKey explicitly to keep this module free of DB concerns.
 *
 * Precedence:
 *   - Explicit provider === 'e2b' + apiKey → E2bSandboxProvider
 *   - Explicit provider === 'modal'        → noop for now (Track C
 *     E2B ships first; Modal follows in a follow-up commit)
 *   - Else (env E2B_API_KEY set, no explicit override) → E2B
 *   - Else → NoopSandboxProvider (fail-closed default)
 */
export function createSandbox(opts?: {
  provider?: SandboxProviderName;
  apiKey?: string;
}): SandboxProvider {
  const provider = opts?.provider;
  const apiKey = opts?.apiKey ?? process.env['E2B_API_KEY'];

  if (provider === 'e2b' || (provider === undefined && apiKey)) {
    if (!apiKey) {
      return new NoopSandboxProvider();
    }
    try {
      return new E2bSandboxProvider(apiKey);
    } catch {
      return new NoopSandboxProvider();
    }
  }

  return new NoopSandboxProvider();
}
