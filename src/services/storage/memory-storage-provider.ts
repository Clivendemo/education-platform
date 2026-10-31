import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  StorageProvider,
  PutObjectParams,
  PutObjectResult,
  HeadObjectResult,
  GetObjectResult,
  GetObjectStreamOptions,
  GetObjectStreamResult,
  CopyObjectParams,
  GetSignedUrlOptions,
} from './storage-provider.interface.js';

interface StoredObject {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
  lastModified: Date;
  eTag: string;
}

/**
 * In-memory implementation of StorageProvider.
 * Faithful simulation of S3/R2 semantics (e.g. metadata lowercase keys, headObject returns null on missing)
 * for testing and isolated offline environments.
 */
export class MemoryStorageProvider implements StorageProvider {
  private readonly storage = new Map<string, StoredObject>();
  private readonly bucketName: string;

  constructor(bucketName: string = 'test-bucket') {
    this.bucketName = bucketName;
  }

  getProviderName(): string {
    return 'MEMORY';
  }

  getBucketName(): string {
    return this.bucketName;
  }

  async putObject(params: PutObjectParams): Promise<PutObjectResult> {
    const buffer = Buffer.isBuffer(params.body)
      ? Buffer.from(params.body)
      : Buffer.from(params.body);

    if (params.checksumSha256Hex) {
      const actualHex = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualHex.toLowerCase() !== params.checksumSha256Hex.toLowerCase()) {
        throw new Error(
          `BadDigest: The SHA256 you specified (${params.checksumSha256Hex}) did not match what we received (${actualHex}).`,
        );
      }
    }

    // S3 downcases all custom metadata keys
    const normalizedMetadata: Record<string, string> = {};
    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        normalizedMetadata[k.toLowerCase()] = String(v);
      }
    }

    const eTag = `"${crypto.createHash('md5').update(buffer).digest('hex')}"`;
    this.storage.set(params.key, {
      body: buffer,
      contentType: params.contentType,
      metadata: normalizedMetadata,
      lastModified: new Date(),
      eTag,
    });

    return {
      key: params.key,
      eTag,
    };
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const item = this.storage.get(key);
    if (!item) {
      return null;
    }

    return {
      key,
      contentLength: item.body.length,
      contentType: item.contentType,
      eTag: item.eTag,
      lastModified: item.lastModified,
      metadata: { ...item.metadata },
    };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const item = this.storage.get(key);
    if (!item) {
      throw new Error(`NoSuchKey: The specified key does not exist: ${key}`);
    }

    return {
      key,
      body: Buffer.from(item.body),
      contentLength: item.body.length,
      contentType: item.contentType,
      metadata: { ...item.metadata },
    };
  }

  async getObjectStream(
    key: string,
    options: GetObjectStreamOptions = {},
  ): Promise<GetObjectStreamResult> {
    const item = this.storage.get(key);
    if (!item) {
      throw new Error(`NoSuchKey: The specified key does not exist: ${key}`);
    }

    const snapshot = Buffer.from(item.body);
    const chunkSize = 16 * 1024;
    async function* generateChunks() {
      for (let offset = 0; offset < snapshot.length; offset += chunkSize) {
        if (options.signal?.aborted) {
          throw new Error('Object stream aborted');
        }
        yield snapshot.subarray(offset, offset + chunkSize);
      }
    }

    const stream = Readable.from(generateChunks());
    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          stream.destroy(new Error('Object stream aborted'));
        },
        { once: true },
      );
    }

    return {
      key,
      stream,
      contentLength: snapshot.length,
      contentType: item.contentType,
      metadata: { ...item.metadata },
    };
  }

  async copyObject(params: CopyObjectParams): Promise<void> {
    const source = this.storage.get(params.sourceKey);
    if (!source) {
      throw new Error(`NoSuchKey: The specified source key does not exist: ${params.sourceKey}`);
    }

    let nextMetadata = { ...source.metadata };
    if (params.metadata) {
      nextMetadata = {};
      for (const [k, v] of Object.entries(params.metadata)) {
        nextMetadata[k.toLowerCase()] = String(v);
      }
    }

    this.storage.set(params.destinationKey, {
      body: Buffer.from(source.body),
      contentType: params.contentType ?? source.contentType,
      metadata: nextMetadata,
      lastModified: new Date(),
      eTag: source.eTag,
    });
  }

  async deleteObject(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async objectExists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async getSignedDownloadUrl(
    key: string,
    options: GetSignedUrlOptions = {},
  ): Promise<string> {
    const {
      expiresInSeconds = 300,
      responseContentDisposition,
      responseCacheControl,
    } = options;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const encodedKey = encodeURIComponent(key);
    const dispositionParam = responseContentDisposition
      ? `&response-content-disposition=${encodeURIComponent(responseContentDisposition)}`
      : '';
    const cacheControlParam = responseCacheControl
      ? `&response-cache-control=${encodeURIComponent(responseCacheControl)}`
      : '';
    return `https://mock-storage.local/${this.bucketName}/${encodedKey}?expires=${encodeURIComponent(expiresAt)}&signature=mock-sig-${Date.now()}${dispositionParam}${cacheControlParam}`;
  }

  /**
   * Test helper: simulate silent storage corruption or multipart truncation while preserving metadata/eTag (T-W1-SHA-01).
   */
  overwriteRawBytesForTesting(key: string, corruptedBody: Buffer): void {
    const existing = this.storage.get(key);
    if (!existing) {
      throw new Error(`Key ${key} does not exist`);
    }
    this.storage.set(key, {
      ...existing,
      body: Buffer.from(corruptedBody),
    });
  }

  /**
   * Helper for tests: inspect stored items directly
   */
  getStoredCount(): number {
    return this.storage.size;
  }

  clear(): void {
    this.storage.clear();
  }
}
