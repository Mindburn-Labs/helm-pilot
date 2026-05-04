import { createLogger } from '@pilot/shared/logger';

const log = createLogger('linear-connector');

/**
 * Linear connector — create/list/update issues via Linear GraphQL API.
 *
 * Uses personal API tokens (Bearer auth). OAuth for Linear is also supported
 * server-side but tokens are simpler for the self-hosted case.
 *
 * API: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

export class LinearConnector {
  constructor(private readonly token: string) {}

  /** Create a new issue in a team. */
  async createIssue(params: {
    teamId: string;
    title: string;
    description?: string;
    priority?: 0 | 1 | 2 | 3 | 4;
    labelIds?: string[];
    assigneeId?: string;
  }): Promise<LinearIssue> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url state { name } }
        }
      }
    `;
    const response = await this.request<{
      issueCreate: { success: boolean; issue: LinearIssue | null };
    }>(mutation, {
      input: {
        teamId: params.teamId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        labelIds: params.labelIds,
        assigneeId: params.assigneeId,
      },
    });
    if (!response.issueCreate.success || !response.issueCreate.issue) {
      throw new Error('Linear issue creation failed');
    }
    log.info({ id: response.issueCreate.issue.id }, 'Linear issue created');
    return response.issueCreate.issue;
  }

  /** List issues in a team (or all teams) with optional filters. */
  async listIssues(params?: {
    teamId?: string;
    stateNames?: string[];
    limit?: number;
  }): Promise<LinearIssue[]> {
    const limit = Math.min(params?.limit ?? 50, 250);
    const filterClauses: string[] = [];
    if (params?.teamId) filterClauses.push(`team: { id: { eq: "${params.teamId}" } }`);
    if (params?.stateNames && params.stateNames.length > 0) {
      filterClauses.push(`state: { name: { in: [${params.stateNames.map((n) => JSON.stringify(n)).join(',')}] } }`);
    }
    const filter = filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} }` : '';
    const query = `
      query ListIssues {
        issues(first: ${limit}${filter ? `, ${filter}` : ''}) {
          nodes { id identifier title url state { name } }
        }
      }
    `;
    const response = await this.request<{ issues: { nodes: LinearIssue[] } }>(query);
    return response.issues.nodes;
  }

  /** Update issue fields (title, description, state, priority). */
  async updateIssue(
    id: string,
    patch: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: 0 | 1 | 2 | 3 | 4;
    },
  ): Promise<LinearIssue> {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier title url state { name } }
        }
      }
    `;
    const response = await this.request<{
      issueUpdate: { success: boolean; issue: LinearIssue | null };
    }>(mutation, { id, input: patch });
    if (!response.issueUpdate.success || !response.issueUpdate.issue) {
      throw new Error('Linear issue update failed');
    }
    return response.issueUpdate.issue;
  }

  /** List teams the authenticated user belongs to. */
  async listTeams(): Promise<LinearTeam[]> {
    const query = `
      query Teams { teams(first: 50) { nodes { id name key } } }
    `;
    const response = await this.request<{ teams: { nodes: LinearTeam[] } }>(query);
    return response.teams.nodes;
  }

  /** List projects in a team. */
  async listProjects(teamId?: string): Promise<LinearProject[]> {
    const filter = teamId ? `, filter: { team: { id: { eq: "${teamId}" } } }` : '';
    const query = `
      query Projects { projects(first: 50${filter}) { nodes { id name state url } } }
    `;
    const response = await this.request<{ projects: { nodes: LinearProject[] } }>(query);
    return response.projects.nodes;
  }

  // ─── Internal ───

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Linear API ${response.status}: ${text}`);
    }

    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (body.errors && body.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('Linear response missing data');
    return body.data;
  }
}

// ─── Types ───

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string };
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  state: string;
  url: string;
}
