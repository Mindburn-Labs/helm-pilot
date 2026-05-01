// ─── Scrapling output sanitizer (Phase 14 Track G) ───
//
// Every scrapling_fetch tool output passes through this filter before
// reaching the agent context. Counters three classes of attack we've
// seen in the wild on public pages:
//
//   1. Zero-width characters — hidden text / credential smuggling
//      (U+200B, U+200C, U+200D, U+FEFF, U+2060, U+180E)
//   2. Bidirectional overrides — "Trojan Source" (Boucher & Anderson
//      2021) where RTL codepoints flip text order to hide payloads
//      (U+202A-U+202E, U+2066-U+2069)
//   3. Homoglyphs — Cyrillic "а" vs Latin "a" via NFKC normalization

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\u180E\uFEFF]/g;
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/g;
export const MAX_SANITIZED_OUTPUT_CHARS = 1_000_000;

export interface SanitizeResult {
  cleaned: string;
  warnings: string[];
  /** True when any dangerous transform fired — callers may surface to HELM. */
  tainted: boolean;
}

function stripMatches(input: string, pattern: RegExp): { cleaned: string; count: number } {
  const cleaned = input.replace(pattern, '');
  return { cleaned, count: input.length - cleaned.length };
}

/**
 * Sanitize a scrapling fetch output (or any untrusted external text).
 * Pure function — safe to call inside tool handlers, validators, or
 * server-side processors. Returns cleaned content + a warnings list
 * describing every transformation applied.
 */
export function sanitizeScrapingOutput(input: string): SanitizeResult {
  const warnings: string[] = [];
  let s = input;

  if (s.length > MAX_SANITIZED_OUTPUT_CHARS) {
    warnings.push(
      `Input length ${s.length} exceeds sanitizer output limit ${MAX_SANITIZED_OUTPUT_CHARS}`,
    );
  }

  const zeroWidth = stripMatches(s, ZERO_WIDTH_RE);
  const zeroWidthCount = zeroWidth.count;
  if (zeroWidthCount > 0) {
    warnings.push(`Stripped ${zeroWidthCount} zero-width character(s)`);
    s = zeroWidth.cleaned;
  }

  const bidi = stripMatches(s, BIDI_OVERRIDE_RE);
  const bidiCount = bidi.count;
  if (bidiCount > 0) {
    warnings.push(`Stripped ${bidiCount} bidirectional override character(s)`);
    s = bidi.cleaned;
  }

  if (s.length > MAX_SANITIZED_OUTPUT_CHARS) {
    s = s.slice(0, MAX_SANITIZED_OUTPUT_CHARS);
    warnings.push(`Truncated cleaned output to ${MAX_SANITIZED_OUTPUT_CHARS} character(s)`);
  }

  const normalized = s.normalize('NFKC');
  if (normalized !== s) {
    warnings.push('Applied Unicode NFKC normalization');
    s = normalized;
  }

  return { cleaned: s, warnings, tainted: warnings.length > 0 };
}

/**
 * Shorthand for callers that only want the cleaned text.
 */
export function sanitize(input: string): string {
  return sanitizeScrapingOutput(input).cleaned;
}
