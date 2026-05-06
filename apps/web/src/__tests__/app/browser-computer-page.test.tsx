import { render, screen, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import BrowserComputerPage from '../../app/browser-computer/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('BrowserComputerPage', () => {
  it('renders real browser/computer API state without production promotion', async () => {
    localStorage.setItem('helm_user', JSON.stringify({ id: 'user-1' }));
    localStorage.setItem('helm_workspace', JSON.stringify({ id: 'ws-1' }));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: {
              total: 18,
              productionReady: 0,
              byState: {
                implemented: 8,
                prototype: 6,
                scaffolded: 0,
                stub: 0,
                blocked: 4,
                production_ready: 0,
              },
            },
            capabilities: [
              {
                key: 'browser_metadata_connector',
                name: 'Browser metadata connector',
                state: 'implemented',
                summary: 'Browser session and redacted observation records exist.',
                blockers: ['YC Logged-In Browser Extraction Eval has not promoted it'],
                evalRequirement: 'YC Logged-In Browser Extraction Eval',
              },
              {
                key: 'browser_execution',
                name: 'Browser execution',
                state: 'prototype',
                summary: 'Read-only governed browser observations exist.',
                blockers: ['No productized browser extension/bridge'],
                evalRequirement: 'YC Logged-In Browser Extraction Eval',
              },
              {
                key: 'computer_use',
                name: 'Computer and sandbox use',
                state: 'prototype',
                summary: 'Narrow safe computer actions exist.',
                blockers: ['Safe Computer/Sandbox Action Eval has not promoted it'],
                evalRequirement: 'Safe Computer/Sandbox Action Eval',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runtimeTruth: {
              productionReady: false,
              blockers: ['Mission runtime is still prototype-only'],
            },
            status: {
              browserObservations: 1,
              computerActions: 1,
            },
            recent: {
              browserObservations: [
                {
                  id: 'obs-1',
                  title: 'YC Account',
                  url: 'https://www.ycombinator.com/account',
                  origin: 'https://www.ycombinator.com',
                  domHash: 'sha256:dom',
                  redactions: ['token'],
                  evidencePackId: 'ep-1',
                  replayRef: 'browser:browser-session-1:0',
                },
              ],
              computerActions: [
                {
                  id: 'computer-1',
                  objective: 'Check dev server',
                  actionType: 'dev_server_status',
                  environment: 'local',
                  status: 'completed',
                  devServerUrl: 'http://localhost:3000',
                  evidencePackId: 'ep-2',
                  replayRef: 'computer:computer-1:0',
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessions: [
              {
                id: 'browser-session-1',
                name: 'YC profile',
                browser: 'chrome',
                status: 'active',
                allowedOrigins: ['https://www.ycombinator.com'],
                policyDecisionId: 'dec-browser',
                evidencePackId: 'ep-browser',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );

    render(<BrowserComputerPage />);

    expect(await screen.findByText('Browser/Computer Session Viewer')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('YC profile')).toBeTruthy());

    expect(screen.getByText('0/18')).toBeTruthy();
    expect(screen.getAllByText('prototype').length).toBeGreaterThan(0);
    expect(screen.getByText('implemented')).toBeTruthy();
    expect(screen.getByText(/browser:browser-session-1:0/)).toBeTruthy();
    expect(screen.getByText(/computer:computer-1:0/)).toBeTruthy();
    expect(screen.getByText(/dec-browser/)).toBeTruthy();
    expect(screen.getByText(/Browser and computer operation remains non-production/)).toBeTruthy();
    expect(screen.queryByText('18/18')).toBeNull();
  });
});
