'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getWorkspaceId, isAuthenticated } from '../../lib/api';

interface WorkspaceSettings {
  workspaceId: string;
  policyConfig: {
    maxIterationBudget: number;
    toolBlocklist: string[];
    connectorAllowlist: string[];
    requireApprovalFor: string[];
    failClosed: boolean;
  };
  budgetConfig: {
    dailyTotalMax: number;
    perTaskMax: number;
    perOperatorMax: number;
    emergencyKill: number;
    currency: string;
  };
  modelConfig: {
    provider: string;
    model: string;
    temperature: number;
  };
}

interface ConnectorStatus {
  id: string;
  name: string;
  description: string;
  authType: 'oauth2' | 'api_key' | 'token' | 'session' | 'none';
  requiredScopes: string[];
  requiresApproval: boolean;
  configured: boolean;
  oauthEnabled: boolean;
  connectionState:
    | 'available'
    | 'enabled'
    | 'granted'
    | 'awaiting_token'
    | 'awaiting_session'
    | 'connected'
    | 'reauthorization_required'
    | 'configuration_required';
  grantId: string | null;
  grantedAt: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastValidatedAt: string | null;
  sessionType: string | null;
  hasGrant: boolean;
  hasToken: boolean;
  hasSession: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [sessionInputs, setSessionInputs] = useState<Record<string, string>>({});

