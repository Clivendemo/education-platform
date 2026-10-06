import { eq, and, asc, desc, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { resources, resourceVersions } from '../db/schema/resource.js';
import { resourceFiles } from '../db/schema/files.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import { CloudflareR2StorageProvider } from './storage/r2-storage-provider.js';
import { MemoryStorageProvider } from './storage/memory-storage-provider.js';

export const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DownloadFileRequest {
  resourceId: string;
  fileId?: string;
  userId?: string;
}

export interface ControlledDownloadMetadata {
  id: string;
  originalFilename: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
}

export interface DownloadFileResponse {
  downloadUrl: string;
  expiresAt: string;
  expiresInSeconds: number;
  file: ControlledDownloadMetadata;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export class ResourceNotFoundError extends DownloadError {
  constructor(message: string = 'Resource not found.') {
    super(message, 'RESOURCE_NOT_FOUND', 404);
    this.name = 'ResourceNotFoundError';
  }
}

export class PremiumResourceLockedError extends DownloadError {
  constructor(
    message: string = 'This resource is premium content and requires purchase or entitlement.',
  ) {
    super(message, 'PREMIUM_RESOURCE_LOCKED', 403);
    this.name = 'PremiumResourceLockedError';
  }
}

export class NoAvailableFilesError extends DownloadError {
  constructor(
    message: string = 'No available files found for published resource version.',
  ) {
    super(message, 'NO_AVAILABLE_FILES', 404);
    this.name = 'NoAvailableFilesError';
  }
}

export class FileNotFoundDownloadError extends DownloadError {
  constructor(message: string = 'Requested file was not found.') {
    super(message, 'FILE_NOT_FOUND', 404);
    this.name = 'FileNotFoundDownloadError';
  }
}

export class FileNotAvailableError extends DownloadError {
  constructor(message: string = 'Requested file is not available for download.') {
    super(message, 'FILE_NOT_AVAILABLE', 400);
    this.name = 'FileNotAvailableError';
  }
}

export interface DownloadService {
  generateDownloadUrl(request: DownloadFileRequest): Promise<DownloadFileResponse>;
}

export class DefaultDownloadService implements DownloadService {
  constructor(
    private readonly db: NodePgDatabase<any>,
    private readonly storageProvider: StorageProvider,
    private readonly downloadUrlTtlSeconds: number = DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  ) {}

  /**
   * Generates a short-lived presigned download URL for an eligible free published resource.
   *
   * All database validation and eligibility checks (publication, quality tier, file status, version isolation)
   * occur prior to any storage provider interaction.
   */
  async generateDownloadUrl(
    request: DownloadFileRequest,
  ): Promise<DownloadFileResponse> {
    const { resourceId, fileId } = request;

    // 1. UUID validation
    if (!resourceId || !UUID_REGEX.test(resourceId)) {
      throw new ResourceNotFoundError(`Resource "${resourceId}" not found.`);
    }

    if (fileId !== undefined && !UUID_REGEX.test(fileId)) {
      throw new DownloadError(
        `Invalid file ID format: "${fileId}".`,
        'VALIDATION_ERROR',
        400,
      );
    }

    // 2. Fetch resource to verify existence, publication state, and quality tier
    const [resourceRecord] = await this.db
      .select({
        id: resources.id,
        status: resources.status,
        qualityLabel: resources.qualityLabel,
      })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!resourceRecord) {
      throw new ResourceNotFoundError(`Resource "${resourceId}" not found.`);
    }

    // Must be PUBLISHED
    if (resourceRecord.status !== 'PUBLISHED') {
      throw new ResourceNotFoundError(
        `Resource "${resourceId}" is not publicly published.`,
      );
    }

    // Prompt 16 Free vs Premium Rule:
    // Resources with qualityLabel === 'PREMIUM' require purchase/entitlement, which is deferred to Prompt 20.
    if (resourceRecord.qualityLabel === 'PREMIUM') {
      throw new PremiumResourceLockedError(
        'This resource is premium content and requires purchase or entitlement.',
      );
    }

    // 3. Find the single active published version
    const [publishedVersion] = await this.db
      .select({
        id: resourceVersions.id,
        status: resourceVersions.status,
      })
      .from(resourceVersions)
      .where(
        and(
          eq(resourceVersions.resourceId, resourceId),
          eq(resourceVersions.status, 'PUBLISHED'),
        ),
      )
      .limit(1);

    if (!publishedVersion) {
      throw new ResourceNotFoundError(
        `Resource "${resourceId}" does not have an active published version.`,
      );
    }

    // 4. Resolve target file
    let targetFile: {
      id: string;
      resourceVersionId: string;
      objectKey: string;
      originalFilename: string;
      fileExtension: string;
      fileType: string;
      mimeType: string;
      fileSizeBytes: number;
      checksumSha256: string;
      status: string;
    };

    if (fileId) {
      // Explicit file ID requested: must belong to the active published version and be AVAILABLE
      const [explicitFile] = await this.db
        .select({
          id: resourceFiles.id,
          resourceVersionId: resourceFiles.resourceVersionId,
          objectKey: resourceFiles.objectKey,
          originalFilename: resourceFiles.originalFilename,
          fileExtension: resourceFiles.fileExtension,
          fileType: resourceFiles.fileType,
          mimeType: resourceFiles.mimeType,
          fileSizeBytes: resourceFiles.fileSizeBytes,
          checksumSha256: resourceFiles.checksumSha256,
          status: resourceFiles.status,
        })
        .from(resourceFiles)
        .where(eq(resourceFiles.id, fileId))
        .limit(1);

      if (!explicitFile) {
        throw new FileNotFoundDownloadError(`File "${fileId}" not found.`);
      }

      // Cross-version file isolation: file must belong strictly to this published version
      if (explicitFile.resourceVersionId !== publishedVersion.id) {
        throw new FileNotFoundDownloadError(
          `File "${fileId}" does not belong to the active published version of this resource.`,
        );
      }

      // File availability status check
      if (explicitFile.status !== 'AVAILABLE') {
        throw new FileNotAvailableError(
          `File "${fileId}" is not available for download (status: ${explicitFile.status}).`,
        );
      }

      targetFile = explicitFile;
    } else {
      // Deterministic primary-file selection when fileId is omitted:
      // 1. isPrimary: true
      // 2. fileType = 'MAIN_DOCUMENT'
      // 3. lowest sequenceOrder ASC
      // 4. earliest createdAt ASC
      // 5. id ASC (deterministic tie-breaker)
      const availableFiles = await this.db
        .select({
          id: resourceFiles.id,
          resourceVersionId: resourceFiles.resourceVersionId,
          objectKey: resourceFiles.objectKey,
          originalFilename: resourceFiles.originalFilename,
          fileExtension: resourceFiles.fileExtension,
          fileType: resourceFiles.fileType,
          mimeType: resourceFiles.mimeType,
          fileSizeBytes: resourceFiles.fileSizeBytes,
          checksumSha256: resourceFiles.checksumSha256,
          status: resourceFiles.status,
        })
        .from(resourceFiles)
        .where(
          and(
            eq(resourceFiles.resourceVersionId, publishedVersion.id),
            eq(resourceFiles.status, 'AVAILABLE'),
          ),
        )
        .orderBy(
          desc(resourceFiles.isPrimary),
          sql`CASE WHEN ${resourceFiles.fileType} = 'MAIN_DOCUMENT' THEN 0 ELSE 1 END ASC`,
          asc(resourceFiles.sequenceOrder),
          asc(resourceFiles.createdAt),
          asc(resourceFiles.id),
        )
        .limit(1);

      if (availableFiles.length === 0) {
        throw new NoAvailableFilesError(
          `Resource "${resourceId}" has no available files attached to its published version.`,
        );
      }

      targetFile = availableFiles[0];
    }

    // 5. Database validation passed. Now request presigned download URL from storage provider.
    const expiresInSeconds = this.downloadUrlTtlSeconds;
    const downloadUrl = await this.storageProvider.getSignedDownloadUrl(
      targetFile.objectKey,
      {
        expiresInSeconds,
        responseContentDisposition: `attachment; filename="${encodeURIComponent(targetFile.originalFilename)}"`,
        responseContentType: targetFile.mimeType,
      },
    );

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // 6. Return controlled download payload.
    // Strictly omit storage_metadata, storage_bucket, object_key, and provider identifiers.
    return {
      downloadUrl,
      expiresAt,
      expiresInSeconds,
      file: {
        id: targetFile.id,
        originalFilename: targetFile.originalFilename,
        fileType: targetFile.fileType,
        mimeType: targetFile.mimeType,
        fileSizeBytes: Number(targetFile.fileSizeBytes),
        checksumSha256: targetFile.checksumSha256,
      },
    };
  }
}

export function createDefaultStorageProvider(): StorageProvider {
  if (
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY
  ) {
    return new CloudflareR2StorageProvider({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucketName: env.R2_BUCKET_NAME,
      endpoint: env.R2_ENDPOINT,
    });
  }
  return new MemoryStorageProvider(env.R2_BUCKET_NAME);
}

export const defaultStorageProvider = createDefaultStorageProvider();
export const defaultDownloadService: DownloadService = new DefaultDownloadService(
  db,
  defaultStorageProvider,
);
