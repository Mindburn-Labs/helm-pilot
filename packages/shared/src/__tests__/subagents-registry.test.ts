import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SubagentRegistry,
  loadDefinitionFile,
} from '../subagents/registry.js';

const SAMPLE_MINIMAL = `---
name: sample_one
description: Sample subagent
operator_role: growth
tool_scope:
  allowed_tools:
    - search_knowledge
---
You are sample one.
`;

const SAMPLE_FULL = `---
name: sample_full
description: Sample with all HELM-additive fields
version: 2.3.4
operator_role: product
max_risk_class: R2
budget_weight: 2.5
execution: SUPERVISED
tool_scope:
  allowed_tools:
    - get_founder_profile
    - analyze
iteration_budget: 30
model: sonnet
---
System prompt body.
`;

const SAMPLE_GEMINI_CLI_ONLY = `---
name: gemini_only
description: Pure Gemini-CLI frontmatter; no HELM fields
operator_role: ops
tool_scope:
  allowed_tools:
    - search_knowledge
---
Works too.
`;

const SAMPLE_BAD_NAME = `---
name: BadName-WithDashes
description: Should fail snake_case regex
operator_role: growth
tool_scope:
  allowed_tools:
    - search_knowledge
---
x
`;

const SAMPLE_NO_FRONTMATTER = `# just markdown, no frontmatter
hello
`;

describe('SubagentRegistry', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'helm-subagents-test-'));
    writeFileSync(join(tmpDir, 'sample_one.md'), SAMPLE_MINIMAL);
    writeFileSync(join(tmpDir, 'sample_full.md'), SAMPLE_FULL);
    writeFileSync(join(tmpDir, 'gemini_only.md'), SAMPLE_GEMINI_CLI_ONLY);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads all .md files under packsDir', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    expect(reg.size()).toBe(3);
    expect(reg.list().map((d) => d.name).sort()).toEqual([
      'gemini_only',
      'sample_full',
      'sample_one',
    ]);
  });

  it('applies defaults to minimal Gemini-CLI-compatible frontmatter', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    const def = reg.findByName('sample_one');
    expect(def).toBeDefined();
    expect(def!.version).toBe('1.0.0');
    expect(def!.maxRiskClass).toBe('R1');
    expect(def!.budgetWeight).toBe(1);
    expect(def!.execution).toBe('AUTONOMOUS');
    expect(def!.iterationBudget).toBe(20);
    expect(def!.toolScope.allowedTools).toEqual(['search_knowledge']);
  });

  it('preserves explicit HELM-additive fields when present', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    const def = reg.findByName('sample_full');
    expect(def).toBeDefined();
    expect(def!.version).toBe('2.3.4');
    expect(def!.maxRiskClass).toBe('R2');
    expect(def!.budgetWeight).toBe(2.5);
    expect(def!.execution).toBe('SUPERVISED');
    expect(def!.iterationBudget).toBe(30);
    expect(def!.model).toBe('sonnet');
  });

  it('captures the Markdown body as systemPrompt', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    const def = reg.findByName('sample_one');
    expect(def!.systemPrompt).toContain('You are sample one');
  });

  it('returns empty registry when packsDir does not exist', () => {
    const reg = SubagentRegistry.loadFromDisk(join(tmpDir, 'nope'));
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it('findByDescription ranks by keyword overlap', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    const hit = reg.findByDescription('HELM additive fields example');
    expect(hit?.name).toBe('sample_full');
  });

  it('findByDescription returns undefined when nothing matches', () => {
    const reg = SubagentRegistry.loadFromDisk(tmpDir);
    const hit = reg.findByDescription('completely orthogonal quarks');
    expect(hit).toBeUndefined();
  });

  it('rejects definitions whose name violates snake_case', () => {
    const badPath = join(tmpDir, 'bad_name.md');
    writeFileSync(badPath, SAMPLE_BAD_NAME);
    try {
      expect(() => loadDefinitionFile(badPath)).toThrow(/snake_case/);
    } finally {
      rmSync(badPath);
    }
  });

  it('rejects files missing YAML frontmatter fences', () => {
    const badPath = join(tmpDir, 'no_fm.md');
    writeFileSync(badPath, SAMPLE_NO_FRONTMATTER);
    try {
      expect(() => loadDefinitionFile(badPath)).toThrow(/frontmatter/);
    } finally {
      rmSync(badPath);
    }
  });

  it('detects duplicate subagent names and throws', () => {
    const dupDir = mkdtempSync(join(tmpdir(), 'helm-subagents-dup-'));
    try {
      writeFileSync(join(dupDir, 'a.md'), SAMPLE_MINIMAL);
      writeFileSync(join(dupDir, 'b.md'), SAMPLE_MINIMAL); // same `name: sample_one`
      expect(() => SubagentRegistry.loadFromDisk(dupDir)).toThrow(/duplicate/);
    } finally {
      rmSync(dupDir, { recursive: true, force: true });
    }
  });
});

describe('SubagentRegistry — real built-in fixtures', () => {
  it('loads the three packs/subagents/*.md definitions', () => {
    // Vitest runs from the package root; walk up to repo root to find packs/.
    const reg = SubagentRegistry.loadFromDisk(
      join(process.cwd(), '..', '..', 'packs', 'subagents'),
    );
    const names = reg.list().map((d) => d.name).sort();
    expect(names).toContain('opportunity_scout');
    expect(names).toContain('decision_facilitator');
    expect(names).toContain('founder_diagnostician');
  });

  it('founder_diagnostician is READ_ONLY and R0', () => {
    const reg = SubagentRegistry.loadFromDisk(
      join(process.cwd(), '..', '..', 'packs', 'subagents'),
    );
    const diag = reg.findByName('founder_diagnostician');
    expect(diag?.execution).toBe('READ_ONLY');
    expect(diag?.maxRiskClass).toBe('R0');
  });
});
