import { and, eq, desc } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import {
  artifacts,
  artifactVersions,
  deployments,
  deployTargets,
  deployHealth,
} from '@helm-pilot/db/schema';
import type {
  DeployProvider,
  DeployResult,
  HealthCheckResult,
  ProvisionResult,
  RollbackResult,
} from './providers/types.js';

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

  async getArtifact(id: string, workspaceId?: string) {
    const [artifact] = await this.db
      .select()
      .from(artifacts)
      .where(
        workspaceId
          ? and(eq(artifacts.id, id), eq(artifacts.workspaceId, workspaceId))
          : eq(artifacts.id, id),
      )
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
    return this.db.select().from(deployTargets).where(eq(deployTargets.workspaceId, workspaceId));
  }

  async getDeployTarget(id: string, workspaceId?: string) {
    const [target] = await this.db
      .select()
      .from(deployTargets)
      .where(
        workspaceId
          ? and(eq(deployTargets.id, id), eq(deployTargets.workspaceId, workspaceId))
          : eq(deployTargets.id, id),
      )
      .limit(1);
    return target ?? null;
  }

  async createDeployTarget(
    workspaceId: string,
    input: {
      name: string;
      provider: string;
      config?: Record<string, unknown>;
    },
  ) {
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

  async updateDeployTargetConfig(targetId: string, config: Record<string, unknown>) {
    const [target] = await this.db
      .update(deployTargets)
      .set({ config, updatedAt: new Date() })
      .where(eq(deployTargets.id, targetId))
      .returning();
    return target ?? null;
  }

  // ─── Deployments ───

  async listDeployments(workspaceId: string) {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.workspaceId, workspaceId))
      .orderBy(desc(deployments.startedAt));
  }

  async getDeployment(id: string, workspaceId?: string) {
    const [deployment] = await this.db
      .select()
      .from(deployments)
      .where(
        workspaceId
          ? and(eq(deployments.id, id), eq(deployments.workspaceId, workspaceId))
          : eq(deployments.id, id),
      )
      .limit(1);
    return deployment ?? null;
  }

  async recordDeployment(
    workspaceId: string,
    input: {
      targetId: string;
      artifactId?: string;
      version?: string;
    },
  ) {
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
    if (!deployment) throw new Error('failed to create deployment record');
    return deployment;
  }

  async updateDeploymentStatus(
    deploymentId: string,
    status: string,
    url?: string,
    metadata?: Record<string, unknown>,
    workspaceId?: string,
  ) {
    const values: Record<string, unknown> = { status };
    if (url) values['url'] = url;
    if (metadata) values['metadata'] = metadata;
    if (['live', 'failed', 'rolled_back'].includes(status)) {
      values['completedAt'] = new Date();
    }
    const [updated] = await this.db
      .update(deployments)
      .set(values)
      .where(
        workspaceId
          ? and(eq(deployments.id, deploymentId), eq(deployments.workspaceId, workspaceId))
          : eq(deployments.id, deploymentId),
      )
      .returning();
    return updated ?? null;
  }

  async deployToTarget(
    workspaceId: string,
    input: {
      targetId: string;
      artifactId?: string;
      version?: string;
      image?: string;
      appName?: string;
      region?: string;
      envVars?: Record<string, string>;
    },
    provider: DeployProvider,
  ): Promise<{
    deployment: typeof deployments.$inferSelect;
    provision?: ProvisionResult;
    providerDeployment: DeployResult;
  }> {
    const target = await this.getDeployTarget(input.targetId, workspaceId);
    if (!target) {
      throw new Error('deploy target not found for workspace');
    }
    if (target.provider !== provider.name) {
      throw new Error(
        `deploy target provider ${target.provider} cannot be handled by ${provider.name}`,
      );
    }

    const config = asRecord(target.config) ?? {};
    const image = input.image ?? stringValue(config['image']);
    if (!image) {
      throw new Error('image is required on the deployment request or deploy target config');
    }

    const deployment = await this.recordDeployment(workspaceId, {
      targetId: input.targetId,
      artifactId: input.artifactId,
      version: input.version,
    });

    let providerId = stringValue(config['providerId']);
    let provision: ProvisionResult | undefined;
    if (!providerId) {
      provision = await provider.provision({
        appName:
          input.appName ??
          stringValue(config['appName']) ??
          `helm-pilot-${workspaceId.slice(0, 8)}`,
        region: input.region ?? stringValue(config['region']) ?? 'nyc3',
        config,
      });
      providerId = provision.providerId;
      await this.updateDeployTargetConfig(input.targetId, {
        ...config,
        providerId,
        appName: provision.appName,
        region: provision.region,
        dashboardUrl: provision.dashboardUrl,
      });
    }

    await this.updateDeploymentStatus(
      deployment.id,
      'deploying',
      undefined,
      undefined,
      workspaceId,
    );
    const providerDeployment = await provider.deploy({
      providerId,
      image,
      tag: input.version ?? 'latest',
      envVars: input.envVars ?? stringRecord(config['envVars']),
    });

    const metadata = {
      ...(asRecord(deployment.metadata) ?? {}),
      provider: provider.name,
      providerId,
      providerDeploymentId: providerDeployment.deploymentId,
      providerStatus: providerDeployment.status,
      provision,
    };
    const updated = await this.updateDeploymentStatus(
      deployment.id,
      providerDeployment.status,
      providerDeployment.url,
      metadata,
      workspaceId,
    );
    if (!updated) throw new Error('deployment disappeared during provider deploy');
    return { deployment: updated, provision, providerDeployment };
  }

  // ─── Deploy Health ───

  async recordHealthCheck(
    deploymentId: string,
    input: {
      status: string;
      responseTimeMs?: string;
      details?: Record<string, unknown>;
    },
  ) {
    const [check] = await this.db
      .insert(deployHealth)
      .values({
        deploymentId,
        status: input.status,
        responseTimeMs: input.responseTimeMs,
        details: input.details ?? {},
      })
      .returning();
    if (!check) throw new Error('failed to record deploy health check');
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

  async runDeploymentHealthCheck(
    deploymentId: string,
    provider: DeployProvider,
    workspaceId?: string,
  ): Promise<{
    check: typeof deployHealth.$inferSelect;
    result: HealthCheckResult;
  }> {
    const deployment = await this.getDeployment(deploymentId, workspaceId);
    if (!deployment) throw new Error('deployment not found');
    const metadata = asRecord(deployment.metadata) ?? {};
    const providerId = stringValue(metadata['providerId']);
    if (!providerId) throw new Error('deployment is missing providerId metadata');

    const result = await provider.healthCheck(providerId);
    const check = await this.recordHealthCheck(deploymentId, {
      status: result.healthy ? 'healthy' : 'down',
      responseTimeMs: String(result.responseTimeMs),
      details: {
        provider: provider.name,
        status: result.status,
        checkedAt: result.checkedAt,
      },
    });
    return { check, result };
  }

  async rollbackDeployment(
    deploymentId: string,
    targetVersion: string,
    provider: DeployProvider,
    workspaceId?: string,
  ): Promise<{
    deployment: typeof deployments.$inferSelect | null;
    result: RollbackResult;
  }> {
    const deployment = await this.getDeployment(deploymentId, workspaceId);
    if (!deployment) throw new Error('deployment not found');
    const metadata = asRecord(deployment.metadata) ?? {};
    const providerId = stringValue(metadata['providerId']);
    const providerDeploymentId = stringValue(metadata['providerDeploymentId']);
    if (!providerId || !providerDeploymentId) {
      throw new Error('deployment is missing provider rollback metadata');
    }
    const result = await provider.rollback({
      providerId,
      deploymentId: providerDeploymentId,
      targetVersion,
    });
    const updated = await this.updateDeploymentStatus(
      deploymentId,
      result.status,
      deployment.url ?? undefined,
      {
        ...metadata,
        rollback: result,
      },
      workspaceId,
    );
    return { deployment: updated ?? null, result };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

export { DigitalOceanProvider } from './providers/digitalocean.js';
export type {
  DeployProvider,
  ProvisionParams,
  ProvisionResult,
  DeployParams,
  DeployResult,
  HealthCheckResult,
  RollbackParams,
  RollbackResult,
} from './providers/types.js';
