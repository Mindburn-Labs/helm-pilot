import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinearConnector } from '../linear.js';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  });
}

describe('LinearConnector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createIssue POSTs GraphQL mutation to Linear API', async () => {
    const mock = mockFetch({
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: 'iss_1',
            identifier: 'HEL-1',
            title: 'Bug',
            url: 'https://linear.app/x/iss/HEL-1',
            state: { name: 'Todo' },
          },
        },
      },
    });
    vi.stubGlobal('fetch', mock);

    const client = new LinearConnector('lin_tok');
    const issue = await client.createIssue({ teamId: 't1', title: 'Bug' });

    expect(issue.identifier).toBe('HEL-1');
    expect(mock).toHaveBeenCalledOnce();
    const [url, opts] = mock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.linear.app/graphql');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('lin_tok');
  });

  it('throws when Linear returns GraphQL errors', async () => {
    const mock = mockFetch({
      errors: [{ message: 'Invalid token' }],
    });
    vi.stubGlobal('fetch', mock);

    const client = new LinearConnector('bad');
    await expect(client.listTeams()).rejects.toThrow(/Invalid token/);
  });

  it('throws on non-ok HTTP status', async () => {
    const mock = mockFetch('Unauthorized', 401);
    vi.stubGlobal('fetch', mock);
    const client = new LinearConnector('x');
    await expect(client.listTeams()).rejects.toThrow(/401/);
  });

  it('listTeams returns team nodes', async () => {
    const mock = mockFetch({
      data: { teams: { nodes: [{ id: 't1', name: 'Eng', key: 'ENG' }] } },
    });
    vi.stubGlobal('fetch', mock);

    const client = new LinearConnector('x');
    const teams = await client.listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0]!.key).toBe('ENG');
  });

  it('listIssues builds filter from teamId + stateNames', async () => {
    const mock = mockFetch({ data: { issues: { nodes: [] } } });
    vi.stubGlobal('fetch', mock);

    const client = new LinearConnector('x');
    await client.listIssues({ teamId: 't1', stateNames: ['Todo', 'In Progress'], limit: 10 });

    const [, opts] = mock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { query: string };
    expect(body.query).toContain('team: { id: { eq: "t1" } }');
    expect(body.query).toContain('Todo');
    expect(body.query).toContain('In Progress');
  });

  it('updateIssue POSTs mutation with patch', async () => {
    const mock = mockFetch({
      data: {
        issueUpdate: {
          success: true,
          issue: {
            id: 'iss_1',
            identifier: 'HEL-1',
            title: 'Fixed',
            url: 'x',
            state: { name: 'Done' },
          },
        },
      },
    });
    vi.stubGlobal('fetch', mock);
    const client = new LinearConnector('x');
    const result = await client.updateIssue('iss_1', { title: 'Fixed' });
    expect(result.title).toBe('Fixed');
  });
});
