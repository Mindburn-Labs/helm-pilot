import { describe, it, expect, vi } from 'vitest';
import {
  ApplicationEngine,
  type LlmProvider,
  type FounderProfile,
} from '../index.js';

// ─── Helpers ───

function createMockLlm(response: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

const FOUNDER_PROFILE: FounderProfile = {
  name: 'Jane Doe',
  background: 'Stanford CS, 10 years at Google',
  experience: 'Built and sold a SaaS startup',
  interests: ['AI', 'healthcare'],
  startupVector: 'AI-powered health platform',
};

// ─── Tests ───

describe('ApplicationEngine', () => {
  // ─── listTemplates ───

  it('lists all 3 templates', () => {
    const engine = new ApplicationEngine();
    const templates = engine.listTemplates();

    expect(templates).toHaveLength(3);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('yc');
    expect(ids).toContain('techstars');
    expect(ids).toContain('antler');
  });

  // ─── YC template field count ───

  it('YC template has 15+ fields', () => {
    const engine = new ApplicationEngine();
    const yc = engine.getTemplate('yc');

    expect(yc).toBeDefined();
    expect(yc!.fields.length).toBeGreaterThanOrEqual(15);

    const ids = yc!.fields.map((f) => f.id);
    expect(ids).toContain('company_name');
    expect(ids).toContain('what_do_you_do');
    expect(ids).toContain('biggest_challenge');
    expect(ids).toContain('pitch_deck_url');
  });

  // ─── Draft generation covers all required fields ───

  it('draft generation produces fields for all required template fields', async () => {
    const llm = createMockLlm('Generated answer');
    const engine = new ApplicationEngine(llm);
    const yc = engine.getTemplate('yc')!;

    const draft = await engine.generateDraft({
      workspaceId: 'ws-001',
      templateId: 'yc',
    });

    const requiredFieldIds = yc.fields
      .filter((f) => f.required)
      .map((f) => f.id);
    const draftFieldIds = draft.fields.map((f) => f.fieldId);

    for (const id of requiredFieldIds) {
      expect(draftFieldIds).toContain(id);
    }

    // Every field has a non-empty value
    for (const field of draft.fields) {
      expect(field.value.length).toBeGreaterThan(0);
    }
  });

  // ─── Evidence links with founder profile ───

  it('draft includes evidence links when founder profile provided', async () => {
    const llm = createMockLlm('Answer with context');
    const engine = new ApplicationEngine(llm);

    const draft = await engine.generateDraft({
      workspaceId: 'ws-002',
      templateId: 'yc',
      founderProfile: FOUNDER_PROFILE,
      opportunity: 'AI healthcare market growing 40% YoY',
    });

    // Evidence-linkable fields should have links
    const linkableField = draft.fields.find((f) => f.fieldId === 'what_do_you_do');
    expect(linkableField).toBeDefined();
    expect(linkableField!.evidenceLinks.length).toBeGreaterThan(0);
    expect(linkableField!.evidenceLinks).toContain('founder-profile:ws-002');
    expect(linkableField!.evidenceLinks).toContain('opportunity:ws-002');

    // Non-linkable fields should have no links
    const nonLinkable = draft.fields.find((f) => f.fieldId === 'company_name');
    expect(nonLinkable).toBeDefined();
    expect(nonLinkable!.evidenceLinks).toHaveLength(0);
  });

  // ─── Revision updates only the specified field ───

  it('revision updates only the specified field, preserves others', async () => {
    const llm = createMockLlm('Revised answer');
    const engine = new ApplicationEngine(llm);

    const original = await engine.generateDraft({
      workspaceId: 'ws-003',
      templateId: 'techstars',
    });

    const originalCompanyName = original.fields.find(
      (f) => f.fieldId === 'company_name',
    )!.value;

    const revised = await engine.reviseDraft({
      draft: original,
      fieldId: 'elevator_pitch',
      feedback: 'Make it shorter and punchier',
    });

    // The targeted field should be updated
    const revisedPitch = revised.fields.find((f) => f.fieldId === 'elevator_pitch');
    expect(revisedPitch).toBeDefined();
    expect(revisedPitch!.value).toBe('Revised answer');

    // Other fields should be unchanged
    const revisedCompanyName = revised.fields.find(
      (f) => f.fieldId === 'company_name',
    );
    expect(revisedCompanyName!.value).toBe(originalCompanyName);

    // Field count should be the same
    expect(revised.fields).toHaveLength(original.fields.length);
  });

  // ─── Graceful without LLM ───

  it('works gracefully without LLM — returns placeholder text', async () => {
    const engine = new ApplicationEngine();

    const draft = await engine.generateDraft({
      workspaceId: 'ws-004',
      templateId: 'antler',
    });

    expect(draft.templateId).toBe('antler');
    expect(draft.workspaceId).toBe('ws-004');
    expect(draft.fields.length).toBeGreaterThan(0);

    // Every field should have a placeholder value
    for (const field of draft.fields) {
      expect(field.value).toMatch(/^\[Draft: .+\]$/);
    }

    // Revision should also work
    const revised = await engine.reviseDraft({
      draft,
      fieldId: 'startup_idea',
      feedback: 'More detail',
    });

    const revisedField = revised.fields.find((f) => f.fieldId === 'startup_idea');
    expect(revisedField!.value).toMatch(/^\[Revised: .+\]$/);
  });
});
