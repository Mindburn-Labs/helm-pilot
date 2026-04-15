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
 * Vercel deploy provider — stub implementation.
 *
 * Returns realistic Vercel-shaped mock data including project IDs,
 * deployment URLs with the vercel.app domain, and team scoping.
 *
 * TODO: Replace stubs with real Vercel REST API (https://vercel.com/docs/rest-api)
 * TODO: Add VERCEL_TOKEN auth via Bearer header
 * TODO: Wire up project creation via POST /v10/projects
 * TODO: Implement deployment creation via POST /v13/deployments
 */
export class VercelProvider implements DeployProvider {
  readonly name = 'vercel';

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    if (!params.appName) throw new Error('appName is required');
    if (!params.region) throw new Error('region is required');

    // TODO: POST https://api.vercel.com/v10/projects
    const projectId = `prj_${crypto.randomUUID().slice(0, 12)}`;
    return {
      providerId: projectId,
      appName: params.appName,
      region: params.region,
      status: 'provisioning',
      dashboardUrl: `https://vercel.com/${params.appName}`,
      createdAt: new Date().toISOString(),
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.image) throw new Error('image is required');

    // TODO: POST https://api.vercel.com/v13/deployments
    const deployId = `dpl_${crypto.randomUUID().slice(0, 12)}`;
    const slug = params.providerId.replace(/^prj_/, '');
    return {
      deploymentId: deployId,
      url: `https://${slug}.vercel.app`,
      status: 'live',
      version: params.tag,
      startedAt: new Date().toISOString(),
    };
  }

  async healthCheck(providerId: string): Promise<HealthCheckResult> {
    if (!providerId) throw new Error('providerId is required');

    // TODO: GET https://api.vercel.com/v6/deployments/{id}
    return {
      healthy: true,
      status: 200,
      responseTimeMs: 38,
      checkedAt: new Date().toISOString(),
    };
  }

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    if (!params.providerId) throw new Error('providerId is required');
    if (!params.deploymentId) throw new Error('deploymentId is required');

    // TODO: POST https://api.vercel.com/v6/deployments with target alias
    return {
      deploymentId: params.deploymentId,
      rolledBackTo: params.targetVersion,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    };
  }
}
