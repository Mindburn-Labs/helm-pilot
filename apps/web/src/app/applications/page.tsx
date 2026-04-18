'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getWorkspaceId, isAuthenticated } from '../../lib/api';

interface Application {
  id: string;
  name: string;
  program: string;
  status: string;
  deadline: string | null;
  createdAt: string;
}

interface Draft {
  id: string;
  applicationId: string;
  section: string;
  content: string;
  version: number;
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [program, setProgram] = useState('yc');
  const [deadline, setDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftSection, setDraftSection] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/login'; return; }
    loadApplications();
  }, []);

  async function loadApplications() {
    setLoading(true);
    const wsId = getWorkspaceId();
    const data = await apiFetch<Application[]>(`/api/applications?workspaceId=${wsId}`);
    setApps(data ?? []);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const wsId = getWorkspaceId();
    const result = await apiFetch<Application>('/api/applications', {
      method: 'POST',
      body: JSON.stringify({ name, program, deadline: deadline || null, workspaceId: wsId }),
    });
    if (result) {
      setApps((prev) => [result, ...prev]);
      setName('');
      setProgram('yc');
      setDeadline('');
      setShowForm(false);
    } else {
      setError('Failed to create application');
    }
    setSubmitting(false);
  }

  async function handleSelectApp(id: string) {
    setSelectedApp(id);
    const data = await apiFetch<{ drafts: Draft[] }>(`/api/applications/${id}`);
    setDrafts(data?.drafts ?? []);
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedApp) return;
    setSavingDraft(true);
    const result = await apiFetch<Draft>(`/api/applications/${selectedApp}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: draftSection, content: draftContent }),
    });
    if (result) {
      setDrafts((prev) => {
        const existing = prev.findIndex((d) => d.section === draftSection);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = result;
          return updated;
        }
        return [...prev, result];
      });
      setDraftSection('');
      setDraftContent('');
    }
    setSavingDraft(false);
  }

  async function handleStatusChange(id: string, status: string) {
    await apiFetch(`/api/applications/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }

  const statusColor: Record<string, string> = {
    draft: '#888',
    in_progress: '#e86a51',
    submitted: '#4ade80',
    accepted: '#22d3ee',
    rejected: '#f87171',
  };

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Applications</h1>
          <p style={{ color: '#888' }}>Prepare YC and funding applications</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={btnPrimary}>
          {showForm ? 'Cancel' : '+ New Application'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #333', borderRadius: 8 }}>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="Application name" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
            <select value={program} onChange={(e) => setProgram(e.target.value)} style={inputStyle}>
              <option value="yc">Y Combinator</option>
              <option value="techstars">Techstars</option>
              <option value="500">500 Global</option>
              <option value="other">Other</option>
            </select>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} placeholder="Deadline (optional)" />
            <button type="submit" disabled={submitting || !name} style={btnPrimary}>
              {submitting ? 'Creating...' : 'Create Application'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading applications...</p>
      ) : apps.length === 0 && !selectedApp ? (
        <div style={{ marginTop: '2rem', padding: '2rem', border: '1px dashed #333', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ fontSize: '1.1rem' }}>No applications yet</p>
          <p style={{ color: '#888' }}>Click &quot;+ New Application&quot; to start preparing your YC or funding application.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem' }}>
          <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {apps.map((a) => (
              <div
                key={a.id}
                onClick={() => handleSelectApp(a.id)}
                style={{
                  border: `1px solid ${selectedApp === a.id ? '#c63a22' : '#333'}`,
                  borderRadius: 8,
                  padding: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{a.name}</strong>
                  <span style={{ fontSize: '0.7rem', color: statusColor[a.status] ?? '#888' }}>{a.status}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.25rem' }}>
                  {a.program}{a.deadline ? ` | Due: ${new Date(a.deadline).toLocaleDateString()}` : ''}
                </div>
              </div>
            ))}
          </div>

          {selectedApp && (
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button onClick={() => handleStatusChange(selectedApp, 'in_progress')} style={btnSmall}>In Progress</button>
                <button onClick={() => handleStatusChange(selectedApp, 'submitted')} style={{ ...btnSmall, color: '#4ade80' }}>Mark Submitted</button>
              </div>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Draft Sections</h3>
              {drafts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  {drafts.map((d) => (
                    <div key={d.id} style={{ border: '1px solid #333', borderRadius: 6, padding: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{d.section}</strong>
                        <span style={{ fontSize: '0.7rem', color: '#555' }}>v{d.version}</span>
                      </div>
                      <p style={{ margin: '0.25rem 0 0', color: '#aaa', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{d.content}</p>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSaveDraft} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input type="text" placeholder="Section (e.g. Company Description, YC Question 1)" value={draftSection} onChange={(e) => setDraftSection(e.target.value)} required style={inputStyle} />
                <textarea placeholder="Draft content..." value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={4} required style={{ ...inputStyle, resize: 'vertical' }} />
                <button type="submit" disabled={savingDraft || !draftSection || !draftContent} style={btnPrimary}>
                  {savingDraft ? 'Saving...' : 'Save Draft Section'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = { padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ededed', fontSize: '1rem' };
const btnPrimary: React.CSSProperties = { padding: '0.6rem 1.2rem', background: '#c63a22', border: 'none', borderRadius: 6, color: '#fff', fontSize: '0.9rem', cursor: 'pointer' };
const btnSmall: React.CSSProperties = { padding: '0.3rem 0.75rem', background: '#333', border: 'none', borderRadius: 4, color: '#ededed', fontSize: '0.8rem', cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#f44', marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #f44', borderRadius: 4, fontSize: '0.85rem' };
