/**
 * @pilot/legacy-audit
 *
 * Adapters and wrappers for existing Pilot modules during migration.
 * Provides bridge interfaces so legacy Python code (money-engine, gig-radar)
 * can interoperate with the new TypeScript services through shared Postgres.
 *
 * Key adapters:
 * - Trust boundary bridge (pretooluse.py → orchestrator/trust.ts)
 * - State reader bridge (JSONL files → Postgres queries)
 * - Skill dispatch bridge (SKILL.md → orchestrator task creation)
 * - gig-radar output bridge (leads.jsonl → opportunity table writes)
 *
 * These adapters are transitional. They will be removed as each
 * legacy module is fully migrated to the new architecture.
 *
 * Historical source imports are externalized outside the active repository.
 */

export interface LegacyBridgeConfig {
  archivePath: string; // externalized historical import path for reference reads
  databaseUrl: string; // Postgres URL for writing migrated data
}

/**
 * Reads a JSONL state file from the archive and returns parsed rows.
 * Used during data migration and for reference during refactor.
 */
export async function readArchiveJsonl<T>(
  archivePath: string,
  filename: string,
): Promise<T[]> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const content = await readFile(join(archivePath, filename), 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}
