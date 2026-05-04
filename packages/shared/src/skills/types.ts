import { z } from 'zod';

// ─── Skills (Phase 14 Track E) ───
//
// A Skill is a domain-knowledge package that extends a subagent's
// behaviour without requiring a new subagent definition. Mirrors the
// Claude Code SKILL.md + OpenClaw ClawHub patterns (April 2026 SOTA).
//
// Precedence (highest → lowest):
//   1. Subagent's explicit `skills:` frontmatter list
//   2. `<cwd>/packs/skills/` (repo-bundled)
//   3. `~/.pilot/skills/` (user overrides)
//   4. Auto-match by description-keyword overlap with subagent's task
//
// File format: `packs/skills/<name>/SKILL.md` — YAML frontmatter
// declaring metadata + Markdown body that becomes a system-prompt
// fragment when the skill is activated.

export const SkillActivationSchema = z.enum([
  'auto', // Fire when subagent's task description overlaps with this skill's description keywords.
  'explicit', // Fire only when the subagent's frontmatter names this skill in `skills:`.
]);
export type SkillActivation = z.infer<typeof SkillActivationSchema>;

export const SkillDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/u, 'name must be kebab-case lowercase'),
  description: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  tools: z.array(z.string()).default([]),
  model: z.string().optional(),
  activation: SkillActivationSchema.default('auto'),
  body: z.string().min(1),
  sourcePath: z.string().min(1),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/** Result of matching skills to a subagent's task. */
export interface SkillMatch {
  skill: SkillDefinition;
  /** Why this skill was selected: explicit list, auto keyword match, or default. */
  reason: 'explicit' | 'auto' | 'default';
  /** Keyword overlap score for `auto` matches; 0 for explicit. */
  score: number;
}
