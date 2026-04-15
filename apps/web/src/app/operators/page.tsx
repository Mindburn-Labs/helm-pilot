'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getWorkspaceId, isAuthenticated } from '../../lib/api';

interface Operator {
  id: string;
  name: string;
  role: string;
  goal: string;
  isActive: string;
}

interface RoleDef {
  name: string;
  description: string;
}

export default function OperatorsPage() {
  const [ops, setOps] = useState<Operator[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/login'; return; }
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [opsData, rolesData] = await Promise.all([
      apiFetch<Operator[]>('/api/operators'),
      apiFetch<RoleDef[]>('/api/operators/roles'),
    ]);
    setOps(opsData ?? []);
    setRoles(rolesData ?? []);
    setLoading(false);
  }

  async function handleSaveGoal(id: string) {
    setSaving(true);
    const result = await apiFetch<Operator>(`/api/operators/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ goal: editGoal }),
    });
    if (result) {
      setOps((prev) => prev.map((o) => (o.id === id ? { ...o, goal: editGoal } : o)));
    }
    setEditingId(null);
    setSaving(false);
  }

  async function handleToggleActive(id: string, current: string) {
    const isActive = current === 'true' ? 'false' : 'true';
    const result = await apiFetch<Operator>(`/api/operators/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive }),
    });
    if (result) {
      setOps((prev) => prev.map((o) => (o.id === id ? { ...o, isActive } : o)));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    const wsId = getWorkspaceId();
    const result = await apiFetch<Operator>('/api/operators', {
      method: 'POST',
      body: JSON.stringify({ name: newName, role: newRole, goal: newGoal, workspaceId: wsId }),
    });
    if (result) {
      setOps((prev) => [...prev, result]);
      setNewName('');
      setNewRole('');
      setNewGoal('');
      setShowCreate(false);
    } else {
      setError('Failed to create operator');
    }
    setCreating(false);
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Operators</h1>
          <p style={{ color: '#888' }}>Your digital co-founder team</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} style={btnPrimary}>
          {showCreate ? 'Cancel' : '+ New Operator'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #333', borderRadius: 8 }}>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="Operator name" value={newName} onChange={(e) => setNewName(e.target.value)} required style={inputStyle} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputStyle} required>
              <option value="">Select a role...</option>
              {roles.map((r) => <option key={r.name} value={r.name}>{r.name} — {r.description}</option>)}
            </select>
            <textarea placeholder="Goal (what should this operator focus on?)" value={newGoal} onChange={(e) => setNewGoal(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            <button type="submit" disabled={creating || !newName || !newRole} style={btnPrimary}>
              {creating ? 'Creating...' : 'Create Operator'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {ops.length > 0 && (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1.2rem' }}>Active Operators</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {ops.map((op) => (
                  <div key={op.id} style={{ border: '1px solid #333', borderRadius: 8, padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>{op.name}</h3>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button onClick={() => handleToggleActive(op.id, op.isActive)} style={btnSmall}>
                          {op.isActive === 'true' ? 'Deactivate' : 'Activate'}
                        </button>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: op.isActive === 'true' ? '#1a3a1a' : '#3a1a1a',
                          color: op.isActive === 'true' ? '#4ade80' : '#f87171',
                        }}>
                          {op.isActive === 'true' ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.25rem' }}>Role: {op.role}</div>
                    {editingId === op.id ? (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <input value={editGoal} onChange={(e) => setEditGoal(e.target.value)} style={{ ...inputStyle, flex: 1, padding: '0.5rem' }} />
                        <button onClick={() => handleSaveGoal(op.id)} disabled={saving} style={btnSmall}>Save</button>
                        <button onClick={() => setEditingId(null)} style={btnSmall}>Cancel</button>
                      </div>
                    ) : (
                      <p
                        onClick={() => { setEditingId(op.id); setEditGoal(op.goal); }}
                        style={{ margin: '0.5rem 0 0', color: '#aaa', fontSize: '0.9rem', cursor: 'pointer' }}
                        title="Click to edit goal"
                      >
                        {op.goal || 'Click to set a goal...'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem' }}>Available Roles</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {roles.map((role) => (
                <div key={role.name} style={{ border: '1px solid #333', borderRadius: 8, padding: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', textTransform: 'capitalize' }}>{role.name}</h3>
                  <p style={{ margin: 0, color: '#888', fontSize: '0.85rem' }}>{role.description}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = { padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ededed', fontSize: '1rem' };
const btnPrimary: React.CSSProperties = { padding: '0.6rem 1.2rem', background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', fontSize: '0.9rem', cursor: 'pointer' };
const btnSmall: React.CSSProperties = { padding: '0.3rem 0.75rem', background: '#333', border: 'none', borderRadius: 4, color: '#ededed', fontSize: '0.8rem', cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#f44', marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #f44', borderRadius: 4, fontSize: '0.85rem' };
