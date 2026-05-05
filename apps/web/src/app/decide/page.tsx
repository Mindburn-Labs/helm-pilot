'use client';

import { useEffect, useState } from 'react';
import { apiFetch, isAuthenticated } from '../../lib/api';

interface Opportunity {
  id: string;
  title: string;
  description: string;
  source: string;
  status: string;
}

type CourtMode = 'heuristic_preview' | 'governed_llm_court';

interface RankedOpportunity {
  opportunityId: string;
  rank: number;
  verdict: string;
  confidence: number;
  reasoning: string;
  bullCase: string;
  bearCase: string;
}

interface CourtModelCall {
  participant: string;
  opportunityId: string;
  status: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  policyDecisionId?: string;
}

interface CourtResult {
  mode?: CourtMode | 'unavailable';
  status?: 'completed' | 'unavailable' | 'governance_denied' | 'referee_failed';
  productionReady?: false;
  ranking?: RankedOpportunity[];
  finalRecommendation?: RankedOpportunity;
  modelCalls?: CourtModelCall[];
  unavailableReason?: string;
  governanceDenialReason?: string;
  capability?: { key: string; state: string; evalRequirement: string };
  error?: string;
}

export default function DecidePage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [context, setContext] = useState('');
  const [mode, setMode] = useState<CourtMode>('governed_llm_court');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CourtResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void load();
  }, []);

  async function load() {
    const data = await apiFetch<Opportunity[]>('/api/opportunities');
    if (data) setOpps(data);
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function runCourt() {
    if (selected.size === 0) {
      setError('Select at least one opportunity');
      return;
    }
    setError(null);
    setRunning(true);
    setResult(null);
    try {
      const body = {
        opportunityIds: Array.from(selected),
        founderContext: context.trim() || undefined,
        mode,
      };
      const data = await apiFetch<CourtResult>('/api/decide/court', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (data?.error) setError(data.error);
      else setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision court failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Decide</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Run the current decision-court capability on a shortlist. Gate 0 capability state is
          returned with the result and controls whether this surface can be treated as production
          autonomous.
        </p>
      </header>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Shortlist ({selected.size})</h2>
        {opps.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            No opportunities yet — <a href="/discover">discover some first</a>.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {opps.map((o) => (
              <li
                key={o.id}
                style={{
                  padding: 12,
                  border: selected.has(o.id) ? '1px solid #4a90e2' : '1px solid #2a2a2a',
                  borderRadius: 8,
                  marginBottom: 8,
                  cursor: 'pointer',
                  background: selected.has(o.id) ? '#15243a' : '#111',
                }}
                onClick={() => toggle(o.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') toggle(o.id);
                }}
                aria-pressed={selected.has(o.id)}
              >
                <div style={{ fontWeight: 600 }}>{o.title}</div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                  {o.source} · {o.status}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <label htmlFor="ctx" style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
          Founder context (optional)
        </label>
        <textarea
          id="ctx"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="What's the founder's axis of advantage, risk tolerance, time horizon..."
          style={{
            width: '100%',
            minHeight: 80,
            padding: 10,
            background: '#111',
            color: '#ededed',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            fontFamily: 'inherit',
            fontSize: 14,
          }}
        />
      </section>

      <section style={{ marginBottom: 24 }}>
        <label htmlFor="court-mode" style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
          Court mode
        </label>
        <select
          id="court-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as CourtMode)}
          style={{
            width: '100%',
            padding: 10,
            background: '#111',
            color: '#ededed',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            fontFamily: 'inherit',
            fontSize: 14,
          }}
        >
          <option value="governed_llm_court">Governed LLM court</option>
          <option value="heuristic_preview">Heuristic preview</option>
        </select>
      </section>

      <button
        type="button"
        onClick={runCourt}
        disabled={running || selected.size === 0}
        style={{
          padding: '10px 18px',
          background: running ? '#333' : '#4a90e2',
          color: 'white',
          border: 0,
          borderRadius: 6,
          cursor: running ? 'default' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {running ? 'Running court…' : `Run court (${selected.size})`}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 20,
            padding: 12,
            background: '#3a1212',
            border: '1px solid #5a2020',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Court result</h2>

          {result.capability && (
            <div
              style={{
                padding: 12,
                border: '1px solid var(--ds-line)',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                background: 'var(--ds-surface)',
              }}
            >
              Capability: <code>{result.capability.key}</code> is{' '}
              <strong>{result.capability.state}</strong>. Production gate:{' '}
              {result.capability.evalRequirement}.
            </div>
          )}

          <div
            style={{
              padding: 12,
              border: '1px solid var(--ds-line)',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              background: 'var(--ds-surface)',
            }}
          >
            Mode: <code>{result.mode ?? 'unknown'}</code>. Status:{' '}
            <strong>{result.status ?? 'unknown'}</strong>. Production-ready:{' '}
            <strong>{String(Boolean(result.productionReady))}</strong>.
          </div>

          {(result.unavailableReason || result.governanceDenialReason) && (
            <div
              role="status"
              style={{
                padding: 12,
                background: '#3a2812',
                border: '1px solid #5a4420',
                borderRadius: 8,
                marginBottom: 20,
                fontSize: 14,
              }}
            >
              {result.governanceDenialReason ?? result.unavailableReason}
            </div>
          )}

          {result.finalRecommendation && (
            <div
              style={{
                padding: 16,
                background: '#102820',
                border: '1px solid #1f4a3a',
                borderRadius: 8,
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>Final recommendation</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                {opps.find((o) => o.id === result.finalRecommendation?.opportunityId)?.title ??
                  result.finalRecommendation.opportunityId}
              </div>
              <div style={{ fontSize: 14, marginTop: 8, opacity: 0.9 }}>
                {result.finalRecommendation.verdict} at {result.finalRecommendation.confidence}%
                confidence. {result.finalRecommendation.reasoning}
              </div>
            </div>
          )}

          {Array.isArray(result.ranking) && result.ranking.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16 }}>Ranking</h3>
              <ol style={{ paddingLeft: 24 }}>
                {result.ranking.map((r) => {
                  const opp = opps.find((o) => o.id === r.opportunityId);
                  return (
                    <li key={r.opportunityId} style={{ marginBottom: 10 }}>
                      <strong>{opp?.title ?? r.opportunityId}</strong>
                      <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
                        {r.verdict} / {r.confidence}% - {r.reasoning}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {Array.isArray(result.ranking) && result.ranking.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, color: '#3ec28f' }}>Bull</h3>
                {result.ranking.map((r) => (
                  <div
                    key={r.opportunityId}
                    style={{
                      padding: 10,
                      background: '#0e1f16',
                      border: '1px solid #1f3a2a',
                      borderRadius: 6,
                      marginBottom: 8,
                      fontSize: 13,
                    }}
                  >
                    <strong>{opps.find((o) => o.id === r.opportunityId)?.title}</strong>
                    <div style={{ marginTop: 4 }}>{r.bullCase}</div>
                  </div>
                ))}
              </div>
              <div>
                <h3 style={{ fontSize: 14, color: '#e27a7a' }}>Bear</h3>
                {result.ranking.map((r) => (
                  <div
                    key={r.opportunityId}
                    style={{
                      padding: 10,
                      background: '#1f0e0e',
                      border: '1px solid #3a1f1f',
                      borderRadius: 6,
                      marginBottom: 8,
                      fontSize: 13,
                    }}
                  >
                    <strong>{opps.find((o) => o.id === r.opportunityId)?.title}</strong>
                    <div style={{ marginTop: 4 }}>{r.bearCase}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(result.modelCalls) && result.modelCalls.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 16 }}>Governed model calls</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {result.modelCalls.map((call, index) => (
                  <li
                    key={`${call.participant}-${call.opportunityId}-${index}`}
                    style={{
                      padding: 10,
                      background: '#111',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      marginBottom: 8,
                      fontSize: 13,
                    }}
                  >
                    <strong>{call.participant}</strong> on {call.opportunityId}: {call.status}
                    {call.policyDecisionId ? (
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                        receipt {call.policyDecisionId}; {call.tokensIn + call.tokensOut} tokens; $
                        {call.costUsd.toFixed(6)}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
