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

interface DigitalOceanProviderOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  mock?: boolean;
}

class DigitalOceanApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'DigitalOceanApiError';
  }
}

/**
 * DigitalOcean App Platform deploy provider.
 *
 * Without a token it returns realistic DO-shaped mock data for local tests.
 * With DIGITALOCEAN_TOKEN or DIGITALOCEAN_API_TOKEN it uses the Apps API.
 * Real provisioning requires params.config.appSpec so callers own the exact
 * App Platform spec instead of this provider inventing production topology.
 */
export class DigitalOceanProvider implements DeployProvider {
  readonly name = 'digitalocean';
  private readonly token?: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly mock: boolean;

  constructor(options: DigitalOceanProviderOptions = {}) {
    this.token =
      options.token ?? process.env['DIGITALOCEAN_TOKEN'] ?? process.env['DIGITALOCEAN_API_TOKEN'];
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.digitalocean.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.mock = options.mock ?? !this.token;
  }

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    if (!params.appName) throw new Error('appName is required');
    if (!params.region) throw new Error('region is required');

    if (!this.mock) {
      const appSpec = asRecord(params.config?.['appSpec']);
      if (!appSpec) {
        throw new Error('config.appSpec is required for real DigitalOcean provisioning');
      }

      const res = await this.request('/v2/apps', {
        method: 'POST',
        body: JSON.stringify({
          spec: {
            ...appSpec,
            name: params.appName,
            region: params.region,
          },
        }),
      });
      const app = asRecord(res['app']);
      if (!app) throw new Error('DigitalOcean create app response missing app');
      const appId = String(app?.['id'] ?? '');
      if (!appId) throw new Error('DigitalOcean create app response missing app.id');
      const spec = asRecord(app['spec']);

      return {
        providerId: appId,
        appName: String(spec?.['name'] ?? params.appName),
        region: String(spec?.['region'] ?? params.region),
        status: 'provisioning',
        dashboardUrl: `https://cloud.digitalocean.com/apps/${appId}`,
        createdAt: String(app['created_at'] ?? new Date().toISOString()),
      };
    }

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

    if (!this.mock) {
      const res = await this.request(
        `/v2/apps/${encodeURIComponent(params.providerId)}/deployments`,
        {
          method: 'POST',
          body: JSON.stringify({ force_build: true }),
        },
      );
      const deployment = asRecord(res['deployment']);
      const deploymentId = String(deployment?.['id'] ?? '');
      if (!deploymentId) throw new Error('DigitalOcean deployment response missing deployment.id');

      return {
        deploymentId,
        url: params.envVars?.['APP_URL'] ?? `https://${params.providerId}.ondigitalocean.app`,
        status: 'deploying',
        version: params.tag,
        startedAt: String(deployment?.['created_at'] ?? new Date().toISOString()),
      };
    }

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

    if (!this.mock) {
      const started = Date.now();
      await this.request(`/v2/apps/${encodeURIComponent(providerId)}/health`, {
        method: 'GET',
      });
      return {
        healthy: true,
        status: 200,
        responseTimeMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }

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

    if (!this.mock) {
      await this.request(`/v2/apps/${encodeURIComponent(params.providerId)}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ deployment_id: params.deploymentId }),
      });
      return {
        deploymentId: params.deploymentId,
        rolledBackTo: params.targetVersion,
        status: 'rolled_back',
        completedAt: new Date().toISOString(),
      };
    }

    return {
      deploymentId: params.deploymentId,
      rolledBackTo: params.targetVersion,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    };
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!this.token) throw new Error('DigitalOcean token is required');
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new DigitalOceanApiError(
        `DigitalOcean API ${response.status} on ${init.method ?? 'GET'} ${path}`,
        response.status,
        body,
      );
    }
    if (!body) return {};
    const json = JSON.parse(body) as unknown;
    const record = asRecord(json);
    if (!record) throw new Error('DigitalOcean API returned non-object JSON');
    return record;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
