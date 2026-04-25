#!/usr/bin/env tsx
/**
 * certify-subagent — L1/L2 conformance audit for a named subagent.
 *
 * Usage: npm run certify:subagent -- <subagent-name> <workspace-id>
 * Exit:  0 = L1 + L2 both pass
 *        1 = any error finding (invalid field, bad hash, orphan parent, cycle, etc.)
 *        2 = argparse or DB connection error
 *
 * Read-only — no DB writes. Runs against the workspace's evidence_packs
 * table, filtering by workspace and the subagent's principal suffix.
 */
import { createDb } from '@helm-pilot/db/client';
import { evidencePacks } from '@helm-pilot/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { validateL1Batch, validateL2, type EvidencePackLite } from '@helm-pilot/shared/conformance';

async function main() {
  const name = process.argv[2];
  const workspaceId = process.argv[3] ?? process.env['WORKSPACE_ID'];
  if (!name || !workspaceId) {
    console.error('Usage: certify-subagent <subagent-name> <workspace-id>');
    console.error('Alternatively set WORKSPACE_ID in the environment.');
    process.exit(2);
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const { db, close } = createDb(databaseUrl);

  try {
    const rows = await db
      .select()
      .from(evidencePacks)
      .where(
        and(
          eq(evidencePacks.workspaceId, workspaceId),
          like(evidencePacks.principal, `%subagent:${name}:%`),
        ),
      )
      .orderBy(evidencePacks.receivedAt);

    console.log(
      `Found ${rows.length} evidence pack(s) for subagent "${name}" in workspace ${workspaceId}`,
    );
    if (rows.length === 0) {
      console.log('Nothing to certify. Exit 0.');
      return;
    }

    const packs: EvidencePackLite[] = rows.map((r) => ({
      id: r.id,
      decisionId: r.decisionId,
      verdict: r.verdict as 'ALLOW' | 'DENY' | 'ESCALATE',
      policyVersion: r.policyVersion,
      action: r.action,
      resource: r.resource,
      principal: r.principal,
      receivedAt: r.receivedAt,
      decisionHash: r.decisionHash ?? null,
      signedBlob: r.signedBlob ?? null,
      parentEvidencePackId: r.parentEvidencePackId ?? null,
      taskRunId: r.taskRunId ?? null,
    }));

    const l1 = validateL1Batch(packs);
    console.log(`L1: ${l1.passedCount}/${l1.total} pass (${l1.failedCount} failed)`);
    if (!l1.passed) {
      for (const [packId, result] of Object.entries(l1.perPack)) {
        if (!result.passed) {
          console.log(`  ✗ ${packId}:`);
          for (const f of result.findings.filter((x) => x.level === 'error')) {
            console.log(`      - ${f.code}: ${f.message}`);
          }
        }
      }
    }

    const l2 = validateL2(packs);
    console.log(`L2: ${l2.passed ? 'PASS' : 'FAIL'} (${l2.findings.length} findings)`);
    for (const f of l2.findings) {
      const icon = f.level === 'error' ? '✗' : 'ℹ';
      console.log(`  ${icon} [${f.code}] ${f.message}`);
    }

    const passed = l1.passed && l2.passed;
    console.log('');
    console.log(`Verdict: ${passed ? 'CERTIFIED L1+L2' : 'FAILED'}`);
    process.exit(passed ? 0 : 1);
  } finally {
    await close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(2);
});
