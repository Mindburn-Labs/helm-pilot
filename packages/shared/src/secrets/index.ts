import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Per-tenant secret envelope.
 *
 * Design goals:
 *   1. Cross-tenant leak is cryptographically impossible — the DEK is keyed
 *      by workspaceId via HKDF-SHA256, so substituting another workspace's
 *      id during decryption yields a different DEK and the AES-GCM auth tag
 *      verification fails.
 *   2. No separate keystore required — DEKs are derived deterministically
 *      from the master ENCRYPTION_KEY. Plaintexts live in memory only for
 *      the duration of a request.
 *   3. Rotation is straightforward: bump `keyVersion`, add MASTER_KEY_V{n},
 *      re-encrypt existing rows with the new derivation. Old rows keep
 *      their keyVersion until migrated.
 *
 * Implementation: HKDF-SHA256 over (master_key, salt=workspace_id, info=kind)
 * → 32-byte DEK. Encryption is AES-256-GCM with a 96-bit IV and 128-bit
 * auth tag. The on-disk blob is `iv || ciphertext || auth_tag` base64-encoded.
 */

/**
 * Canonical secret kinds. The shared type alias `SecretKind` allows
 * `custom_<string>` so connectors can register ad-hoc kinds without a
 * schema migration — but new first-class kinds should be added here so the
 * type system catches typos at the call site.
 */
export const SECRET_KINDS = [
  'llm_openrouter_key',
  'llm_anthropic_key',
  'llm_openai_key',
  'llm_cohere_key',
  'llm_voyage_key',
  'telegram_bot_token',
  'telegram_webhook_secret',
  'evidence_signing_key',
  'helm_admin_api_key',
  'connector_github',
  'connector_gmail',
  'connector_gdrive',
  'connector_linear',
  'connector_yc',
  'resend_api_key',
  'smtp_password',
] as const;

export type CanonicalSecretKind = (typeof SECRET_KINDS)[number];
export type SecretKind = CanonicalSecretKind | `custom_${string}`;

/** Currently-active master key version. Increment on rotation. */
export const CURRENT_SECRET_KEY_VERSION = 1;

const DEK_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const HKDF_INFO_PREFIX = 'pilot-tenant-secret-v1:';

export interface SecretEnvelope {
  /** Base64-encoded iv(12) || ciphertext || auth_tag(16). */
  encryptedBlob: string;
  /** Master-key version used to derive the DEK. Stored alongside the blob. */
  keyVersion: number;
}

/**
 * Read the master key for a given version from the environment.
 *
 *   v1 → ENCRYPTION_KEY           (existing env var — zero-migration)
 *   vN → MASTER_KEY_V{N}          (added by `scripts/rotate-master-key.ts`)
 *
 * Keys shorter than 32 bytes are right-padded deterministically. This
 * matches the legacy pattern in packages/connectors/src/token-store.ts so
 * migrating its encrypted rows into tenantSecrets preserves the material.
 */
function getMasterKey(keyVersion: number): Buffer {
  const envName = keyVersion === 1 ? 'ENCRYPTION_KEY' : `MASTER_KEY_V${keyVersion}`;
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `Master key version ${keyVersion} not configured — expected env var ${envName}.`,
    );
  }
  if (raw.length < 32) {
    throw new Error(
      `${envName} must be at least 32 chars (got ${raw.length}). ` +
        'Generate a fresh one with `openssl rand -hex 32`.',
    );
  }
  // Normalize to 32 bytes: the existing ENCRYPTION_KEY convention is a 64-char
  // hex string, but we accept any UTF-8 ≥32 chars and pad to 32 bytes.
  return Buffer.from(raw.padEnd(64, '0').slice(0, 64), 'utf-8').subarray(0, 32);
}

/**
 * Derive a per-(workspace, kind, version) DEK via HKDF-SHA256.
 *
 * Exported so callers can use the DEK for their own envelopes (e.g. signing
 * webhook secrets) without round-tripping through encryptSecret. When
 * crypto-agility matters, callers should re-derive rather than cache.
 */
export function deriveDek(
  workspaceId: string,
  kind: SecretKind,
  keyVersion: number = CURRENT_SECRET_KEY_VERSION,
): Buffer {
  const master = getMasterKey(keyVersion);
  const salt = Buffer.from(workspaceId, 'utf-8');
  const info = Buffer.from(`${HKDF_INFO_PREFIX}${kind}:v${keyVersion}`, 'utf-8');
  const derived = hkdfSync('sha256', master, salt, info, DEK_LENGTH);
  return Buffer.from(derived);
}

export function encryptSecret(
  workspaceId: string,
  kind: SecretKind,
  plaintext: string,
  keyVersion: number = CURRENT_SECRET_KEY_VERSION,
): SecretEnvelope {
  if (!plaintext) throw new Error('encryptSecret: plaintext is required');
  const dek = deriveDek(workspaceId, kind, keyVersion);
  try {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, ciphertext, tag]).toString('base64');
    return { encryptedBlob: blob, keyVersion };
  } finally {
    dek.fill(0);
  }
}

export function decryptSecret(
  workspaceId: string,
  kind: SecretKind,
  envelope: SecretEnvelope,
): string {
  const buf = Buffer.from(envelope.encryptedBlob, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('decryptSecret: invalid envelope — blob too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const dek = deriveDek(workspaceId, kind, envelope.keyVersion);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString('utf-8');
  } catch (err) {
    // Redact the cause to avoid leaking decryption detail to HTTP responses.
    throw new SecretDecryptionError(
      'decryptSecret: auth tag verification failed — wrong workspace, kind, or key version',
    );
  } finally {
    dek.fill(0);
  }
}

export class SecretDecryptionError extends Error {
  public readonly code = 'SECRET_DECRYPTION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}
