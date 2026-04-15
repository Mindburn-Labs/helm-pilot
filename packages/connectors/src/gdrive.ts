import { createLogger } from '@helm-pilot/shared/logger';

const log = createLogger('gdrive-connector');

/**
 * Google Drive Connector — read/write files via Drive REST API v3.
 *
 * Uses raw fetch (no googleapis dependency). Requires an OAuth2 access token
 * with the `drive.file` scope.
 */
export class DriveConnector {
  private readonly baseUrl = 'https://www.googleapis.com/drive/v3';
  private readonly uploadUrl = 'https://www.googleapis.com/upload/drive/v3';

  constructor(private readonly token: string) {}

  /**
   * List files matching a query.
   *
   * @param query Drive search query (e.g., "name contains 'report'")
   * @param pageSize Max results per page (default: 20)
   * @param folderId Optional parent folder ID to restrict search
   */
  async listFiles(params?: {
    query?: string;
    pageSize?: number;
    folderId?: string;
    orderBy?: string;
  }): Promise<DriveFile[]> {
    const searchParams = new URLSearchParams({
      pageSize: String(params?.pageSize ?? 20),
      fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents)',
    });

    const queryParts: string[] = ['trashed=false'];
    if (params?.query) queryParts.push(params.query);
    if (params?.folderId) queryParts.push(`'${params.folderId}' in parents`);
    searchParams.set('q', queryParts.join(' and '));

    if (params?.orderBy) {
      searchParams.set('orderBy', params.orderBy);
    }

    const response = await this.request('GET', `/files?${searchParams.toString()}`);
    return ((response.files as Array<Record<string, unknown>>) ?? []).map(mapDriveFile);
  }

  /**
   * Get file metadata by ID.
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const response = await this.request(
      'GET',
      `/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents`,
    );
    return mapDriveFile(response);
  }

  /**
   * Read file content as text.
   *
   * Works for Google Docs (exported as plain text), text files, and similar.
   * For binary files, use `downloadFile()` instead.
   */
  async readFile(fileId: string): Promise<string> {
    // Check if it's a Google Docs file (needs export, not download)
    const meta = await this.getFile(fileId);

    if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
      // Export Google Workspace files
      const exportMime = EXPORT_MIME_MAP[meta.mimeType] ?? 'text/plain';
      const url = `${this.baseUrl}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!response.ok) {
        throw new Error(`Drive export failed: ${response.status}`);
      }
      return response.text();
    }

    // Download regular files
    const url = `${this.baseUrl}/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Drive download failed: ${response.status}`);
    }
    return response.text();
  }

  /**
   * Download file content as Buffer (for binary files).
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const url = `${this.baseUrl}/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Drive download failed: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Create a new file with content.
   */
  async createFile(params: {
    name: string;
    content: string | Buffer;
    mimeType?: string;
    folderId?: string;
    description?: string;
  }): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name: params.name,
      mimeType: params.mimeType ?? 'text/plain',
    };
    if (params.folderId) metadata.parents = [params.folderId];
    if (params.description) metadata.description = params.description;

    const contentBuffer = typeof params.content === 'string'
      ? Buffer.from(params.content, 'utf8')
      : params.content;

    // Use multipart upload for simplicity (metadata + content in one request)
    const boundary = `helm_pilot_${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${params.mimeType ?? 'text/plain'}\r\n\r\n`,
      ),
      contentBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const response = await fetch(
      `${this.uploadUrl}/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Drive create failed: ${response.status} ${errorBody}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ name: params.name, id: result.id }, 'File created in Drive');
    return mapDriveFile(result);
  }

  /**
   * Update an existing file's content.
   */
  async updateFile(fileId: string, content: string | Buffer, mimeType?: string): Promise<DriveFile> {
    const contentBuffer = typeof content === 'string'
      ? Buffer.from(content, 'utf8')
      : content;

    const response = await fetch(
      `${this.uploadUrl}/files/${fileId}?uploadType=media&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': mimeType ?? 'text/plain',
        },
        body: contentBuffer,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Drive update failed: ${response.status} ${errorBody}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ fileId, name: result.name }, 'File updated in Drive');
    return mapDriveFile(result);
  }

  /**
   * Create a new folder.
   */
  async createFolder(name: string, parentId?: string): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) metadata.parents = [parentId];

    const response = await this.request('POST', '/files?fields=id,name,mimeType,createdTime,modifiedTime,webViewLink,parents', metadata);
    log.info({ name, id: response.id }, 'Folder created in Drive');
    return mapDriveFile(response);
  }

  /**
   * Delete a file (move to trash).
   */
  async trashFile(fileId: string): Promise<void> {
    await this.request('PATCH', `/files/${fileId}`, { trashed: true });
    log.info({ fileId }, 'File trashed in Drive');
  }

  /**
   * Search files by content or name.
   */
  async searchFiles(searchTerm: string, limit = 10): Promise<DriveFile[]> {
    return this.listFiles({
      query: `fullText contains '${searchTerm.replace(/'/g, "\\'")}'`,
      pageSize: limit,
      orderBy: 'modifiedTime desc',
    });
  }

  // ─── Internal ───

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Drive API ${method} ${path} failed: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

// ─── Types ───

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  parents: string[];
}

function mapDriveFile(raw: Record<string, unknown>): DriveFile {
  return {
    id: (raw.id as string) ?? '',
    name: (raw.name as string) ?? '',
    mimeType: (raw.mimeType as string) ?? '',
    size: Number(raw.size ?? 0),
    createdTime: (raw.createdTime as string) ?? '',
    modifiedTime: (raw.modifiedTime as string) ?? '',
    webViewLink: (raw.webViewLink as string) ?? '',
    parents: (raw.parents as string[]) ?? [],
  };
}

/** Maps Google Workspace MIME types to export MIME types for plain text download. */
const EXPORT_MIME_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
};
