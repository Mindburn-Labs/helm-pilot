import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageClient, S3StorageClient, createStorageClient } from '../storage.js';
import type { S3Config } from '../storage.js';

// ─── LocalStorageClient (integration with real fs) ──────────────────────────

describe('LocalStorageClient', () => {
  let tempDir: string;
  let client: LocalStorageClient;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'helm-test-'));
    client = new LocalStorageClient(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('upload creates file and returns path', async () => {
    const data = Buffer.from('hello world');
    const path = await client.upload('docs/test.txt', data, 'text/plain');
    expect(path).toBe(`file://${join(tempDir, 'docs/test.txt')}`);
    expect(await client.exists('docs/test.txt')).toBe(true);
  });

  it('download reads uploaded file', async () => {
    const original = Buffer.from('binary content here');
    await client.upload('file.bin', original, 'application/octet-stream');

    const downloaded = await client.download('file.bin');
    expect(downloaded.toString()).toBe('binary content here');
  });

  it('exists returns true for existing file', async () => {
    await client.upload('present.txt', Buffer.from('x'), 'text/plain');
    expect(await client.exists('present.txt')).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    expect(await client.exists('nope.txt')).toBe(false);
  });

  it('delete removes file', async () => {
    await client.upload('to-delete.txt', Buffer.from('bye'), 'text/plain');
    expect(await client.exists('to-delete.txt')).toBe(true);
    await client.delete('to-delete.txt');
    expect(await client.exists('to-delete.txt')).toBe(false);
  });
});

// ─── S3StorageClient (AWS SDK integration) ────────────────────────────────────

describe('S3StorageClient', () => {
  const s3Config: S3Config = {
    bucket: 'test-bucket',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    accessKeyId: 'AKID',
    secretAccessKey: 'secret',
  };

  it('constructs without error', () => {
    const client = new S3StorageClient(s3Config);
    expect(client).toBeDefined();
  });

  it('upload returns correct S3 URI format', async () => {
    // Mock the AWS SDK module dynamically imported by S3StorageClient
    const mockSend = vi.fn().mockResolvedValue({});
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
      PutObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'put' })),
      GetObjectCommand: vi.fn(),
      DeleteObjectCommand: vi.fn(),
      HeadObjectCommand: vi.fn(),
    }));

    // Re-import to get the mocked version
    const { S3StorageClient: MockedS3 } = await import('../storage.js');
    const client = new MockedS3(s3Config);
    const result = await client.upload('path/file.json', Buffer.from('{}'), 'application/json');
    expect(result).toBe('s3://test-bucket/path/file.json');
    expect(mockSend).toHaveBeenCalledOnce();

    vi.doUnmock('@aws-sdk/client-s3');
  });
});

// ─── createStorageClient factory ────────────────────────────────────────────

describe('createStorageClient', () => {
  it('returns LocalStorageClient by default', () => {
    const client = createStorageClient();
    expect(client).toBeInstanceOf(LocalStorageClient);
  });

  it('returns S3StorageClient when configured', () => {
    const client = createStorageClient({
      provider: 's3',
      s3: {
        bucket: 'b',
        endpoint: 'https://s3.example.com',
        accessKeyId: 'id',
        secretAccessKey: 'key',
      },
    });
    expect(client).toBeInstanceOf(S3StorageClient);
  });

  it('returns LocalStorageClient with custom basePath', () => {
    const client = createStorageClient({ basePath: '/tmp/custom-storage' });
    expect(client).toBeInstanceOf(LocalStorageClient);
  });
});
