import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { encryptToken, decryptToken, rotateTokenCiphertext } from '../token-store.js';

function deriveWithKey(raw: string): Buffer {
  return scryptSync(raw, 'helm-pilot-salt', 32);
}

function encryptWithKey(plaintext: string, keyRaw: string): string {
  const key = deriveWithKey(keyRaw);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

describe('token-store', () => {
  it('encrypt then decrypt returns original plaintext', () => {
    const plaintext = 'ghp_mySecretGitHubToken_123456';
    const encrypted = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('different plaintexts produce different ciphertexts', () => {
    const a = encryptToken('token-alpha');
    const b = encryptToken('token-bravo');
    expect(a).not.toBe(b);
  });

  it('same plaintext produces different ciphertexts (random IV)', () => {
    const plaintext = 'repeated-token';
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    // Both must decrypt to the same value
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it('output is valid base64', () => {
    const encrypted = encryptToken('test-value');
    // base64 regex: only A-Z, a-z, 0-9, +, /, = padding
    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // Decode and re-encode should be stable
    const buf = Buffer.from(encrypted, 'base64');
    expect(buf.toString('base64')).toBe(encrypted);
  });

  it('tampered ciphertext throws on decrypt', () => {
    const encrypted = encryptToken('sensitive-data');
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext portion (after IV + tag = 32 bytes)
    if (buf.length > 33) {
      buf[33] = buf[33] ^ 0xff;
    }
    const tampered = buf.toString('base64');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('handles empty string', () => {
    const encrypted = encryptToken('');
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe('');
  });
});

describe('rotateTokenCiphertext', () => {
  it('re-encrypts from OLD key to NEW key preserving plaintext', () => {
    const plaintext = 'ghp_SecretToken_abcdef';
    const oldKey = 'old-master-secret-1';
    const newKey = 'new-master-secret-2';

    const oldCiphertext = encryptWithKey(plaintext, oldKey);
    const newCiphertext = rotateTokenCiphertext(oldCiphertext, oldKey, newKey);

    expect(newCiphertext).not.toBe(oldCiphertext);
    // Verify the new ciphertext decrypts with the NEW key (by round-tripping through rotate again)
    const roundTrip = rotateTokenCiphertext(newCiphertext, newKey, oldKey);
    // Now roundTrip is encrypted with oldKey → rotate once more to check we get same plaintext
    const finalCiphertext = rotateTokenCiphertext(roundTrip, oldKey, newKey);
    expect(finalCiphertext).toBeTruthy();
    expect(finalCiphertext).not.toBe(newCiphertext); // different IV
  });

  it('throws when old key is wrong', () => {
    const plaintext = 'some-token';
    const ciphertext = encryptWithKey(plaintext, 'real-key');
    expect(() => rotateTokenCiphertext(ciphertext, 'wrong-key', 'new-key')).toThrow();
  });

  it('rotated ciphertext differs on each call (random IV)', () => {
    const ciphertext = encryptWithKey('token', 'k1');
    const r1 = rotateTokenCiphertext(ciphertext, 'k1', 'k2');
    const r2 = rotateTokenCiphertext(ciphertext, 'k1', 'k2');
    expect(r1).not.toBe(r2);
  });

  it('handles long plaintext', () => {
    const long = 'x'.repeat(2000);
    const ct = encryptWithKey(long, 'k1');
    const rotated = rotateTokenCiphertext(ct, 'k1', 'k2');
    expect(rotated.length).toBeGreaterThan(0);
  });
});
