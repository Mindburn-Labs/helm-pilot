'use client';

import { useEffect, useState } from 'react';
import { apiFetch, isAuthenticated } from '../../lib/api';

// ─── Compliance dashboard (Phase 14 Track B) ───
//
// Lists the 5 regulated frameworks (SOC 2 / HIPAA / PCI / EU AI Act /
// ISO 42001), shows which are enabled for the workspace, lets the
// founder toggle them, and surfaces attestation history.

interface Framework {
  code: string;
  label: string;
  description: string;
  retentionDays: number;
  category: string;
  jurisdictions: string[];
}

interface FrameworksResponse {
  catalog: Framework[];
  enabled: string[];
}

interface Attestation {
  id: string;
  framework: string;
  attestedAt: string;
  bundleHash: string | null;
  expiresAt: string | null;
}

export default function CompliancePage() {
  const [data, setData] = useState<FrameworksResponse | null>(null);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void load();
  }, []);

  async function load() {
    try {
      const [fw, att] = await Promise.all([
        apiFetch<FrameworksResponse>('/api/compliance/frameworks'),
        apiFetch<{ attestations: Attestation[] }>('/api/compliance/attestations'),
      ]);
      if (fw) setData(fw);
      if (att) setAttestations(att.attestations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggle(code: string, enabled: boolean) {
    setBusy(code);
    try {
      if (enabled) {
        await apiFetch(`/api/compliance/frameworks/${code}`, { method: 'DELETE' });
      } else {
        await apiFetch('/api/compliance/frameworks', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function attest(code: string) {
    setBusy(`attest:${code}`);
    try {
      await apiFetch('/api/compliance/attest', {
        method: 'POST',
        body: JSON.stringify({ framework: code }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Compliance</h1>
      <p style={{ opacity: 0.7, marginBottom: 24 }}>
        Opt in to a regulated framework. Each one extends evidence retention
        and applies a P2 policy overlay. Attestations are HELM-signed bundles
        you can hand to an auditor.
      </p>

      {error ? (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: 'rgba(255,80,80,0.12)',
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Frameworks</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(data?.catalog ?? []).map((f) => {
            const enabled = (data?.enabled ?? []).includes(f.code);
            return (
              <li
                key={f.code}
                style={{
                  padding: 16,
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  marginBottom: 8,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {f.label}{' '}
                    <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 12 }}>
                      {f.category} · {f.jurisdictions.join(', ')} · retains {f.retentionDays}d
                    </span>
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                    {f.description}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void toggle(f.code, enabled)}
                    disabled={busy === f.code}
                    style={{
                      padding: '6px 12px',
                      background: enabled ? 'rgba(150,180,150,0.15)' : 'transparent',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 4,
                      cursor: busy ? 'wait' : 'pointer',
                      color: 'inherit',
                    }}
                  >
                    {enabled ? 'Enabled' : 'Enable'}
                  </button>
                  {enabled ? (
                    <button
                      onClick={() => void attest(f.code)}
                      disabled={busy === `attest:${f.code}`}
                      style={{
                        padding: '6px 12px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: 4,
                        cursor: busy ? 'wait' : 'pointer',
                        color: 'inherit',
                      }}
                    >
                      Generate attestation
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Attestation history</h2>
        {attestations.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No attestations yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {attestations.map((a) => (
              <li
                key={a.id}
                style={{
                  padding: 12,
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: 13,
                  display: 'grid',
                  gridTemplateColumns: '180px 220px 1fr',
                  gap: 12,
                }}
              >
                <span>{new Date(a.attestedAt).toISOString().slice(0, 19)}Z</span>
                <span>{a.framework}</span>
                <span style={{ opacity: 0.6 }}>
                  {a.bundleHash ? `hash ${a.bundleHash.slice(0, 16)}…` : '(no bundle hash)'}
                  {a.expiresAt
                    ? ` · expires ${new Date(a.expiresAt).toISOString().slice(0, 10)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
