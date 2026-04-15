import { eq, desc } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { artifacts, artifactVersions, deployments, deployTargets, deployHealth } from '@helm-pilot/db/schema';

export class LaunchEngine {
  constructor(private readonly db: Db) {}

  // ─── Artifacts ───

  async listArtifacts(workspaceId: string) {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.workspaceId, workspaceId))
      .orderBy(desc(artifacts.updatedAt));
  }

  async getArtifact(id: string) {
    const [artifact] = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .limit(1);
    if (!artifact) return null;

    const versions = await this.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, id))
      .orderBy(desc(artifactVersions.version));

    return { ...artifact, versions };
  }

  // ─── Deploy Targets ───

  async listDeployTargets(workspaceId: string) {
    return this.db
      .select()
      .from(deployTargets)
      .where(eq(deployTargets.workspaceId, workspaceId));
  }

  async createDeployTarget(workspaceId: string, input: {
    name: string;
    provider: string;
    config?: Record<string, unknown>;
  }) {
    const [target] = await this.db
      .insert(deployTargets)
      .values({
        workspaceId,
        name: input.name,
        provider: input.provider,
        config: input.config ?? {},
      })
      .returning();
    return target;
  }

  // ─── Deployments ───

  async listDeployments(workspaceId: string) {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.workspaceId, workspaceId))
      .orderBy(desc(deployments.startedAt));
  }

  async recordDeployment(workspaceId: string, input: {
    targetId: string;
    artifactId?: string;
    version?: string;
  }) {
    const [deployment] = await this.db
      .insert(deployments)
      .values({
        workspaceId,
        targetId: input.targetId,
        artifactId: input.artifactId,
        version: input.version,
        status: 'pending',
      })
      .returning();
    return deployment;
  }

  async updateDeploymentStatus(deploymentId: string, status: string, url?: string) {
    const values: Record<string, unknown> = { status };
    if (url) values['url'] = url;
    if (['live', 'failed', 'rolled_back'].includes(status)) {
      values['completedAt'] = new Date();
    }
    const [updated] = await this.db
      .update(deployments)
      .set(values)
      .where(eq(deployments.id, deploymentId))
      .returning();
    return updated;
  }

  // ─── Deploy Health ───

  async recordHealthCheck(deploymentId: string, input: {
    status: string;
    responseTimeMs?: string;
    details?: Record<string, unknown>;
  }) {
    const [check] = await this.db
      .insert(deployHealth)
      .values({
        deploymentId,
        status: input.status,
        responseTimeMs: input.responseTimeMs,
        details: input.details ?? {},
      })
      .returning();
    return check;
  }

  async getLatestHealth(deploymentId: string) {
    const [latest] = await this.db
      .select()
      .from(deployHealth)
      .where(eq(deployHealth.deploymentId, deploymentId))
      .orderBy(desc(deployHealth.checkedAt))
      .limit(1);
    return latest ?? null;
  }
}
