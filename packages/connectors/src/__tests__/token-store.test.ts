import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../token-store.js';

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
