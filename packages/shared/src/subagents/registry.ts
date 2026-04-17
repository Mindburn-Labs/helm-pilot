import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SubagentDefinitionSchema,
  type SubagentDefinition,
  type SubagentRiskClass,
  type SubagentExecutionMode,
} from './types.js';

// ─── Subagent Registry (Phase 12) ───
//
// Loads `packs/subagents/*.md` at startup. Each file is YAML frontmatter +
// Markdown body where the body becomes the system prompt. Lookups:
//
//   registry.findByName('opportunity_scout')      // exact
//   registry.findByDescription('discover markets')  // keyword-scored
//   registry.list()                                 // all
//
// Design decision #4 (plan): inline parser, no new dep. We handle the
// exact subset needed — scalars, numbers, booleans, quoted strings, one
// level of nesting (`tool_scope.allowed_tools:`), `- ` lists. Anything
// beyond that throws loudly.

export class SubagentRegistry {
  private readonly byName = new Map<string, SubagentDefinition>();

  constructor(definitions: SubagentDefinition[]) {
    for (const def of definitions) {
      if (this.byName.has(def.name)) {
        throw new Error(
          `SubagentRegistry: duplicate subagent name "${def.name}" ` +
            `(source: ${def.sourcePath})`,
        );
      }
      this.byName.set(def.name, def);
    }
  }

  /**
   * Load all `*.md` files under `packsDir` (default: `<cwd>/packs/subagents`).
   * Returns an empty registry if the directory doesn't exist — lets pilot
   * boot without subagents configured.
   */
  static loadFromDisk(packsDir?: string): SubagentRegistry {
    const dir = resolve(packsDir ?? join(process.cwd(), 'packs', 'subagents'));
    if (!existsSync(dir)) {
      return new SubagentRegistry([]);
    }
    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      return new SubagentRegistry([]);
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    const defs = files.map((f) => loadDefinitionFile(join(dir, f)));
    return new SubagentRegistry(defs);
  }

  findByName(name: string): SubagentDefinition | undefined {
    return this.byName.get(name);
  }

  /**
   * Keyword-based retrieval: returns the highest-scoring subagent by
   * token overlap with its `description`. Used when the parent LLM
   * supplies a description instead of an exact name. Returns undefined
   * if no subagent scores above a minimum threshold.
   */
  findByDescription(query: string): SubagentDefinition | undefined {
    const tokens = tokenize(query);
    if (tokens.length === 0) return undefined;

    let best: { def: SubagentDefinition; score: number } | undefined;
    for (const def of this.byName.values()) {
      const descTokens = new Set(tokenize(def.description));
      const score = tokens.reduce((acc, t) => acc + (descTokens.has(t) ? 1 : 0), 0);
      if (score > 0 && (best === undefined || score > best.score)) {
        best = { def, score };
      }
    }
    return best?.def;
  }

  list(): SubagentDefinition[] {
    return Array.from(this.byName.values());
  }

  size(): number {
    return this.byName.size;
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function loadDefinitionFile(filePath: string): SubagentDefinition {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw, filePath);
  const parsed = parseYamlSubset(frontmatter, filePath);

  const candidate = {
    name: str(parsed.name, 'name', filePath),
    description: str(parsed.description, 'description', filePath),
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    operatorRole: str(parsed.operator_role, 'operator_role', filePath),
    maxRiskClass: parsed.max_risk_class as SubagentRiskClass | undefined,
    budgetWeight:
      typeof parsed.budget_weight === 'number' ? parsed.budget_weight : undefined,
    execution: parsed.execution as SubagentExecutionMode | undefined,
    toolScope: {
      allowedTools: extractAllowedTools(parsed.tool_scope, filePath),
    },
    mcpServers: Array.isArray(parsed.mcp_servers)
      ? (parsed.mcp_servers as string[])
      : undefined,
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
    iterationBudget:
      typeof parsed.iteration_budget === 'number' ? parsed.iteration_budget : undefined,
    systemPrompt: body.trim(),
    sourcePath: filePath,
  };

  const result = SubagentDefinitionSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `SubagentRegistry: failed to parse ${filePath}:\n` +
        result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return result.data;
}

function splitFrontmatter(
  raw: string,
  filePath: string,
): { frontmatter: string; body: string } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(
      `SubagentRegistry: ${filePath} is missing YAML frontmatter (must open with --- and close with ---)`,
    );
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

/**
 * Parse the tiny subset of YAML our frontmatter uses:
 *   key: value                  (scalar: string, number, bool)
 *   key: "quoted"
 *   key:                        (nested object follows, 2-space indent)
 *     subkey: value
 *     list_key:
 *       - item
 *       - item
 * Anything else (flow syntax, anchors, multi-doc) throws.
 */
function parseYamlSubset(src: string, filePath: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const topMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!topMatch) {
      throw new Error(
        `SubagentRegistry: ${filePath}: cannot parse frontmatter line: "${line}"`,
      );
    }
    const key = topMatch[1] ?? '';
    const rest = (topMatch[2] ?? '').trim();
    if (rest.length > 0) {
      out[key] = coerceScalar(rest);
      i++;
      continue;
    }
    // Nested block — collect 2-space-indented child lines
    const childLines: string[] = [];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (next.trim() === '' || next.trim().startsWith('#')) {
        i++;
        continue;
      }
      if (!/^\s{2}/.test(next)) break;
      childLines.push(next);
      i++;
    }
    out[key] = parseNestedBlock(childLines, filePath);
  }
  return out;
}

function parseNestedBlock(lines: string[], filePath: string): unknown {
  // Flat list: every line is "  - item"
  if (lines.length > 0 && lines.every((l) => /^\s{2,}-\s/.test(l))) {
    return lines.map((l) => coerceScalar(l.replace(/^\s*-\s*/, '').trim()));
  }
  // Object with possible list children (one level deep).
  const obj: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      throw new Error(
        `SubagentRegistry: ${filePath}: cannot parse nested line: "${line}"`,
      );
    }
    const key = m[1] ?? '';
    const rest = (m[2] ?? '').trim();
    if (rest.length > 0) {
      obj[key] = coerceScalar(rest);
      i++;
      continue;
    }
    // Child list under this key
    const listLines: string[] = [];
    i++;
    while (i < lines.length && /^\s{4,}-\s/.test(lines[i] ?? '')) {
      listLines.push(lines[i] ?? '');
      i++;
    }
    obj[key] = listLines.map((l) => coerceScalar(l.replace(/^\s*-\s*/, '').trim()));
  }
  return obj;
}

function coerceScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function str(v: unknown, field: string, filePath: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `SubagentRegistry: ${filePath}: field "${field}" must be a non-empty string`,
    );
  }
  return v;
}

function extractAllowedTools(scope: unknown, filePath: string): string[] {
  if (scope === undefined || scope === null) return [];
  if (typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error(
      `SubagentRegistry: ${filePath}: "tool_scope" must be an object with allowed_tools list`,
    );
  }
  const allowed = (scope as Record<string, unknown>)['allowed_tools'];
  if (allowed === undefined) return [];
  if (!Array.isArray(allowed) || !allowed.every((x) => typeof x === 'string')) {
    throw new Error(
      `SubagentRegistry: ${filePath}: "tool_scope.allowed_tools" must be a list of strings`,
    );
  }
  return allowed as string[];
}
