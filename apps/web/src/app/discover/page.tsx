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

interface FounderStrength {
  dimension: string;
  score: number;
  evidence: string;
}

interface FounderProfile {
  id: string;
  name: string;
  background: string | null;
  experience: string | null;
  interests: string[];
  startupVector: string | null;
  strengths: FounderStrength[];
}

interface Candidate {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  fitSummary: string | null;
  latestScore?: { overallScore: number | null } | null;
}

interface ConnectorStatus {
  id: string;
  name: string;
  authType: 'oauth2' | 'api_key' | 'token' | 'session' | 'none';
  connectionState: string;
  hasSession: boolean;
  grantId: string | null;
  lastValidatedAt: string | null;
}

interface IngestionRecord {
  id: string;
  sourceOrigin: string;
  status: string;
  fetchedAt: string;
  itemCount: number | null;
}

export default function DiscoverPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [profile, setProfile] = useState<FounderProfile | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [ycConnector, setYcConnector] = useState<ConnectorStatus | null>(null);
  const [ingestionHistory, setIngestionHistory] = useState<IngestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOpportunityForm, setShowOpportunityForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('manual');
  const [founderIntake, setFounderIntake] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [candidateHeadline, setCandidateHeadline] = useState('');
  const [candidateBio, setCandidateBio] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncingPublic, setSyncingPublic] = useState(false);
  const [syncingPrivate, setSyncingPrivate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [opportunitiesData, profileData, candidatesData] = await Promise.all([
      apiFetch<Opportunity[]>('/api/opportunities'),
      apiFetch<FounderProfile>('/api/founder/profile').catch(() => null),
      apiFetch<Candidate[]>('/api/founder/candidates').catch(() => []),
    ]);
    const [ycConnectorData, historyData] = await Promise.all([
      apiFetch<ConnectorStatus>('/api/connectors/yc').catch(() => null),
      apiFetch<IngestionRecord[]>('/api/yc/ingestion/history?limit=5').catch(() => []),
    ]);

    setOpportunities(Array.isArray(opportunitiesData) ? opportunitiesData : []);
    setProfile(normalizeFounderProfile(profileData));
    setCandidates(Array.isArray(candidatesData) ? candidatesData : []);
    setYcConnector(ycConnectorData ?? null);
    setIngestionHistory(Array.isArray(historyData) ? historyData : []);
    setLoading(false);
  }

  async function handleCreateOpportunity(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const result = await apiFetch<Opportunity>('/api/opportunities', {
      method: 'POST',
      body: JSON.stringify({ title, description, source }),
    });
    if (result) {
      setOpportunities((prev) => [result, ...prev]);
      setTitle('');
      setDescription('');
      setSource('manual');
      setShowOpportunityForm(false);
    } else {
      setError('Failed to create opportunity');
    }
    setSubmitting(false);
  }

  async function handleAnalyzeFounder(e: React.FormEvent) {
    e.preventDefault();
    if (!founderIntake.trim()) return;
    setAnalyzing(true);
    setError('');
    const result = await apiFetch<FounderProfile>('/api/founder/analyze', {
      method: 'POST',
      body: JSON.stringify({ rawText: founderIntake }),
    });
    if (result) {
      const refreshed = await apiFetch<FounderProfile>('/api/founder/profile');
      setProfile(normalizeFounderProfile(refreshed));
      setFounderIntake('');
    } else {
      setError('Founder analysis failed');
    }
    setAnalyzing(false);
  }

  async function handleCreateCandidate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const result = await apiFetch<Candidate>('/api/founder/candidates', {
      method: 'POST',
      body: JSON.stringify({
        name: candidateName,
        headline: candidateHeadline || undefined,
        bio: candidateBio || undefined,
        source: 'manual',
      }),
    });
    if (result) {
      setCandidates((prev) => [result, ...prev]);
      setCandidateName('');
      setCandidateHeadline('');
      setCandidateBio('');
      setShowCandidateForm(false);
    } else {
      setError('Failed to add candidate');
    }
    setSubmitting(false);
  }

  async function handleScoreOpportunity(id: string) {
    await apiFetch(`/api/opportunities/${id}/score`, { method: 'POST' });
    setOpportunities((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'scoring' } : item)),
    );
  }

  async function handleScoreCandidate(id: string) {
    const result = await apiFetch<{ overallScore: number }>(
      '/api/founder/candidates/' + id + '/score',
      {
        method: 'POST',
      },
    );
    if (!result) return;

    const detail = await apiFetch<Candidate>('/api/founder/candidates/' + id);
    setCandidates((prev) =>
      prev.map((candidate) => (candidate.id === id ? (detail ?? candidate) : candidate)),
    );
  }

  async function handlePublicIngestion() {
    setSyncingPublic(true);
    setError('');
    const result = await apiFetch<{ queued: boolean }>('/api/yc/ingestion/public', {
      method: 'POST',
      body: JSON.stringify({ source: 'all', limit: 50 }),
    });
    if (!result?.queued) {
      setError('Failed to queue public YC ingestion');
    }
    await loadData();
    setSyncingPublic(false);
  }

  async function handlePrivateIngestion() {
    if (!ycConnector?.grantId) {
      setError('Connect the YC session in Settings first');
      return;
    }
    setSyncingPrivate(true);
    setError('');
    const result = await apiFetch<{ queued: boolean }>('/api/yc/ingestion/private', {
      method: 'POST',
      body: JSON.stringify({ grantId: ycConnector.grantId, action: 'sync', limit: 50 }),
    });
    if (!result?.queued) {
      setError('Failed to queue private YC sync');
    }
    await loadData();
    setSyncingPrivate(false);
  }

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1>Discover</h1>
          <p style={{ color: '#888' }}>
            Founder assessment, opportunity ranking, and real co-founder matching
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button onClick={() => setShowOpportunityForm((value) => !value)} style={btnPrimary}>
            {showOpportunityForm ? 'Cancel Opportunity' : '+ Opportunity'}
          </button>
          <button onClick={() => setShowCandidateForm((value) => !value)} style={btnSecondary}>
            {showCandidateForm ? 'Cancel Candidate' : '+ Co-founder Candidate'}
          </button>
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.25fr) minmax(320px, 0.95fr)',
          gap: '1rem',
          marginTop: '1.5rem',
        }}
      >
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={h2Style}>Founder Fit</h2>
              <p style={subtleStyle}>
                Analyze the founder profile and keep the startup vector current.
              </p>
            </div>
          </div>

          {profile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>{profile.name}</h3>
                  <p style={{ margin: '0.4rem 0 0', color: '#aaa' }}>
                    {profile.background ?? 'No background summary yet.'}
                  </p>
                </div>
                <div style={pillStyle}>{profile.interests.length} interests</div>
              </div>
              {profile.startupVector && (
                <div style={calloutStyle}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#7dd3fc',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    Startup Vector
                  </div>
                  <div style={{ marginTop: '0.35rem' }}>{profile.startupVector}</div>
                </div>
              )}
              {profile.strengths.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '0.65rem',
                  }}
                >
                  {profile.strengths.map((strength) => (
                    <div key={strength.dimension} style={miniCardStyle}>
                      <div
                        style={{ color: '#888', fontSize: '0.8rem', textTransform: 'capitalize' }}
                      >
                        {strength.dimension}
                      </div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{strength.score}</div>
                      <div style={{ color: '#666', fontSize: '0.78rem' }}>{strength.evidence}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: '#888', marginBottom: '1rem' }}>
              No founder profile yet. Run an intake below and the system will persist the profile,
              strengths, and startup vector.
            </div>
          )}

          <form
            onSubmit={handleAnalyzeFounder}
            style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <textarea
              placeholder="Describe the founder: background, shipped products, strengths, interests, what they want to build, where they feel weak."
              value={founderIntake}
              onChange={(e) => setFounderIntake(e.target.value)}
              rows={6}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <button type="submit" disabled={analyzing || !founderIntake.trim()} style={btnPrimary}>
              {analyzing ? 'Analyzing...' : 'Analyze Founder'}
            </button>
          </form>
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={h2Style}>YC Intelligence</h2>
              <p style={subtleStyle}>
                Queue public YC ingestion and private co-founder matching syncs.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button onClick={handlePublicIngestion} disabled={syncingPublic} style={btnPrimary}>
              {syncingPublic ? 'Queueing...' : 'Sync Public YC Data'}
            </button>
            <button
              onClick={handlePrivateIngestion}
              disabled={syncingPrivate || !ycConnector?.hasSession}
              style={btnSecondary}
            >
              {syncingPrivate ? 'Queueing...' : 'Sync Private YC Matching'}
            </button>
          </div>

          <div style={calloutStyle}>
            <div
              style={{
                fontSize: '0.8rem',
                color: '#7dd3fc',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              YC Session
            </div>
            <div style={{ marginTop: '0.35rem' }}>
              {ycConnector
                ? `${ycConnector.connectionState}${ycConnector.lastValidatedAt ? ` | validated ${new Date(ycConnector.lastValidatedAt).toLocaleString()}` : ''}`
                : 'Session status unavailable'}
            </div>
          </div>

          {ingestionHistory.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                marginTop: '1rem',
              }}
            >
              {ingestionHistory.map((record) => (
                <div key={record.id} style={miniCardStyle}>
                  <div style={{ fontWeight: 600 }}>{record.sourceOrigin}</div>
                  <div style={{ color: '#888', fontSize: '0.82rem', marginTop: '0.35rem' }}>
                    {record.status} | {record.itemCount ?? 0} items |{' '}
                    {new Date(record.fetchedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={h2Style}>Real Co-founder Matching</h2>
              <p style={subtleStyle}>
                Track candidates, score complementarity, and keep notes moving.
              </p>
            </div>
          </div>

          {showCandidateForm && (
            <form
              onSubmit={handleCreateCandidate}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <input
                type="text"
                placeholder="Candidate name"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                required
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Headline / role focus"
                value={candidateHeadline}
                onChange={(e) => setCandidateHeadline(e.target.value)}
                style={inputStyle}
              />
              <textarea
                placeholder="Relevant background, YC profile notes, or why they may fit."
                value={candidateBio}
                onChange={(e) => setCandidateBio(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <button type="submit" disabled={submitting || !candidateName} style={btnSecondary}>
                {submitting ? 'Saving...' : 'Add Candidate'}
              </button>
            </form>
          )}

          {candidates.length === 0 ? (
            <div style={emptyStateStyle}>No co-founder candidates yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {candidates.map((candidate) => (
                <div key={candidate.id} style={miniCardStyle}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{candidate.name}</div>
                      <div style={{ color: '#888', fontSize: '0.85rem' }}>
                        {candidate.headline ?? 'No headline yet'}
                      </div>
                    </div>
                    <button onClick={() => handleScoreCandidate(candidate.id)} style={btnSmall}>
                      Score Fit
                    </button>
                  </div>
                  {candidate.fitSummary && (
                    <p style={{ margin: '0.6rem 0 0', color: '#aaa', fontSize: '0.86rem' }}>
                      {candidate.fitSummary}
                    </p>
                  )}
                  <div style={{ marginTop: '0.6rem', color: '#666', fontSize: '0.8rem' }}>
                    Overall score: {candidate.latestScore?.overallScore ?? 'unscored'}
                    {candidate.location ? ` | ${candidate.location}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showOpportunityForm && (
        <form
          onSubmit={handleCreateOpportunity}
          style={{
            ...panelStyle,
            marginTop: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <h2 style={h2Style}>New Opportunity</h2>
          <input
            type="text"
            placeholder="Opportunity title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={inputStyle}
          />
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
            <option value="manual">Manual</option>
            <option value="yc">YC Research</option>
            <option value="market">Market Scan</option>
          </select>
          <button type="submit" disabled={submitting || !title} style={btnPrimary}>
            {submitting ? 'Creating...' : 'Create Opportunity'}
          </button>
        </form>
      )}

      <section style={{ ...panelStyle, marginTop: '1rem' }}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={h2Style}>Opportunities</h2>
            <p style={subtleStyle}>Rank startup paths and keep the pipeline moving.</p>
          </div>
        </div>

        {loading ? (
          <p>Loading opportunities...</p>
        ) : opportunities.length === 0 ? (
          <div style={emptyStateStyle}>No opportunities discovered yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {opportunities.map((opportunity) => (
              <div key={opportunity.id} style={miniCardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>{opportunity.title}</h3>
                    <div style={{ marginTop: '0.35rem', color: '#888', fontSize: '0.85rem' }}>
                      {opportunity.source} | {opportunity.status}
                    </div>
                  </div>
                  <button onClick={() => handleScoreOpportunity(opportunity.id)} style={btnSmall}>
                    Score
                  </button>
                </div>
                <p style={{ margin: '0.75rem 0 0', color: '#aaa' }}>{opportunity.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function normalizeFounderProfile(profile: FounderProfile | null): FounderProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    interests: Array.isArray(profile.interests) ? profile.interests : [],
    strengths: Array.isArray(profile.strengths) ? profile.strengths : [],
  };
}

const panelStyle: React.CSSProperties = {
  border: '1px solid #2b3547',
  borderRadius: 14,
  padding: '1.1rem',
  background: 'linear-gradient(180deg, rgba(13,20,32,0.94), rgba(10,14,24,0.98))',
};

const miniCardStyle: React.CSSProperties = {
  border: '1px solid #283244',
  borderRadius: 12,
  padding: '0.9rem',
  background: 'rgba(12, 18, 29, 0.88)',
};

const calloutStyle: React.CSSProperties = {
  padding: '0.85rem',
  borderRadius: 12,
  border: '1px solid #24415a',
  background: 'rgba(10, 31, 48, 0.55)',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
  marginBottom: '0.85rem',
};

const h2Style: React.CSSProperties = { margin: 0, fontSize: '1.1rem' };
const subtleStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  color: '#7b8798',
  fontSize: '0.9rem',
};
const emptyStateStyle: React.CSSProperties = {
  padding: '1rem',
  border: '1px dashed #344154',
  borderRadius: 12,
  color: '#7b8798',
};
const pillStyle: React.CSSProperties = {
  padding: '0.35rem 0.65rem',
  borderRadius: 999,
  border: '1px solid #33506d',
  color: '#ec7866',
  fontSize: '0.8rem',
};
const inputStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#0f1724',
  border: '1px solid #273244',
  borderRadius: 10,
  color: '#ededed',
  fontSize: '0.95rem',
};
const btnPrimary: React.CSSProperties = {
  padding: '0.65rem 1.05rem',
  background: '#2563eb',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontSize: '0.9rem',
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '0.65rem 1.05rem',
  background: '#0f766e',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontSize: '0.9rem',
  cursor: 'pointer',
};
const btnSmall: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  background: '#1f2937',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: '0.8rem',
  cursor: 'pointer',
};
const errorStyle: React.CSSProperties = {
  color: '#fca5a5',
  marginTop: '1rem',
  padding: '0.65rem 0.8rem',
  border: '1px solid #7f1d1d',
  borderRadius: 10,
  fontSize: '0.85rem',
  background: 'rgba(69, 10, 10, 0.25)',
};
