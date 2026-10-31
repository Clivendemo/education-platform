import type { Readable } from 'node:stream';

/**
 * StorageProvider Abstraction
 * Provider-neutral interface for binary object storage operations (S3-compatible R2, memory, etc.)
 */

export interface PutObjectParams {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
  checksumSha256Hex?: string;
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

export interface GetObjectStreamOptions {
  signal?: AbortSignal;
}

export interface GetObjectStreamResult {
  key: string;
  stream: Readable;
  contentLength: number;
  contentType: string;
  metadata: Record<string, string>;
}

export interface CopyObjectParams {
  sourceKey: string;
  destinationKey: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetSignedUrlOptions {
  expiresInSeconds?: number;
  responseContentDisposition?: string;
  responseContentType?: string;
  responseCacheControl?: string;
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
   * Stream object binary contents without buffering the entire file in memory.
   */
  getObjectStream(
    key: string,
    options?: GetObjectStreamOptions,
  ): Promise<GetObjectStreamResult>;

  /**
   * Server-side copy from sourceKey to destinationKey within the bucket.
   */
  copyObject(params: CopyObjectParams): Promise<void>;

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

  /**
   * Generates a short-lived presigned download URL for the target object key.
   */
  getSignedDownloadUrl(
    key: string,
    options?: GetSignedUrlOptions,
  ): Promise<string>;
}
