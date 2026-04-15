export type ConnectorAuthType = 'oauth2' | 'api_key' | 'token' | 'none';

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
