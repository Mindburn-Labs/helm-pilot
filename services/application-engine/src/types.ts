export interface TemplateField {
  readonly id: string;
  readonly label: string;
  readonly maxLength: number;
  readonly required: boolean;
  readonly evidenceLinkable: boolean;
  readonly promptHint: string;
}

export interface ApplicationTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly fields: readonly TemplateField[];
}

export interface DraftField {
  readonly fieldId: string;
  readonly value: string;
  readonly evidenceLinks: readonly string[];
}

export interface ApplicationDraft {
  readonly workspaceId: string;
  readonly templateId: string;
  readonly fields: readonly DraftField[];
  readonly createdAt: string;
}
