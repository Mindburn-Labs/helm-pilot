import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import {
  CURRENT_SECRET_KEY_VERSION,
  decryptSecret,
  deriveDek,
  encryptSecret,
  SECRET_KINDS,
  SecretDecryptionError,
  type SecretKind,
} from '../index.js';

const TEST_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = TEST_MASTER_KEY;
  process.env['MASTER_KEY_V2'] = 'ffffffff'.repeat(8); // 32 bytes of 0xff
});

function uuidArb(): fc.Arbitrary<string> {
  return fc.uuid({ version: 4 });
}

function plaintextArb(): fc.Arbitrary<string> {
  // Include non-ASCII + long strings to stress UTF-8 encoding path.
  return fc.string({ minLength: 1, maxLength: 2048 });
}

function kindArb(): fc.Arbitrary<SecretKind> {
  return fc.constantFrom(...SECRET_KINDS);
}

describe('secrets — crypto primitives', () => {
  describe('round-trip', () => {
    it('decrypt(encrypt(plaintext)) === plaintext for any input', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), plaintextArb(), (workspaceId, kind, plaintext) => {
          const envelope = encryptSecret(workspaceId, kind, plaintext);
          const recovered = decryptSecret(workspaceId, kind, envelope);
          return recovered === plaintext;
        }),
        { numRuns: 200 },
      );
    });

    it('each encrypt produces a distinct ciphertext even for the same plaintext', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), plaintextArb(), (workspaceId, kind, plaintext) => {
          const a = encryptSecret(workspaceId, kind, plaintext);
          const b = encryptSecret(workspaceId, kind, plaintext);
          return a.encryptedBlob !== b.encryptedBlob;
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it('decrypting A\'s ciphertext with B\'s workspaceId fails', () => {
      fc.assert(
        fc.property(uuidArb(), uuidArb(), kindArb(), plaintextArb(), (a, b, kind, plaintext) => {
          fc.pre(a !== b);
          const envelope = encryptSecret(a, kind, plaintext);
          let threw = false;
          try {
            decryptSecret(b, kind, envelope);
          } catch (err) {
            threw = err instanceof SecretDecryptionError;
          }
          return threw;
        }),
        { numRuns: 100 },
      );
    });

    it('decrypting kind X\'s ciphertext as kind Y fails', () => {
      fc.assert(
        fc.property(uuidArb(), plaintextArb(), (workspaceId, plaintext) => {
          const envelope = encryptSecret(workspaceId, 'llm_openrouter_key', plaintext);
          let threw = false;
          try {
            decryptSecret(workspaceId, 'llm_anthropic_key', envelope);
          } catch (err) {
            threw = err instanceof SecretDecryptionError;
          }
          return threw;
        }),
        { numRuns: 50 },
      );
    });

    it('tampering with the ciphertext body fails auth-tag verification', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), plaintextArb(), (workspaceId, kind, plaintext) => {
          const envelope = encryptSecret(workspaceId, kind, plaintext);
          // Flip one bit in the middle of the base64 blob.
          const buf = Buffer.from(envelope.encryptedBlob, 'base64');
          if (buf.length < 20) return true;
          buf[15]! ^= 0x01;
          const tampered = { ...envelope, encryptedBlob: buf.toString('base64') };
          let threw = false;
          try {
            decryptSecret(workspaceId, kind, tampered);
          } catch (err) {
            threw = err instanceof SecretDecryptionError;
          }
          return threw;
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('deriveDek', () => {
    it('same inputs → same DEK (deterministic)', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), (workspaceId, kind) => {
          const a = deriveDek(workspaceId, kind);
          const b = deriveDek(workspaceId, kind);
          return a.equals(b);
        }),
        { numRuns: 50 },
      );
    });

    it('different workspaces → different DEKs (no collision on same kind)', () => {
      fc.assert(
        fc.property(uuidArb(), uuidArb(), kindArb(), (a, b, kind) => {
          fc.pre(a !== b);
          return !deriveDek(a, kind).equals(deriveDek(b, kind));
        }),
        { numRuns: 50 },
      );
    });

    it('different key versions → different DEKs for the same (workspace, kind)', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), (workspaceId, kind) => {
          const v1 = deriveDek(workspaceId, kind, 1);
          const v2 = deriveDek(workspaceId, kind, 2);
          return !v1.equals(v2);
        }),
        { numRuns: 30 },
      );
    });
  });

  describe('key rotation', () => {
    it('re-encrypting with a new version preserves plaintext', () => {
      fc.assert(
        fc.property(uuidArb(), kindArb(), plaintextArb(), (workspaceId, kind, plaintext) => {
          const v1 = encryptSecret(workspaceId, kind, plaintext, 1);
          const roundtrip = decryptSecret(workspaceId, kind, v1);
          const v2 = encryptSecret(workspaceId, kind, roundtrip, 2);
          const finalRoundtrip = decryptSecret(workspaceId, kind, v2);
          return finalRoundtrip === plaintext && v1.encryptedBlob !== v2.encryptedBlob;
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('invariants', () => {
    it('empty plaintext rejected', () => {
      expect(() =>
        encryptSecret('00000000-0000-4000-8000-000000000000', 'llm_openrouter_key', ''),
      ).toThrow(/plaintext is required/);
    });

    it('CURRENT_SECRET_KEY_VERSION is 1 for the initial ship', () => {
      expect(CURRENT_SECRET_KEY_VERSION).toBe(1);
    });
  });
});
