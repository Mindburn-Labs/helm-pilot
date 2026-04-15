#!/usr/bin/env tsx
/**
 * ENCRYPTION_KEY rotation tool.
 *
 * Re-encrypts every row in `connector_tokens` from OLD key to NEW key.
 *
 * Usage:
 *   ENCRYPTION_KEY_OLD=<hex> ENCRYPTION_KEY_NEW=<hex> DATABASE_URL=... \
 *     tsx scripts/rotate-encryption-key.ts [--dry-run]
 *
 * Procedure:
 *   1. Set ENCRYPTION_KEY_OLD = current key, ENCRYPTION_KEY_NEW = new key.
 *   2. Run with --dry-run first to see how many rows will rotate.
 *   3. Run without --dry-run to actually rotate.
 *   4. Swap ENCRYPTION_KEY in production env to NEW value.
 *   5. Restart services.
 */
import postgres from 'postgres';
import { rotateTokenCiphertext } from '../packages/connectors/src/token-store.js';

const BATCH_SIZE = 100;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const databaseUrl = process.env['DATABASE_URL'];
  const oldRaw = process.env['ENCRYPTION_KEY_OLD'];
  const newRaw = process.env['ENCRYPTION_KEY_NEW'];

  if (!databaseUrl) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  if (!oldRaw || !newRaw) {
    console.error('ENCRYPTION_KEY_OLD and ENCRYPTION_KEY_NEW env vars required');
    process.exit(1);
  }
  if (oldRaw === newRaw) {
    console.error('ENCRYPTION_KEY_OLD and ENCRYPTION_KEY_NEW must be different');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 2 });

  try {
    // Count rows first
    const [{ count }] = await sql<{ count: string }[]>`SELECT COUNT(*)::text FROM connector_tokens`;
    const total = Number(count);
    console.log(`Found ${total} token rows to rotate`);

    if (total === 0) {
      console.log('Nothing to rotate. Exiting.');
      await sql.end();
      return;
    }

    if (dryRun) {
      console.log('[DRY RUN] No changes will be written.');
      await sql.end();
      return;
    }

    // Process in batches to avoid locking the whole table
    let offset = 0;
    let rotated = 0;
    let failed = 0;

    while (offset < total) {
      const rows = await sql<
        { id: string; access_token_enc: string; refresh_token_enc: string | null }[]
      >`
        SELECT id, access_token_enc, refresh_token_enc
        FROM connector_tokens
        ORDER BY id
        LIMIT ${BATCH_SIZE} OFFSET ${offset}
      `;

      for (const row of rows) {
        try {
          const newAccess = rotateTokenCiphertext(row.access_token_enc, oldRaw, newRaw);
          const newRefresh = row.refresh_token_enc
            ? rotateTokenCiphertext(row.refresh_token_enc, oldRaw, newRaw)
            : null;

          await sql`
            UPDATE connector_tokens
            SET access_token_enc = ${newAccess},
                refresh_token_enc = ${newRefresh},
                updated_at = NOW()
            WHERE id = ${row.id}
          `;
          rotated++;
        } catch (err) {
          console.error(`Row ${row.id}: rotation failed —`, (err as Error).message);
          failed++;
        }
      }

      offset += BATCH_SIZE;
      if (rotated % 100 === 0 || offset >= total) {
        console.log(`  Progress: ${rotated}/${total} rotated (${failed} failed)`);
      }
    }

    console.log(`\nDone. Rotated: ${rotated}. Failed: ${failed}.`);
    if (failed > 0) {
      console.log('⚠️  Some rows failed — check logs above. These tokens are UNUSABLE without the old key.');
      process.exit(2);
    }
  } finally {
    await sql.end();
  }
}

// Only run if invoked directly (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
