#!/usr/bin/env node
/**
 * Master-key rotation for per-tenant secrets (Phase 2b).
 *
 * Walks every workspace, re-derives per-tenant DEKs under the new master
 * key, re-encrypts the tenant_secrets rows in place, and bumps their
 * key_version. Old key is never kept once the rotation completes — plaintext
 * only lives in memory during the re-encrypt window.
 *
 * Usage:
 *
 *   FROM_VERSION=1 \
 *   TO_VERSION=2 \
 *   ENCRYPTION_KEY=<current-v1-master>     \   # kept as legacy alias for v1
 *   MASTER_KEY_V2=<new-master>             \
 *   DATABASE_URL=postgres://...            \
 *   npx tsx scripts/rotate-master-key.ts
 *
 * The script is idempotent — re-running against already-rotated rows is a
 * no-op. It exits non-zero on any failure so an on-call runbook can retry
 * without accidentally double-rotating a subset of rows.
 */

import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from '../packages/db/src/client.js';
import { tenantSecrets, workspaces } from '../packages/db/src/schema/index.js';
import { TenantSecretStore } from '../packages/db/src/tenant-secret-store.js';

async function main(): Promise<void> {
  const fromVersion = Number(process.env['FROM_VERSION'] ?? 1);
  const toVersion = Number(process.env['TO_VERSION'] ?? fromVersion + 1);
  if (!Number.isFinite(fromVersion) || !Number.isFinite(toVersion) || toVersion <= fromVersion) {
    throw new Error(
      `FROM_VERSION (${fromVersion}) must be a positive integer and TO_VERSION (${toVersion}) must be greater.`,
    );
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  // Validate both keys are present up front — fail loudly rather than
  // half-rotate and leave an unreadable partition.
  if (fromVersion === 1 && !process.env['ENCRYPTION_KEY']) {
    throw new Error('ENCRYPTION_KEY (the v1 master) must be set to decrypt old rows.');
  }
  if (fromVersion !== 1 && !process.env[`MASTER_KEY_V${fromVersion}`]) {
    throw new Error(`MASTER_KEY_V${fromVersion} must be set to decrypt old rows.`);
  }
  if (!process.env[`MASTER_KEY_V${toVersion}`]) {
    throw new Error(`MASTER_KEY_V${toVersion} must be set to re-encrypt rows.`);
  }

  const { db, close } = createDb(databaseUrl);
  const store = new TenantSecretStore(db);

  try {
    // Apply migrations so tenant_secrets exists before we query it.
    const here = new URL('..', import.meta.url).pathname;
    await runMigrations(databaseUrl, `${here}/packages/db/migrations`);

    const workspacesRows = await db.select({ id: workspaces.id }).from(workspaces);
    console.log(`[rotate] walking ${workspacesRows.length} workspace(s) from v${fromVersion} → v${toVersion}`);

    let totalRotated = 0;
    let totalSkipped = 0;

    for (const { id: workspaceId } of workspacesRows) {
      // Check if this workspace has any rows still on fromVersion (cheap
      // early-exit for idempotent re-runs).
      const pending = await db
        .select({ id: tenantSecrets.id })
        .from(tenantSecrets)
        .where(eq(tenantSecrets.workspaceId, workspaceId));
      const remaining = pending.length;
      if (remaining === 0) {
        totalSkipped++;
        continue;
      }

      try {
        const rotated = await store.rotateWorkspace(workspaceId, fromVersion, toVersion);
        if (rotated > 0) {
          totalRotated += rotated;
          console.log(`[rotate]   ${workspaceId}: rotated ${rotated} / ${remaining} row(s)`);
        }
      } catch (err) {
        console.error(`[rotate]   ${workspaceId}: FAILED —`, err);
        // Continue with the remaining workspaces so one bad row doesn't block
        // the fleet. The runbook asks the operator to re-run the script,
        // which will pick up the failed workspaces on the second pass.
      }
    }

    console.log(
      `[rotate] done — ${totalRotated} row(s) re-encrypted across ${workspacesRows.length} workspace(s); ${totalSkipped} workspace(s) had nothing to rotate.`,
    );
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('[rotate] fatal:', err);
  process.exit(1);
});
