export type ConnectorAuthType = 'oauth2' | 'api_key' | 'token' | 'session' | 'none';
export type ConnectorSessionType = 'browser_storage_state' | 'cookie_jar';

/**
 * Connector — any external integration that can be granted to a workspace.
 */
export interface Connector {
  id: string;
  name: string;
  description: string;
  authType: ConnectorAuthType;
  /** Required scopes/permissions */
  requiredScopes: string[];
  /** Whether this connector needs an approval gate before agent use */
  requiresApproval: boolean;
}

export interface ConnectorGrant {
  connectorId: string;
  workspaceId: string;
  scopes: string[];
  grantedAt: Date;
  expiresAt?: Date;
}

export interface ConnectorToken {
  connectorId: string;
  workspaceId: string;
  token: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface ConnectorSession {
  connectorId: string;
  workspaceId: string;
  sessionType: ConnectorSessionType;
  sessionData: unknown;
  metadata?: Record<string, unknown>;
  lastValidatedAt?: Date;
}
