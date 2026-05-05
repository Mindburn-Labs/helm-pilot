import type { Db } from './client.js';
import { evidenceItems } from './schema/evidence.js';

type EvidenceItemInsert = typeof evidenceItems.$inferInsert;
type EvidenceItemDb = Pick<Db, 'insert'>;

export type AppendEvidenceItemInput = Pick<
  EvidenceItemInsert,
  'workspaceId' | 'evidenceType' | 'sourceType' | 'title'
> &
  Partial<
    Omit<
      EvidenceItemInsert,
      'id' | 'workspaceId' | 'evidenceType' | 'sourceType' | 'title' | 'createdAt'
    >
  >;

export async function appendEvidenceItem(
  db: EvidenceItemDb,
  input: AppendEvidenceItemInput,
): Promise<string> {
  const [row] = await db
    .insert(evidenceItems)
    .values({
      ...input,
      metadata: input.metadata ?? {},
    })
    .returning({ id: evidenceItems.id });

  if (!row?.id) {
    throw new Error('evidence_items insert did not return id');
  }

  return row.id;
}
