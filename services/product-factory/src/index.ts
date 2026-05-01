import { and, eq, desc } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { plans, milestones, tasks } from '@helm-pilot/db/schema';

export class ProductFactory {
  constructor(private readonly db: Db) {}

  async listPlans(workspaceId: string) {
    return this.db
      .select()
      .from(plans)
      .where(eq(plans.workspaceId, workspaceId))
      .orderBy(desc(plans.createdAt));
  }

  async getPlan(planId: string, workspaceId?: string) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(workspaceId ? and(eq(plans.id, planId), eq(plans.workspaceId, workspaceId)) : eq(plans.id, planId))
      .limit(1);
    if (!plan) return null;

    const ms = await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.planId, planId))
      .orderBy(milestones.sortOrder);

    return { ...plan, milestones: ms };
  }

  async createPlan(workspaceId: string, title: string, description?: string) {
    const [plan] = await this.db
      .insert(plans)
      .values({ workspaceId, title, description })
      .returning();
    return plan;
  }

  async addMilestone(planId: string, title: string, description?: string, workspaceId?: string) {
    if (workspaceId) {
      const [plan] = await this.db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.workspaceId, workspaceId)))
        .limit(1);
      if (!plan) return null;
    }

    const existing = await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.planId, planId));

    const [ms] = await this.db
      .insert(milestones)
      .values({ planId, title, description, sortOrder: existing.length })
      .returning();
    return ms;
  }

  async getWorkspaceSummary(workspaceId: string) {
    const planList = await this.db
      .select()
      .from(plans)
      .where(eq(plans.workspaceId, workspaceId));

    const taskList = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId));

    return {
      totalPlans: planList.length,
      activePlans: planList.filter((p) => p.status === 'active').length,
      totalTasks: taskList.length,
      completedTasks: taskList.filter((t) => t.status === 'completed').length,
      runningTasks: taskList.filter((t) => t.status === 'running').length,
    };
  }
}
