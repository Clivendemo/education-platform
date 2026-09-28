/**
 * StorageProvider Abstraction
 * Provider-neutral interface for binary object storage operations (S3-compatible R2, memory, etc.)
 */

export interface PutObjectParams {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  eTag?: string;
}

export interface HeadObjectResult {
  key: string;
  contentLength: number;
  contentType: string;
  eTag?: string;
  lastModified?: Date;
  metadata: Record<string, string>;
}

export interface GetObjectResult {
  key: string;
  body: Buffer;
  contentLength: number;
  contentType: string;
  metadata: Record<string, string>;
}

export interface StorageProvider {
  /**
   * Upload binary data to the storage bucket.
   */
  putObject(params: PutObjectParams): Promise<PutObjectResult>;

  /**
   * Retrieve object metadata and verify existence without fetching bytes.
   * Returns null if object does not exist.
   */
  headObject(key: string): Promise<HeadObjectResult | null>;

  /**
   * Fetch object binary contents and metadata.
   */
  getObject(key: string): Promise<GetObjectResult>;

  /**
   * Delete an object from the storage bucket.
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Check whether an object exists in the storage bucket.
   */
  objectExists(key: string): Promise<boolean>;

  /**
   * Get the provider identifier (e.g. 'CLOUDFLARE_R2', 'MEMORY')
   */
  getProviderName(): string;

  /**
   * Get the bucket name
   */
  getBucketName(): string;
}
