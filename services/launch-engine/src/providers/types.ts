/** Deploy provider interface and shared types for launch-engine Phase 6. */

export type DeployStatus = 'provisioning' | 'deploying' | 'live' | 'failed' | 'rolled_back';

export interface ProvisionParams {
  appName: string;
  region: string;
  config?: Record<string, unknown>;
}

export interface ProvisionResult {
  providerId: string;
  appName: string;
  region: string;
  status: DeployStatus;
  dashboardUrl: string;
  createdAt: string;
}

export interface DeployParams {
  providerId: string;
  image: string;
  tag: string;
  envVars?: Record<string, string>;
}

export interface DeployResult {
  deploymentId: string;
  url: string;
  status: DeployStatus;
  version: string;
  startedAt: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  status: number;
  responseTimeMs: number;
  checkedAt: string;
}

export interface RollbackParams {
  providerId: string;
  deploymentId: string;
  targetVersion: string;
}

export interface RollbackResult {
  deploymentId: string;
  rolledBackTo: string;
  status: DeployStatus;
  completedAt: string;
}

export interface DeployProvider {
  readonly name: string;
  provision(params: ProvisionParams): Promise<ProvisionResult>;
  deploy(params: DeployParams): Promise<DeployResult>;
  healthCheck(providerId: string): Promise<HealthCheckResult>;
  rollback(params: RollbackParams): Promise<RollbackResult>;
}
