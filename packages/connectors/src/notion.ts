// ─── Notion Connector (Phase 15 Track I) ───
//
// Thin REST wrapper over Notion API v1 (2022-06-28). Bearer-token auth
// (internal-integration token or OAuth `access_token`). Returns minimal
// typed shapes — Notion responses are deeply nested and most fields
// uninteresting to a founder.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionSearchResult {
  id: string;
  url: string;
  title: string;
  lastEditedTime: string;
}

export interface NotionPageCreateResult {
  id: string;
  url: string;
}

export interface NotionPageDetail {
  id: string;
  url: string;
  title: string;
  lastEditedTime: string;
  properties: Record<string, unknown>;
}

export class NotionError extends Error {
  constructor(message: string, readonly notionCode?: string) {
    super(message);
    this.name = 'NotionError';
  }
}

export class NotionConnector {
  constructor(private readonly token: string) {
    if (!token) throw new NotionError('Notion token is required');
  }

  /**
   * Search across pages the integration has access to.
   * Returns up to `limit` page hits ordered by `last_edited_time` desc.
   */
  async search(query: string, opts?: { limit?: number }): Promise<NotionSearchResult[]> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 20));
    const json = await this.call('search', {
      method: 'POST',
      body: {
        query,
        page_size: limit,
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      },
    });
    const results = Array.isArray(json['results'])
      ? (json['results'] as Record<string, unknown>[])
      : [];
    return results.map((r) => ({
      id: String(r['id']),
      url: String(r['url'] ?? ''),
      title: extractTitle(r),
      lastEditedTime: String(r['last_edited_time'] ?? ''),
    }));
  }

  /** Create a new page under `parentPageId` with a single title and optional paragraph blocks. */
  async createPage(
    parentPageId: string,
    title: string,
    bodyParagraphs?: string[],
  ): Promise<NotionPageCreateResult> {
    const children = (bodyParagraphs ?? []).map((para) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: para } }],
      },
    }));
    const body: Record<string, unknown> = {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }],
        },
      },
    };
    if (children.length > 0) body['children'] = children;
    const json = await this.call('pages', { method: 'POST', body });
    return { id: String(json['id']), url: String(json['url'] ?? '') };
  }

  /** Fetch a single page with raw Notion properties (callers parse what they need). */
  async getPage(pageId: string): Promise<NotionPageDetail> {
    const json = await this.call(`pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
    return {
      id: String(json['id']),
      url: String(json['url'] ?? ''),
      title: extractTitle(json),
      lastEditedTime: String(json['last_edited_time'] ?? ''),
      properties: (json['properties'] as Record<string, unknown>) ?? {},
    };
  }

  private async call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${NOTION_API}/${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const errBody = (await response.json()) as Record<string, unknown>;
        code = typeof errBody['code'] === 'string' ? errBody['code'] : undefined;
      } catch {
        /* ignore */
      }
      throw new NotionError(`Notion HTTP ${response.status}`, code);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

function extractTitle(page: Record<string, unknown>): string {
  const props = (page['properties'] as Record<string, unknown>) ?? {};
  for (const value of Object.values(props)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as Record<string, unknown>)['title'])
    ) {
      const titleArr = (value as Record<string, unknown>)['title'] as Record<string, unknown>[];
      const first = titleArr[0];
      if (first && typeof first['plain_text'] === 'string') {
        return first['plain_text'];
      }
    }
  }
  return '(untitled)';
}
