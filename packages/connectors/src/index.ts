import { eq, and } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { connectors, connectorGrants, connectorSessions, connectorTokens } from '@helm-pilot/db/schema';
import { type Connector } from './types.js';
import { encryptToken, decryptToken } from './token-store.js';

export { createStorageClient, LocalStorageClient, S3StorageClient } from './storage.js';
export { GitHubConnector } from './github.js';
export { GmailConnector } from './gmail.js';
export { DriveConnector } from './gdrive.js';
export { OAuthFlowManager, OAuthError } from './oauth.js';
export { encryptToken, decryptToken } from './token-store.js';
export {
  registerRefreshJobs,
  listReauthRequired,
  PROACTIVE_WINDOW_MS,
  PERMANENT_AFTER_ATTEMPTS,
  TICK_BATCH_LIMIT,
} from './refresh.js';
export type { RefreshNotifier, RefreshDeps } from './refresh.js';
export {
  FlyMachinesClient,
  FlyApiError,
  FlyAppSchema,
  FlyMachineSchema,
  FlyMachineStateSchema,
  FlyRegionSchema,
} from './fly/index.js';
export type {
  FlyApp,
  FlyMachine,
  FlyMachineState,
  CreateAppParams,
  CreateMachineParams,
} from './fly/index.js';
export type { StorageClient, S3Config } from './storage.js';
export type {
  Connector,
  ConnectorAuthType,
  ConnectorGrant,
  ConnectorSession,
  ConnectorSessionType,
  ConnectorToken,
} from './types.js';
export type { OAuthProviderConfig, OAuthCallbackResult } from './oauth.js';
export type { GmailMessage, GmailMessageSummary, GmailLabel } from './gmail.js';
export type { DriveFile } from './gdrive.js';

/**
 * Connector Registry — manages connector definitions, workspace grants, and tokens.
 *
 * DB model (from schema/connector.ts):
 * - `connectors` — global registry of available connector types (github, gmail, etc.)
 * - `connectorGrants` — per-workspace authorization to use a connector
 * - `connectorTokens` — encrypted tokens per grant
 */
export class ConnectorRegistry {
  private readonly definitions = new Map<string, Connector>();

  constructor(private readonly db: Db) {
    this.registerDefaults();
  }

  /** Register a connector definition in memory */
  registerConnector(connector: Connector) {
    this.definitions.set(connector.id, connector);
  }

  /** List all available connector definitions */
  listConnectors(): Connector[] {
    return [...this.definitions.values()];
  }

  /** Get a connector definition by ID */
  getConnector(id: string): Connector | undefined {
    return this.definitions.get(id);
  }

