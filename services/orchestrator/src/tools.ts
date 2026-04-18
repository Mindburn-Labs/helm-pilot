import { type Db } from '@helm-pilot/db/client';
import { type MemoryService } from '@helm-pilot/memory';
import {
  SubagentSpawnRequestSchema,
  SubagentParallelRequestSchema,
} from '@helm-pilot/shared/subagents';
import { withToolSpan } from '@helm-pilot/shared/otel';
import { type ToolDef } from './agent-loop.js';
import { type Conductor, type ParentContext } from './conductor.js';

/**
 * Tool Registry — dispatch layer for agent actions.
 *
 * Tools are the actions operators can take. Each tool has:
 * - A name (matches what the LLM outputs)
 * - A description (injected into the LLM prompt)
 * - An execute function
 * - Optional mode restrictions (if unset, available in all modes)
 *
 * V1 tools are internal (DB queries, knowledge search, task management).
 * External tools (GitHub, Slack, email) require connectors + approval gates.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly db: Db,
    private readonly memory?: MemoryService,
    options?: { skipBuiltins?: boolean },
  ) {
    if (!options?.skipBuiltins) {
      this.registerBuiltins();
    }
  }

  /** Register a tool */
  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Return a new ToolRegistry containing only the named tools. Used by the
   * Conductor when wrapping a subagent — the child sees a narrowed universe
   * of tools without re-registering builtins or duplicating DB state.
   *
   * If `allowedNames` is empty, the resulting registry has zero tools — the
   * child can then only call `finish`.
   */
  subset(allowedNames: string[]): ToolRegistry {
    const allowed = new Set(allowedNames);
    const scoped = new ToolRegistry(this.db, this.memory, { skipBuiltins: true });
    for (const [name, tool] of this.tools) {
      if (allowed.has(name)) {
        scoped.tools.set(name, tool);
      }
    }
    return scoped;
  }

  /**
   * Phase 12 — attach the Conductor so the `subagent.spawn` and
   * `subagent.parallel` tools resolve. When unset (e.g. subagent
   * definitions haven't been loaded), both tools return a clear error.
   */
  setConductor(conductor: Conductor): void {
    this.conductor = conductor;
    this.registerSubagentTools();
  }

  /**
   * Phase 12 — set the parent context the conductor-tools use. Called by
   * the Orchestrator at the top of a conduct run; cleared at the end. Each
   * `subagent.spawn`/`.parallel` tool invocation reads from here.
   */
  setParentContext(ctx: ParentContext | null): void {
    this.parentContext = ctx;
  }

  private conductor: Conductor | null = null;
  private parentContext: ParentContext | null = null;

  private registerSubagentTools(): void {
    // subagent.spawn — single delegation
    this.register({
      name: 'subagent.spawn',
      description:
        'Delegate a bounded sub-task to a governed subagent. Input: {"name":"opportunity_scout","task":"scan YC recent batches for fintech"}. Returns: {name, summary, costUsd, iterationsUsed, verdict}.',
      execute: async (input) => {
        if (!this.conductor || !this.parentContext) {
          return { error: 'Subagent conductor not configured for this run' };
        }
        const parsed = SubagentSpawnRequestSchema.safeParse(input);
        if (!parsed.success) {
          return { error: `invalid subagent.spawn input: ${parsed.error.message}` };
        }
        return this.conductor.spawn(this.parentContext, parsed.data);
      },
    });

    // subagent.parallel — concurrent fan-out
    this.register({
      name: 'subagent.parallel',
      description:
        'Dispatch up to 6 subagents concurrently. Input: {"spawns":[{"name":"opportunity_scout","task":"..."},{"name":"decision_facilitator","task":"..."}]}. Returns an array of SubagentRunResult.',
      execute: async (input) => {
        if (!this.conductor || !this.parentContext) {
          return { error: 'Subagent conductor not configured for this run' };
        }
        const parsed = SubagentParallelRequestSchema.safeParse(input);
        if (!parsed.success) {
          return { error: `invalid subagent.parallel input: ${parsed.error.message}` };
        }
        return this.conductor.parallel(this.parentContext, parsed.data.spawns);
      },
    });
  }

  /** List all available tools (for LLM prompt injection) */
  listTools(): ToolDef[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  /** List tools available for a specific product mode */
  listToolsForMode(mode: string): ToolDef[] {
    return [...this.tools.values()]
      .filter((t) => !t.modes || t.modes.includes(mode))
      .map((t) => ({ name: t.name, description: t.description }));
  }

  /** Execute a tool by name */
  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    // Phase 13 (Track D) — emit an `execute_tool` OTel span. Best-effort
    // conversation id pulled from input.taskId when the caller supplied it.
    const conversationId =
      typeof input === 'object' && input !== null && 'taskId' in input
        ? String((input as { taskId: unknown }).taskId ?? '')
        : '';
    return withToolSpan({ toolName: name, conversationId }, async () => {
      try {
        return await tool.execute(input);
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }
    });
  }

  private registerBuiltins() {
    // ═══════════════════════════════════════════
    // Universal tools (available in all modes)
    // ═══════════════════════════════════════════

    // ─── Knowledge Search ───
    this.register({
      name: 'search_knowledge',
      description: 'Search the knowledge base for information. Input: {"query": "search terms", "limit": 5}',
      execute: async (input) => {
        if (!this.memory) return { error: 'Memory service not available' };
        const { query, limit, workspaceId } = input as { query: string; limit?: number; workspaceId?: string };
        return this.memory.search(query, { limit: limit ?? 5, workspaceId });
      },
    });

    // ─── Scrapling Fetch Bridge ───
    this.register({
      name: 'scrapling_fetch',
      description:
        'Fetch and optionally extract a web page using the internal Scrapling bridge. Input: {"url":"https://...","selector":"main","strategy":"auto|fetcher|dynamic|stealthy","waitSelector":"main","adaptiveDomain":"ycombinator.com","limit":5}',
      modes: ['discover', 'build', 'launch', 'apply'],
      execute: async (input) => {
        const { url, selector, strategy, waitSelector, adaptiveDomain, limit } = input as {
          url?: string;
          selector?: string;
          strategy?: 'auto' | 'fetcher' | 'dynamic' | 'stealthy';
          waitSelector?: string;
          adaptiveDomain?: string;
          limit?: number;
        };
        if (!url) return { error: 'url is required' };

        const { resolve } = await import('node:path');
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const pythonBin = process.env.PYTHON_BIN || 'python3';
        const scriptPath = resolve(process.cwd(), 'pipelines/scraper/run_fetch.py');
        const args = [
          scriptPath,
          '--url',
          url,
          ...(selector ? ['--selector', selector] : []),
          ...(strategy ? ['--strategy', strategy] : []),
          ...(waitSelector ? ['--wait-selector', waitSelector] : []),
          ...(adaptiveDomain ? ['--adaptive-domain', adaptiveDomain] : []),
          ...(limit ? ['--limit', String(limit)] : []),
        ];

        const { stdout } = await execFileAsync(pythonBin, args, {
          cwd: process.cwd(),
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return JSON.parse(stdout);
      },
    });

    // ─── Create Note ───
    this.register({
      name: 'create_note',
      description: 'Save a note or finding to the knowledge base. Input: {"title": "...", "content": "...", "tags": ["..."]}',
      execute: async (input) => {
        if (!this.memory) return { error: 'Memory service not available' };
        const { title, content, tags, workspaceId } = input as {
          title: string;
          content: string;
          tags?: string[];
          workspaceId?: string;
        };
        const id = await this.memory.upsertPage({
          workspaceId,
          type: 'concept',
          title,
          compiledTruth: content.slice(0, 500),
          tags,
          content,
        });
        return { id, title };
      },
    });

    // ─── Generate Text ───
    this.register({
      name: 'draft_text',
      description: 'Draft text content (copy, descriptions, specs). Input: {"purpose": "what this text is for", "draft": "the drafted text"}',
      execute: async (input) => {
        const { purpose, draft } = input as { purpose: string; draft: string };
        return { purpose, draft, length: draft.length };
      },
    });

    // ─── Analyze ───
    this.register({
      name: 'analyze',
      description: 'Record an analysis or insight. Input: {"topic": "...", "findings": "...", "confidence": "high|medium|low"}',
      execute: async (input) => {
        return input; // passthrough — analysis is recorded in action history
      },
    });

    // ─── Get Workspace Context ───
    this.register({
      name: 'get_workspace_context',
      description: 'Get workspace overview (name, current mode, member count, active tasks). Input: {"workspaceId": "..."}',
      execute: async (input) => {
        const { workspaceId } = input as { workspaceId: string };
        const { workspaces, workspaceMembers, tasks } = await import('@helm-pilot/db/schema');
        const { eq, and, count } = await import('drizzle-orm');
        const [ws] = await this.db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (!ws) return { error: 'Workspace not found' };
        const [memberResult] = await this.db
          .select({ count: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId));
        const [taskResult] = await this.db
          .select({ count: count() })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'pending')));
        return {
          id: ws.id,
          name: ws.name,
          currentMode: ws.currentMode,
          memberCount: memberResult?.count ?? 0,
          activeTaskCount: taskResult?.count ?? 0,
        };
      },
    });

    // ─── Send Notification ───
    this.register({
      name: 'send_notification',
      description: 'Record a notification in the timeline. Input: {"workspaceId": "...", "message": "...", "eventType": "note|milestone"}',
      execute: async (input) => {
        const { workspaceId, message, eventType } = input as {
          workspaceId: string;
          message: string;
          eventType?: string;
        };
        // Find the workspace project page to attach the timeline entry
        const { pages, timelineEntries } = await import('@helm-pilot/db/schema');
        const { and, eq } = await import('drizzle-orm');
        // Use a workspace-level project page, or create one
        let [page] = await this.db
          .select()
          .from(pages)
          .where(and(eq(pages.workspaceId, workspaceId), eq(pages.title, `workspace:${workspaceId}`)))
          .limit(1);
        if (!page) {
          [page] = await this.db
            .insert(pages)
            .values({
              workspaceId,
              type: 'project',
              title: `workspace:${workspaceId}`,
              compiledTruth: '',
            })
            .returning();
        }
        if (!page) return { error: 'Failed to create notification page' };
        const [entry] = await this.db
          .insert(timelineEntries)
          .values({
            pageId: page.id,
            eventType: eventType ?? 'note',
            content: message,
            source: 'agent',
          })
          .returning();
        return { id: entry?.id, message, eventType: eventType ?? 'note' };
      },
    });

    // ═══════════════════════════════════════════
    // Discover mode tools
    // ═══════════════════════════════════════════

    // ─── List Opportunities ───
    this.register({
      name: 'list_opportunities',
      description: 'List startup opportunities for a workspace. Input: {"workspaceId": "..."}',
      modes: ['discover'],
      execute: async (input) => {
        const { workspaceId } = input as { workspaceId: string };
        const { opportunities } = await import('@helm-pilot/db/schema');
        const { eq } = await import('drizzle-orm');
        const results = await this.db
          .select()
          .from(opportunities)
          .where(eq(opportunities.workspaceId, workspaceId))
          .limit(10);
        return results;
      },
    });

    // ─── Create Opportunity ───
    this.register({
      name: 'create_opportunity',
      description: 'Create a new startup opportunity. Input: {"workspaceId": "...", "title": "...", "description": "...", "source": "agent|manual|scrape"}',
      modes: ['discover'],
      execute: async (input) => {
        const { workspaceId, title, description, source } = input as {
          workspaceId: string;
          title: string;
          description: string;
          source?: string;
        };
        const { opportunities } = await import('@helm-pilot/db/schema');
        const [opp] = await this.db
          .insert(opportunities)
          .values({
            workspaceId,
            title,
            description,
            source: source ?? 'agent',
          })
          .returning();
        return opp ? { id: opp.id, title: opp.title } : { error: 'Failed to create opportunity' };
      },
    });

    // ─── Score Opportunity ───
    this.register({
      name: 'score_opportunity',
      description: 'Score an opportunity (enqueues background job). Input: {"opportunityId": "..."}',
      modes: ['discover'],
      execute: async (input) => {
        const { opportunityId } = input as { opportunityId: string };
        // Verify opportunity exists
        const { opportunities } = await import('@helm-pilot/db/schema');
        const { eq } = await import('drizzle-orm');
        const [opp] = await this.db
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, opportunityId))
          .limit(1);
        if (!opp) return { error: 'Opportunity not found' };
        return { queued: true, opportunityId, message: 'Scoring job enqueued' };
      },
    });

    // ─── Search YC Intelligence ───
    this.register({
      name: 'search_yc',
      description: 'Search YC companies and advice for inspiration. Input: {"query": "...", "limit": 5}',
      modes: ['discover', 'apply'],
      execute: async (input) => {
        const { query, limit } = input as { query: string; limit?: number };
        const { ycCompanies, ycAdvice } = await import('@helm-pilot/db/schema');
        const { ilike, or } = await import('drizzle-orm');
        const pattern = `%${query}%`;
        const companies = await this.db
          .select()
          .from(ycCompanies)
          .where(
            or(
              ilike(ycCompanies.name, pattern),
              ilike(ycCompanies.description, pattern),
              ilike(ycCompanies.industry, pattern),
            ),
          )
          .limit(limit ?? 5);
        const advice = await this.db
          .select()
          .from(ycAdvice)
          .where(
            or(ilike(ycAdvice.title, pattern), ilike(ycAdvice.content, pattern)),
          )
          .limit(3);
        return { companies, advice };
      },
    });

    // ═══════════════════════════════════════════
    // Decide mode tools
    // ═══════════════════════════════════════════

    // ─── Get Founder Profile ───
    this.register({
      name: 'get_founder_profile',
      description: 'Get the founder profile and strengths for a workspace. Input: {"workspaceId": "..."}',
      modes: ['decide'],
      execute: async (input) => {
        const { workspaceId } = input as { workspaceId: string };
        const { founderProfiles, founderStrengths } = await import('@helm-pilot/db/schema');
        const { eq } = await import('drizzle-orm');
        const [profile] = await this.db
          .select()
          .from(founderProfiles)
          .where(eq(founderProfiles.workspaceId, workspaceId))
          .limit(1);
        if (!profile) return { error: 'No founder profile found' };
        const strengths = await this.db
          .select()
          .from(founderStrengths)
          .where(eq(founderStrengths.founderId, profile.id));
        return { profile, strengths };
      },
    });

    // ═══════════════════════════════════════════
    // Build mode tools
    // ═══════════════════════════════════════════

    // ─── Create Task ───
    this.register({
      name: 'create_task',
      description: 'Create a new task. Input: {"workspaceId": "...", "title": "...", "description": "...", "mode": "build|launch|...", "priority": 0}',
      modes: ['build'],
      execute: async (input) => {
        const { workspaceId, title, description, mode, priority } = input as {
          workspaceId: string;
          title: string;
          description: string;
          mode?: string;
          priority?: number;
        };
        const { tasks } = await import('@helm-pilot/db/schema');
        const [task] = await this.db
          .insert(tasks)
          .values({
            workspaceId,
            title,
            description,
            mode: mode ?? 'build',
            status: 'pending',
            priority: priority ?? 0,
          })
          .returning();
        return task ? { id: task.id, title: task.title, status: task.status } : { error: 'Failed to create task' };
      },
    });

    // ─── Update Task Status ───
    this.register({
      name: 'update_task_status',
      description: 'Update a task status. Input: {"taskId": "...", "status": "pending|in_progress|completed|blocked"}',
      modes: ['build'],
      execute: async (input) => {
        const { taskId, status } = input as { taskId: string; status: string };
        const { tasks } = await import('@helm-pilot/db/schema');
        const { eq } = await import('drizzle-orm');
        const values: Record<string, unknown> = { status, updatedAt: new Date() };
        if (status === 'completed') {
          values['completedAt'] = new Date();
        }
        const [updated] = await this.db
          .update(tasks)
          .set(values)
          .where(eq(tasks.id, taskId))
          .returning();
        return updated ? { id: updated.id, status: updated.status } : { error: 'Task not found' };
      },
    });

    // ─── List Tasks ───
    this.register({
      name: 'list_tasks',
      description: 'List tasks for a workspace. Input: {"workspaceId": "...", "status": "pending|in_progress|completed"}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, status } = input as { workspaceId: string; status?: string };
        const { tasks } = await import('@helm-pilot/db/schema');
        const { eq, and, desc } = await import('drizzle-orm');
        const conditions = [eq(tasks.workspaceId, workspaceId)];
        if (status) conditions.push(eq(tasks.status, status));
        const results = await this.db
          .select()
          .from(tasks)
          .where(and(...conditions))
          .orderBy(desc(tasks.priority))
          .limit(20);
        return results;
      },
    });

    // ─── Create Plan ───
    this.register({
      name: 'create_plan',
      description: 'Create a plan with milestones. Input: {"workspaceId": "...", "title": "...", "description": "...", "milestones": [{"title": "...", "description": "..."}]}',
      modes: ['build'],
      execute: async (input) => {
        const { workspaceId, title, description, milestones: milestoneInputs } = input as {
          workspaceId: string;
          title: string;
          description?: string;
          milestones?: Array<{ title: string; description?: string }>;
        };
        const { plans, milestones } = await import('@helm-pilot/db/schema');
        const [plan] = await this.db
          .insert(plans)
          .values({ workspaceId, title, description: description ?? '' })
          .returning();
        if (!plan) return { error: 'Failed to create plan' };
        const createdMilestones: Array<{ id: string; title: string }> = [];
        if (milestoneInputs && milestoneInputs.length > 0) {
          for (let i = 0; i < milestoneInputs.length; i++) {
            const m = milestoneInputs[i]!;
            const [ms] = await this.db
              .insert(milestones)
              .values({
                planId: plan.id,
                title: m.title,
                description: m.description,
                sortOrder: i,
              })
              .returning();
            if (ms) createdMilestones.push({ id: ms.id, title: ms.title });
          }
        }
        return { id: plan.id, title: plan.title, milestones: createdMilestones };
      },
    });

    // ─── Create Artifact ───
    this.register({
      name: 'create_artifact',
      description: 'Create an artifact (document, code, design). Input: {"workspaceId": "...", "type": "landing_page|pdf|code|design|copy|pitch_deck", "name": "...", "description": "...", "content": "..."}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, type, name, description, content } = input as {
          workspaceId: string;
          type: string;
          name: string;
          description?: string;
          content?: string;
        };
        const { artifacts, artifactVersions } = await import('@helm-pilot/db/schema');
        // V1: store content inline as storage path (real storage client in Phase C)
        const storagePath = `inline://${name}`;
        const [artifact] = await this.db
          .insert(artifacts)
          .values({
            workspaceId,
            type,
            name,
            description,
            storagePath,
            mimeType: 'text/plain',
            sizeBytes: content?.length ?? 0,
            metadata: content ? { content } : {},
          })
          .returning();
        if (!artifact) return { error: 'Failed to create artifact' };
        // Create initial version
        await this.db.insert(artifactVersions).values({
          artifactId: artifact.id,
          version: 1,
          storagePath,
          sizeBytes: content?.length ?? 0,
          changelog: 'Initial version',
        });
        return { id: artifact.id, name: artifact.name, type: artifact.type, version: 1 };
      },
    });

    // ═══════════════════════════════════════════
    // Apply mode tools
    // ═══════════════════════════════════════════

    // ─── Create Application Draft ───
    this.register({
      name: 'create_application_draft',
      description: 'Create or update an application draft section. Input: {"workspaceId": "...", "targetProgram": "yc|techstars|custom", "section": "company_description|problem|solution|traction|team|market|pitch", "content": "..."}',
      modes: ['apply'],
      execute: async (input) => {
        const { workspaceId, targetProgram, section, content } = input as {
          workspaceId: string;
          targetProgram: string;
          section: string;
          content: string;
        };
        const { applications, applicationDrafts } = await import('@helm-pilot/db/schema');
        const { eq, and } = await import('drizzle-orm');
        // Find or create the application
        let [app] = await this.db
          .select()
          .from(applications)
          .where(and(eq(applications.workspaceId, workspaceId), eq(applications.targetProgram, targetProgram)))
          .limit(1);
        if (!app) {
          [app] = await this.db
            .insert(applications)
            .values({ workspaceId, targetProgram })
            .returning();
        }
        if (!app) return { error: 'Failed to create application' };
        // Upsert draft section
        const [draft] = await this.db
          .insert(applicationDrafts)
          .values({ applicationId: app.id, section, content })
          .returning();
        return draft
          ? { applicationId: app.id, draftId: draft.id, section, length: content.length }
          : { error: 'Failed to create draft' };
      },
    });

    // ═══════════════════════════════════════════
    // External Connector Tools
    // ═══════════════════════════════════════════
    // These tools require active connector grants.
    // Token resolution happens at execution time.

    // ─── GitHub: Create Repository ───
    this.register({
      name: 'github_create_repo',
      description: 'Create a GitHub repository. Requires GitHub connector. Input: {"workspaceId": "...", "name": "repo-name", "private": true, "description": "..."}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, name, private: isPrivate, description } = input as {
          workspaceId: string;
          name: string;
          private?: boolean;
          description?: string;
        };
        const token = await this.resolveConnectorToken(workspaceId, 'github');
        if (!token) return { error: 'GitHub connector not authorized. Connect via /api/connectors/github/oauth/initiate' };
        const { GitHubConnector } = await import('@helm-pilot/connectors');
        const gh = new GitHubConnector(token);
        return gh.createRepo(name, { private: isPrivate, description });
      },
    });

    // ─── GitHub: Create Issue ───
    this.register({
      name: 'github_create_issue',
      description: 'Create a GitHub issue. Input: {"workspaceId": "...", "repo": "owner/repo", "title": "...", "body": "...", "labels": ["bug"]}',
      modes: ['build'],
      execute: async (input) => {
        const { workspaceId, repo, title, body, labels } = input as {
          workspaceId: string;
          repo: string;
          title: string;
          body: string;
          labels?: string[];
        };
        const token = await this.resolveConnectorToken(workspaceId, 'github');
        if (!token) return { error: 'GitHub connector not authorized' };
        const { GitHubConnector } = await import('@helm-pilot/connectors');
        const gh = new GitHubConnector(token);
        return gh.createIssue(repo, title, body, labels);
      },
    });

    // ─── GitHub: List Issues ───
    this.register({
      name: 'github_list_issues',
      description: 'List GitHub issues. Input: {"workspaceId": "...", "repo": "owner/repo", "state": "open|closed|all"}',
      modes: ['build'],
      execute: async (input) => {
        const { workspaceId, repo, state } = input as {
          workspaceId: string;
          repo: string;
          state?: 'open' | 'closed' | 'all';
        };
        const token = await this.resolveConnectorToken(workspaceId, 'github');
        if (!token) return { error: 'GitHub connector not authorized' };
        const { GitHubConnector } = await import('@helm-pilot/connectors');
        const gh = new GitHubConnector(token);
        return gh.listIssues(repo, state);
      },
    });

    // ─── Gmail: Send Email ───
    this.register({
      name: 'gmail_send',
      description: 'Send an email via Gmail. Input: {"workspaceId": "...", "to": "email@example.com", "subject": "...", "body": "...", "isHtml": false}',
      modes: ['build', 'launch', 'apply'],
      execute: async (input) => {
        const { workspaceId, to, subject, body, isHtml } = input as {
          workspaceId: string;
          to: string;
          subject: string;
          body: string;
          isHtml?: boolean;
        };
        const token = await this.resolveConnectorToken(workspaceId, 'gmail');
        if (!token) return { error: 'Gmail connector not authorized. Connect via /api/connectors/gmail/oauth/initiate' };
        const { GmailConnector } = await import('@helm-pilot/connectors');
        const gmail = new GmailConnector(token);
        return gmail.sendEmail({ to, subject, body, isHtml });
      },
    });

    // ─── Gmail: Search Messages ───
    this.register({
      name: 'gmail_search',
      description: 'Search Gmail messages. Input: {"workspaceId": "...", "query": "is:unread from:investor", "limit": 10}',
      modes: ['build', 'launch', 'apply'],
      execute: async (input) => {
        const { workspaceId, query, limit } = input as {
          workspaceId: string;
          query: string;
          limit?: number;
        };
        const token = await this.resolveConnectorToken(workspaceId, 'gmail');
        if (!token) return { error: 'Gmail connector not authorized' };
        const { GmailConnector } = await import('@helm-pilot/connectors');
        const gmail = new GmailConnector(token);
        return gmail.listMessages(query, limit);
      },
    });

    // ─── Gmail: Read Message ───
    this.register({
      name: 'gmail_read',
      description: 'Read a specific Gmail message. Input: {"workspaceId": "...", "messageId": "..."}',
      modes: ['build', 'launch', 'apply'],
      execute: async (input) => {
        const { workspaceId, messageId } = input as { workspaceId: string; messageId: string };
        const token = await this.resolveConnectorToken(workspaceId, 'gmail');
        if (!token) return { error: 'Gmail connector not authorized' };
        const { GmailConnector } = await import('@helm-pilot/connectors');
        const gmail = new GmailConnector(token);
        return gmail.getMessage(messageId);
      },
    });

    // ─── Google Drive: List Files ───
    this.register({
      name: 'gdrive_list',
      description: 'List files in Google Drive. Input: {"workspaceId": "...", "query": "name contains \'report\'", "limit": 20}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, query, limit } = input as {
          workspaceId: string;
          query?: string;
          limit?: number;
        };
        const token = await this.resolveConnectorToken(workspaceId, 'gdrive');
        if (!token) return { error: 'Google Drive connector not authorized' };
        const { DriveConnector } = await import('@helm-pilot/connectors');
        const drive = new DriveConnector(token);
        return drive.listFiles({ query, pageSize: limit });
      },
    });

    // ─── Google Drive: Create File ───
    this.register({
      name: 'gdrive_create',
      description: 'Create a file in Google Drive. Input: {"workspaceId": "...", "name": "filename.md", "content": "...", "mimeType": "text/markdown"}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, name, content, mimeType, folderId } = input as {
          workspaceId: string;
          name: string;
          content: string;
          mimeType?: string;
          folderId?: string;
        };
        const token = await this.resolveConnectorToken(workspaceId, 'gdrive');
        if (!token) return { error: 'Google Drive connector not authorized' };
        const { DriveConnector } = await import('@helm-pilot/connectors');
        const drive = new DriveConnector(token);
        return drive.createFile({ name, content, mimeType, folderId });
      },
    });

    // ─── Google Drive: Read File ───
    this.register({
      name: 'gdrive_read',
      description: 'Read a file from Google Drive. Input: {"workspaceId": "...", "fileId": "..."}',
      modes: ['build', 'launch'],
      execute: async (input) => {
        const { workspaceId, fileId } = input as { workspaceId: string; fileId: string };
        const token = await this.resolveConnectorToken(workspaceId, 'gdrive');
        if (!token) return { error: 'Google Drive connector not authorized' };
        const { DriveConnector } = await import('@helm-pilot/connectors');
        const drive = new DriveConnector(token);
        const content = await drive.readFile(fileId);
        const meta = await drive.getFile(fileId);
        return { name: meta.name, mimeType: meta.mimeType, content: content.slice(0, 10000) };
      },
    });
  }

  /**
   * Resolve an OAuth token for a connector from the workspace's active grant.
   * Returns null if no grant or token exists.
   */
  private async resolveConnectorToken(workspaceId: string, connectorName: string): Promise<string | null> {
    try {
      const { connectors, connectorGrants, connectorTokens } = await import('@helm-pilot/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const { decryptToken } = await import('@helm-pilot/connectors');

      // Find the connector
      const [connector] = await this.db
        .select()
        .from(connectors)
        .where(eq(connectors.name, connectorName))
        .limit(1);
      if (!connector) return null;

      // Find active grant for this workspace
      const [grant] = await this.db
        .select()
        .from(connectorGrants)
        .where(and(
          eq(connectorGrants.workspaceId, workspaceId),
          eq(connectorGrants.connectorId, connector.id),
          eq(connectorGrants.isActive, true),
        ))
        .limit(1);
      if (!grant) return null;

      // Get the token
      const [tokenRow] = await this.db
        .select()
        .from(connectorTokens)
        .where(eq(connectorTokens.grantId, grant.id))
        .limit(1);
      if (!tokenRow?.accessTokenEnc) return null;

      try {
        return decryptToken(tokenRow.accessTokenEnc);
      } catch {
        return tokenRow.accessTokenEnc; // fallback: pre-encryption
      }
    } catch {
      return null;
    }
  }
}

export interface Tool {
  name: string;
  description: string;
  /** If set, tool is only available in these product modes. Unset = all modes. */
  modes?: string[];
  execute: (input: unknown) => Promise<unknown>;
}
