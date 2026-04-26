#!/usr/bin/env tsx
/**
 * Schema verification — runs after `drizzle-kit migrate` / `db:push` to assert
 * the expected extensions, tables, columns, and indexes are present.
 *
 * Exits 0 on pass, 1 on any missing piece. Used in CI after spinning up
 * postgres + applying migrations.
 */
import postgres from 'postgres';

interface Check {
  name: string;
  run: (sql: postgres.Sql) => Promise<boolean>;
}

const checks: Check[] = [
  {
    name: 'pgvector extension installed',
    run: async (sql) => {
      const rows = await sql<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'content_chunks.embedding_vec column exists as vector type',
    run: async (sql) => {
      const rows = await sql<{ data_type: string; udt_name: string }[]>`
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'content_chunks' AND column_name = 'embedding_vec'
      `;
      return rows.length > 0 && rows[0]!.udt_name === 'vector';
    },
  },
  {
    name: 'content_chunks.embedding_vec HNSW index exists',
    run: async (sql) => {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'content_chunks' AND indexname = 'chunks_embedding_idx'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'task_runs.cost_usd column exists',
    run: async (sql) => {
      const rows = await sql<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'task_runs' AND column_name = 'cost_usd'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'task_runs checkpoint columns exist',
    run: async (sql) => {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'task_runs'
          AND column_name IN ('checkpoint_state', 'last_checkpoint_at', 'watchdog_alerted_at')
      `;
      return rows.length === 3;
    },
  },
  {
    name: 'task_runs running checkpoint index exists',
    run: async (sql) => {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'task_runs' AND indexname = 'task_runs_running_checkpoint_idx'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'workspace compliance frameworks column exists',
    run: async (sql) => {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'workspaces' AND column_name = 'compliance_frameworks'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'rate-limit buckets table exists',
    run: async (sql) => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ratelimit_buckets'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'rate-limit buckets updated index exists',
    run: async (sql) => {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'ratelimit_buckets' AND indexname = 'ratelimit_buckets_updated_idx'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'tasks triggers notify helm_pilot_events',
    run: async (sql) => {
      const rows = await sql<{ trigger_name: string }[]>`
        SELECT trigger_name FROM information_schema.triggers
        WHERE event_object_table = 'tasks' AND trigger_name = 'tasks_notify_change'
      `;
      return rows.length > 0;
    },
  },
  {
    name: 'core tables present (users, workspaces, tasks, sessions)',
    run: async (sql) => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('users', 'workspaces', 'tasks', 'sessions', 'connector_tokens', 'pages')
      `;
      return rows.length === 6;
    },
  },
];

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

  let passed = 0;
  let failed = 0;

  try {
    for (const check of checks) {
      process.stdout.write(`  ${check.name}... `);
      try {
        const ok = await check.run(sql);
        if (ok) {
          console.log('\u2713 PASS');
          passed++;
        } else {
          console.log('\u2717 FAIL');
          failed++;
        }
      } catch (err) {
        console.log(`\u2717 ERROR: ${(err as Error).message}`);
        failed++;
      }
    }
  } finally {
    await sql.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
