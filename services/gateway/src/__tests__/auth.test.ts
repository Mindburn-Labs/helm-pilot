import { describe, it, expect } from 'vitest';
import { hashApiKey, generateToken, generateApiKey } from '../middleware/auth.js';

describe('Auth utilities', () => {
  describe('generateToken', () => {
    it('generates a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates unique tokens', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
    });
  });

  describe('generateApiKey', () => {
    it('generates a key with hp_ prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^hp_[a-f0-9]{48}$/);
    });

    it('generates unique keys', () => {
      const a = generateApiKey();
      const b = generateApiKey();
      expect(a).not.toBe(b);
    });
  });

  describe('hashApiKey', () => {
    it('produces a consistent SHA-256 hash', () => {
      const key = 'hp_test123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different keys produce different hashes', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
