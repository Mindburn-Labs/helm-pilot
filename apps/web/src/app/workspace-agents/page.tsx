import Link from 'next/link';
import type { CSSProperties } from 'react';

export const metadata = {
  title: 'Self-hostable Workspace Agents | HELM Pilot',
  description:
    'Run shared founder operators from Slack with self-hosted state, HELM-governed approvals, and signed receipt trails.',
};

const shell: CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at 18% 18%, rgba(232,106,81,0.14), transparent 28%), #13120f',
  color: '#f0ead9',
};

const container: CSSProperties = {
  width: 'min(1120px, calc(100% - 40px))',
  margin: '0 auto',
};

const eyebrow: CSSProperties = {
  margin: 0,
  color: '#d4a24c',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
};

const h1: CSSProperties = {
  margin: '14px 0 18px',
  maxWidth: 760,
  fontFamily: 'var(--ds-font-display)',
  fontSize: 'clamp(40px, 7vw, 80px)',
  lineHeight: 0.92,
  fontWeight: 700,
};

const lead: CSSProperties = {
  maxWidth: 720,
  margin: 0,
  color: '#c9c2b0',
  fontSize: 19,
  lineHeight: 1.55,
};

const buttonRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 28,
};

const primaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 6,
  background: '#e86a51',
  color: '#13120f',
  fontWeight: 800,
  textDecoration: 'none',
};

const secondaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 6,
  border: '1px solid #4a4539',
  color: '#f0ead9',
  textDecoration: 'none',
};

const sectionTitle: CSSProperties = {
  margin: '0 0 14px',
  fontSize: 24,
};

const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 14,
};

const card: CSSProperties = {
  minHeight: 142,
  border: '1px solid #332f27',
  borderRadius: 8,
  background: '#1a1814',
  padding: 18,
};

export default function WorkspaceAgentsPage() {
  return (
    <main style={shell}>
      <section style={{ ...container, padding: '44px 0 52px' }}>
        <nav
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 20,
            alignItems: 'center',
            marginBottom: 58,
          }}
        >
          <Link href="/" style={{ color: '#f0ead9', textDecoration: 'none', fontWeight: 800 }}>
            HELM Pilot
          </Link>
          <Link href="/settings" style={{ color: '#c9c2b0', textDecoration: 'none' }}>
            Connect Slack
          </Link>
        </nav>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
            gap: 36,
            alignItems: 'center',
          }}
        >
          <div>
            <p style={eyebrow}>Self-hostable Workspace Agents</p>
            <h1 style={h1}>Founder operators that live in Slack and answer to HELM.</h1>
            <p style={lead}>
              HELM Pilot turns repeatable founder workflows into shared Slack agents backed by
              Postgres state, local deployment, human approvals, and signed HELM receipt trails.
            </p>
            <div style={buttonRow}>
              <Link href="/settings" style={primaryButton}>
                Install Slack adapter
              </Link>
              <Link href="/governance" style={secondaryButton}>
                Review governance
              </Link>
            </div>
          </div>

          <AgentConsolePreview />
        </div>
      </section>

      <section style={{ ...container, paddingBottom: 54 }}>
        <h2 style={sectionTitle}>What ships in the self-hosted loop</h2>
        <div style={cardGrid}>
          <FeatureCard
            title="Slack ingress"
            body="Slash commands normalize into workspace-agent requests after Slack signature verification."
          />
          <FeatureCard
            title="HELM approvals"
            body="Sensitive actions pause for approval before email, CRM, repository, or deploy mutations."
          />
          <FeatureCard
            title="Receipt trail"
            body="Agent summaries post back to Slack with approval ids, evidence packs, and HELM receipts."
          />
          <FeatureCard
            title="Durable memory"
            body="Founder context stays in the self-hosted Postgres and pgvector deployment."
          />
        </div>
      </section>

      <section
        style={{
          borderTop: '1px solid #332f27',
          background: '#1a1814',
        }}
      >
        <div
          style={{
            ...container,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            padding: '32px 0',
            color: '#c9c2b0',
          }}
        >
          <Metric label="Deployment" value="Self-hosted" />
          <Metric label="Control point" value="HELM Kernel" />
          <Metric label="State" value="Postgres + pgvector" />
          <Metric label="Slack mode" value="Approval-first" />
        </div>
      </section>
    </main>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <article style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 18 }}>{title}</h3>
      <p style={{ margin: 0, color: '#c9c2b0', lineHeight: 1.5 }}>{body}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#8f897a', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f0ead9', fontSize: 20, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function AgentConsolePreview() {
  return (
    <div
      style={{
        border: '1px solid #4a4539',
        borderRadius: 8,
        background: '#201e19',
        boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid #332f27',
          color: '#c9c2b0',
          fontSize: 13,
        }}
      >
        <span>#founder-os</span>
        <span>HELM Pilot</span>
      </div>
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <PreviewLine speaker="/pilot" text="Prepare launch brief and queue investor follow-up" />
        <PreviewLine speaker="HELM" text="Approval required: gmail_send" tone="warn" />
        <PreviewLine speaker="Receipt" text="evidence_pack=evp-42 receipt=rcpt-18" tone="ok" />
      </div>
    </div>
  );
}

function PreviewLine({
  speaker,
  text,
  tone = 'info',
}: {
  speaker: string;
  text: string;
  tone?: 'info' | 'warn' | 'ok';
}) {
  const toneColor = tone === 'warn' ? '#d4a24c' : tone === 'ok' ? '#8fae86' : '#8aa4c8';
  return (
    <div
      style={{
        border: '1px solid #332f27',
        borderRadius: 8,
        background: '#13120f',
        padding: 12,
      }}
    >
      <div style={{ color: toneColor, fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
        {speaker}
      </div>
      <div style={{ color: '#f0ead9', fontSize: 14, lineHeight: 1.45 }}>{text}</div>
    </div>
  );
}