  const [maxIterationBudget, setMaxIterationBudget] = useState(50);
  const [toolBlocklist, setToolBlocklist] = useState('');
  const [connectorAllowlist, setConnectorAllowlist] = useState('');
  const [requireApprovalFor, setRequireApprovalFor] = useState('');
  const [failClosed, setFailClosed] = useState(true);
  const [dailyTotalMax, setDailyTotalMax] = useState(500);
  const [perTaskMax, setPerTaskMax] = useState(100);
  const [perOperatorMax, setPerOperatorMax] = useState(200);
  const [emergencyKill, setEmergencyKill] = useState(1500);
  const [currency, setCurrency] = useState('EUR');
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('anthropic/claude-sonnet-4-20250514');
  const [temperature, setTemperature] = useState(0.7);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void loadAll();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'pilot-oauth-success') return;
      setSuccess(`Connected ${event.data.connectorId}`);
      void loadConnectors();
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadSettings(), loadConnectors()]);
    setLoading(false);
  }

  async function loadSettings() {
    const wsId = getWorkspaceId();
    if (!wsId) return;
    const data = await apiFetch<WorkspaceSettings>(`/api/workspace/${wsId}/settings`);
    if (!data) return;

    setSettings(data);
    setMaxIterationBudget(data.policyConfig.maxIterationBudget);
    setToolBlocklist(data.policyConfig.toolBlocklist.join(', '));
    setConnectorAllowlist(data.policyConfig.connectorAllowlist.join(', '));
    setRequireApprovalFor(data.policyConfig.requireApprovalFor.join(', '));
    setFailClosed(data.policyConfig.failClosed);
    setDailyTotalMax(data.budgetConfig.dailyTotalMax);
    setPerTaskMax(data.budgetConfig.perTaskMax);
    setPerOperatorMax(data.budgetConfig.perOperatorMax);
    setEmergencyKill(data.budgetConfig.emergencyKill);
    setCurrency(data.budgetConfig.currency);
    setProvider(data.modelConfig.provider);
    setModel(data.modelConfig.model);
    setTemperature(data.modelConfig.temperature);
  }

  async function loadConnectors() {
    const wsId = getWorkspaceId();
    if (!wsId) return;
    const data = await apiFetch<ConnectorStatus[]>(`/api/connectors?workspaceId=${wsId}`);
    setConnectors(data ?? []);
  }

  async function handleSave() {
    const wsId = getWorkspaceId();
    if (!wsId) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const result = await apiFetch<WorkspaceSettings>(`/api/workspace/${wsId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        policyConfig: {
          maxIterationBudget,
          toolBlocklist: splitCsv(toolBlocklist),
          connectorAllowlist: splitCsv(connectorAllowlist),
          requireApprovalFor: splitCsv(requireApprovalFor),
          failClosed,
        },
        budgetConfig: {
          dailyTotalMax,
          perTaskMax,
          perOperatorMax,
          emergencyKill,
          currency,
        },
        modelConfig: {
          provider,
          model,
          temperature,
        },
      }),
    });

    if (result) {
      setSettings(result);
      setSuccess('Settings saved');
    } else {
      setError('Failed to save settings');
    }

    setSaving(false);
  }

  async function handleInvite() {
    const wsId = getWorkspaceId();
    if (!wsId) return;
    setInviting(true);
    const result = await apiFetch<{ inviteUrl: string }>(`/api/workspace/${wsId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ role: inviteRole }),
    });
    if (result) {
      setInviteUrl(result.inviteUrl);
    }
    setInviting(false);
  }

  async function handleConnect(connector: ConnectorStatus) {
    const wsId = getWorkspaceId();
    if (!wsId) return;

    setConnectingId(connector.id);
    setError('');
    setSuccess('');

    if (connector.authType === 'oauth2') {
      const result = await apiFetch<{ authUrl: string; connector: string }>(
        `/api/connectors/${connector.id}/oauth/initiate?workspaceId=${wsId}`,
      );
      if (!result?.authUrl) {
        setError(`Failed to initiate ${connector.name} OAuth flow`);
        setConnectingId(null);
        return;
      }

      window.open(
        result.authUrl,
        `oauth-${connector.id}`,
        'popup=yes,width=640,height=760,resizable=yes,scrollbars=yes',
      );
      setSuccess(`Continue connecting ${connector.name} in the popup window`);
      setConnectingId(null);
      return;
    }

    if (connector.authType === 'token' || connector.authType === 'api_key') {
      const token = tokenInputs[connector.id]?.trim();
      if (!token) {
        setError(`Enter a token for ${connector.name} first`);
        setConnectingId(null);
        return;
      }

      const grantResult = await apiFetch<{ grantId: string }>(`/api/connectors/${connector.id}/grant`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: wsId, scopes: connector.requiredScopes }),
      });
      if (!grantResult?.grantId) {
        setError(`Failed to grant ${connector.name}`);
        setConnectingId(null);
        return;
      }

      const tokenResult = await apiFetch<{ stored: boolean }>(`/api/connectors/${connector.id}/token`, {
        method: 'POST',
        body: JSON.stringify({ grantId: grantResult.grantId, accessToken: token }),
      });
      if (!tokenResult?.stored) {
        setError(`Failed to store ${connector.name} token`);
        setConnectingId(null);
        return;
      }

      setTokenInputs((current) => ({ ...current, [connector.id]: '' }));
      setSuccess(`${connector.name} connected`);
      await loadConnectors();
      setConnectingId(null);
      return;
    }

    if (connector.authType === 'session') {
      const rawSession = sessionInputs[connector.id]?.trim();
      if (!rawSession) {
        setError(`Paste a session export for ${connector.name} first`);
        setConnectingId(null);
        return;
      }

      let sessionData: Record<string, unknown> | unknown[];
      try {
        sessionData = JSON.parse(rawSession) as Record<string, unknown> | unknown[];
      } catch {
        setError(`Session export for ${connector.name} must be valid JSON`);
        setConnectingId(null);
        return;
      }

      const grantResult = await apiFetch<{ grantId: string }>(`/api/connectors/${connector.id}/grant`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: wsId, scopes: connector.requiredScopes }),
      });
      if (!grantResult?.grantId) {
        setError(`Failed to grant ${connector.name}`);
        setConnectingId(null);
        return;
      }

      const sessionResult = await apiFetch<{ stored: boolean }>(`/api/connectors/${connector.id}/session`, {
        method: 'POST',
        body: JSON.stringify({
          grantId: grantResult.grantId,
          sessionType: 'browser_storage_state',
          sessionData,
          metadata: { uploadedFrom: 'web-settings' },
        }),
      });
      if (!sessionResult?.stored) {
        setError(`Failed to store ${connector.name} session`);
        setConnectingId(null);
        return;
      }

      setSessionInputs((current) => ({ ...current, [connector.id]: '' }));
      setSuccess(`${connector.name} session saved`);
      await loadConnectors();
      setConnectingId(null);
      return;
    }

    const grant = await apiFetch<{ grantId: string }>(`/api/connectors/${connector.id}/grant`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId: wsId, scopes: connector.requiredScopes }),
    });
    if (!grant?.grantId) {
      setError(`Failed to enable ${connector.name}`);
    } else {
      setSuccess(`${connector.name} enabled`);
      await loadConnectors();
    }
    setConnectingId(null);
  }

  async function handleDisconnect(connector: ConnectorStatus) {
    const wsId = getWorkspaceId();
    if (!wsId) return;

    setRevokingId(connector.id);
    setError('');
    const result = await apiFetch<{ revoked: boolean }>(
      `/api/connectors/${connector.id}/grant?workspaceId=${wsId}`,
      { method: 'DELETE' },
    );
    if (result?.revoked) {
      setSuccess(`${connector.name} disconnected`);
      await loadConnectors();
    } else {
      setError(`Failed to disconnect ${connector.name}`);
    }
    setRevokingId(null);
  }

  async function handleValidateSession(connector: ConnectorStatus) {
    if (!connector.grantId) {
      setError(`No grant found for ${connector.name}`);
      return;
    }

    setValidatingId(connector.id);
    setError('');
    const result = await apiFetch<{ queued: boolean }>(`/api/connectors/${connector.id}/session/validate`, {
      method: 'POST',
      body: JSON.stringify({ grantId: connector.grantId, action: 'validate' }),
    });
    if (result?.queued) {
      setSuccess(`${connector.name} validation queued`);
      await loadConnectors();
    } else {
      setError(`Failed to validate ${connector.name} session`);
    }
    setValidatingId(null);
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '2rem' }}>
        <p>Loading settings...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '2rem' }}>
      <h1>Settings</h1>
      <p style={{ color: '#888' }}>Runtime policy, model routing, connectors, and partner access</p>

      {success && <div style={successStyle}>{success}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionTitle}>Runtime Policy</h2>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Max Iteration Budget
            <input type="number" min={1} max={100} value={maxIterationBudget} onChange={(e) => setMaxIterationBudget(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Tool Blocklist
            <input type="text" value={toolBlocklist} onChange={(e) => setToolBlocklist(e.target.value)} placeholder="send_notification, github_create_repo" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Connector Allowlist
            <input type="text" value={connectorAllowlist} onChange={(e) => setConnectorAllowlist(e.target.value)} placeholder="github, gmail, gdrive" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Approval-Required Tools
            <input type="text" value={requireApprovalFor} onChange={(e) => setRequireApprovalFor(e.target.value)} placeholder="send_notification, create_artifact" style={inputStyle} />
          </label>
        </div>
        <label style={{ ...labelStyle, display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.9rem' }}>
          <input type="checkbox" checked={failClosed} onChange={(e) => setFailClosed(e.target.checked)} />
          Fail closed when policy is invalid
        </label>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionTitle}>Budget Limits</h2>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Daily Total Max
            <input type="number" min={0} value={dailyTotalMax} onChange={(e) => setDailyTotalMax(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Per Task Max
            <input type="number" min={0} value={perTaskMax} onChange={(e) => setPerTaskMax(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Per Operator Max
            <input type="number" min={0} value={perOperatorMax} onChange={(e) => setPerOperatorMax(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Emergency Kill
            <input type="number" min={0} value={emergencyKill} onChange={(e) => setEmergencyKill(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
        </div>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionTitle}>Model Routing Defaults</h2>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)} style={inputStyle}>
              <option value="openrouter">OpenRouter</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label style={labelStyle}>
            Model
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Temperature
            <input type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} style={inputStyle} />
          </label>
        </div>
      </section>

      <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, marginTop: '1.5rem' }}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      <section style={{ marginTop: '3rem', borderTop: '1px solid #333', paddingTop: '2rem' }}>
        <h2 style={sectionTitle}>Connectors</h2>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>
          Authorize real tools for Pilot. OAuth connectors open a popup. Internal connectors can be enabled directly.
        </p>

        <div style={{ display: 'grid', gap: '0.85rem', marginTop: '1rem' }}>
          {connectors.map((connector) => (
            <div key={connector.id} style={connectorCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{connector.name}</strong>
                    <span style={pillStyle}>{connector.authType}</span>
                    <span style={{ ...pillStyle, borderColor: '#334155', color: '#cbd5e1' }}>
                      {humanizeState(connector.connectionState)}
                    </span>
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: '0.45rem 0 0' }}>{connector.description}</p>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.55rem' }}>
                    Required scopes: {connector.requiredScopes.length > 0 ? connector.requiredScopes.join(', ') : 'none'}
                    {connector.requiresApproval ? ' | approval-gated' : ' | low-risk'}
                    {connector.expiresAt ? ` | expires ${new Date(connector.expiresAt).toLocaleString()}` : ''}
                    {connector.lastValidatedAt ? ` | validated ${new Date(connector.lastValidatedAt).toLocaleString()}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {connector.authType === 'session' && !connector.hasSession && (
                    <textarea
                      placeholder={`${connector.name} storage-state JSON`}
                      value={sessionInputs[connector.id] ?? ''}
                      onChange={(e) =>
                        setSessionInputs((current) => ({ ...current, [connector.id]: e.target.value }))
                      }
                      rows={5}
                      style={{ ...inputStyle, width: 320, minHeight: 120, marginTop: 0, resize: 'vertical' }}
                    />
                  )}

                  {(connector.authType === 'token' || connector.authType === 'api_key') && !connector.hasToken && (
                    <input
                      type="password"
                      placeholder={`${connector.name} token`}
                      value={tokenInputs[connector.id] ?? ''}
                      onChange={(e) =>
                        setTokenInputs((current) => ({ ...current, [connector.id]: e.target.value }))
                      }
                      style={{ ...inputStyle, width: 220, marginTop: 0 }}
                    />
                  )}

                  {(connector.authType === 'token' || connector.authType === 'api_key') && !connector.hasToken ? (
                    <button
                      onClick={() => handleConnect(connector)}
                      disabled={connectingId === connector.id}
                      style={btnPrimary}
                    >
                      {connectingId === connector.id ? 'Saving...' : 'Save Token'}
                    </button>
                  ) : connector.authType === 'session' && !connector.hasSession ? (
                    <button
                      onClick={() => handleConnect(connector)}
                      disabled={connectingId === connector.id}
                      style={btnPrimary}
                    >
                      {connectingId === connector.id ? 'Saving...' : 'Save Session'}
                    </button>
                  ) : connector.connectionState !== 'configuration_required' && connector.authType === 'none' && !connector.hasGrant ? (
                    <button
                      onClick={() => handleConnect(connector)}
                      disabled={connectingId === connector.id}
                      style={btnPrimary}
                    >
                      {connectingId === connector.id ? 'Working...' : 'Enable'}
                    </button>
                  ) : connector.authType === 'session' && connector.hasSession ? (
                    <>
                      <button
                        onClick={() => handleValidateSession(connector)}
                        disabled={validatingId === connector.id}
                        style={btnSecondary}
                      >
                        {validatingId === connector.id ? 'Queueing...' : 'Validate Session'}
                      </button>
                      <button
                        onClick={() => handleDisconnect(connector)}
                        disabled={revokingId === connector.id}
                        style={btnSecondary}
                      >
                        {revokingId === connector.id ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </>
                  ) : connector.hasGrant ? (
                    <button
                      onClick={() => handleDisconnect(connector)}
                      disabled={revokingId === connector.id}
                      style={btnSecondary}
                    >
                      {revokingId === connector.id ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(connector)}
                      disabled={connectingId === connector.id || connector.connectionState === 'configuration_required'}
                      style={btnPrimary}
                    >
                      {connectingId === connector.id
                        ? 'Connecting...'
                        : connector.authType === 'oauth2'
                          ? 'Connect'
                          : connector.authType === 'session'
                            ? 'Save Session'
                          : connector.authType === 'none'
                            ? 'Enable'
                            : 'Save Token'}
                    </button>
                  )}
                </div>
              </div>

              {connector.connectionState === 'configuration_required' && (
                <div style={warningStyle}>
                  OAuth is not configured for {connector.name}. Set the required client ID/secret env vars before connecting it.
                </div>
              )}
              {connector.authType === 'session' && (
                <div style={{ ...warningStyle, background: 'rgba(15, 23, 42, 0.35)', borderColor: '#334155', color: '#cbd5e1' }}>
                  Paste a founder-authorized Playwright storage-state JSON export. Pilot stores it encrypted at rest and uses it only for approval-gated YC automation.
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: '3rem', borderTop: '1px solid #333', paddingTop: '2rem' }}>
        <h2 style={sectionTitle}>Team</h2>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>Invite a partner or member into the shared workspace.</p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ ...labelStyle, minWidth: 180 }}>
            Role
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={inputStyle}>
              <option value="member">Member</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <button onClick={handleInvite} disabled={inviting} style={btnPrimary}>
            {inviting ? 'Generating...' : 'Generate Invite Link'}
          </button>
        </div>
        {inviteUrl && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#111827', border: '1px solid #334155', borderRadius: 8, wordBreak: 'break-all', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            {inviteUrl}
          </div>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionTitle}>Info</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <SettingsRow label="Workspace" value={settings?.workspaceId ?? 'unknown'} />
          <SettingsRow label="API Server" value={process.env.NEXT_PUBLIC_API_URL ?? 'same-origin'} />
          <SettingsRow label="Version" value="0.1.0" />
        </div>
      </section>
    </main>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', border: '1px solid #334155', borderRadius: 8 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{value}</span>
    </div>
  );
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function humanizeState(state: ConnectorStatus['connectionState']) {
  return state.replace(/_/g, ' ');
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '0.85rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#ededed',
  fontSize: '0.95rem',
  width: '100%',
  display: 'block',
  marginTop: '0.3rem',
};

const labelStyle: React.CSSProperties = { color: '#cbd5e1', fontSize: '0.85rem' };
const sectionTitle: React.CSSProperties = { fontSize: '1.1rem', marginBottom: '0.9rem' };
const btnPrimary: React.CSSProperties = { padding: '0.65rem 1.1rem', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.9rem', cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '0.65rem 1.1rem', background: '#1f2937', border: '1px solid #475569', borderRadius: 8, color: '#e5e7eb', fontSize: '0.9rem', cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#fecaca', marginTop: '1rem', padding: '0.65rem 0.8rem', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: '0.85rem', background: 'rgba(69, 10, 10, 0.25)' };
const successStyle: React.CSSProperties = { color: '#bbf7d0', marginTop: '1rem', padding: '0.65rem 0.8rem', border: '1px solid #166534', borderRadius: 8, fontSize: '0.85rem', background: 'rgba(20, 83, 45, 0.25)' };
const connectorCardStyle: React.CSSProperties = { padding: '1rem', border: '1px solid #334155', borderRadius: 12, background: '#0b1120' };
const pillStyle: React.CSSProperties = { padding: '0.2rem 0.5rem', borderRadius: 999, border: '1px solid #1d4ed8', color: '#ec7866', fontSize: '0.72rem', textTransform: 'uppercase' };
const warningStyle: React.CSSProperties = { marginTop: '0.85rem', padding: '0.6rem 0.75rem', borderRadius: 8, background: 'rgba(120, 53, 15, 0.2)', border: '1px solid #92400e', color: '#fcd34d', fontSize: '0.82rem' };
