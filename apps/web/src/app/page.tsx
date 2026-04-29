'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { isAuthenticated, logout } from '../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

export default function Home() {
  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/login';
    }
  }, []);

  if (typeof window !== 'undefined' && !isAuthenticated()) return null;

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <header
        style={{
          marginBottom: '3rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>HELM Pilot</h1>
          <p style={{ color: '#888', fontSize: '1.1rem' }}>
            Open-source autonomous founder operating system
          </p>
        </div>
        <button
          onClick={logout}
          style={{
            padding: '0.5rem 1rem',
            background: 'transparent',
            border: '1px solid #555',
            borderRadius: 6,
            color: '#888',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Sign out
        </button>
      </header>

      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
        }}
      >
        <NavCard
          href="/discover"
          title="Discover"
          description="Find startup opportunities matched to your strengths"
        />
        <NavCard
          href="/build"
          title="Build"
          description="Execute on your plan with AI co-founder operators"
        />
        <NavCard
          href="/workspace-agents"
          title="Workspace Agents"
          description="Run founder operators from Slack with HELM receipts"
        />
        <NavCard
          href="/operators"
          title="Operators"
          description="Manage your digital co-founder team"
        />
        <NavCard
          href="/knowledge"
          title="Memory"
          description="Browse the shared intelligence and operational memory"
        />
        <NavCard
          href="/applications"
          title="Applications"
          description="Prepare YC and funding applications"
        />
        <NavCard
          href="/settings"
          title="Settings"
          description="Workspace, profile, and configuration"
        />
      </nav>

      <footer style={{ marginTop: '4rem', color: '#555', fontSize: '0.85rem' }}>
        HELM Pilot v0.1.0 | API: {API_BASE}
      </footer>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '1.5rem',
        border: '1px solid #333',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.2s',
      }}
    >
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>{title}</h2>
      <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>{description}</p>
    </Link>
  );
}
