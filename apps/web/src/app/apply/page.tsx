'use client';

import { useEffect, useState } from 'react';
import { apiFetch, isAuthenticated } from '../../lib/api';

interface Application {
  id: string;
  targetProgram: string;
  status: string;
  name?: string;
  submittedAt?: string | null;
  createdAt?: string;
}

const STATUSES = ['draft', 'in_progress', 'in_review', 'submitted', 'accepted', 'rejected'];

export default function ApplyPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [program, setProgram] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isAuthenticated()) {
      window.location.href = '/login';
      return;
    }
    void load();
  }, []);

  async function load() {
    const data = await apiFetch<Application[]>('/api/applications');
    if (data) setApps(data);
  }

  async function create() {
    if (!program.trim()) {
      setError('Program name is required');
      return;
    }
    setError(null);
    await apiFetch('/api/applications', {
      method: 'POST',
      body: JSON.stringify({ targetProgram: program.trim() }),
    });
    setProgram('');
    await load();
  }

  async function updateStatus(id: string, status: string) {
    await apiFetch(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Apply</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Accelerator and fundraising applications. Each submission is a HELM-escalated
          action with a sealed PDF receipt.
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
        <h2 style={{ fontSize: 16, marginTop: 0 }}>New application</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="YC S26, Techstars, Antler…"
            style={{
              flex: 1,
              padding: 8,
              background: '#000',
              color: '#ededed',
              border: '1px solid #333',
              borderRadius: 4,
            }}
          />
          <button
            type="button"
            onClick={create}
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
            Create
          </button>
        </div>
        {error && (
          <div role="alert" style={{ marginTop: 10, color: '#e27a7a', fontSize: 13 }}>
            {error}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Applications ({apps.length})</h2>
        {apps.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No applications yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {apps.map((a) => (
              <li
                key={a.id}
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
                  <div style={{ fontWeight: 600 }}>{a.name ?? a.targetProgram}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {a.status}
                    {a.submittedAt
                      ? ` · submitted ${new Date(a.submittedAt).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                <select
                  value={a.status}
                  onChange={(e) => updateStatus(a.id, e.target.value)}
                  aria-label="Application status"
                  style={{
                    padding: 6,
                    background: '#000',
                    color: '#ededed',
                    border: '1px solid #333',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
