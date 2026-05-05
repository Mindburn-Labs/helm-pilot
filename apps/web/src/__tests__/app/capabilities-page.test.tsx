import { render, screen, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CapabilitiesPage from '../../app/capabilities/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('CapabilitiesPage', () => {
  it('renders capability states from the API without inflating production readiness', async () => {
    localStorage.setItem('helm_user', JSON.stringify({ id: 'user-1' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          summary: {
            generatedAt: '2026-05-05T00:00:00.000Z',
            total: 3,
            productionReady: 0,
            byState: {
              implemented: 0,
              prototype: 1,
              scaffolded: 0,
              stub: 1,
              blocked: 1,
              production_ready: 0,
            },
          },
          capabilities: [
            {
              key: 'decision_court',
              name: 'Decision Court',
              state: 'stub',
              summary: 'Heuristic preview only.',
              owner: 'Decision Agent',
              blockers: ['No governed LLM court path'],
              evidence: ['Gate 4 required'],
              evalRequirement: 'Decision Court Governed Model Eval',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
            {
              key: 'helm_receipts',
              name: 'Mandatory HELM receipts',
              state: 'prototype',
              summary: 'Receipt persistence is not yet global.',
              owner: 'Governance Agent',
              blockers: ['No mandatory global sink'],
              evidence: ['Gate 2 required'],
              evalRequirement: 'HELM Governance Eval',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
            {
              key: 'browser_execution',
              name: 'Browser execution',
              state: 'blocked',
              summary: 'No governed read/extract session manager.',
              owner: 'Browser Agent',
              blockers: ['No active tab grant model'],
              evidence: ['Gate 6 required'],
              evalRequirement: 'YC Logged-In Browser Extraction Eval',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<CapabilitiesPage />);

    expect(await screen.findByText('Capability Truth')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('decision_court')).toBeTruthy());

    expect(screen.getByText('0/3')).toBeTruthy();
    expect(screen.getAllByText('stub').length).toBeGreaterThan(0);
    expect(screen.getAllByText('prototype').length).toBeGreaterThan(0);
    expect(screen.getAllByText('blocked').length).toBeGreaterThan(0);
    expect(screen.queryByText('production ready')).toBeTruthy();
    expect(screen.queryByText('3/3')).toBeNull();
  });
});
