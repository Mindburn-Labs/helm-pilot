'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch, isAuthenticated } from '../../lib/api';

interface Artifact {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
}
interface Target {
  id: string;
  name: string;
  provider: string;
  config?: {
    region?: string;
    appName?: string;
    image?: string;
  };
}
interface Deployment {
  id: string;
  artifactId: string;
  targetId: string;
  version: string;
  status: string;
  url: string | null;
  startedAt: string;
  completedAt?: string | null;
}
interface ManagedTelegramBot {
  id: string;
  telegramBotUsername: string;
  telegramBotName: string;
  status: 'active' | 'disabled' | 'error';
  responseMode: 'intake_only' | 'approval_required' | 'autonomous_helm';
  welcomeCopy: string;
  launchUrl: string | null;
  supportPrompt: string | null;
}
interface ManagedTelegramProvisioningRequest {
  id: string;
  creationUrl: string;
  suggestedUsername: string;
  expiresAt: string;
}
interface ManagedTelegramMessage {
  id: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  inboundText: string;
  aiDraft: string | null;
  replyText: string | null;
  replyStatus: string;
  createdAt: string;
}
interface ManagedTelegramState {
  bot: ManagedTelegramBot | null;
  pendingRequest: ManagedTelegramProvisioningRequest | null;
  leads: Array<{ id: string }>;
  messages: ManagedTelegramMessage[];
}

