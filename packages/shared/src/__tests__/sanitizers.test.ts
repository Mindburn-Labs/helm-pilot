import { describe, it, expect } from 'vitest';
import {
  sanitize,
  sanitizeScrapingOutput,
} from '../sanitizers/scrapling.js';

describe('sanitizeScrapingOutput', () => {
  it('passes ASCII-only input through unchanged', () => {
    const input = 'The quick brown fox jumps over the lazy dog.';
    const r = sanitizeScrapingOutput(input);
    expect(r.cleaned).toBe(input);
    expect(r.tainted).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('strips zero-width characters (credential-smuggling defense)', () => {
    const input = 'password=\u200Bsecret123\u200C';
    const r = sanitizeScrapingOutput(input);
    expect(r.cleaned).toBe('password=secret123');
    expect(r.tainted).toBe(true);
    expect(r.warnings[0]).toMatch(/zero-width/);
  });

  it('strips bidirectional overrides (Trojan Source defense)', () => {
    // U+202E flips the rendering direction of the following text.
    const input = 'token=\u202Emalicious\u202C-abc';
    const r = sanitizeScrapingOutput(input);
    expect(r.cleaned).toBe('token=malicious-abc');
    expect(r.tainted).toBe(true);
    expect(r.warnings.some((w) => w.includes('bidirectional'))).toBe(true);
  });

  it('NFKC normalization is idempotent on already-normalized text', () => {
    const input = 'admin-123';
    const r = sanitizeScrapingOutput(input);
    expect(r.cleaned.normalize('NFKC')).toBe(r.cleaned);
    expect(r.tainted).toBe(false);
  });

  it('flags compound attacks combining multiple vectors', () => {
    const input = 'admin\u200B\u202Ehidden\u202C\uFEFF';
    const r = sanitizeScrapingOutput(input);
    expect(r.tainted).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.cleaned).toBe('adminhidden');
  });

  it('sanitize() shorthand returns only the cleaned string', () => {
    expect(sanitize('hello\u200Bworld')).toBe('helloworld');
  });

  it('NFKC collapses full-width ASCII digits to standard digits', () => {
    // U+FF11 is full-width "１"; NFKC folds it to ASCII "1".
    const input = 'amount=\uFF11\uFF12\uFF13';
    const r = sanitizeScrapingOutput(input);
    expect(r.cleaned).toBe('amount=123');
    expect(r.warnings.some((w) => w.includes('NFKC'))).toBe(true);
  });
});
