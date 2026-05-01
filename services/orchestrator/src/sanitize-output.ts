import { sanitizeScrapingOutput } from '@helm-pilot/shared/sanitizers';

// ─── Tool-output sanitizer (v1.2.1 remediation) ───
//
// Every connector + external-fetch tool's result passes through here
// before reaching the agent context. Strips zero-width, bidirectional-
// override, and NFKC-unsafe content from free-text fields while
// preserving short identifiers (ids, emails, URLs).
//
// Trusted tools (DB-backed Pilot primitives whose content Pilot itself
// generates) are passed through untouched.

const SANITIZE_THRESHOLD = 32;

/** Tools whose output is Pilot-generated or DB-backed — no sanitization. */
export const TRUSTED_TOOLS: ReadonlySet<string> = new Set([
  'list_opportunities',
  'get_workspace_context',
  'list_tasks',
  'create_task',
  'create_artifact',
  'create_plan',
  'draft_text',
  'analyze',
  'send_notification',
  'search_yc',
  'get_founder_profile',
  'create_application_draft',
  'update_task_status',
  'create_opportunity',
  'score_opportunity',
  'create_note',
  'finish',
  'subagent.spawn',
  'subagent.parallel',
]);

export interface SanitizeOutputResult {
  sanitized: unknown;
  warnings: string[];
  /** True when any field was modified by the sanitizer. */
  tainted: boolean;
}

export function sanitizeToolOutput(result: unknown, toolName: string): SanitizeOutputResult {
  if (TRUSTED_TOOLS.has(toolName)) {
    return { sanitized: result, warnings: [], tainted: false };
  }
  const state = { warnings: [] as string[], tainted: false };
  const sanitized = walk(result, state, toolName);
  return { sanitized, warnings: state.warnings, tainted: state.tainted };
}

function walk(
  value: unknown,
  state: { warnings: string[]; tainted: boolean },
  toolName: string,
  path: string = '',
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length < SANITIZE_THRESHOLD) return value;
    const result = sanitizeScrapingOutput(value);
    if (result.tainted) {
      state.tainted = true;
      state.warnings.push(`[${toolName}${path ? ' @ ' + path : ''}] ${result.warnings.join('; ')}`);
    }
    return result.cleaned;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => walk(item, state, toolName, `${path}[${i}]`));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(v, state, toolName, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}
