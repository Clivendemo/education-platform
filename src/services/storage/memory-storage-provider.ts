import type {
  StorageProvider,
  PutObjectParams,
  PutObjectResult,
  HeadObjectResult,
  GetObjectResult,
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
      ? params.body
      : Buffer.from(params.body);

    // S3 downcases all custom metadata keys
    const normalizedMetadata: Record<string, string> = {};
    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        normalizedMetadata[k.toLowerCase()] = String(v);
      }
    }

    const eTag = `"${Date.now()}"`;
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
    const { expiresInSeconds = 300, responseContentDisposition } = options;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const encodedKey = encodeURIComponent(key);
    const dispositionParam = responseContentDisposition
      ? `&response-content-disposition=${encodeURIComponent(responseContentDisposition)}`
      : '';
    return `https://mock-storage.local/${this.bucketName}/${encodedKey}?expires=${encodeURIComponent(expiresAt)}&signature=mock-sig-${Date.now()}${dispositionParam}`;
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
