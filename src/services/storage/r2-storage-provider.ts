import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
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

let presignerModule: { getSignedUrl: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl } | null = null;

async function getPresigner(): Promise<{ getSignedUrl: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl }> {
  if (!presignerModule) {
    try {
      const mod = await import('@aws-sdk/s3-request-presigner');
      presignerModule = { getSignedUrl: mod.getSignedUrl };
    } catch {
      throw new Error(
        'The package "@aws-sdk/s3-request-presigner" is required to generate presigned download URLs with CloudflareR2StorageProvider. Run "npm install" to ensure all dependencies are installed.',
      );
    }
  }
  return presignerModule;
}

function encodeCopySourceKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface CloudflareR2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName: string;
  endpoint?: string;
}

/**
 * Cloudflare R2 implementation of the StorageProvider interface.
 * Connects to Cloudflare R2 via its S3-compatible API.
 */
export class CloudflareR2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(config: CloudflareR2Config, s3ClientOverride?: S3Client) {
    this.bucketName = config.bucketName;

    if (s3ClientOverride) {
      this.client = s3ClientOverride;
      return;
    }

    const endpoint =
      config.endpoint ||
      (config.accountId
        ? `https://${config.accountId}.r2.cloudflarestorage.com`
        : undefined);

    const clientConfig: S3ClientConfig = {
      region: 'auto',
      endpoint,
    };

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  getProviderName(): string {
    return 'CLOUDFLARE_R2';
  }

  getBucketName(): string {
    return this.bucketName;
  }

  async putObject(params: PutObjectParams): Promise<PutObjectResult> {
    const checksumBase64 = params.checksumSha256Hex
      ? Buffer.from(params.checksumSha256Hex, 'hex').toString('base64')
      : undefined;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
      ...(checksumBase64 ? { ChecksumSHA256: checksumBase64 } : {}),
    });

    const response = await this.client.send(command);

    return {
      key: params.key,
      eTag: response.ETag,
    };
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      return {
        key,
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        eTag: response.ETag,
        lastModified: response.LastModified,
        metadata: response.Metadata ?? {},
      };
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        error.name === 'NotFound' ||
        error.name === 'NoSuchKey' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Empty body returned for object ${key}`);
    }

    let buffer: Buffer;
    if (response.Body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      buffer = Buffer.concat(chunks);
    } else {
      const byteArray = await response.Body.transformToByteArray();
      buffer = Buffer.from(byteArray);
    }

    return {
      key,
      body: buffer,
      contentLength: response.ContentLength ?? buffer.length,
      contentType: response.ContentType ?? 'application/octet-stream',
      metadata: response.Metadata ?? {},
    };
  }

  async getObjectStream(
    key: string,
    options: GetObjectStreamOptions = {},
  ): Promise<GetObjectStreamResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.client.send(
      command,
      options.signal ? { abortSignal: options.signal } : undefined,
    );

    if (!response.Body) {
      throw new Error(`Empty body returned for object ${key}`);
    }

    let stream: Readable;
    if (response.Body instanceof Readable) {
      stream = response.Body;
    } else if (typeof (response.Body as any).transformToWebStream === 'function') {
      stream = Readable.fromWeb((response.Body as any).transformToWebStream());
    } else {
      const byteArray = await response.Body.transformToByteArray();
      stream = Readable.from(Buffer.from(byteArray));
    }

    return {
      key,
      stream,
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
      metadata: response.Metadata ?? {},
    };
  }

  async copyObject(params: CopyObjectParams): Promise<void> {
    const hasMetadataOverride = params.metadata !== undefined || params.contentType !== undefined;
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${encodeCopySourceKey(params.sourceKey)}`,
      Key: params.destinationKey,
      MetadataDirective: hasMetadataOverride ? 'REPLACE' : 'COPY',
      ...(params.contentType ? { ContentType: params.contentType } : {}),
      ...(params.metadata ? { Metadata: params.metadata } : {}),
    });

    await this.client.send(command);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.client.send(command);
  }

  async objectExists(key: string): Promise<boolean> {
    const result = await this.headObject(key);
    return result !== null;
  }

  async getSignedDownloadUrl(
    key: string,
    options: GetSignedUrlOptions = {},
  ): Promise<string> {
    const {
      expiresInSeconds = 300,
      responseContentDisposition,
      responseContentType,
      responseCacheControl,
    } = options;

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
      ResponseContentType: responseContentType,
      ResponseCacheControl: responseCacheControl,
    });

    const presigner = await getPresigner();
    return presigner.getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }
}