  /**
   * Ensure a connector row exists in the DB.
   * Called during bootstrap to sync in-memory definitions to the `connectors` table.
   */
  async ensureDbRecord(connectorDef: Connector): Promise<string> {
    const [existing] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.name, connectorDef.id))
      .limit(1);
    if (existing) return existing.id;

    const [created] = await this.db
      .insert(connectors)
      .values({
        name: connectorDef.id,
        displayName: connectorDef.name,
        authType: connectorDef.authType,
        configSchema: {
          requiredScopes: connectorDef.requiredScopes,
          requiresApproval: connectorDef.requiresApproval,
        },
      })
      .returning();
    if (!created) throw new Error(`Failed to create connector: ${connectorDef.id}`);
    return created.id;
  }

  /** Grant a connector to a workspace */
  async grantConnector(workspaceId: string, connectorName: string, scopes?: string[]): Promise<string> {
    // Find the connector DB record
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.name, connectorName))
      .limit(1);
    if (!connector) throw new Error(`Unknown connector: ${connectorName}`);

    // Check for existing active grant
    const [existing] = await this.db
      .select()
      .from(connectorGrants)
      .where(and(
        eq(connectorGrants.workspaceId, workspaceId),
        eq(connectorGrants.connectorId, connector.id),
        eq(connectorGrants.isActive, true),
      ))
      .limit(1);
    if (existing) return existing.id;

    const [grant] = await this.db
      .insert(connectorGrants)
      .values({
        workspaceId,
        connectorId: connector.id,
        scopes: scopes ?? [],
      })
      .returning();
    if (!grant) throw new Error('Failed to create grant');
    return grant.id;
  }

  /** Revoke a connector grant */
  async revokeConnector(workspaceId: string, connectorName: string): Promise<void> {
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.name, connectorName))
      .limit(1);
    if (!connector) return;

    await this.db
      .update(connectorGrants)
      .set({ isActive: false, revokedAt: new Date() })
      .where(and(
        eq(connectorGrants.workspaceId, workspaceId),
        eq(connectorGrants.connectorId, connector.id),
      ));
  }

  /** Check if a workspace has an active grant for a connector */
  async hasGrant(workspaceId: string, connectorName: string): Promise<boolean> {
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.name, connectorName))
      .limit(1);
    if (!connector) return false;

    const [grant] = await this.db
      .select()
      .from(connectorGrants)
      .where(and(
        eq(connectorGrants.workspaceId, workspaceId),
        eq(connectorGrants.connectorId, connector.id),
        eq(connectorGrants.isActive, true),
      ))
      .limit(1);
    return !!grant;
  }

  /** List active grants for a workspace */
  async listWorkspaceGrants(workspaceId: string) {
    return this.db
      .select()
      .from(connectorGrants)
      .where(and(eq(connectorGrants.workspaceId, workspaceId), eq(connectorGrants.isActive, true)));
  }

  /** Resolve the active grant for a workspace + connector name. */
  async getGrantByWorkspaceConnector(workspaceId: string, connectorName: string) {
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.name, connectorName))
      .limit(1);
    if (!connector) return null;

    const [grant] = await this.db
      .select()
      .from(connectorGrants)
      .where(and(
        eq(connectorGrants.workspaceId, workspaceId),
        eq(connectorGrants.connectorId, connector.id),
        eq(connectorGrants.isActive, true),
      ))
      .limit(1);

    return grant ?? null;
  }

  /** Store a token for a grant (encrypted at rest via AES-256-GCM) */
  async storeToken(grantId: string, accessToken: string, refreshToken?: string, expiresAt?: Date): Promise<void> {
    const encAccess = encryptToken(accessToken);
    const encRefresh = refreshToken ? encryptToken(refreshToken) : undefined;

    const [existing] = await this.db
      .select()
      .from(connectorTokens)
      .where(eq(connectorTokens.grantId, grantId))
      .limit(1);

    if (existing) {
      await this.db
        .update(connectorTokens)
        .set({
          accessTokenEnc: encAccess,
          refreshTokenEnc: encRefresh,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(connectorTokens.id, existing.id));
    } else {
      await this.db.insert(connectorTokens).values({
        grantId,
        accessTokenEnc: encAccess,
        refreshTokenEnc: encRefresh,
        expiresAt,
      });
    }
  }

  /** Retrieve and decrypt a token for a grant */
  async getToken(grantId: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(connectorTokens)
      .where(eq(connectorTokens.grantId, grantId))
      .limit(1);
    if (!row?.accessTokenEnc) return null;
    try {
      return decryptToken(row.accessTokenEnc);
    } catch {
      // Token may be stored pre-encryption — return raw as fallback
      return row.accessTokenEnc;
    }
  }

  /** Return token metadata for a grant without decrypting the token body. */
  async getTokenRecord(grantId: string) {
    const [row] = await this.db
      .select()
      .from(connectorTokens)
      .where(eq(connectorTokens.grantId, grantId))
      .limit(1);
    return row ?? null;
  }

  /** Store an encrypted browser/session snapshot for a grant. */
  async storeSession(
    grantId: string,
    sessionData: unknown,
    sessionType: 'browser_storage_state' | 'cookie_jar' = 'browser_storage_state',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const payload = encryptToken(JSON.stringify(sessionData));
    const [existing] = await this.db
      .select()
      .from(connectorSessions)
      .where(eq(connectorSessions.grantId, grantId))
      .limit(1);

    if (existing) {
      await this.db
        .update(connectorSessions)
        .set({
          sessionType,
          sessionDataEnc: payload,
          metadata,
          updatedAt: new Date(),
        })
        .where(eq(connectorSessions.id, existing.id));
      return;
    }

    await this.db.insert(connectorSessions).values({
      grantId,
      sessionType,
      sessionDataEnc: payload,
      metadata,
    });
  }

  async getSession(grantId: string): Promise<unknown | null> {
    const [row] = await this.db
      .select()
      .from(connectorSessions)
      .where(eq(connectorSessions.grantId, grantId))
      .limit(1);
    if (!row?.sessionDataEnc) return null;
    try {
      return JSON.parse(decryptToken(row.sessionDataEnc));
    } catch {
      return null;
    }
  }

  async getSessionRecord(grantId: string) {
    const [row] = await this.db
      .select()
      .from(connectorSessions)
      .where(eq(connectorSessions.grantId, grantId))
      .limit(1);
    return row ?? null;
  }

  async deleteSession(grantId: string): Promise<void> {
    await this.db.delete(connectorSessions).where(eq(connectorSessions.grantId, grantId));
  }

  async markSessionValidated(grantId: string, metadata?: Record<string, unknown>) {
    const [existing] = await this.db
      .select()
      .from(connectorSessions)
      .where(eq(connectorSessions.grantId, grantId))
      .limit(1);
    if (!existing) return;

    await this.db
      .update(connectorSessions)
      .set({
        metadata: metadata ? { ...(existing.metadata as Record<string, unknown> ?? {}), ...metadata } : existing.metadata,
        lastValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectorSessions.id, existing.id));
  }

  private registerDefaults() {
    this.registerConnector({
      id: 'github',
      name: 'GitHub',
      description: 'Create repos, manage issues, and push code',
      authType: 'oauth2',
      requiredScopes: ['repo', 'user'],
      requiresApproval: true,
    });

    this.registerConnector({
      id: 'gmail',
      name: 'Gmail',
      description: 'Send and read emails',
      authType: 'oauth2',
      requiredScopes: ['gmail.send', 'gmail.readonly'],
      requiresApproval: true,
    });

    this.registerConnector({
      id: 'gdrive',
      name: 'Google Drive',
      description: 'Read and write files in Google Drive',
      authType: 'oauth2',
      requiredScopes: ['drive.file'],
      requiresApproval: true,
    });

    this.registerConnector({
      id: 'linear',
      name: 'Linear',
      description: 'Project management — create/manage issues and projects',
      authType: 'token',
      requiredScopes: ['issues:write', 'projects:read'],
      requiresApproval: false,
    });

    this.registerConnector({
      id: 'yc',
      name: 'YC',
      description: 'Founder-authorized YC session for cofounder matching, Startup School, and application workflows',
      authType: 'session',
      requiredScopes: ['profile:read', 'matching:read', 'matching:write', 'applications:read'],
      requiresApproval: true,
    });

    this.registerConnector({
      id: 'telegram',
      name: 'Telegram',
      description: 'Founder control surface for chat, approvals, and operator interactions',
      authType: 'none',
      requiredScopes: [],
      requiresApproval: false,
    });

    this.registerConnector({
      id: 'browser',
      name: 'Browser Automation',
      description: 'Controlled browser actions for research, capture, and workflow execution',
      authType: 'none',
      requiredScopes: [],
      requiresApproval: true,
    });

    this.registerConnector({
      id: 'files',
      name: 'File Import',
      description: 'Workspace file uploads and imported artifacts',
      authType: 'none',
      requiredScopes: [],
      requiresApproval: false,
    });
  }
}
