import { AsyncLocalStorage } from 'node:async_hooks';
import { type Context, type Next } from 'hono';

/**
 * Workspace-scoped request context.
 *
 * Populated by `requireWorkspace()` at the top of every workspace-scoped route
 * branch. Every downstream DB helper that operates on tenant-scoped tables
 * should read the workspaceId from here rather than accept it as a free
 * parameter — that way "forgot to pass it" becomes a compile-time or
 * lint-level error instead of a silent cross-tenant leak.
 */
export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  /** Timestamp the context was opened — used by the audit log. */
  openedAt: Date;
}

const workspaceStore = new AsyncLocalStorage<WorkspaceContext>();

/**
 * Gate workspace-scoped routes. Builds on `requireAuth` (which populates
 * c.get('workspaceId') + c.get('userId') from the session / API key).
 *
 *   requireAuth    → authenticates the caller + sets optional workspace
 *   requireWorkspace → *mandates* a workspace and exposes it to deep callers
 *
 * Returns 401 if the caller isn't authenticated, 400 if no workspace is
 * attached to the request. On success wraps the downstream handler in an
 * AsyncLocalStorage frame so any depth of async work can call
 * `currentWorkspace()` / `currentWorkspaceId()` without threading the id.
 */
export function requireWorkspace() {
  return async (c: Context, next: Next) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ error: 'authentication required' }, 401);
    if (!workspaceId) return c.json({ error: 'workspace context required' }, 400);

    const ctx: WorkspaceContext = { workspaceId, userId, openedAt: new Date() };
    return workspaceStore.run(ctx, () => next());
  };
}

/**
 * Read the current workspace context. Throws when called outside a
 * `requireWorkspace()`-scoped frame — this is intentional, since any code
 * path that can reach a tenant-scoped DB helper MUST be downstream of one.
 */
export function currentWorkspace(): WorkspaceContext {
  const ctx = workspaceStore.getStore();
  if (!ctx) {
    throw new Error(
      'currentWorkspace() called outside a requireWorkspace() scope — ' +
        'every tenant-scoped DB call must run inside an authenticated workspace frame.',
    );
  }
  return ctx;
}

/** Shorthand for `currentWorkspace().workspaceId`. */
export function currentWorkspaceId(): string {
  return currentWorkspace().workspaceId;
}

/**
 * Soft-read the current workspace context. Returns null when not in one —
 * useful for code paths that can be invoked both from workspace-scoped routes
 * and platform-admin tools (the latter must branch on the null case).
 */
export function tryCurrentWorkspace(): WorkspaceContext | null {
  return workspaceStore.getStore() ?? null;
}

/**
 * Run a callback inside a synthetic workspace frame. Used by background job
 * handlers (pg-boss) and scheduled tasks that operate on a specific tenant
 * but aren't triggered through the HTTP surface.
 *
 * NEVER export this from the gateway — it's a back-door and should stay
 * confined to orchestrator job handlers that can trust the workspaceId they
 * dequeued from the job payload.
 */
export function runWithWorkspace<T>(ctx: WorkspaceContext, fn: () => Promise<T>): Promise<T> {
  return workspaceStore.run(ctx, fn);
}
