import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { evidencePacks } from './governance.js';

// ─── Compliance Domain (Phase 14 Track B) ───
//
// Attestation history for workspaces that opt in to a regulated
// compliance framework (SOC2 Type II / HIPAA / PCI DSS 4 /
// EU AI Act High-Risk / ISO 42001). Each row records a generated
// compliance bundle (via HelmClient.exportSoc2 or equivalent).
//
// The per-workspace enabled list lives on
// `workspaces.compliance_frameworks` (added by migration 0013) — wire
// that column from workspace.ts when a downstream consumer needs it
// typed (a follow-up commit adds the field there).

export const complianceAttestations = pgTable(
  'compliance_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Framework code: soc2_type2 | hipaa_covered_entity | pci_dss_4 | eu_ai_act_high_risk | iso_42001. */
    framework: text('framework').notNull(),
    attestedAt: timestamp('attested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Evidence pack that anchors this attestation (when HELM returned one). */
    evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id, {
      onDelete: 'set null',
    }),
    /** Expiry driven by framework retention policy. Null = no explicit expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** SHA-256 of the JCS-canonical bundle — lets consumers verify offline. */
    bundleHash: text('bundle_hash'),
    /** Framework-specific payload (e.g. {"trigger":"manual","auditor":"…"}). */
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('compliance_attestations_workspace_idx').on(
      table.workspaceId,
      table.framework,
    ),
    index('compliance_attestations_attested_idx').on(table.attestedAt),
  ],
);
