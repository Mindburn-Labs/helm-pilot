#!/usr/bin/env node
/**
 * Tenancy lint — guards against cross-tenant DB leaks.
 *
 * Scans TypeScript source for drizzle query calls against tables that carry a
 * `workspace_id` column and verifies the call site includes a workspace
 * predicate. Catches the most common "forgot to scope it" bug at CI time.
 *
 * Rules:
 *   1. For every `.from(TABLE)` where TABLE is workspace-scoped, the same
 *      query chain must contain `TABLE.workspaceId` (any `eq`, `and`, `or`
 *      usage) — otherwise the query can read other tenants' data.
 *   2. For every `.insert(TABLE)` where TABLE is workspace-scoped, the
 *      `.values(...)` block must reference `workspaceId`.
 *   3. For every `.update(TABLE)` where TABLE is workspace-scoped, the
 *      query chain must contain `TABLE.workspaceId` in a predicate.
 *
 * Exceptions (files skipped):
 *   - test files (`**\/__tests__/**`, `**\/*.test.ts`, `**\/*.spec.ts`)
 *   - migrations
 *   - schema definitions themselves
 *   - admin-scoped routes under services/gateway/src/routes/admin.ts
 *   - the migration runner in packages/db/src/client.ts
 *
 * Tables that are deliberately global (no workspace_id) are listed explicitly
 * so adding a new one here is an intentional review gate.
 *
 * Run:  npm run lint:tenancy      (exit 0 = clean, exit 1 = violations)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// ─── Schema taxonomy ─────────────────────────────────────────────────────

/**
 * Tables that carry a `workspace_id` column (directly or implicitly via a
 * foreign key that roots at a workspace). Every query against one of these
 * MUST include a workspace predicate.
 *
 * Keep this list in sync with packages/db/src/schema/*. When you add a new
 * workspace-scoped table, register it here so the lint enforces it.
 */
const WORKSPACE_SCOPED_TABLES = new Set<string>([
  'workspaces',
  'workspaceMembers',
  'workspaceSettings',
  'founderProfiles',
  'founderStrengths',
  'founderAssessments',
  'opportunities',
  'opportunityScores',
  'operators',
  'tasks',
  'plans',
  'pages',
  'timelineEntries',
  'connectorGrants',
  'auditLog',
  'approvals',
  'policyViolations',
  'evidencePacks',
  'crawlSources',
  'crawlRuns',
  'applications',
  'cofounderCandidates',
  'cofounderCandidateSources',
  'launchArtifacts',
  'deployments',
  'deployTargets',
]);

/**
 * Tables scoped indirectly — they carry a FK to a workspace-scoped parent
 * instead of a direct workspace_id column. Phase 2a does NOT lint these; a
 * future slice will add a deeper FK-traversal analyzer.
 *
 * Listed here so adding a new one is an intentional review gate. Examples:
 *   - connectorTokens → connectorGrants.workspaceId (scoped via grantId)
 *   - milestones      → plans.workspaceId          (scoped via planId)
 *   - taskArtifacts   → tasks.workspaceId          (scoped via taskId)
 */
const FK_SCOPED_TABLES = new Set<string>([
  'connectorTokens',
  'connectorSessions',
  'milestones',
  'taskArtifacts',
  'taskRuns',
  'operatorMemory',
  'operatorConfigs',
  'contentChunks',
  'opportunityTags',
  'cofounderCandidateNotes',
  'cofounderMatchEvaluations',
  'cofounderOutreachDrafts',
  'cofounderFollowUps',
]);

/**
 * Tables that are deliberately global (no workspace_id) — queries against
 * them are NOT subject to the lint. Listed explicitly so adding a new global
 * table requires a review.
 */
const GLOBAL_TABLES = new Set<string>([
  'users',
  'sessions',
  'apiKeys',
  'connectors', // global connector definitions; workspace scoping is via connectorGrants
  'operatorRoles', // global role templates
  'ycCompanies',
  'ycBatches',
  'ycFounders',
  'ycAdvice',
  'ycCourses',
  'helmHealthSnapshots',
  'links',
  'tags',
  'rawData',
  'rawCaptures',
  'crawlCheckpoints',
  'ingestionLinks',
  'ingestionRecords', // platform-wide ingestion bookkeeping
]);

// ─── Exceptions ──────────────────────────────────────────────────────────

const SKIP_PATH_PATTERNS: RegExp[] = [
  /\/__tests__\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\/migrations\//,
  /\/schema\//, // schema definitions themselves
  /\/db\/src\/client\.ts$/,
  /\/db\/src\/index\.ts$/,
  /\/routes\/admin\.ts$/, // admin routes are platform-scoped by design
  /\/_archive\//,
  /\/node_modules\//,
  /\/dist\//,
  /\/\.turbo\//,
  /\/\.next\//,
  // Phase 2a scope: guard the HTTP/bot surface (where untrusted ids enter).
  // Service-layer methods accept scoped ids from their caller — their
  // tenancy posture is a Phase 2b audit task (enforce double-scoping).
  /\/services\/(memory|orchestrator|founder-intel|yc-intel|cofounder-engine|product-factory|launch-engine)\//,
];

