import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  resourceFiles,
  fileProcessingJobs,
  fileProcessingHistory,
  type ResourceFileType,
  RESOURCE_FILE_TYPES,
} from '../db/schema/files.js';
import { resourceVersions } from '../db/schema/resource.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import {
  generateStorageKey,
  generateQuarantineStorageKey,
  sanitizeFilename,
  getSafeExtension,
} from './storage/file-key.js';
import { validateUploadedFileSignature } from './storage/file-signature-validator.js';
import { env } from '../config/env.js';
import { db as defaultDb } from '../db/index.js';
import { defaultStorageProvider } from './download.service.js';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/epub+zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface UploadResourceFileInput {
  resourceId: string;
  resourceVersionId: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer | Uint8Array;
  fileType?: ResourceFileType;
  isPrimary?: boolean;
  sequenceOrder?: number;
}

export class FileStorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'FileStorageError';
  }
}

export class FileStorageService {
  constructor(
    private readonly db: NodePgDatabase<any>,
    private readonly storageProvider: StorageProvider,
    private readonly maxFileSizeBytes: number = env.MAX_FILE_SIZE_BYTES,
    private readonly envName: string = env.NODE_ENV,
  ) {}

  /**
   * Quarantine-Staged Resource File Upload Flow (W1-AC-09)
   *
   * Flow:
   * 1. Validate buffer size (>0 and <= max), declared MIME type, fileType, sequenceOrder.
   * 2. Validate binary magic-byte signature & ZIP/OOXML structural safety BEFORE any storage call (415 on mismatch).
   * 3. Verify parent resource version exists, matches resourceId, and is not PUBLISHED.
   * 4. Compute SHA-256 digest of buffer locally.
   * 5. Stage object exclusively to `quarantine/{env}/resources/{resourceId}/versions/{versionId}/{fileId}.ext` with ChecksumSHA256.
   * 6. Verify staged object via `headObject` (existence, byte length, and sha256-checksum metadata).
   * 7. Atomically insert `files.resource_files` (`status = 'PENDING'`, `malware_scan_status = 'PENDING'`)
   *    and durable `files.file_processing_jobs` (`stagedObjectKey`, `targetObjectKey`, `expectedSha256`, `expectedSizeBytes`).
   * 8. On any verification or DB failure, delete staged object from `quarantine/` before rethrowing.
   */
  async uploadResourceFile(input: UploadResourceFileInput) {
    const {
      resourceId,
      resourceVersionId,
      originalFilename,
      mimeType,
      fileType = 'MAIN_DOCUMENT',
      isPrimary = false,
      sequenceOrder = 1,
    } = input;

    const buffer = Buffer.isBuffer(input.buffer)
      ? input.buffer
      : Buffer.from(input.buffer);

    // 1. Validate buffer size
    if (buffer.length === 0) {
      throw new FileStorageError(
        'Uploaded file buffer is empty (0 bytes).',
        'EMPTY_FILE',
        400,
      );
    }

    if (buffer.length > this.maxFileSizeBytes) {
      throw new FileStorageError(
        `File size (${buffer.length} bytes) exceeds maximum permitted size of ${this.maxFileSizeBytes} bytes.`,
        'FILE_TOO_LARGE',
        413,
      );
    }

    // 2. Validate MIME type allowlist
    const normalizedMime = mimeType.toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.includes(normalizedMime as AllowedMimeType)) {
      throw new FileStorageError(
        `MIME type "${mimeType}" is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
        'INVALID_MIME_TYPE',
        415,
      );
    }

    // 3. Validate binary magic bytes & archive structure BEFORE touching DB/storage (W1-AC-09)
    validateUploadedFileSignature(buffer, normalizedMime as AllowedMimeType);

    // 4. Validate fileType enum
    if (!RESOURCE_FILE_TYPES.includes(fileType)) {
      throw new FileStorageError(
        `File type "${fileType}" is invalid. Allowed: ${RESOURCE_FILE_TYPES.join(', ')}`,
        'INVALID_FILE_TYPE',
        400,
      );
    }

    // 5. Validate sequence order
    if (sequenceOrder < 1 || !Number.isInteger(sequenceOrder)) {
      throw new FileStorageError(
        'sequenceOrder must be a positive integer greater than or equal to 1.',
        'INVALID_SEQUENCE_ORDER',
        400,
      );
    }

    // 6. Verify parent resource version exists and verify publication status
    const versionQuery = await this.db
      .select({
        id: resourceVersions.id,
        resourceId: resourceVersions.resourceId,
        status: resourceVersions.status,
      })
      .from(resourceVersions)
      .where(eq(resourceVersions.id, resourceVersionId))
      .limit(1);

    if (versionQuery.length === 0) {
      throw new FileStorageError(
        `Resource version "${resourceVersionId}" not found.`,
        'RESOURCE_VERSION_NOT_FOUND',
        404,
      );
    }

    const parentVersion = versionQuery[0];

    if (parentVersion.resourceId !== resourceId) {
      throw new FileStorageError(
        `Resource version "${resourceVersionId}" does not belong to resource "${resourceId}".`,
        'VERSION_RESOURCE_MISMATCH',
        400,
      );
    }

    if (parentVersion.status === 'PUBLISHED') {
      throw new FileStorageError(
        'Cannot attach a file to an already PUBLISHED resource version. Published versions are immutable.',
        'VERSION_PUBLISHED_IMMUTABLE',
        409,
      );
    }

    // 7. Compute local SHA-256 digest
    const checksumSha256 = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .toLowerCase();

    // 8. Sanitize filename (basename only, no path traversal)
    const safeBasename = sanitizeFilename(originalFilename);
    const safeExt = getSafeExtension(safeBasename, normalizedMime);

    // 9. Generate UUID fileId, staged quarantine key, and promoted target key
    const fileId = crypto.randomUUID();
    const stagedObjectKey = generateQuarantineStorageKey({
      envName: this.envName,
      resourceId,
      resourceVersionId,
      fileId,
      safeExtension: safeExt,
    });
    const targetObjectKey = generateStorageKey({
      resourceId,
      resourceVersionId,
      fileId,
      safeExtension: safeExt,
    });

    const bucketName = this.storageProvider.getBucketName();
    const providerName = this.storageProvider.getProviderName();

    // 10. Stage object to quarantine prefix with SHA-256 integrity metadata
    try {
      await this.storageProvider.putObject({
        key: stagedObjectKey,
        body: buffer,
        contentType: normalizedMime,
        checksumSha256Hex: checksumSha256,
        metadata: {
          'sha256-checksum': checksumSha256,
          'original-filename': encodeURIComponent(safeBasename),
        },
      });
    } catch (uploadErr) {
      throw new FileStorageError(
        `Failed to upload object to storage provider: ${(uploadErr as Error).message}`,
        'STORAGE_UPLOAD_FAILED',
        502,
      );
    }

    // 11. Verification phase: Head staged object and compare byte length & SHA-256 metadata
    try {
      const headResult = await this.storageProvider.headObject(stagedObjectKey);

      if (!headResult) {
        throw new Error('Staged object not found in storage immediately after upload');
      }

      if (headResult.contentLength !== buffer.length) {
        throw new Error(
          `Byte size mismatch: expected ${buffer.length}, storage reported ${headResult.contentLength}`,
        );
      }

      const returnedSha256 =
        headResult.metadata['sha256-checksum'] ||
        headResult.metadata['SHA256-CHECKSUM'] ||
        headResult.metadata['x-amz-meta-sha256-checksum'];

      if (!returnedSha256 || returnedSha256.toLowerCase() !== checksumSha256) {
        throw new Error(
          `SHA-256 checksum verification failed. Computed: ${checksumSha256}, Storage metadata: ${returnedSha256 ?? 'missing'}`,
        );
      }
    } catch (verifyErr) {
      try {
        await this.storageProvider.deleteObject(stagedObjectKey);
      } catch (cleanupErr) {
        console.error('Compensating cleanup failed after verification failure:', cleanupErr);
      }

      throw new FileStorageError(
        `Storage verification failed: ${(verifyErr as Error).message}`,
        'STORAGE_VERIFICATION_FAILED',
        502,
      );
    }

    // 12. Atomically persist PENDING resource_files row + durable file_processing_jobs row
    try {
      return await this.db.transaction(async (tx) => {
        const [insertedFile] = await tx
          .insert(resourceFiles)
          .values({
            id: fileId,
            resourceVersionId,
            storageProvider: providerName,
            storageBucket: bucketName,
            objectKey: stagedObjectKey,
            originalFilename: safeBasename,
            fileExtension: safeExt,
            fileType,
            mimeType: normalizedMime,
            fileSizeBytes: buffer.length,
            checksumSha256,
            storageMetadata: {
              'sha256-checksum': checksumSha256,
              'original-filename': safeBasename,
              staged: true,
            },
            status: 'PENDING',
            malwareScanStatus: 'PENDING',
            isPrimary,
            sequenceOrder,
          })
          .returning();

        const [job] = await tx
          .insert(fileProcessingJobs)
          .values({
            fileId: insertedFile.id,
            stagedObjectKey,
            targetObjectKey,
            expectedSha256: checksumSha256,
            expectedSizeBytes: buffer.length,
            status: 'PENDING',
            attemptCount: 0,
            maxAttempts: 5,
            fencingToken: 0,
          })
          .returning();

        await tx.insert(fileProcessingHistory).values({
          jobId: job.id,
          fileId: insertedFile.id,
          eventType: 'STAGE_UPLOADED',
          fencingToken: 0,
          details: {
            stagedObjectKey,
            targetObjectKey,
            expectedSizeBytes: buffer.length,
            expectedSha256: checksumSha256,
          },
        });

        return insertedFile;
      });
    } catch (dbErr) {
      try {
        await this.storageProvider.deleteObject(stagedObjectKey);
      } catch (cleanupErr) {
        console.error('Compensating cleanup failed after database insert failure:', cleanupErr);
      }

      throw dbErr;
    }
  }

  /**
   * Retrieves a file record by UUID.
   */
  async getFileById(fileId: string) {
    const records = await this.db
      .select()
      .from(resourceFiles)
      .where(eq(resourceFiles.id, fileId))
      .limit(1);

    return records[0] ?? null;
  }

  /**
   * Lists all files attached to a resource version ordered by sequence order.
   */
  async listFilesForVersion(resourceVersionId: string) {
    return this.db
      .select()
      .from(resourceFiles)
      .where(eq(resourceFiles.resourceVersionId, resourceVersionId))
      .orderBy(resourceFiles.sequenceOrder);
  }

  /**
   * Gets the primary file for a resource version, if designated.
   */
  async getPrimaryFileForVersion(resourceVersionId: string) {
    const records = await this.db
      .select()
      .from(resourceFiles)
      .where(
        and(
          eq(resourceFiles.resourceVersionId, resourceVersionId),
          eq(resourceFiles.isPrimary, true),
        ),
      )
      .limit(1);

    return records[0] ?? null;
  }

  /**
   * Controlled file deletion.
   * Only files belonging to non-PUBLISHED resource versions can be deleted.
   * Removes PostgreSQL metadata (cascading processing job/history) and cleans up staged/promoted storage keys.
   */
  async deleteFile(fileId: string) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new FileStorageError(`File "${fileId}" not found.`, 'FILE_NOT_FOUND', 404);
    }

    const versionQuery = await this.db
      .select({
        id: resourceVersions.id,
        status: resourceVersions.status,
      })
      .from(resourceVersions)
      .where(eq(resourceVersions.id, file.resourceVersionId))
      .limit(1);

    if (versionQuery.length > 0 && versionQuery[0].status === 'PUBLISHED') {
      throw new FileStorageError(
        'Cannot delete a file belonging to a PUBLISHED resource version.',
        'VERSION_PUBLISHED_IMMUTABLE',
        409,
      );
    }

    const [job] = await this.db
      .select({
        stagedObjectKey: fileProcessingJobs.stagedObjectKey,
        targetObjectKey: fileProcessingJobs.targetObjectKey,
      })
      .from(fileProcessingJobs)
      .where(eq(fileProcessingJobs.fileId, fileId))
      .limit(1);

    await this.db.delete(resourceFiles).where(eq(resourceFiles.id, fileId));

    const keysToDelete = new Set<string>([file.objectKey]);
    if (job?.stagedObjectKey) keysToDelete.add(job.stagedObjectKey);
    if (job?.targetObjectKey) keysToDelete.add(job.targetObjectKey);

    for (const key of keysToDelete) {
      try {
        await this.storageProvider.deleteObject(key);
      } catch (storageErr) {
        console.error(`Failed to delete object from storage: ${key}`, storageErr);
      }
    }

    return file;
  }

  /**
   * Verifies the integrity of a stored file against storage provider.
   */
  async verifyFileIntegrity(
    fileId: string,
    options?: { signal?: AbortSignal },
  ) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new FileStorageError(`File "${fileId}" not found.`, 'FILE_NOT_FOUND', 404);
    }

    const headResult = await this.storageProvider.headObject(file.objectKey, options);
    if (!headResult) {
      return {
        fileId,
        existsInStorage: false,
        sizeMatches: false,
        checksumMatches: false,
        status: 'MISSING_IN_STORAGE',
      };
    }

    const sizeMatches = headResult.contentLength === file.fileSizeBytes;
    const returnedSha256 =
      headResult.metadata['sha256-checksum'] ||
      headResult.metadata['SHA256-CHECKSUM'] ||
      headResult.metadata['x-amz-meta-sha256-checksum'];

    const checksumMatches =
      Boolean(returnedSha256) &&
      returnedSha256.toLowerCase() === file.checksumSha256.toLowerCase();

    return {
      fileId,
      existsInStorage: true,
      sizeMatches,
      checksumMatches,
      status: sizeMatches && checksumMatches ? 'VALID' : 'INTEGRITY_MISMATCH',
    };
  }
}

export const defaultFileStorageService = new FileStorageService(
  defaultDb,
  defaultStorageProvider,
);
