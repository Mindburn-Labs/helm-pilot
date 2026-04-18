import type {
  DeployProvider,
  ProvisionParams,
  ProvisionResult,
  DeployParams,
  DeployResult,
  HealthCheckResult,
  RollbackParams,
  RollbackResult,
  DeployStatus,
} from './types.js';
import type {
  FlyMachinesClient,
  FlyMachine,
  FlyMachineState,
} from '@helm-pilot/connectors';

/**
 * Fly.io deploy provider (Phase 13 Track A).
 *
 * Two modes:
 *   - Real mode: constructed with a FlyMachinesClient; every call hits
 *     api.machines.dev with the workspace's FLY_API_TOKEN (resolved
 *     upstream from TenantSecretStore).
 *   - Mock mode: no client → returns realistic-shaped mock data so tests +
 *     dev-without-credentials still work. Preserves the pre-Phase-13 API
 *     shape verified by services/launch-engine/src/__tests__/launch-providers.test.ts.
 *
 * Lifecycle:
 *   provision   → client.createApp(name, org_slug)
 *   deploy      → client.createMachine(image, region, checks) +
 *                 waitForMachineState('started')
 *   healthCheck → client.listMachines → checks[] aggregated to boolean
 *   rollback    → find prior machine image_ref by tag → createMachine
 *                 with that image → waitForMachineState('started') →
 *                 destroy the current machine (blue-green swap)
 */
export class FlyProvider implements DeployProvider {
  readonly name = 'fly';

  constructor(
    private readonly client?: FlyMachinesClient,
    private readonly orgSlug: string = 'personal',
  ) {}

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    if (!params.appName) throw new Error('appName is required');
    if (!params.region) throw new Error('region is required');

    if (!this.client) {
      // ─── Mock mode ───
      const providerId = `fly_${params.appName}_${Date.now()}`;
      return {
        providerId,
        appName: params.appName,
        region: params.region,
        status: 'provisioning',
        dashboardUrl: `https://fly.io/apps/${params.appName}`,
        createdAt: new Date().toISOString(),
      };
    }

    // ─── Real mode ───
    const app = await this.client.createApp({
      name: params.appName,
      orgSlug: this.orgSlug,
    });
    return {
      providerId: app.name,
      appName: app.name,
      region: params.region,
      status: 'provisioning',
      dashboardUrl: `https://fly.io/apps/${app.name}`,
      createdAt: new Date().toISOString(),
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.image) throw new Error('image is required');

    if (!this.client) {
      const machineId = `mach_${crypto.randomUUID().slice(0, 8)}`;
      return {
        deploymentId: machineId,
        url: `https://${this.extractAppFromMockId(params.providerId)}.fly.dev`,
        status: 'live',
        version: params.tag,
        startedAt: new Date().toISOString(),
      };
    }

    const appName = params.providerId;
    const machine = await this.client.createMachine({
      appName,
      region: 'fra', // sensible EU default; caller can extend via config
      image: params.image,
      env: params.envVars,
      services: [
        {
          internal_port: 8080,
          protocol: 'tcp',
          ports: [
            { port: 80, handlers: ['http'] },
            { port: 443, handlers: ['tls', 'http'] },
          ],
        },
      ],
      checks: {
        health: {
          type: 'http',
          port: 8080,
          interval: '15s',
          timeout: '5s',
          grace_period: '10s',
          method: 'GET',
          path: '/health',
        },
      },
      leaseTtlSeconds: 30,
    });
    const ready = await this.client.waitForMachineState(
      appName,
      machine.id,
      'started',
      120_000,
    );
    return {
      deploymentId: ready.id,
      url: `https://${appName}.fly.dev`,
      status: 'live',
      version: params.tag,
      startedAt: ready.created_at ?? new Date().toISOString(),
    };
  }

  async healthCheck(providerId: string): Promise<HealthCheckResult> {
    if (!providerId) throw new Error('providerId is required');

    if (!this.client) {
      return {
        healthy: true,
        status: 200,
        responseTimeMs: 42,
        checkedAt: new Date().toISOString(),
      };
    }

    const machines = await this.client.listMachines(providerId);
    const latest = machines.at(-1);
    if (!latest) {
      return {
        healthy: false,
        status: 404,
        responseTimeMs: 0,
        checkedAt: new Date().toISOString(),
      };
    }
    const healthy = FlyProvider.healthyFromMachine(latest);
    return {
      healthy,
      status: healthy ? 200 : 503,
      responseTimeMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.deploymentId) throw new Error('deploymentId is required');

    if (!this.client) {
      return {
        deploymentId: params.deploymentId,
        rolledBackTo: params.targetVersion,
        status: 'rolled_back',
        completedAt: new Date().toISOString(),
      };
    }

    // Find the machine matching targetVersion by image tag.
    const machines = await this.client.listMachines(params.providerId);
    const target = machines.find((m) => m.image_ref?.tag === params.targetVersion);
    if (!target?.image_ref?.tag) {
      throw new Error(
        `rollback: no prior machine found with image tag "${params.targetVersion}"`,
      );
    }
    const imageRef = `${target.image_ref.registry ?? 'registry.fly.io'}/${
      target.image_ref.repository ?? params.providerId
    }:${target.image_ref.tag}`;
    const replacement = await this.client.createMachine({
      appName: params.providerId,
      region: target.region,
      image: imageRef,
    });
    await this.client.waitForMachineState(params.providerId, replacement.id, 'started');
    await this.client.destroyMachine(params.providerId, params.deploymentId);
    return {
      deploymentId: replacement.id,
      rolledBackTo: params.targetVersion,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    };
  }

  // ─── helpers ───

  private extractAppFromMockId(providerId: string): string {
    return providerId.replace(/^fly_/, '').replace(/_\d+$/, '');
  }

  /** Translate Fly machine state → our DeployStatus for surface consistency. */
  static mapState(state: FlyMachineState): DeployStatus {
    switch (state) {
      case 'created':
      case 'starting':
        return 'deploying';
      case 'started':
        return 'live';
      case 'failed':
      case 'destroyed':
        return 'failed';
      case 'destroying':
      case 'replacing':
      case 'stopping':
      case 'stopped':
        return 'rolled_back';
      default:
        return 'provisioning';
    }
  }

  static healthyFromMachine(machine: FlyMachine): boolean {
    if (machine.state !== 'started') return false;
    const checks = machine.checks ?? [];
    if (checks.length === 0) return true;
    return checks.every((c) => c.status === 'passing');
  }
}
