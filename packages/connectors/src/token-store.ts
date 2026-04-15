import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from the ENCRYPTION_KEY env var using scrypt.
 *
 * In production (NODE_ENV=production), ENCRYPTION_KEY is required — the process
 * will throw if it is not set. In development, falls back to a deterministic
 * dev key for convenience.
 */
function deriveKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY'];
  if (!raw) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'ENCRYPTION_KEY is required in production. ' +
        'Set a strong random secret (e.g., openssl rand -base64 32) to encrypt connector tokens at rest.',
      );
    }
    // Dev-only fallback — NOT safe for production
    return scryptSync('helm-pilot-dev-key-do-not-use-in-prod', 'helm-pilot-salt', 32);
  }
  return scryptSync(raw, 'helm-pilot-salt', 32);
}

/**
 * Encrypt a plaintext string. Returns a base64 string containing IV + tag + ciphertext.
 */
export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: iv(16) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a token previously encrypted with encryptToken.
 */
export function decryptToken(encoded: string): string {
  const key = deriveKey();
  const data = Buffer.from(encoded, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
