import { createHash, createHmac, randomBytes } from 'node:crypto';
import { type Db } from '@helm-pilot/db/client';
import { type ConnectorRegistry } from './index.js';
import { createLogger } from '@helm-pilot/shared/logger';

const log = createLogger('oauth');

/**
 * OAuth2 Flow Manager — handles initiate/callback/refresh for all OAuth-based connectors.
 *
 * Supports:
 * - Standard OAuth2 Authorization Code flow
 * - PKCE extension (required by Google, recommended for all)
 * - State parameter HMAC-signed with SESSION_SECRET for CSRF protection
 * - Automatic token refresh on expiry
 *
 * Provider configs are registered at startup. Each connector maps to a provider.
 */
export class OAuthFlowManager {
  private readonly providers = new Map<string, OAuthProviderConfig>();
  private readonly pendingStates = new Map<string, PendingOAuthState>();
  private readonly stateSecret: string;

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly db: Db,
  ) {
    this.stateSecret = process.env['SESSION_SECRET'] ?? 'dev-state-secret';
    this.registerDefaultProviders();
  }

  /** Register an OAuth provider configuration */
  registerProvider(config: OAuthProviderConfig) {
    this.providers.set(config.connectorId, config);
  }

  /** Get registered provider config */
  getProvider(connectorId: string): OAuthProviderConfig | undefined {
    return this.providers.get(connectorId);
  }

  /**
   * Initiate OAuth flow — returns the authorization URL to redirect the user to.
   */
  initiateFlow(params: {
    connectorId: string;
    workspaceId: string;
    scopes?: string[];
    redirectUri?: string;
  }): { authUrl: string; state: string } {
    const provider = this.providers.get(params.connectorId);
    if (!provider) {
      throw new OAuthError(`No OAuth provider configured for connector: ${params.connectorId}`);
    }

    if (!provider.clientId) {
      throw new OAuthError(`OAuth client ID not configured for ${params.connectorId}. Set ${provider.clientIdEnv ?? 'CLIENT_ID'} in .env`);
    }

    // Generate state with HMAC signature for CSRF protection
    const nonce = randomBytes(16).toString('hex');
    const statePayload = `${params.connectorId}:${params.workspaceId}:${nonce}`;
    const hmac = createHmac('sha256', this.stateSecret).update(statePayload).digest('hex');
    const state = `${statePayload}:${hmac}`;

    // Generate PKCE code_verifier + code_challenge
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Store pending state for callback verification
    this.pendingStates.set(state, {
      connectorId: params.connectorId,
      workspaceId: params.workspaceId,
      codeVerifier,
      createdAt: new Date(),
    });

    // Clean up expired states (older than 10 minutes)
    this.cleanupExpiredStates();

    const scopes = params.scopes ?? provider.defaultScopes;
    const redirectUri = params.redirectUri ?? provider.redirectUri;

    const authParams = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      access_type: 'offline', // Request refresh token (Google-specific but harmless for others)
      prompt: 'consent', // Force consent screen to ensure refresh token
    });

    // Add PKCE if supported
    if (provider.supportsPkce) {
      authParams.set('code_challenge', codeChallenge);
      authParams.set('code_challenge_method', 'S256');
    }

    // Add provider-specific params
    if (provider.extraAuthParams) {
      for (const [key, value] of Object.entries(provider.extraAuthParams)) {
        authParams.set(key, value);
      }
    }

    const authUrl = `${provider.authorizationUrl}?${authParams.toString()}`;
    log.info({ connectorId: params.connectorId, workspaceId: params.workspaceId }, 'OAuth flow initiated');

    return { authUrl, state };
  }

  /**
   * Handle OAuth callback — exchanges code for tokens and stores them.
   */
  async handleCallback(params: {
    code: string;
    state: string;
  }): Promise<OAuthCallbackResult> {
    // Verify state HMAC
    const pending = this.pendingStates.get(params.state);
    if (!pending) {
      throw new OAuthError('Invalid or expired OAuth state. Please try again.');
    }

    // Verify HMAC signature
    const parts = params.state.split(':');
    if (parts.length < 4) {
      throw new OAuthError('Malformed OAuth state');
    }
    const payload = parts.slice(0, 3).join(':');
    const receivedHmac = parts[3];
    const expectedHmac = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
    if (receivedHmac !== expectedHmac) {
      throw new OAuthError('OAuth state HMAC verification failed (possible CSRF)');
    }

    // Clean up the used state
    this.pendingStates.delete(params.state);

    const provider = this.providers.get(pending.connectorId);
    if (!provider) {
      throw new OAuthError(`Provider not found: ${pending.connectorId}`);
    }

    // Exchange code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: provider.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
    });

    if (provider.supportsPkce) {
      tokenParams.set('code_verifier', pending.codeVerifier);
    }

    const tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text().catch(() => '');
      log.error({ status: tokenResponse.status, errorBody, connectorId: pending.connectorId }, 'Token exchange failed');
      throw new OAuthError(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = (await tokenResponse.json()) as OAuthTokenResponse;

    // Grant the connector to the workspace
    const grantId = await this.registry.grantConnector(
      pending.workspaceId,
      pending.connectorId,
      provider.defaultScopes,
    );

    // Store the encrypted tokens
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : undefined;

    await this.registry.storeToken(
      grantId,
      tokenData.access_token,
      tokenData.refresh_token,
      expiresAt,
    );

    log.info(
      { connectorId: pending.connectorId, workspaceId: pending.workspaceId, hasRefresh: !!tokenData.refresh_token },
      'OAuth tokens stored',
    );

    return {
      connectorId: pending.connectorId,
      workspaceId: pending.workspaceId,
      grantId,
      scopes: tokenData.scope?.split(' ') ?? provider.defaultScopes,
    };
  }

  /**
   * Refresh an access token using the stored refresh token.
   *
   * Returns the new access token, or null if refresh is not possible.
   */
  async refreshToken(grantId: string, connectorId: string): Promise<string | null> {
    const provider = this.providers.get(connectorId);
    if (!provider) return null;

    // Get stored refresh token
    const { connectorTokens } = await import('@helm-pilot/db/schema');
    const { eq } = await import('drizzle-orm');
    const { decryptToken } = await import('./token-store.js');

    const [tokenRow] = await this.db
      .select()
      .from(connectorTokens)
      .where(eq(connectorTokens.grantId, grantId))
      .limit(1);

    if (!tokenRow?.refreshTokenEnc) {
      log.warn({ grantId, connectorId }, 'No refresh token available');
      return null;
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(tokenRow.refreshTokenEnc);
    } catch {
      refreshToken = tokenRow.refreshTokenEnc; // fallback: pre-encryption storage
    }

    // Exchange refresh token
    const tokenParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
    });

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!response.ok) {
      log.error({ status: response.status, connectorId }, 'Token refresh failed');
      return null;
    }

    const data = (await response.json()) as OAuthTokenResponse;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    await this.registry.storeToken(
      grantId,
      data.access_token,
      data.refresh_token ?? refreshToken, // Keep old refresh token if new one not provided
      expiresAt,
    );

    log.info({ grantId, connectorId }, 'Access token refreshed');
    return data.access_token;
  }

  /** Register default OAuth providers from environment configuration */
  private registerDefaultProviders() {
    const baseUrl = process.env['APP_URL'] ?? 'http://localhost:3100';

    // GitHub OAuth App
    this.registerProvider({
      connectorId: 'github',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env['GITHUB_CLIENT_ID'] ?? '',
      clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? '',
      clientIdEnv: 'GITHUB_CLIENT_ID',
      redirectUri: `${baseUrl}/api/connectors/github/oauth/callback`,
      defaultScopes: ['repo', 'user'],
      supportsPkce: false,
      extraAuthParams: { allow_signup: 'false' },
    });

    // Google (Gmail + Drive share the same OAuth project)
    this.registerProvider({
      connectorId: 'gmail',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      redirectUri: process.env['GOOGLE_REDIRECT_URI'] ?? `${baseUrl}/api/connectors/gmail/oauth/callback`,
      defaultScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      supportsPkce: true,
    });

    this.registerProvider({
      connectorId: 'gdrive',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      redirectUri: process.env['GOOGLE_REDIRECT_URI'] ?? `${baseUrl}/api/connectors/gdrive/oauth/callback`,
      defaultScopes: ['https://www.googleapis.com/auth/drive.file'],
      supportsPkce: true,
    });
  }

  private cleanupExpiredStates() {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [state, pending] of this.pendingStates) {
      if (pending.createdAt.getTime() < tenMinutesAgo) {
        this.pendingStates.delete(state);
      }
    }
  }
}

// ─── Types ───

export interface OAuthProviderConfig {
  connectorId: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Env var name for the client ID (for error messages) */
  clientIdEnv?: string;
  redirectUri: string;
  defaultScopes: string[];
  supportsPkce: boolean;
  extraAuthParams?: Record<string, string>;
}

interface PendingOAuthState {
  connectorId: string;
  workspaceId: string;
  codeVerifier: string;
  createdAt: Date;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

export interface OAuthCallbackResult {
  connectorId: string;
  workspaceId: string;
  grantId: string;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}
