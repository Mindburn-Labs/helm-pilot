'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getWorkspaceId, isAuthenticated } from '../../lib/api';

interface Task {
  id: string;
  title: string;
  status: string;
  operatorId: string | null;
  createdAt: string;
}

export default function BuildPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/login'; return; }
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    const data = await apiFetch<Task[]>('/api/tasks');
    setTasks(data ?? []);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const wsId = getWorkspaceId();
    const result = await apiFetch<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, workspaceId: wsId }),
    });
    if (result) {
      setTasks((prev) => [result, ...prev]);
      setTitle('');
      setDescription('');
      setShowForm(false);
    } else {
      setError('Failed to create task');
    }
    setSubmitting(false);
  }

  async function handleStatusChange(id: string, status: string) {
    const result = await apiFetch<Task>(`/api/tasks/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    if (result) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    }
  }

  const statusColor: Record<string, string> = {
    pending: '#888',
    queued: '#e86a51',
    running: '#fbbf24',
    completed: '#4ade80',
    failed: '#f87171',
    cancelled: '#888',
    awaiting_approval: '#c084fc',
  };

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Build</h1>
          <p style={{ color: '#888' }}>Execute on your plan with AI co-founder operators</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={btnPrimary}>
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #333', borderRadius: 8 }}>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />
            <textarea placeholder="Description (what should the operator do?)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            <button type="submit" disabled={submitting || !title} style={btnPrimary}>
              {submitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <div style={{ marginTop: '2rem', padding: '2rem', border: '1px dashed #333', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ fontSize: '1.1rem' }}>No tasks yet</p>
          <p style={{ color: '#888' }}>Click &quot;+ New Task&quot; to create one. Operators will execute them through the agent loop.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ border: '1px solid #333', borderRadius: 8, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{t.title}</h3>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: '#1a1a1a',
                    color: statusColor[t.status] ?? '#888',
                    border: `1px solid ${statusColor[t.status] ?? '#333'}`,
                  }}>
                    {t.status}
                  </span>
                  {t.status === 'pending' && (
                    <button onClick={() => handleStatusChange(t.id, 'queued')} style={btnSmall}>Queue</button>
                  )}
                  {t.status === 'running' && (
                    <button onClick={() => handleStatusChange(t.id, 'cancelled')} style={{ ...btnSmall, color: '#f87171' }}>Cancel</button>
                  )}
                  {t.status !== 'completed' && t.status !== 'cancelled' && (
                    <button onClick={() => handleStatusChange(t.id, 'completed')} style={{ ...btnSmall, color: '#4ade80' }}>Done</button>
                  )}
                </div>
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#555' }}>
                Created: {new Date(t.createdAt).toLocaleDateString()}
                {t.operatorId ? ` | Operator: ${t.operatorId.slice(0, 8)}...` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = { padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ededed', fontSize: '1rem' };
const btnPrimary: React.CSSProperties = { padding: '0.6rem 1.2rem', background: '#c63a22', border: 'none', borderRadius: 6, color: '#fff', fontSize: '0.9rem', cursor: 'pointer' };
const btnSmall: React.CSSProperties = { padding: '0.3rem 0.75rem', background: '#333', border: 'none', borderRadius: 4, color: '#ededed', fontSize: '0.8rem', cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#f44', marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #f44', borderRadius: 4, fontSize: '0.85rem' };
