'use client';

import { useState } from 'react';
import { apiFetch, getWorkspaceId, isAuthenticated } from '../../lib/api';

interface SearchResult {
  pageId: string;
  title: string;
  excerpt: string;
  score: number;
  type: string;
}

export default function KnowledgePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteType, setNoteType] = useState('note');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (typeof window !== 'undefined' && !isAuthenticated()) {
    window.location.href = '/login';
    return null;
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    const data = await apiFetch<SearchResult[]>(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=20`);
    setResults(data ?? []);
    setSearched(true);
    setLoading(false);
  }

  async function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const wsId = getWorkspaceId();
    const result = await apiFetch<{ id: string }>('/api/knowledge/pages', {
      method: 'POST',
      body: JSON.stringify({ title: noteTitle, content: noteContent, type: noteType, workspaceId: wsId }),
    });
    if (result) {
      setNoteTitle('');
      setNoteContent('');
      setShowForm(false);
    } else {
      setError('Failed to create note');
    }
    setSubmitting(false);
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Memory</h1>
          <p style={{ color: '#888' }}>Search and manage shared intelligence and operational memory</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={btnPrimary}>
          {showForm ? 'Cancel' : '+ New Note'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateNote} style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #333', borderRadius: 8 }}>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="Note title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required style={inputStyle} />
            <textarea placeholder="Content" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
            <select value={noteType} onChange={(e) => setNoteType(e.target.value)} style={inputStyle}>
              <option value="note">Note</option>
              <option value="research">Research</option>
              <option value="insight">Insight</option>
              <option value="decision">Decision</option>
            </select>
            <button type="submit" disabled={submitting || !noteTitle} style={btnPrimary}>
              {submitting ? 'Creating...' : 'Create Note'}
            </button>
          </div>
        </form>
      )}

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search knowledge..."
          style={{ flex: 1, ...inputStyle }}
        />
        <button type="submit" disabled={loading} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#333', border: 'none', borderRadius: 6, color: '#ededed', cursor: 'pointer' }}>
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {searched && (
        <div style={{ marginTop: '1.5rem' }}>
          <p style={{ color: '#888', fontSize: '0.85rem' }}>
            {results.length} results for &quot;{query}&quot;
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {results.map((r) => (
              <div key={r.pageId} style={{ border: '1px solid #333', borderRadius: 8, padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{r.title}</h3>
                  <span style={{ fontSize: '0.75rem', color: '#555' }}>
                    {r.type} | {r.score.toFixed(3)}
                  </span>
                </div>
                <p style={{ margin: '0.5rem 0 0', color: '#888', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {r.excerpt.slice(0, 200)}...
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = { padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ededed', fontSize: '1rem' };
const btnPrimary: React.CSSProperties = { padding: '0.6rem 1.2rem', background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', fontSize: '0.9rem', cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#f44', marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #f44', borderRadius: 4, fontSize: '0.85rem' };
