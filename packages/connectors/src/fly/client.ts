import { createLogger } from '@helm-pilot/shared/logger';
import {
  FlyAppSchema,
  FlyMachineSchema,
  FlyApiError,
  type FlyApp,
  type FlyMachine,
  type FlyMachineState,
  type CreateAppParams,
  type CreateMachineParams,
} from './types.js';

const log = createLogger('fly.client');

/**
 * Fly Machines API v2 client (Phase 13 Track A).
 *
 * Replaces the 80-line mock at services/launch-engine/src/providers/fly.ts
 * with a real client that:
 *   - Bearer-auths via a per-tenant FLY_API_TOKEN (resolved by the
 *     launch-engine from TenantSecretStore).
 *   - Validates every response body through Zod schemas in ./types.js.
 *   - Surfaces typed FlyApiError on non-2xx.
 *   - Polls machine state via waitForMachineState() with exp-backoff.
 *   - Follows the 2026 SOTA lifecycle: provision (createApp) → deploy
 *     (createMachine + waitForMachineState('started')) → healthCheck →
 *     rollback (redeploy prior image_ref) → destroy.
 *
 * Reference: https://fly.io/docs/machines/api/
 */
export class FlyMachinesClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.machines.dev/v1',
  ) {
    if (!token) {
      throw new Error('FlyMachinesClient: FLY_API_TOKEN is required');
    }
  }

  // ─── Apps ───

  async createApp(params: CreateAppParams): Promise<FlyApp> {
    const res = await this.fetch('/apps', {
      method: 'POST',
      body: JSON.stringify({
        app_name: params.name,
        org_slug: params.orgSlug,
        network: params.network,
      }),
    });
    return FlyAppSchema.parse(res);
  }

  async getApp(appName: string): Promise<FlyApp> {
    const res = await this.fetch(`/apps/${encodeURIComponent(appName)}`);
    return FlyAppSchema.parse(res);
  }

  async deleteApp(appName: string): Promise<void> {
    await this.fetch(
      `/apps/${encodeURIComponent(appName)}`,
      { method: 'DELETE' },
      { parseJson: false },
    );
  }

  // ─── Machines ───

  async createMachine(params: CreateMachineParams): Promise<FlyMachine> {
    const body: Record<string, unknown> = {
      name: params.name,
      region: params.region,
      config: {
        image: params.image,
        env: params.env ?? {},
        services: params.services,
        checks: params.checks,
        guest: params.guest ?? {
          cpu_kind: 'shared',
          cpus: 1,
          memory_mb: 256,
        },
      },
    };
    if (params.leaseTtlSeconds) {
      body['lease_ttl'] = params.leaseTtlSeconds;
    }
    const res = await this.fetch(
      `/apps/${encodeURIComponent(params.appName)}/machines`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return FlyMachineSchema.parse(res);
  }

  async getMachine(appName: string, machineId: string): Promise<FlyMachine> {
    const res = await this.fetch(
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
    );
    return FlyMachineSchema.parse(res);
  }

  async listMachines(appName: string): Promise<FlyMachine[]> {
    const res = await this.fetch(`/apps/${encodeURIComponent(appName)}/machines`);
    if (!Array.isArray(res)) return [];
    return res.map((row) => FlyMachineSchema.parse(row));
  }

  async updateMachine(
    appName: string,
    machineId: string,
    patch: Partial<CreateMachineParams>,
  ): Promise<FlyMachine> {
    const res = await this.fetch(
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          region: patch.region,
          config: patch.image
            ? {
                image: patch.image,
                env: patch.env,
                services: patch.services,
                checks: patch.checks,
                guest: patch.guest,
              }
            : undefined,
        }),
      },
    );
    return FlyMachineSchema.parse(res);
  }

  async destroyMachine(appName: string, machineId: string): Promise<void> {
    await this.fetch(
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
      { method: 'DELETE' },
      { parseJson: false },
    );
  }

  /**
   * Poll the machine until it reaches `target` state (or throws on timeout).
   * Per Fly docs: after createMachine the state transitions through
   * created → starting → started; healthcheck-bearing machines may emit a
   * `checks` array only once `started`.
   */
  async waitForMachineState(
    appName: string,
    machineId: string,
    target: FlyMachineState,
    timeoutMs = 120_000,
  ): Promise<FlyMachine> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      const m = await this.getMachine(appName, machineId);
      if (m.state === target) return m;
      if (m.state === 'failed' || m.state === 'destroyed') {
        throw new FlyApiError(
          `Machine ${machineId} reached terminal state ${m.state} while waiting for ${target}`,
          0,
          JSON.stringify(m),
        );
      }
      const delay = Math.min(2000, 250 * 2 ** attempt++);
      await new Promise((r) => setTimeout(r, delay));
    }
    throw new FlyApiError(
      `Timeout waiting for machine ${machineId} to reach ${target}`,
      408,
      '',
    );
  }

  // ─── Internals ───

  private async fetch(
    path: string,
    init: RequestInit = {},
    opts: { parseJson?: boolean } = {},
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...init, headers });
    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      log.warn(
        { url, status: response.status, body: bodyText.slice(0, 200) },
        'Fly API non-2xx',
      );
      throw new FlyApiError(
        `Fly API ${response.status} on ${init.method ?? 'GET'} ${path}`,
        response.status,
        bodyText,
      );
    }
    if (opts.parseJson === false) return null;
    if (!bodyText) return null;
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }
}
