import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SkillDefinitionSchema,
  type SkillDefinition,
  type SkillActivation,
  type SkillMatch,
} from './types.js';

// ─── Skill Registry (Phase 14 Track E) ───
//
// Loads `packs/skills/<name>/SKILL.md` (repo-bundled) + optional
// `~/.pilot/skills/<name>/SKILL.md` (user overrides). Each file is
// YAML frontmatter + Markdown body, same format as subagent defs.
//
// Entry points:
//   registry.findByName('yc-application-writing')      — exact
//   registry.match(taskDescription, explicitNames)     — returns ranked SkillMatch[]
//   registry.list()                                    — all

export class SkillRegistry {
  private readonly byName = new Map<string, SkillDefinition>();

  constructor(definitions: SkillDefinition[]) {
    for (const def of definitions) {
      // Later definitions override earlier ones (user overrides > repo bundle).
      this.byName.set(def.name, def);
    }
  }

  /**
   * Load from disk. Scans `packsDir` (default: `<cwd>/packs/skills`) and
   * optionally the user override dir `~/.pilot/skills`. User dir
   * takes precedence when both define the same skill name.
   */
  static loadFromDisk(opts?: {
    packsDir?: string;
    userDir?: string;
  }): SkillRegistry {
    const repoDir = resolve(
      opts?.packsDir ?? join(process.cwd(), 'packs', 'skills'),
    );
    const userDir = opts?.userDir
      ? resolve(opts.userDir)
      : process.env['HOME']
        ? join(process.env['HOME'], '.pilot', 'skills')
        : undefined;

    const defs: SkillDefinition[] = [];
    if (existsSync(repoDir) && statSync(repoDir).isDirectory()) {
      for (const name of readdirSync(repoDir)) {
        const skillPath = join(repoDir, name, 'SKILL.md');
        if (existsSync(skillPath)) {
          defs.push(loadSkillFile(skillPath));
        }
      }
    }
    if (userDir && existsSync(userDir) && statSync(userDir).isDirectory()) {
      for (const name of readdirSync(userDir)) {
        const skillPath = join(userDir, name, 'SKILL.md');
        if (existsSync(skillPath)) {
          defs.push(loadSkillFile(skillPath));
        }
      }
    }
    return new SkillRegistry(defs);
  }

  findByName(name: string): SkillDefinition | undefined {
    return this.byName.get(name);
  }

  list(): SkillDefinition[] {
    return Array.from(this.byName.values());
  }

  size(): number {
    return this.byName.size;
  }

  /**
   * Match skills to a subagent's task. Returns in precedence order:
   *   1. Every skill named in `explicitNames` (reason=explicit, score=0)
   *   2. Every `activation:"auto"` skill with token overlap against
   *      `taskDescription` > 0, ranked by overlap score (reason=auto)
   */
  match(taskDescription: string, explicitNames: string[] = []): SkillMatch[] {
    const matches: SkillMatch[] = [];
    const seen = new Set<string>();

    // Explicit matches first — always included.
    for (const name of explicitNames) {
      const skill = this.byName.get(name);
      if (skill && !seen.has(skill.name)) {
        matches.push({ skill, reason: 'explicit', score: 0 });
        seen.add(skill.name);
      }
    }

    // Auto matches — score by keyword overlap against task description.
    const taskTokens = tokenize(taskDescription);
    if (taskTokens.length === 0) return matches;

    const autoCandidates: SkillMatch[] = [];
    for (const skill of this.byName.values()) {
      if (seen.has(skill.name)) continue;
      if (skill.activation !== 'auto') continue;
      const descTokens = new Set(tokenize(skill.description));
      const score = taskTokens.reduce(
        (acc, t) => acc + (descTokens.has(t) ? 1 : 0),
        0,
      );
      if (score > 0) {
        autoCandidates.push({ skill, reason: 'auto', score });
      }
    }
    autoCandidates.sort((a, b) => b.score - a.score);
    matches.push(...autoCandidates);
    return matches;
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function loadSkillFile(filePath: string): SkillDefinition {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw, filePath);
  const parsed = parseYamlSubset(frontmatter, filePath);

  const candidate = {
    name: str(parsed.name, 'name', filePath),
    description: str(parsed.description, 'description', filePath),
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    tools: Array.isArray(parsed.tools) ? (parsed.tools as string[]) : [],
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
    activation: parsed.activation as SkillActivation | undefined,
    body: body.trim(),
    sourcePath: filePath,
  };

  const result = SkillDefinitionSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `SkillRegistry: failed to parse ${filePath}:\n` +
        result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n'),
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
      `SkillRegistry: ${filePath} is missing YAML frontmatter (must open with --- and close with ---)`,
    );
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

/**
 * Minimal YAML subset — same parser rules as the SubagentRegistry.
 * Handles scalars, quoted strings, numbers, booleans, and `- ` lists.
 */
function parseYamlSubset(
  src: string,
  filePath: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      throw new Error(
        `SkillRegistry: ${filePath}: cannot parse frontmatter line: "${line}"`,
      );
    }
    const key = m[1] ?? '';
    const rest = (m[2] ?? '').trim();
    if (rest.length > 0) {
      out[key] = coerceScalar(rest);
      i++;
      continue;
    }
    // Nested — collect indented `- ` list lines.
    const childLines: string[] = [];
    i++;
    while (i < lines.length && /^\s{2,}-\s/.test(lines[i] ?? '')) {
      childLines.push(lines[i] ?? '');
      i++;
    }
    out[key] = childLines.map((l) =>
      coerceScalar(l.replace(/^\s*-\s*/, '').trim()),
    );
  }
  return out;
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
      `SkillRegistry: ${filePath}: field "${field}" must be a non-empty string`,
    );
  }
  return v;
}
