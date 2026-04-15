/**
 * GitHub Connector — creates repos, issues, and lists issues.
 * Uses the GitHub REST API directly (no Octokit dependency).
 */
export class GitHubConnector {
  private readonly baseUrl = 'https://api.github.com';

  constructor(private readonly token: string) {}

  async createRepo(name: string, opts?: { private?: boolean; description?: string }): Promise<{ url: string; fullName: string }> {
    const response = await this.request('POST', '/user/repos', {
      name,
      private: opts?.private ?? true,
      description: opts?.description,
      auto_init: true,
    });
    return { url: response.html_url as string, fullName: response.full_name as string };
  }

  async createIssue(repo: string, title: string, body: string, labels?: string[]): Promise<{ number: number; url: string }> {
    const response = await this.request('POST', `/repos/${repo}/issues`, {
      title,
      body,
      labels,
    });
    return { number: response.number as number, url: response.html_url as string };
  }

  async listIssues(repo: string, state?: 'open' | 'closed' | 'all'): Promise<GitHubIssue[]> {
    const response = await this.request('GET', `/repos/${repo}/issues?state=${state ?? 'open'}&per_page=30`);
    return (response as unknown as GitHubIssue[]).map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.url,
      labels: issue.labels,
      createdAt: issue.createdAt,
    }));
  }

  async getRepo(repo: string): Promise<{ name: string; fullName: string; url: string; stars: number }> {
    const response = await this.request('GET', `/repos/${repo}`);
    return {
      name: response.name as string,
      fullName: response.full_name as string,
      url: response.html_url as string,
      stars: response.stargazers_count as number,
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'helm-pilot/0.1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: Array<{ name: string }>;
  createdAt: string;
}
