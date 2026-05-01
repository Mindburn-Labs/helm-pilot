'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { API } from '../../../lib/api';

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const acceptInvite = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/invite/${token}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to accept invite');
        return;
      }
      localStorage.setItem('helm_user', JSON.stringify(data.user));
      localStorage.setItem('helm_workspace', JSON.stringify({ id: data.workspaceId }));
      window.location.href = '/';
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '4rem 2rem', textAlign: 'center' }}>
      <h1>Join Workspace</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        You've been invited to join a HELM Pilot workspace
      </p>

      {error && (
        <div
          style={{
            color: '#f44',
            marginBottom: '1rem',
            padding: '0.5rem',
            border: '1px solid #f44',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && acceptInvite()}
          style={{
            padding: '0.75rem 1rem',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            color: '#ededed',
            fontSize: '1rem',
          }}
        />
        <button
          onClick={acceptInvite}
          disabled={loading || !email}
          style={{
            padding: '0.75rem 1rem',
            background: '#2563eb',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Joining...' : 'Accept Invite'}
        </button>
      </div>
    </main>
  );
}
