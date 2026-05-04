import Link from 'next/link';
import type { CSSProperties } from 'react';

export const metadata = {
  title: 'Pilot vs Replit Agent',
  description:
    'Pilot positioning against Replit Agent for founder-OS, mobile shipping, and governed deployment loops.',
};

const container: CSSProperties = {
  width: 'min(1120px, calc(100% - 40px))',
  margin: '0 auto',
};

const surface: CSSProperties = {
  border: '1px solid #2c3b3f',
  borderRadius: 8,
  background: '#15191b',
};

const cell: CSSProperties = {
  padding: 16,
  borderTop: '1px solid #2c3b3f',
};

export default function VsReplitPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#101315', color: '#f4efe4' }}>
      <section style={{ ...container, padding: '44px 0 38px' }}>
        <nav style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 52 }}>
          <Link href="/" style={{ color: '#f4efe4', textDecoration: 'none', fontWeight: 800 }}>
            Pilot
          </Link>
          <Link href="/workspace-agents" style={{ color: '#a8cfd6', textDecoration: 'none' }}>
            Workspace Agents
          </Link>
        </nav>

        <p
          style={{
            margin: 0,
            color: '#d8a64d',
            fontSize: 13,
            fontWeight: 800,
            textTransform: 'uppercase',
          }}
        >
          Positioning
        </p>
        <h1
          style={{
            margin: '14px 0 18px',
            maxWidth: 820,
            fontFamily: 'var(--ds-font-display)',
            fontSize: 52,
            lineHeight: 1,
          }}
        >
          Pilot is the self-hosted founder OS for governed mobile shipping.
        </h1>
        <p style={{ maxWidth: 760, margin: 0, color: '#c9c6ba', fontSize: 19, lineHeight: 1.55 }}>
          Replit Agent compresses the browser-to-mobile build loop with Agent, Expo Go, TestFlight,
          and App Store publishing. Pilot competes by keeping the founder state durable, the
          deployment self-hosted, and each external action gated through HELM.
        </p>
      </section>

      <section style={{ ...container, paddingBottom: 38 }}>
        <div
          style={{
            ...surface,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            overflow: 'hidden',
          }}
        >
          <HeaderCell label="Loop" />
          <HeaderCell label="Replit Agent" />
          <HeaderCell label="Pilot" />
          <CompareCell text="Mobile app creation" />
          <CompareCell text="Prompt to Expo/React Native project in Replit." />
          <CompareCell text="Telegram or Slack request to governed Expo/EAS plan." strong />
          <CompareCell text="Preview" />
          <CompareCell text="Expo Go and Replit workspace preview." />
          <CompareCell text="Expo Go preview after dependency and metadata checks." strong />
          <CompareCell text="Submission" />
          <CompareCell text="TestFlight and App Store path through Replit docs." />
          <CompareCell text="EAS build/submit commands pause for HELM approval first." strong />
          <CompareCell text="State" />
          <CompareCell text="Cloud workspace and Replit project context." />
          <CompareCell text="Self-hosted Postgres, pgvector memory, signed receipt trail." strong />
        </div>
      </section>

      <section style={{ ...container, padding: '0 0 54px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: 14,
          }}
        >
          <ProofCard
            title="Telegram to EAS"
            body="The mobile ship skill turns a founder Telegram request into Expo/EAS commands and HELM action checks."
          />
          <ProofCard
            title="Approval-first deploy"
            body="EAS builds, TestFlight promotion, and App Store submission are marked as approval-gated actions."
          />
          <ProofCard
            title="Durable evidence"
            body="The loop returns receipt ids and build references to the founder channel after approval."
          />
        </div>
      </section>

      <section style={{ ...container, padding: '0 0 44px', color: '#9a9386', fontSize: 13 }}>
        Source notes:{' '}
        <a href="https://docs.replit.com/tutorials/build-and-launch-a-mobile-app" style={linkStyle}>
          Replit mobile launch
        </a>
        ,{' '}
        <a href="https://docs.replit.com/tutorials/expo-on-replit" style={linkStyle}>
          Replit Expo
        </a>
        ,{' '}
        <a href="https://docs.replit.com/platforms/mobile-app" style={linkStyle}>
          Replit mobile app
        </a>
        .
      </section>
    </main>
  );
}

function HeaderCell({ label }: { label: string }) {
  return (
    <div style={{ padding: 16, background: '#1c2528', color: '#d8a64d', fontWeight: 800 }}>
      {label}
    </div>
  );
}

function CompareCell({ text, strong = false }: { text: string; strong?: boolean }) {
  return (
    <div style={{ ...cell, color: strong ? '#f4efe4' : '#c9c6ba', lineHeight: 1.45 }}>{text}</div>
  );
}

function ProofCard({ title, body }: { title: string; body: string }) {
  return (
    <article style={{ ...surface, padding: 18, minHeight: 136 }}>
      <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>{title}</h2>
      <p style={{ margin: 0, color: '#c9c6ba', lineHeight: 1.5 }}>{body}</p>
    </article>
  );
}

const linkStyle: CSSProperties = {
  color: '#8ecbd8',
  textDecoration: 'none',
};
