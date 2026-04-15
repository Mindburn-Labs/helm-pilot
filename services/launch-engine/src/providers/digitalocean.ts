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
 * DigitalOcean App Platform deploy provider — stub implementation.
 *
 * Returns realistic DO-shaped mock data including app IDs, ondigitalocean.app
 * URLs, and datacenter region codes.
 *
 * TODO: Replace stubs with real DO API (https://docs.digitalocean.com/reference/api/api-reference/#tag/Apps)
 * TODO: Add DIGITALOCEAN_TOKEN auth via Bearer header
 * TODO: Wire up app creation via POST /v2/apps
 * TODO: Implement deployment via POST /v2/apps/{id}/deployments
 */
export class DigitalOceanProvider implements DeployProvider {
  readonly name = 'digitalocean';

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    if (!params.appName) throw new Error('appName is required');
    if (!params.region) throw new Error('region is required');

    // TODO: POST https://api.digitalocean.com/v2/apps
    const appId = crypto.randomUUID();
    return {
      providerId: appId,
      appName: params.appName,
      region: params.region,
      status: 'provisioning',
      dashboardUrl: `https://cloud.digitalocean.com/apps/${appId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.image) throw new Error('image is required');

    // TODO: POST https://api.digitalocean.com/v2/apps/{id}/deployments
    const deployId = crypto.randomUUID();
    const slug = params.providerId.slice(0, 8);
    return {
      deploymentId: deployId,
      url: `https://${slug}.ondigitalocean.app`,
      status: 'live',
      version: params.tag,
      startedAt: new Date().toISOString(),
    };
  }

  async healthCheck(providerId: string): Promise<HealthCheckResult> {
    if (!providerId) throw new Error('providerId is required');

    // TODO: GET https://api.digitalocean.com/v2/apps/{id}
    return {
      healthy: true,
      status: 200,
      responseTimeMs: 55,
      checkedAt: new Date().toISOString(),
    };
  }

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.deploymentId) throw new Error('deploymentId is required');

    // TODO: POST https://api.digitalocean.com/v2/apps/{id}/rollback
    return {
      deploymentId: params.deploymentId,
      rolledBackTo: params.targetVersion,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    };
  }
}
