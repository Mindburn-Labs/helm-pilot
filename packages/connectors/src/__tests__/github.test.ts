import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubConnector } from '../github.js';

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GitHubConnector', () => {
  const TOKEN = 'ghp_testToken123';
  let gh: GitHubConnector;

  beforeEach(() => {
    mockFetch.mockReset();
    gh = new GitHubConnector(TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createRepo POSTs to /user/repos', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ html_url: 'https://github.com/user/repo', full_name: 'user/repo' }),
    );

    const result = await gh.createRepo('repo');
    expect(result).toEqual({ url: 'https://github.com/user/repo', fullName: 'user/repo' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user/repos');
    expect(opts.method).toBe('POST');
  });

  it('createRepo defaults to private', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ html_url: 'https://github.com/u/r', full_name: 'u/r' }),
    );

    await gh.createRepo('r');

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.private).toBe(true);
  });

  it('createIssue POSTs with labels', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ number: 42, html_url: 'https://github.com/u/r/issues/42' }),
    );

    const result = await gh.createIssue('u/r', 'Bug', 'It is broken', ['bug', 'urgent']);
    expect(result).toEqual({ number: 42, url: 'https://github.com/u/r/issues/42' });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/u/r/issues');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.title).toBe('Bug');
    expect(body.body).toBe('It is broken');
    expect(body.labels).toEqual(['bug', 'urgent']);
  });

  it('listIssues GETs with state param', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse([
        { number: 1, title: 'first', state: 'closed', url: 'u', labels: [], createdAt: '2025-01-01' },
      ]),
    );

    const issues = await gh.listIssues('u/r', 'closed');
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('state=closed');
  });

  it('getRepo returns details', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ name: 'repo', full_name: 'u/repo', html_url: 'https://github.com/u/repo', stargazers_count: 99 }),
    );

    const repo = await gh.getRepo('u/repo');
    expect(repo).toEqual({
      name: 'repo',
      fullName: 'u/repo',
      url: 'https://github.com/u/repo',
      stars: 99,
    });
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(404, 'Not Found'));

    await expect(gh.getRepo('u/missing')).rejects.toThrow('GitHub API GET /repos/u/missing failed: 404');
  });

  it('sends Authorization header with token', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ name: 'r', full_name: 'u/r', html_url: 'url', stargazers_count: 0 }),
    );

    await gh.getRepo('u/r');

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('listIssues defaults state to open', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse([]));
    await gh.listIssues('u/r');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('state=open');
  });
});
