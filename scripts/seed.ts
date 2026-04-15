/**
 * HELM Pilot — Development Seed Script
 *
 * Creates initial data for local development:
 * - A test user
 * - A workspace with membership
 * - Operator role definitions
 * - Sample opportunity
 *
 * Usage: npx tsx scripts/seed.ts
 */

import { createDb } from '@helm-pilot/db/client';
import { users, workspaces, workspaceMembers, operatorRoles, opportunities } from '@helm-pilot/db/schema';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const { db, close } = createDb(DATABASE_URL);

async function seed() {
  console.log('Seeding HELM Pilot database...');

  // 1. Create test user
  const [user] = await db
    .insert(users)
    .values({ email: 'dev@helm-pilot.local', name: 'Dev User' })
    .onConflictDoNothing()
    .returning();

  const userId = user?.id;
  if (!userId) {
    console.log('User already exists, looking up...');
    const [existing] = await db.select().from(users).limit(1);
    if (!existing) { console.error('No user found'); process.exit(1); }
    console.log(`Using existing user: ${existing.email}`);
  }
  const finalUserId = userId ?? (await db.select().from(users).limit(1))[0]!.id;

  // 2. Create workspace
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Dev User's Workspace", ownerId: finalUserId })
    .returning();

  if (ws) {
    await db.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId: finalUserId,
      role: 'owner',
    });
    console.log(`Workspace created: ${ws.id}`);
  }

  // 3. Operator roles
  const roles = [
    { name: 'engineering', description: 'Technical co-founder. Builds products, writes code, manages infrastructure.', defaultGoal: 'Build and ship the technical product. Write specs, create prototypes, manage code quality.', defaultConstraints: ['No production deployments without approval', 'External API integrations require approval', 'Budget limit per task applies'], defaultTools: ['search_knowledge', 'create_note', 'draft_text', 'analyze', 'create_task', 'update_task_status', 'create_artifact'], systemPrompt: 'You are the engineering co-founder inside HELM Pilot. You think in systems, implementation tradeoffs, and shipping fast without creating brittle code.' },
    { name: 'product', description: 'Product co-founder. Defines roadmap, user value, and prioritization.', defaultGoal: 'Turn startup ideas into clear product strategy, specs, and prioritized execution plans.', defaultConstraints: ['Public roadmap changes require approval', 'External user interviews require approval'], defaultTools: ['search_knowledge', 'create_note', 'draft_text', 'analyze', 'get_founder_profile', 'list_opportunities', 'create_plan'], systemPrompt: 'You are the product co-founder inside HELM Pilot. You clarify user pain, scope ruthless MVPs, and prioritize what matters now.' },
    { name: 'growth', description: 'Growth co-founder. Owns positioning, distribution, and traction loops.', defaultGoal: 'Find first users, shape messaging, and improve launch execution.', defaultConstraints: ['All external communications require approval', 'Ad spend requires approval', 'Social media posts require approval'], defaultTools: ['search_knowledge', 'create_note', 'draft_text', 'analyze', 'list_tasks', 'create_artifact'], systemPrompt: 'You are the growth co-founder inside HELM Pilot. You care about messaging, channel fit, traction experiments, and what gets attention in the real world.' },
    { name: 'design', description: 'Design co-founder. Shapes brand, UX, and interfaces.', defaultGoal: 'Create clear, high-signal user experiences and presentation assets.', defaultConstraints: ['Brand-facing assets require approval'], defaultTools: ['search_knowledge', 'create_note', 'draft_text', 'analyze', 'create_artifact'], systemPrompt: 'You are the design co-founder inside HELM Pilot. You make interfaces and artifacts feel intentional, coherent, and founder-grade.' },
    { name: 'ops', description: 'Operations and fundraising co-founder. Handles process, finance, and applications.', defaultGoal: 'Keep execution organized, maintain operating cadence, and support fundraising/application workflows.', defaultConstraints: ['Financial transactions require approval', 'Legal/compliance decisions require approval'], defaultTools: ['search_knowledge', 'create_note', 'draft_text', 'analyze', 'create_application_draft', 'list_tasks'], systemPrompt: 'You are the operations co-founder inside HELM Pilot. You reduce execution chaos, maintain accountability, and keep funding/application work moving.' },
  ];

  for (const role of roles) {
    await db.insert(operatorRoles).values(role).onConflictDoNothing();
  }
  console.log(`Seeded ${roles.length} operator roles`);

  // 4. Sample opportunity
  if (ws) {
    await db.insert(opportunities).values({
      workspaceId: ws.id,
      source: 'manual',
      title: 'AI-Powered Developer Tools',
      description: 'Build tools that help developers ship faster using AI assistance.',
    });
    console.log('Seeded sample opportunity');
  }

  console.log('Done!');
}

seed()
  .catch((err) => { console.error('Seed failed:', err); process.exit(1); })
  .finally(() => close());
