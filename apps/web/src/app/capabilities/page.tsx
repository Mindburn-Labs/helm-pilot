'use client';

import React, { type CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, isAuthenticated } from '../../lib/api';

type CapabilityState =
  | 'implemented'
  | 'prototype'
  | 'scaffolded'
  | 'stub'
  | 'blocked'
  | 'production_ready';

interface CapabilityRecord {
  key: string;
  name: string;
  state: CapabilityState;
  summary: string;
  owner: string;
  blockers: string[];
  evidence: string[];
  evalRequirement: string;
  updatedAt: string;
}

interface CapabilityResponse {
  summary: {
    generatedAt: string;
    total: number;
    productionReady: number;
    byState: Record<CapabilityState, number>;
  };
  capabilities: CapabilityRecord[];
}

const stateOrder: CapabilityState[] = [
  'production_ready',
  'implemented',
  'prototype',
  'scaffolded',
  'stub',
  'blocked',
];

export default function CapabilitiesPage() {
  const [data, setData] = useState<CapabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return;
    }

    apiFetch<CapabilityResponse>('/api/capabilities')
      .then((response) => {
        if (!response) {
          setError('Capability registry unavailable.');
          return;
        }
        setData(response);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const sortedCapabilities = useMemo(() => {
    return [...(data?.capabilities ?? [])].sort((a, b) => {
      const stateDelta = stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state);
      return stateDelta === 0 ? a.key.localeCompare(b.key) : stateDelta;
    });
  }, [data]);

  if (typeof window !== 'undefined' && !isAuthenticated()) return null;

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <Link href="/" style={backLinkStyle}>
            Pilot
          </Link>
          <h1 style={titleStyle}>Capability Truth</h1>
          <p style={subtitleStyle}>Authoritative Gate 0 state for production-readiness claims.</p>
        </div>
        {data ? (
          <div style={readinessCardStyle}>
            <span style={labelStyle}>Production ready</span>
            <strong style={readinessNumberStyle}>
              {data.summary.productionReady}/{data.summary.total}
            </strong>
          </div>
        ) : null}
      </header>

      {loading ? <section style={panelStyle}>Loading capability registry...</section> : null}

      {error ? (
        <section style={{ ...panelStyle, borderColor: 'var(--danger)' }}>
          <strong>Registry unavailable</strong>
          <p style={mutedTextStyle}>{error}</p>
        </section>
      ) : null}

      {data ? (
        <>
          <section style={stateGridStyle} aria-label="Capability state counts">
            {stateOrder.map((state) => (
              <div key={state} style={statCardStyle}>
                <span style={labelStyle}>{formatState(state)}</span>
                <strong style={statValueStyle}>{data.summary.byState[state] ?? 0}</strong>
              </div>
            ))}
          </section>

          <section style={matrixStyle} aria-label="Capability matrix">
            {sortedCapabilities.map((capability) => (
              <article key={capability.key} style={capabilityCardStyle}>
                <div style={capabilityHeaderStyle}>
                  <div>
                    <h2 style={capabilityTitleStyle}>{capability.name}</h2>
                    <code style={capabilityKeyStyle}>{capability.key}</code>
                  </div>
                  <span style={stateBadgeStyle(capability.state)}>
                    {formatState(capability.state)}
                  </span>
                </div>

                <p style={summaryStyle}>{capability.summary}</p>

                <div style={detailGridStyle}>
                  <CapabilityDetail title="Owner" value={capability.owner} />
                  <CapabilityDetail title="Eval gate" value={capability.evalRequirement} />
                  <CapabilityDetail
                    title="Blockers"
                    value={
                      capability.blockers.length === 0 ? 'None' : capability.blockers.join(' / ')
                    }
                  />
                  <CapabilityDetail
                    title="Evidence"
                    value={
                      capability.evidence.length === 0 ? 'None' : capability.evidence.join(' / ')
                    }
                  />
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}

function CapabilityDetail({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <span style={labelStyle}>{title}</span>
      <p style={detailValueStyle}>{value}</p>
    </div>
  );
}

function formatState(state: CapabilityState): string {
  return state.replace(/_/g, ' ');
}

function stateBadgeStyle(state: CapabilityState): CSSProperties {
  const palette: Record<CapabilityState, CSSProperties> = {
    production_ready: {
      color: 'var(--ok)',
      borderColor: 'var(--ok)',
      background: 'var(--ok-soft)',
    },
    implemented: {
      color: 'var(--info)',
      borderColor: 'var(--info)',
      background: 'var(--info-soft)',
    },
    prototype: {
      color: 'var(--warn)',
      borderColor: 'var(--warn)',
      background: 'var(--warn-soft)',
    },
    scaffolded: {
      color: 'var(--warn)',
      borderColor: 'var(--ds-line-2)',
      background: 'var(--ds-surface-2)',
    },
    stub: {
      color: 'var(--danger)',
      borderColor: 'var(--danger)',
      background: 'var(--accent-soft)',
    },
    blocked: {
      color: 'var(--danger)',
      borderColor: 'var(--danger)',
      background: 'var(--accent-soft)',
    },
  };

  return {
    ...badgeBaseStyle,
    ...palette[state],
  };
}

const pageStyle: CSSProperties = {
  maxWidth: 1180,
  margin: '0 auto',
  padding: '2rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
  marginBottom: '2rem',
};

const backLinkStyle: CSSProperties = {
  color: 'var(--ink-3)',
  textDecoration: 'none',
  fontSize: '0.9rem',
};

const titleStyle: CSSProperties = {
  margin: '0.35rem 0 0.35rem',
  fontSize: '2rem',
  fontWeight: 800,
};

const subtitleStyle: CSSProperties = {
  color: 'var(--ink-2)',
  margin: 0,
};

const readinessCardStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  background: 'var(--ds-surface)',
  borderRadius: 8,
  padding: '1rem',
  minWidth: 170,
};

const readinessNumberStyle: CSSProperties = {
  display: 'block',
  fontSize: '1.7rem',
  marginTop: '0.3rem',
};

const panelStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  background: 'var(--ds-surface)',
  padding: '1rem',
  marginBottom: '1rem',
};

const stateGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '0.75rem',
  marginBottom: '1rem',
};

const statCardStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  background: 'var(--ds-surface)',
  borderRadius: 8,
  padding: '1rem',
};

const statValueStyle: CSSProperties = {
  display: 'block',
  fontSize: '1.4rem',
  marginTop: '0.25rem',
};

const matrixStyle: CSSProperties = {
  display: 'grid',
  gap: '0.85rem',
};

const capabilityCardStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  background: 'var(--ds-surface)',
  borderRadius: 8,
  padding: '1rem',
};

const capabilityHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
};

const capabilityTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.1rem',
};

const capabilityKeyStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: '0.3rem',
  color: 'var(--ink-3)',
  fontSize: '0.78rem',
};

const badgeBaseStyle: CSSProperties = {
  border: '1px solid',
  borderRadius: 999,
  padding: '0.25rem 0.6rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const summaryStyle: CSSProperties = {
  margin: '0.9rem 0',
  color: 'var(--ink-2)',
  lineHeight: 1.45,
};

const detailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.8rem',
};

const labelStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: 0,
};

const detailValueStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  color: 'var(--ink)',
  lineHeight: 1.4,
};

const mutedTextStyle: CSSProperties = {
  color: 'var(--ink-2)',
  marginBottom: 0,
};
