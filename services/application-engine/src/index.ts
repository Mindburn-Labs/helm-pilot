import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApplicationTemplate, ApplicationDraft, DraftField, TemplateField } from './types.js';

export type { ApplicationTemplate, ApplicationDraft, DraftField, TemplateField } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTemplate(filename: string): ApplicationTemplate {
  const raw = readFileSync(join(__dirname, 'templates', filename), 'utf-8');
  return JSON.parse(raw) as ApplicationTemplate;
}

export interface LlmProvider {
  complete(prompt: string): Promise<string>;
}

export interface FounderProfile {
  readonly name: string;
  readonly background: string;
  readonly experience: string;
  readonly interests: readonly string[];
  readonly startupVector: string;
}

export interface GenerateDraftParams {
  readonly workspaceId: string;
  readonly templateId: string;
  readonly founderProfile?: FounderProfile;
  readonly opportunity?: string;
  readonly existingWork?: string;
}

export interface ReviseDraftParams {
  readonly draft: ApplicationDraft;
  readonly fieldId: string;
  readonly feedback: string;
}

const TEMPLATES: readonly ApplicationTemplate[] = [
  loadTemplate('yc.json'),
  loadTemplate('techstars.json'),
  loadTemplate('antler.json'),
];

const TEMPLATE_MAP = new Map<string, ApplicationTemplate>(
  TEMPLATES.map((t) => [t.id, t]),
);

export class ApplicationEngine {
  constructor(private readonly llm?: LlmProvider) {}

  listTemplates(): readonly ApplicationTemplate[] {
    return TEMPLATES;
  }

  getTemplate(id: string): ApplicationTemplate | undefined {
    return TEMPLATE_MAP.get(id);
  }

  async generateDraft(params: GenerateDraftParams): Promise<ApplicationDraft> {
    const template = TEMPLATE_MAP.get(params.templateId);
    if (!template) {
      throw new Error(`Unknown template: ${params.templateId}`);
    }

    const fields: DraftField[] = [];

    for (const field of template.fields) {
      const value = await this.generateFieldValue(field, params);
      const evidenceLinks = this.collectEvidenceLinks(field, params);
      fields.push({ fieldId: field.id, value, evidenceLinks });
    }

    return {
      workspaceId: params.workspaceId,
      templateId: params.templateId,
      fields,
      createdAt: new Date().toISOString(),
    };
  }

  async reviseDraft(params: ReviseDraftParams): Promise<ApplicationDraft> {
    const { draft, fieldId, feedback } = params;

    const template = TEMPLATE_MAP.get(draft.templateId);
    if (!template) {
      throw new Error(`Unknown template: ${draft.templateId}`);
    }

    const templateField = template.fields.find((f) => f.id === fieldId);
    if (!templateField) {
      throw new Error(`Unknown field: ${fieldId}`);
    }

    const existingField = draft.fields.find((f) => f.fieldId === fieldId);
    const currentValue = existingField?.value ?? '';
    const revisedValue = await this.reviseFieldValue(templateField, currentValue, feedback);

    const updatedFields = draft.fields.map((f) =>
      f.fieldId === fieldId ? { ...f, value: revisedValue } : f,
    );

    return { ...draft, fields: updatedFields };
  }

  private async generateFieldValue(
    field: TemplateField,
    params: GenerateDraftParams,
  ): Promise<string> {
    if (!this.llm) {
      return `[Draft: ${field.label}]`;
    }

    const prompt = buildFieldPrompt(field, params);
    const response = await this.llm.complete(prompt);
    return response.slice(0, field.maxLength);
  }

  private collectEvidenceLinks(
    field: TemplateField,
    params: GenerateDraftParams,
  ): readonly string[] {
    if (!field.evidenceLinkable) return [];

    const links: string[] = [];

    if (params.founderProfile) {
      links.push(`founder-profile:${params.workspaceId}`);
    }
    if (params.opportunity) {
      links.push(`opportunity:${params.workspaceId}`);
    }
    if (params.existingWork) {
      links.push(`existing-work:${params.workspaceId}`);
    }

    return links;
  }

  private async reviseFieldValue(
    field: TemplateField,
    currentValue: string,
    feedback: string,
  ): Promise<string> {
    if (!this.llm) {
      return `[Revised: ${field.label}]`;
    }

    const prompt = buildRevisionPrompt(field, currentValue, feedback);
    const response = await this.llm.complete(prompt);
    return response.slice(0, field.maxLength);
  }
}

// ─── Prompt Engineering ───

function buildFieldPrompt(field: TemplateField, params: GenerateDraftParams): string {
  const sections: string[] = [
    `You are drafting an accelerator application field.`,
    `\nField: ${field.label}`,
    `Hint: ${field.promptHint}`,
    `Max length: ${field.maxLength} characters.`,
  ];

  if (params.founderProfile) {
    const fp = params.founderProfile;
    sections.push(`\n<founder_profile>`);
    sections.push(`Name: ${fp.name}`);
    sections.push(`Background: ${fp.background}`);
    sections.push(`Experience: ${fp.experience}`);
    sections.push(`Interests: ${fp.interests.join(', ')}`);
    sections.push(`Startup Vector: ${fp.startupVector}`);
    sections.push(`</founder_profile>`);
  }

  if (params.opportunity) {
    sections.push(`\n<opportunity>${params.opportunity}</opportunity>`);
  }

  if (params.existingWork) {
    sections.push(`\n<existing_work>${params.existingWork}</existing_work>`);
  }

  sections.push(
    `\nWrite a compelling, honest answer for this field. Be specific and concise. Return only the answer text, no labels or formatting.`,
  );

  return sections.join('\n');
}

function buildRevisionPrompt(
  field: TemplateField,
  currentValue: string,
  feedback: string,
): string {
  return `You are revising an accelerator application field.

Field: ${field.label}
Hint: ${field.promptHint}
Max length: ${field.maxLength} characters.

<current_answer>
${currentValue}
</current_answer>

<feedback>
${feedback}
</feedback>

Revise the answer based on the feedback. Return only the revised text, no labels or formatting.`;
}
