import type { Metadata } from 'next';
import './ds.css';

export const metadata: Metadata = {
  title: 'HELM Pilot',
  description: 'Open-source autonomous founder operating system',
};

/**
 * Mindburn DS v1.0 — Graphite surface, bone ink, Inter Tight.
 * Source of truth: mindburn/app/styles/design-system.css.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '"Inter Tight", Inter, -apple-system, "Helvetica Neue", sans-serif',
          background: '#13120f',
          color: '#f0ead9',
          minHeight: '100vh',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {children}
      </body>
    </html>
  );
}
