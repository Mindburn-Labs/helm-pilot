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
  blockers: string[];
  evalRequirement: string;
}

interface CapabilityResponse {
  summary: {
    total: number;
    productionReady: number;
  };
  capabilities: CapabilityRecord[];
}

type DurableRow = Record<string, unknown>;

interface CommandCenterResponse {
  runtimeTruth: {
    productionReady: boolean;
    blockers: string[];
  };
  status: {
    browserObservations: number;
    computerActions: number;
  };
  recent: {
    browserObservations: DurableRow[];
    computerActions: DurableRow[];
  };
}

interface BrowserSessionsResponse {
  sessions: DurableRow[];
}

interface ViewerState {
  capabilities: CapabilityResponse;
  commandCenter: CommandCenterResponse;
  browserSessions: BrowserSessionsResponse;
}

const viewerCapabilityKeys = ['browser_metadata_connector', 'browser_execution', 'computer_use'];

export default function BrowserComputerPage() {
  const [data, setData] = useState<ViewerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return;
    }

    let cancelled = false;
    Promise.all([
      apiFetch<CapabilityResponse>('/api/capabilities'),
      apiFetch<CommandCenterResponse>('/api/command-center'),
      apiFetch<BrowserSessionsResponse>('/api/browser-sessions'),
    ])
      .then(([capabilities, commandCenter, browserSessions]) => {
        if (cancelled) return;
        if (!capabilities || !commandCenter || !browserSessions) {
          setError('Browser/computer state unavailable.');
          return;
        }
        setData({ capabilities, commandCenter, browserSessions });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const viewerCapabilities = useMemo(() => {
    const records = data?.capabilities.capabilities ?? [];
    return viewerCapabilityKeys
      .map((key) => records.find((record) => record.key === key))
      .filter((record): record is CapabilityRecord => Boolean(record));
  }, [data]);

  if (typeof window !== 'undefined' && !isAuthenticated()) return null;

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <Link href="/" style={backLinkStyle}>
            Pilot
          </Link>
          <h1 style={titleStyle}>Browser/Computer Session Viewer</h1>
          <p style={subtitleStyle}>
            Governed session state, replay references, evidence pointers, and blockers.
          </p>
        </div>
        {data ? (
          <div style={readinessStyle}>
            <span style={labelStyle}>Production ready</span>
            <strong style={readinessNumberStyle}>
              {data.capabilities.summary.productionReady}/{data.capabilities.summary.total}
            </strong>
          </div>
        ) : null}
      </header>

      {loading ? <section style={noticeStyle}>Loading browser/computer state...</section> : null}

      {error ? (
        <section style={{ ...noticeStyle, borderColor: 'var(--danger)' }}>
          <strong>State unavailable</strong>
          <p style={mutedTextStyle}>{error}</p>
        </section>
      ) : null}

      {data ? (
        <>
          <section style={statGridStyle} aria-label="Browser and computer state counts">
            <Stat label="Browser sessions" value={data.browserSessions.sessions.length} />
            <Stat
              label="Browser observations"
              value={data.commandCenter.status.browserObservations}
            />
            <Stat label="Computer actions" value={data.commandCenter.status.computerActions} />
          </section>

          <section style={sectionStyle} aria-label="Viewer capability states">
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Capability State</h2>
              <span style={subtleBadgeStyle}>no production promotion</span>
            </div>
            <div style={capabilityGridStyle}>
              {viewerCapabilities.map((capability) => (
                <article key={capability.key} style={rowStyle}>
                  <div style={rowHeaderStyle}>
                    <div>
                      <h3 style={rowTitleStyle}>{capability.name}</h3>
                      <code style={codeStyle}>{capability.key}</code>
                    </div>
                    <span style={stateBadgeStyle(capability.state)}>
                      {formatState(capability.state)}
                    </span>
                  </div>
                  <p style={mutedTextStyle}>{capability.summary}</p>
                  <p style={detailStyle}>
                    Eval gate: {capability.evalRequirement} / Blockers:{' '}
                    {capability.blockers.length > 0 ? capability.blockers.join(' / ') : 'None'}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section style={splitStyle}>
            <Timeline
              title="Browser Sessions"
              empty="No browser sessions recorded for this workspace."
              rows={data.browserSessions.sessions.map((session) => ({
                id: String(session.id ?? session.name ?? 'browser-session'),
                title: display(session.name, display(session.browser, 'Browser session')),
                meta: `${display(session.status, 'unknown')} / ${display(session.browser, 'browser')}`,
                detail: `origins ${arrayDisplay(session.allowedOrigins)} / policy ${display(session.policyDecisionId, 'none')} / evidence ${display(session.evidencePackId, 'none')}`,
              }))}
            />

            <Timeline
              title="Browser Observations"
              empty="No browser observations recorded yet."
              rows={data.commandCenter.recent.browserObservations.map((observation) => ({
                id: String(observation.id ?? observation.url ?? 'browser-observation'),
                title: display(observation.title, display(observation.url, 'Browser observation')),
                meta: display(observation.origin, 'origin'),
                detail: `replay ${display(observation.replayRef, 'unlinked')} / DOM ${display(observation.domHash, 'unhashed')} / redactions ${arrayCount(observation.redactions)} / evidence ${display(observation.evidencePackId, 'none')}`,
              }))}
            />
          </section>

          <section style={sectionStyle} aria-label="Computer actions">
            <Timeline
              title="Computer Actions"
              empty="No safe computer actions recorded yet."
              rows={data.commandCenter.recent.computerActions.map((action) => ({
                id: String(action.id ?? action.objective ?? 'computer-action'),
                title: display(action.objective, display(action.actionType, 'Computer action')),
                meta: `${display(action.status, 'unknown')} / ${display(action.environment, 'local')}`,
                detail: `replay ${display(action.replayRef, 'unlinked')} / ${display(action.command, display(action.filePath, display(action.devServerUrl, 'no command')))} / evidence ${display(action.evidencePackId, 'none')}`,
              }))}
            />
          </section>

          <section style={noticeStyle}>
            <strong>Runtime truth</strong>
            <p style={mutedTextStyle}>
              {data.commandCenter.runtimeTruth.productionReady
                ? 'Command center runtime truth is marked production_ready.'
                : 'Browser and computer operation remains non-production unless the relevant evals pass.'}
            </p>
            {data.commandCenter.runtimeTruth.blockers.slice(0, 4).map((blocker) => (
              <p key={blocker} style={detailStyle}>
                {blocker}
              </p>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={statStyle}>
      <span style={labelStyle}>{label}</span>
      <strong style={statValueStyle}>{value}</strong>
    </div>
  );
}

function Timeline({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; title: string; meta: string; detail: string }>;
}) {
  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <h2 style={sectionTitleStyle}>{title}</h2>
        <span style={subtleBadgeStyle}>{rows.length}</span>
      </div>
      {rows.length === 0 ? <p style={mutedTextStyle}>{empty}</p> : null}
      <div style={rowStackStyle}>
        {rows.map((row) => (
          <article key={row.id} style={rowStyle}>
            <div style={rowHeaderStyle}>
              <h3 style={rowTitleStyle}>{row.title}</h3>
              <span style={metaStyle}>{row.meta}</span>
            </div>
            <p style={detailStyle}>{row.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function display(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function arrayDisplay(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'none';
  return value.filter((item) => typeof item === 'string' && item.length > 0).join(', ');
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
    ...badgeStyle,
    ...palette[state],
  };
}

const pageStyle: CSSProperties = {
  maxWidth: 1220,
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

const readinessStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  padding: '1rem',
  minWidth: 170,
};

const readinessNumberStyle: CSSProperties = {
  display: 'block',
  fontSize: '1.7rem',
  marginTop: '0.3rem',
};

const statGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '1rem',
  marginBottom: '1.5rem',
};

const statStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  padding: '1rem',
};

const statValueStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.35rem',
  fontSize: '1.7rem',
};

const splitStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '1rem',
  marginBottom: '1.5rem',
};

const sectionStyle: CSSProperties = {
  marginBottom: '1.5rem',
};

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'center',
  marginBottom: '0.75rem',
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.15rem',
};

const capabilityGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '1rem',
};

const rowStackStyle: CSSProperties = {
  display: 'grid',
  gap: '0.75rem',
};

const rowStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  padding: '1rem',
};

const rowHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
};

const rowTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1rem',
};

const labelStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: 0,
};

const mutedTextStyle: CSSProperties = {
  color: 'var(--ink-2)',
  margin: '0.65rem 0 0',
  lineHeight: 1.5,
};

const detailStyle: CSSProperties = {
  color: 'var(--ink-2)',
  margin: '0.5rem 0 0',
  fontSize: '0.9rem',
  lineHeight: 1.45,
};

const metaStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '0.86rem',
};

const codeStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '0.82rem',
};

const badgeStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 999,
  padding: '0.25rem 0.55rem',
  fontSize: '0.75rem',
  whiteSpace: 'nowrap',
};

const subtleBadgeStyle: CSSProperties = {
  ...badgeStyle,
  color: 'var(--ink-2)',
};

const noticeStyle: CSSProperties = {
  border: '1px solid var(--ds-line)',
  borderRadius: 8,
  padding: '1rem',
  marginBottom: '1.5rem',
};
