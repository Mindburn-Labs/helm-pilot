import type {
  DeployProvider,
  ProvisionParams,
  ProvisionResult,
  DeployParams,
  DeployResult,
  HealthCheckResult,
  RollbackParams,
  RollbackResult,
} from './types.js';

/**
 * Fly.io deploy provider — stub implementation.
 *
 * Returns realistic Fly.io-shaped mock data. Each method validates its
 * params and returns a plausible response structure.
 *
 * TODO: Replace stubs with real Fly Machines API calls (https://fly.io/docs/machines/api/)
 * TODO: Add FLY_API_TOKEN auth header to all requests
 * TODO: Wire up Fly.io org/app creation via POST /v1/apps
 * TODO: Implement real health polling via /v1/apps/{app}/machines/{id}
 */
export class FlyProvider implements DeployProvider {
  readonly name = 'fly';

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    if (!params.appName) throw new Error('appName is required');
    if (!params.region) throw new Error('region is required');

    // TODO: POST https://api.machines.dev/v1/apps
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

  async deploy(params: DeployParams): Promise<DeployResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.image) throw new Error('image is required');

    // TODO: POST https://api.machines.dev/v1/apps/{app}/machines
    const machineId = `mach_${crypto.randomUUID().slice(0, 8)}`;
    return {
      deploymentId: machineId,
      url: `https://${params.providerId.replace(/^fly_/, '').replace(/_\d+$/, '')}.fly.dev`,
      status: 'live',
      version: params.tag,
      startedAt: new Date().toISOString(),
    };
  }

  async healthCheck(providerId: string): Promise<HealthCheckResult> {
    if (!providerId) throw new Error('providerId is required');

    // TODO: GET https://api.machines.dev/v1/apps/{app}/machines/{id}
    return {
      healthy: true,
      status: 200,
      responseTimeMs: 42,
      checkedAt: new Date().toISOString(),
    };
  }

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.deploymentId) throw new Error('deploymentId is required');

    // TODO: PUT https://api.machines.dev/v1/apps/{app}/machines/{id} with prior image ref
    return {
      deploymentId: params.deploymentId,
      rolledBackTo: params.targetVersion,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    };
  }
}