// ─── Scanner ─────────────────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  table: string;
  operation: 'from' | 'insert' | 'update';
  snippet: string;
  reason: string;
}

/**
 * Find every `.op(TABLE)` call in the source where TABLE is in the scoped
 * list, then look at a window of lines around it to check for a workspace
 * predicate. The window is deliberately generous (±25 lines) because drizzle
 * queries often span several lines.
 */
function scanFile(path: string): Violation[] {
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  const opRegex = /\.(from|insert|update)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[),]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let match: RegExpExecArray | null;
    opRegex.lastIndex = 0;
    while ((match = opRegex.exec(line)) !== null) {
      const operation = match[1] as 'from' | 'insert' | 'update';
      const table = match[2]!;

      if (!WORKSPACE_SCOPED_TABLES.has(table)) continue;

      // Look forward and backward for a workspace predicate.
      const windowStart = Math.max(0, i - 25);
      const windowEnd = Math.min(lines.length, i + 25);
      const window = lines.slice(windowStart, windowEnd).join('\n');

      // Allow authors to opt out with a nearby `// lint-tenancy: ok <reason>`
      // comment — used for legitimate patterns the static rule can't verify
      // (e.g. "fetched by id and verified against session.workspaceId").
      if (/\/\/\s*lint-tenancy:\s*(ok|safe|allow)\b/i.test(window)) continue;

      // Special case: `.from(workspaces).where(eq(workspaces.id, …))` is
      // scope-defining rather than scope-leaking — it's how you LOOK UP a
      // workspace.
      if (table === 'workspaces' && /\.where\(\s*eq\(\s*workspaces\.id/.test(window)) continue;

      if (hasWorkspacePredicate(window, table)) continue;

      violations.push({
        file: relative(REPO_ROOT, path),
        line: i + 1,
        table,
        operation,
        snippet: line.trim(),
        reason:
          `${operation}(${table}) without a visible workspace predicate ` +
          `(expected ${table}.workspaceId or workspaceId: ... in values within ±25 lines).`,
      });
    }
  }

  return violations;
}

/**
 * Heuristic check for a workspace predicate within a window of source text.
 *
 * Matches any of:
 *   - `${table}.workspaceId`   (drizzle predicate ref)
 *   - `workspaceId:`           (insert values shorthand)
 *   - `workspaceId,`           (insert values shorthand)
 *   - `workspace_id`           (raw SQL literal)
 *   - `currentWorkspaceId(`    (AsyncLocalStorage helper)
 */
function hasWorkspacePredicate(window: string, table: string): boolean {
  if (window.includes(`${table}.workspaceId`)) return true;
  if (window.includes('workspaceId:')) return true;
  if (window.includes('workspaceId,')) return true;
  if (window.includes('workspace_id')) return true;
  if (window.includes('currentWorkspaceId(')) return true;
  return false;
}

// ─── Entry point ─────────────────────────────────────────────────────────

const DIR_PRUNE = new Set(['node_modules', 'dist', '.turbo', '.next', '_archive', '.git']);

function collectTsFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (DIR_PRUNE.has(entry)) continue;
    const abs = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectTsFiles(abs, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
}

function main(): void {
  // Scope the scan to the first-party source roots so we skip node_modules /
  // dist / .turbo / _archive without walking them at all.
  const roots = ['apps', 'services', 'packages', 'scripts'].map((r) => resolve(REPO_ROOT, r));
  const sourceFiles: string[] = [];
  for (const root of roots) collectTsFiles(root, sourceFiles);

  const allViolations: Violation[] = [];
  let scanned = 0;

  for (const abs of sourceFiles) {
    if (SKIP_PATH_PATTERNS.some((p) => p.test(abs))) continue;
    scanned++;
    const found = scanFile(abs);
    allViolations.push(...found);
  }

  if (allViolations.length === 0) {
    console.log(`✓ tenancy lint: ${scanned} files scanned, no violations.`);
    process.exit(0);
  }

  console.error(`✗ tenancy lint: ${allViolations.length} violation(s)\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.reason}`);
    console.error(`    > ${v.snippet}`);
    console.error('');
  }
  console.error(
    'Every query against a workspace-scoped table must either\n' +
      '  - include a `TABLE.workspaceId` predicate (for select / update),\n' +
      '  - include `workspaceId` in the .values() call (for insert), or\n' +
      '  - call `currentWorkspaceId()` from @helm-pilot/gateway/middleware/workspace.\n' +
      'If this is a legitimate platform-admin query, move it to services/gateway/src/routes/admin.ts\n' +
      'which is exempt by design.',
  );
  process.exit(1);
}

main();
