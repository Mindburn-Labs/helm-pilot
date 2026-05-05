import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry, loadSkillFile } from '../skills/registry.js';

const SAMPLE_SKILL = `---
name: sample-skill
description: Sample skill for market research
version: 2.0.0
tools:
  - search_knowledge
  - analyze
risk_profile: R2
permission_requirements:
  - knowledge.read
  - analysis.write
eval_status: passed
activation: explicit
---
Use precise evidence and cite assumptions.
`;

const SAMPLE_INVALID = `---
name: bad-skill
description: Invalid eval status
eval_status: production_ready
---
bad
`;

describe('SkillRegistry', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilot-skills-test-'));
    const sampleDir = join(tmpDir, 'sample-skill');
    mkdirSync(sampleDir);
    writeFileSync(join(sampleDir, 'SKILL.md'), SAMPLE_SKILL);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads skill manifests with risk, permission, and eval metadata', () => {
    const registry = SkillRegistry.loadFromDisk({
      packsDir: tmpDir,
      userDir: join(tmpDir, 'none'),
    });
    const skill = registry.findByName('sample-skill');
    expect(skill).toEqual(
      expect.objectContaining({
        name: 'sample-skill',
        version: '2.0.0',
        tools: ['search_knowledge', 'analyze'],
        riskProfile: 'R2',
        permissionRequirements: ['knowledge.read', 'analysis.write'],
        evalStatus: 'passed',
        activation: 'explicit',
        body: expect.stringContaining('Use precise evidence'),
      }),
    );
  });

  it('rejects invalid skill manifests loudly', () => {
    const invalidDir = join(tmpDir, 'bad-skill');
    mkdirSync(invalidDir);
    const invalidPath = join(invalidDir, 'SKILL.md');
    writeFileSync(invalidPath, SAMPLE_INVALID);
    try {
      expect(() => loadSkillFile(invalidPath)).toThrow(/evalStatus/);
    } finally {
      rmSync(invalidDir, { recursive: true, force: true });
    }
  });

  it('loads bundled YC application skill as not eval-promoted', () => {
    const registry = SkillRegistry.loadFromDisk({
      packsDir: join(process.cwd(), '..', '..', 'packs', 'skills'),
      userDir: join(tmpDir, 'none'),
    });
    const skill = registry.findByName('yc-application-writing');
    expect(skill?.riskProfile).toBe('R1');
    expect(skill?.permissionRequirements).toEqual([
      'application.write',
      'founder_profile.read',
      'opportunity.read',
      'knowledge.read',
    ]);
    expect(skill?.evalStatus).toBe('not_evaluated');
  });
});
