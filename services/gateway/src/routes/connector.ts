import { Hono } from 'hono';
import { type Connector } from '@helm-pilot/connectors';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

export function connectorRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);

    const workspaceId = getWorkspaceId(c);
    const available = deps.connectors.listConnectors();

    if (!workspaceId) {
      return c.json(
        available.map((connector) => serializeConnector(connector, deps, null, null)),
      );
    }

    const statuses = await Promise.all(
      available.map((connector) => getConnectorStatus(deps, connector, workspaceId)),
    );
    return c.json(statuses);
  });

  app.get('/grants', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const grants = await deps.connectors.listWorkspaceGrants(workspaceId);
    return c.json(grants);
  });

  app.post('/:name/grant', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);
    const { name } = c.req.param();
    const body = (await c.req.json().catch(() => ({}))) as { workspaceId?: string; scopes?: string[] };
    const workspaceId = body.workspaceId ?? getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const connector = deps.connectors.getConnector(name);
    if (!connector) return c.json({ error: `Unknown connector: ${name}` }, 404);

    const grantId = await deps.connectors.grantConnector(workspaceId, name, body.scopes);
    const status = await getConnectorStatus(deps, connector, workspaceId);
    return c.json({ grantId, connector: name, workspaceId, status }, 201);
  });

  app.delete('/:name/grant', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);
    const { name } = c.req.param();
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    await deps.connectors.revokeConnector(workspaceId, name);
    return c.json({ revoked: true });
  });

  app.post('/:name/token', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);
    const { name } = c.req.param();
    const connector = deps.connectors.getConnector(name);
    if (!connector) return c.json({ error: `Unknown connector: ${name}` }, 404);

    const body = await c.req.json();
    const { grantId, accessToken, refreshToken, expiresAt } = body as {
      grantId: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: string;
    };
    if (!grantId || !accessToken) return c.json({ error: 'grantId and accessToken required' }, 400);

    await deps.connectors.storeToken(
      grantId,
      accessToken,
      refreshToken,
      expiresAt ? new Date(expiresAt) : undefined,
    );
    return c.json({ stored: true });
  });

  app.get('/:name/oauth/initiate', async (c) => {
    if (!deps.oauth) return c.json({ error: 'OAuth not configured' }, 503);
    const { name } = c.req.param();
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const provider = deps.oauth.getProvider(name);
    if (!provider) return c.json({ error: `No OAuth provider for connector: ${name}` }, 404);
    if (!provider.clientId) {
      return c.json({
        error: `OAuth not configured for ${name}. Set ${provider.clientIdEnv ?? 'CLIENT_ID'} in .env`,
      }, 503);
    }

    try {
      const scopes = c.req.query('scopes')?.split(',').filter(Boolean);
      const { authUrl } = deps.oauth.initiateFlow({
        connectorId: name,
        workspaceId,
        scopes,
      });
      if (c.req.query('redirect') === 'true') {
        return c.redirect(authUrl);
      }
      return c.json({ authUrl, connector: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth initiation failed';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/:name/oauth/callback', async (c) => {
    if (!deps.oauth) return c.json({ error: 'OAuth not configured' }, 503);

    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      const errorDesc = c.req.query('error_description') ?? error;
      return c.html(oauthResultPage(false, `Authorization denied: ${errorDesc}`));
    }

    if (!code || !state) {
      return c.json({ error: 'Missing code or state parameter' }, 400);
    }

    try {
      const result = await deps.oauth.handleCallback({ code, state });
      return c.html(oauthResultPage(true, `Connected ${result.connectorId} successfully!`, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth callback failed';
      return c.html(oauthResultPage(false, message));
    }
  });

  app.post('/:name/oauth/refresh', async (c) => {
    if (!deps.oauth) return c.json({ error: 'OAuth not configured' }, 503);
    const { name } = c.req.param();
    const body = await c.req.json();
    const { grantId } = body as { grantId: string };
    if (!grantId) return c.json({ error: 'grantId required' }, 400);

    const newToken = await deps.oauth.refreshToken(grantId, name);
    if (!newToken) {
      return c.json({ error: 'Token refresh failed. Re-authorize the connector.' }, 401);
    }
    return c.json({ refreshed: true });
  });

  app.get('/:name', async (c) => {
    if (!deps.connectors) return c.json({ error: 'Connectors not configured' }, 503);
    const { name } = c.req.param();
    const connector = deps.connectors.getConnector(name);
    if (!connector) return c.json({ error: `Unknown connector: ${name}` }, 404);

    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) {
      return c.json(serializeConnector(connector, deps, null, null));
    }

    return c.json(await getConnectorStatus(deps, connector, workspaceId));
  });

  return app;
}

async function getConnectorStatus(deps: GatewayDeps, connector: Connector, workspaceId: string) {
  const grant = await deps.connectors?.getGrantByWorkspaceConnector(workspaceId, connector.id);
  const token = grant ? await deps.connectors?.getTokenRecord(grant.id) : null;
  return serializeConnector(connector, deps, grant ?? null, token ?? null);
}

function serializeConnector(
  connector: Connector,
  deps: GatewayDeps,
  grant: {
    id: string;
    workspaceId: string;
    scopes: unknown;
    grantedAt?: Date | string;
  } | null,
  token: {
    expiresAt?: Date | string | null;
    updatedAt?: Date | string;
  } | null,
) {
  const provider = deps.oauth?.getProvider(connector.id);
  const configured = connector.authType !== 'oauth2' || Boolean(provider?.clientId);
  const hasGrant = Boolean(grant);
  const hasToken = connector.authType === 'none' ? hasGrant : Boolean(token);
  const expiresAt = token?.expiresAt ? new Date(token.expiresAt).toISOString() : null;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  let connectionState: ConnectorConnectionState = 'available';
  if (!configured) {
    connectionState = 'configuration_required';
  } else if (connector.authType === 'none' && hasGrant) {
    connectionState = 'enabled';
  } else if (hasGrant && hasToken && !isExpired) {
    connectionState = 'connected';
  } else if (hasGrant && isExpired) {
    connectionState = 'reauthorization_required';
  } else if (hasGrant && connector.authType === 'oauth2') {
    connectionState = 'granted';
  } else if (hasGrant) {
    connectionState = 'awaiting_token';
  }

  return {
    id: connector.id,
    name: connector.name,
    description: connector.description,
    authType: connector.authType,
    requiredScopes: connector.requiredScopes,
    requiresApproval: connector.requiresApproval,
    configured,
    oauthEnabled: connector.authType === 'oauth2' && configured,
    connectionState,
    grantId: grant?.id ?? null,
    grantedAt: grant?.grantedAt ? new Date(grant.grantedAt).toISOString() : null,
    scopes: Array.isArray(grant?.scopes) ? grant.scopes : [],
    expiresAt,
    hasGrant,
    hasToken,
  };
}

type ConnectorConnectionState =
  | 'available'
  | 'enabled'
  | 'granted'
  | 'awaiting_token'
  | 'connected'
  | 'reauthorization_required'
  | 'configuration_required';

function oauthResultPage(
  success: boolean,
  message: string,
  result?: { connectorId: string; workspaceId: string; grantId: string },
): string {
  const icon = success ? '✅' : '❌';
  const color = success ? '#22c55e' : '#ef4444';

  return `<!DOCTYPE html>
<html>
<head>
  <title>HELM Pilot — ${success ? 'Connected' : 'Error'}</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1a1a1a; border: 1px solid #333; max-width: 400px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { color: ${color}; margin: 0 0 0.5rem; font-size: 1.25rem; }
    p { color: #aaa; margin: 0.5rem 0 0; font-size: 0.875rem; }
    .close { margin-top: 1.5rem; padding: 0.5rem 2rem; background: #333; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    .close:hover { background: #444; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${message}</h2>
    <p>${success ? 'You can close this window.' : 'Please try again.'}</p>
    <button class="close" onclick="window.close()">Close</button>
  </div>
  <script>
    ${success && result ? `
    if (window.opener) {
      window.opener.postMessage({
        type: 'helm-pilot-oauth-success',
        connectorId: '${result.connectorId}',
        workspaceId: '${result.workspaceId}',
        grantId: '${result.grantId}',
      }, '*');
      setTimeout(() => window.close(), 1500);
    }` : ''}
  </script>
</body>
</html>`;
}
