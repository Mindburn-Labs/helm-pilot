import { createHash } from 'node:crypto';

/**
 * Semantic deduplication engine (Phase 3b).
 *
 * Two-tier strategy:
 *   1. Content-hash fast path — SHA-256 of normalised (title + description).
 *      If the hash matches an existing opportunity, it's an exact duplicate.
 *      O(1) lookup, zero false positives.
 *   2. Embedding cosine similarity — if the hash is novel, compare the
 *      embedding vector against existing opportunities in the workspace.
 *      Cosine > threshold (default 0.92) → near-duplicate. This catches
 *      the same opportunity described differently on HN vs ProductHunt.
 *
 * The engine is stateless — callers pass in the lookup functions so this
 * module has no DB or provider dependency. Tested deterministically.
 */

/** Threshold above which two opportunities are considered near-duplicates. */
export const DEFAULT_COSINE_THRESHOLD = 0.92;

export interface DedupCandidate {
  title: string;
  description: string;
  source: string;
  sourceUrl?: string | null;
  /** Pre-computed embedding if available. */
  embedding?: readonly number[] | null;
}

export interface ExistingOpportunity {
  id: string;
  contentHash: string;
  embedding?: readonly number[] | null;
  title: string;
  source: string;
}

export type DedupVerdict =
  | { kind: 'novel' }
  | { kind: 'exact_duplicate'; existingId: string }
  | { kind: 'near_duplicate'; existingId: string; similarity: number };

/**
 * Normalise and hash content for fast exact-match dedup.
 *
 * Normalisation: lowercase → collapse whitespace → strip punctuation → trim.
 * This catches trivial reformatting (extra spaces, case changes, trailing
 * periods) that would defeat a raw hash.
 */
export function contentHash(title: string, description: string): string {
  const normalised = normalise(`${title}\n${description}`);
  return createHash('sha256').update(normalised, 'utf-8').digest('hex');
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Cosine similarity between two vectors. Returns NaN when either vector has
 * zero magnitude (degenerate embedding).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? NaN : dot / denom;
}

/**
 * Run the two-tier dedup check.
 *
 * @param candidate     The incoming opportunity to check.
 * @param existing      All opportunities already in the workspace (or a
 *                      pre-filtered subset — callers can limit by time window
 *                      or source tier to bound the search space).
 * @param threshold     Cosine similarity threshold for near-duplicate.
 */
export function dedup(
  candidate: DedupCandidate,
  existing: readonly ExistingOpportunity[],
  threshold: number = DEFAULT_COSINE_THRESHOLD,
): DedupVerdict {
  const hash = contentHash(candidate.title, candidate.description);

  // ── Tier 1: exact content hash ──
  for (const opp of existing) {
    if (opp.contentHash === hash) {
      return { kind: 'exact_duplicate', existingId: opp.id };
    }
  }

  // ── Tier 2: embedding cosine similarity ──
  if (candidate.embedding && candidate.embedding.length > 0) {
    let bestSim = -1;
    let bestId = '';
    for (const opp of existing) {
      if (!opp.embedding || opp.embedding.length !== candidate.embedding.length) continue;
      const sim = cosineSimilarity(candidate.embedding, opp.embedding);
      if (Number.isFinite(sim) && sim > bestSim) {
        bestSim = sim;
        bestId = opp.id;
      }
    }
    if (bestSim >= threshold) {
      return { kind: 'near_duplicate', existingId: bestId, similarity: bestSim };
    }
  }

  return { kind: 'novel' };
}

/**
 * Batch dedup — process multiple candidates against the same existing set.
 * Returns a Map from candidate index to its verdict.
 */
export function dedupBatch(
  candidates: readonly DedupCandidate[],
  existing: readonly ExistingOpportunity[],
  threshold: number = DEFAULT_COSINE_THRESHOLD,
): Map<number, DedupVerdict> {
  // Build a hash index for O(1) exact lookups across the batch.
  const hashIndex = new Map<string, string>();
  for (const opp of existing) {
    hashIndex.set(opp.contentHash, opp.id);
  }

  const results = new Map<number, DedupVerdict>();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const hash = contentHash(c.title, c.description);

    // Tier 1: hash index
    const exactId = hashIndex.get(hash);
    if (exactId) {
      results.set(i, { kind: 'exact_duplicate', existingId: exactId });
      continue;
    }

    // Tier 2: embedding similarity
    if (c.embedding && c.embedding.length > 0) {
      let bestSim = -1;
      let bestId = '';
      for (const opp of existing) {
        if (!opp.embedding || opp.embedding.length !== c.embedding.length) continue;
        const sim = cosineSimilarity(c.embedding, opp.embedding);
        if (Number.isFinite(sim) && sim > bestSim) {
          bestSim = sim;
          bestId = opp.id;
        }
      }
      if (bestSim >= threshold) {
        results.set(i, { kind: 'near_duplicate', existingId: bestId, similarity: bestSim });
        continue;
      }
    }

    results.set(i, { kind: 'novel' });
  }

  return results;
}
