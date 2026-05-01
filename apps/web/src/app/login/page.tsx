'use client';

import { useState } from 'react';
import { API } from '../../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');

  const requestCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/email/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to send code');
        return;
      }
      // In dev mode, the API returns the code
      if (data.code) setDevCode(data.code);
      setStep('code');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/email/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Invalid code');
        return;
      }
      // Store auth data
      localStorage.setItem('helm_user', JSON.stringify(data.user));
      if (data.workspace) {
        localStorage.setItem('helm_workspace', JSON.stringify(data.workspace));
      }
      window.location.href = '/';
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '4rem 2rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>HELM Pilot</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>Sign in to your founder workspace</p>

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

      {step === 'email' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && requestCode()}
            style={inputStyle}
          />
          <button onClick={requestCode} disabled={loading || !email} style={buttonStyle}>
            {loading ? 'Sending...' : 'Send Magic Code'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ color: '#aaa' }}>Check your email for a 6-digit code</p>
          {devCode && (
            <p style={{ color: '#4f4', fontSize: '0.85rem' }}>Dev mode: code is {devCode}</p>
          )}
          <input
            type="text"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
            maxLength={6}
            style={{
              ...inputStyle,
              textAlign: 'center',
              fontSize: '1.5rem',
              letterSpacing: '0.5rem',
            }}
          />
          <button onClick={verifyCode} disabled={loading || code.length !== 6} style={buttonStyle}>
            {loading ? 'Verifying...' : 'Verify Code'}
          </button>
          <button
            onClick={() => {
              setStep('email');
              setCode('');
              setDevCode('');
            }}
            style={{ ...buttonStyle, background: 'transparent', border: '1px solid #555' }}
          >
            Back
          </button>
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#ededed',
  fontSize: '1rem',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#2563eb',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontSize: '1rem',
  cursor: 'pointer',
};
