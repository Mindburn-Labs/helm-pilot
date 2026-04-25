'use client';

import { useEffect, useState } from 'react';
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

export default function LaunchPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [version, setVersion] = useState('');
  const [image, setImage] = useState('');
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
    const [a, t, d] = await Promise.all([
      apiFetch<Artifact[]>('/api/launch/artifacts'),
      apiFetch<Target[]>('/api/launch/targets'),
      apiFetch<Deployment[]>('/api/launch/deployments'),
    ]);
    if (a) setArtifacts(a);
    if (t) setTargets(t);
    if (d) setDeployments(d);
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
