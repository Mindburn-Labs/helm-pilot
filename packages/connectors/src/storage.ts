import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/**
 * Storage Client — abstraction over local filesystem and S3-compatible stores.
 *
 * V1 ships with LocalStorageClient for self-hosting.
 * S3StorageClient planned for cloud deployments.
 */
export interface StorageClient {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Local filesystem storage — stores blobs in a configurable directory.
 * Suitable for self-hosting and development.
 */
export class LocalStorageClient implements StorageClient {
  constructor(private readonly basePath: string) {}

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fullPath = join(this.basePath, key);
    await mkdir(dirname(fullPath), { recursive: true });
    const stream = createWriteStream(fullPath);
    await pipeline(Readable.from(data), stream);
    return `file://${fullPath}`;
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = join(this.basePath, key);
    const chunks: Buffer[] = [];
    const stream = createReadStream(fullPath);
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.basePath, key);
    await unlink(fullPath).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = join(this.basePath, key);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * S3-compatible storage client.
 *
 * Uses the official AWS SDK with proper SigV4 request signing.
 * Works with any S3-compatible service (DO Spaces, MinIO, Cloudflare R2, etc.)
 * by setting a custom endpoint.
 */
export class S3StorageClient implements StorageClient {
  private readonly bucket: string;
  private readonly config: S3Config;
  private clientPromise: Promise<typeof import('@aws-sdk/client-s3')> | null = null;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.config = config;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3');
    }
    const sdk = await this.clientPromise;
    return new sdk.S3Client({
      region: this.config.region ?? 'us-east-1',
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: true, // Required for most S3-compatible services
    });
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    const sdk = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    const sdk = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const result = await client.send(
      new sdk.GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!result.Body) throw new Error(`S3 download returned empty body for ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    const sdk = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(
      new sdk.DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const sdk = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    try {
      await client.send(
        new sdk.HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound') return false;
      throw err;
    }
  }
}

export interface S3Config {
  bucket: string;
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Factory — creates storage client from environment config.
 */
export function createStorageClient(config?: { provider?: string; basePath?: string; s3?: S3Config }): StorageClient {
  const provider = config?.provider ?? process.env['STORAGE_PROVIDER'] ?? 'local';

  if (provider === 's3' && config?.s3) {
    return new S3StorageClient(config.s3);
  }

  const basePath = config?.basePath ?? process.env['STORAGE_PATH'] ?? './data/storage';
  return new LocalStorageClient(basePath);
}