export default function LaunchPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [version, setVersion] = useState('');
  const [image, setImage] = useState('');
  const [telegramState, setTelegramState] = useState<ManagedTelegramState | null>(null);
  const [welcomeCopy, setWelcomeCopy] = useState('');
  const [launchUrl, setLaunchUrl] = useState('');
  const [supportPrompt, setSupportPrompt] = useState('');
  const [responseMode, setResponseMode] =
    useState<ManagedTelegramBot['responseMode']>('approval_required');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void load();
  }, []);

  async function load() {
    const [a, t, d, tg] = await Promise.all([
      apiFetch<Artifact[]>('/api/launch/artifacts'),
      apiFetch<Target[]>('/api/launch/targets'),
      apiFetch<Deployment[]>('/api/launch/deployments'),
      apiFetch<ManagedTelegramState>('/api/launch/telegram-bot'),
    ]);
    if (a) setArtifacts(a);
    if (t) setTargets(t);
    if (d) setDeployments(d);
    if (tg) {
      setTelegramState(tg);
      if (tg.bot) {
        setWelcomeCopy(tg.bot.welcomeCopy);
        setLaunchUrl(tg.bot.launchUrl ?? '');
        setSupportPrompt(tg.bot.supportPrompt ?? '');
        setResponseMode(tg.bot.responseMode);
      }
    }
  }

  async function createTelegramBotRequest() {
    setError(null);
    const result = await apiFetch<ManagedTelegramProvisioningRequest>(
      '/api/launch/telegram-bot/provisioning-request',
      { method: 'POST', body: JSON.stringify({}) },
    );
    if (result) {
      await load();
      window.open(result.creationUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function saveTelegramBotSettings() {
    setError(null);
    await apiFetch('/api/launch/telegram-bot/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        responseMode,
        welcomeCopy,
        launchUrl: launchUrl.trim() || null,
        supportPrompt: supportPrompt.trim() || null,
      }),
    });
    await load();
  }

  async function replyToTelegramMessage(messageId: string) {
    const text = replyDrafts[messageId]?.trim();
    if (!text) return;
    await apiFetch(`/api/launch/telegram-bot/messages/${messageId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    setReplyDrafts((current) => ({ ...current, [messageId]: '' }));
    await load();
  }

  async function deploy() {
    const target = targets.find((t) => t.id === selectedTarget);
    if (!selectedArtifact || !selectedTarget || !version.trim()) {
      setError('Pick an artifact, target, and version tag');
      return;
    }
    if (!image.trim() && !target?.config?.image) {
      setError('Set a container image or choose a target with one configured');
      return;
    }
    setError(null);
    setRunning(true);
    try {
      await apiFetch('/api/launch/deployments', {
        method: 'POST',
        body: JSON.stringify({
          artifactId: selectedArtifact,
          targetId: selectedTarget,
          version: version.trim(),
          image: image.trim() || undefined,
        }),
      });
      await load();
      setVersion('');
      setImage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setRunning(false);
    }
  }

  async function runHealth(id: string) {
    await apiFetch(`/api/launch/deployments/${id}/health`, { method: 'POST' });
    await load();
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Launch</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Push an artifact to a deploy target. Every deploy crosses the HELM trust boundary and
          emits a signed receipt.
        </p>
      </header>

      <section
        style={{
          marginBottom: 32,
          padding: 16,
          background: '#111',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Telegram launch/support bot</h2>
        {!telegramState?.bot ? (
          <>
            <p style={{ opacity: 0.7, fontSize: 13 }}>
              Create a founder-owned Telegram bot for launch interest and support intake.
            </p>
            <button
              type="button"
              onClick={createTelegramBotRequest}
              style={{
                padding: '8px 18px',
                background: '#4a90e2',
                color: 'white',
                border: 0,
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Create setup link
            </button>
            {telegramState?.pendingRequest ? (
              <p style={{ fontSize: 12, opacity: 0.7 }}>
                Pending: @{telegramState.pendingRequest.suggestedUsername} · expires{' '}
                {new Date(telegramState.pendingRequest.expiresAt).toLocaleString()}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
              @{telegramState.bot.telegramBotUsername} · {telegramState.bot.status} ·{' '}
              {telegramState.leads.length} recent leads
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              <label style={{ fontSize: 13 }}>
                Response mode
                <select
                  value={responseMode}
                  onChange={(e) =>
                    setResponseMode(e.target.value as ManagedTelegramBot['responseMode'])
                  }
                  style={fieldStyle}
                >
                  <option value="intake_only">Intake only</option>
                  <option value="approval_required">Approval required</option>
                  <option value="autonomous_helm">Autonomous with HELM</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                Launch URL
                <input
                  value={launchUrl}
                  onChange={(e) => setLaunchUrl(e.target.value)}
                  placeholder="https://example.com"
                  style={fieldStyle}
                />
              </label>
            </div>
            <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>
              Welcome copy
              <textarea
                value={welcomeCopy}
                onChange={(e) => setWelcomeCopy(e.target.value)}
                rows={2}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>
              Support prompt
              <textarea
                value={supportPrompt}
                onChange={(e) => setSupportPrompt(e.target.value)}
                rows={2}
                style={fieldStyle}
              />
            </label>
            <button
              type="button"
              onClick={saveTelegramBotSettings}
              style={{
                marginTop: 12,
                padding: '8px 18px',
                background: '#4a90e2',
                color: 'white',
                border: 0,
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Save bot settings
            </button>

            <h3 style={{ fontSize: 14, marginTop: 20 }}>Recent support</h3>
            {telegramState.messages.length === 0 ? (
              <p style={{ opacity: 0.6, fontSize: 13 }}>No support messages yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {telegramState.messages.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      padding: 12,
                      border: '1px solid #2a2a2a',
                      borderRadius: 8,
                      marginBottom: 8,
                      background: '#0b0b0b',
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {m.telegramUsername
                        ? `@${m.telegramUsername}`
                        : (m.telegramFirstName ?? 'User')}{' '}
                      · {m.replyStatus} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div style={{ marginTop: 6 }}>{m.inboundText}</div>
                    {m.aiDraft ? (
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
                        Draft: {m.aiDraft}
                      </div>
                    ) : null}
                    {m.replyStatus !== 'sent' ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input
                          value={replyDrafts[m.id] ?? m.aiDraft ?? ''}
                          onChange={(e) =>
                            setReplyDrafts((current) => ({ ...current, [m.id]: e.target.value }))
                          }
                          style={fieldStyle}
                        />
                        <button
                          type="button"
                          onClick={() => replyToTelegramMessage(m.id)}
                          style={{
                            padding: '6px 12px',
                            background: '#222',
                            color: '#ededed',
                            border: '1px solid #444',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          Reply
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section
        style={{
          marginBottom: 32,
          padding: 16,
          background: '#111',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>New deployment</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <label style={{ fontSize: 13 }}>
            Artifact
            <select
              value={selectedArtifact}
              onChange={(e) => setSelectedArtifact(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: 8,
                background: '#000',
                color: '#ededed',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              <option value="">—</option>
              {artifacts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            Target
            <select
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: 8,
                background: '#000',
                color: '#ededed',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              <option value="">—</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.provider}
                  {t.config?.region ? ` (${t.config.region})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            Version tag
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v0.1.0"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: 8,
                background: '#000',
                color: '#ededed',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Image
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="registry.example.com/app:v0.1.0"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: 8,
                background: '#000',
                color: '#ededed',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={deploy}
          disabled={running}
          style={{
            marginTop: 12,
            padding: '8px 18px',
            background: running ? '#333' : '#4a90e2',
            color: 'white',
            border: 0,
            borderRadius: 6,
            cursor: running ? 'default' : 'pointer',
            fontWeight: 600,
          }}
        >
          {running ? 'Deploying…' : 'Deploy'}
        </button>
        {error && (
          <div role="alert" style={{ marginTop: 10, color: '#e27a7a', fontSize: 13 }}>
            {error}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Deployments ({deployments.length})</h2>
        {deployments.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No deployments yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {deployments.map((d) => (
              <li
                key={d.id}
                style={{
                  padding: 12,
                  border: '1px solid #2a2a2a',
                  borderRadius: 8,
                  marginBottom: 8,
                  background: '#111',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{d.version}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    <span style={{ color: statusColor(d.status) }}>● {d.status}</span>
                    {d.url ? (
                      <>
                        {' · '}
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#4a90e2' }}
                        >
                          {d.url}
                        </a>
                      </>
                    ) : null}
                    {' · '}
                    {new Date(d.startedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => runHealth(d.id)}
                  style={{
                    padding: '6px 12px',
                    background: '#222',
                    color: '#ededed',
                    border: '1px solid #444',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Run health check
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function statusColor(status: string): string {
  if (status === 'live') return '#3ec28f';
  if (status === 'failed') return '#e27a7a';
  if (status === 'rolled_back') return '#e2a84a';
  return '#888';
}

const fieldStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: 8,
  background: '#000',
  color: '#ededed',
  border: '1px solid #333',
  borderRadius: 4,
};
