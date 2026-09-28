import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  resourceFiles,
  type ResourceFileType,
  RESOURCE_FILE_TYPES,
} from '../db/schema/files.js';
import { resourceVersions } from '../db/schema/resource.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import {
  generateStorageKey,
  sanitizeFilename,
  getSafeExtension,
} from './storage/file-key.js';
import { env } from '../config/env.js';

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
  ) {}

  /**
   * Synchronous Resource File Upload Flow
   *
   * Flow:
   * 1. Validate parent resource version exists and is not PUBLISHED.
   * 2. Validate MIME type, size limit (>0 and <= max), file type, sequence order.
   * 3. Compute SHA-256 digest of buffer locally.
   * 4. Derive safe basename and safe extension (original filename is never in R2 key).
   * 5. Generate UUID fileId and storage key: resources/{resourceId}/versions/{versionId}/{fileId}.ext
   * 6. Put object to storage provider with metadata: sha256: computedDigest.
   * 7. Head object from storage provider: verify existence, byte length, and returned sha256 metadata.
   * 8. If verification fails: perform compensating cleanup (deleteObject from R2) and throw error.
   * 9. Persist metadata record in PostgreSQL (files.resource_files) as AVAILABLE.
   * 10. If DB insert fails: perform compensating cleanup (deleteObject from R2) and rethrow error.
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

    // 2. Validate MIME type
    const normalizedMime = mimeType.toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.includes(normalizedMime as AllowedMimeType)) {
      throw new FileStorageError(
        `MIME type "${mimeType}" is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
        'INVALID_MIME_TYPE',
        415,
      );
    }

    // 3. Validate fileType enum
    if (!RESOURCE_FILE_TYPES.includes(fileType)) {
      throw new FileStorageError(
        `File type "${fileType}" is invalid. Allowed: ${RESOURCE_FILE_TYPES.join(', ')}`,
        'INVALID_FILE_TYPE',
        400,
      );
    }

    // 4. Validate sequence order
    if (sequenceOrder < 1 || !Number.isInteger(sequenceOrder)) {
      throw new FileStorageError(
        'sequenceOrder must be a positive integer greater than or equal to 1.',
        'INVALID_SEQUENCE_ORDER',
        400,
      );
    }

    // 5. Verify parent resource version exists and verify publication status
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

    // 6. Compute local SHA-256 digest
    const checksumSha256 = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .toLowerCase();

    // 7. Sanitize filename (basename only, no path traversal)
    const safeBasename = sanitizeFilename(originalFilename);
    const safeExt = getSafeExtension(safeBasename, normalizedMime);

    // 8. Generate unique fileId and UUID-derived storage key (never includes original filename)
    const fileId = crypto.randomUUID();
    const objectKey = generateStorageKey({
      resourceId,
      resourceVersionId,
      fileId,
      safeExtension: safeExt,
    });

    const bucketName = this.storageProvider.getBucketName();
    const providerName = this.storageProvider.getProviderName();

    // 9. Upload object to storage provider with SHA-256 metadata (sha256-checksum)
    try {
      await this.storageProvider.putObject({
        key: objectKey,
        body: buffer,
        contentType: normalizedMime,
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

    // 10. Verification phase: Head object from storage provider and compare length & SHA-256
    try {
      const headResult = await this.storageProvider.headObject(objectKey);

      if (!headResult) {
        throw new Error('Object not found in storage immediately after upload');
      }

      if (headResult.contentLength !== buffer.length) {
        throw new Error(
          `Byte size mismatch: expected ${buffer.length}, storage reported ${headResult.contentLength}`,
        );
      }

      // Check SHA-256 in object metadata (sha256-checksum key match)
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
      // Verification failed: perform compensating cleanup on storage provider
      try {
        await this.storageProvider.deleteObject(objectKey);
      } catch (cleanupErr) {
        console.error('Compensating cleanup failed after verification failure:', cleanupErr);
      }

      throw new FileStorageError(
        `Storage verification failed: ${(verifyErr as Error).message}`,
        'STORAGE_VERIFICATION_FAILED',
        502,
      );
    }

    // 11. Persist file metadata record in PostgreSQL as AVAILABLE
    try {
      const [insertedFile] = await this.db
        .insert(resourceFiles)
        .values({
          id: fileId,
          resourceVersionId,
          storageProvider: providerName,
          storageBucket: bucketName,
          objectKey,
          originalFilename: safeBasename,
          fileExtension: safeExt,
          fileType,
          mimeType: normalizedMime,
          fileSizeBytes: buffer.length,
          checksumSha256,
          storageMetadata: {
            'sha256-checksum': checksumSha256,
            'original-filename': safeBasename,
          },
          status: 'AVAILABLE',
          isPrimary,
          sequenceOrder,
        })
        .returning();

      return insertedFile;
    } catch (dbErr) {
      // Database insert failed: perform compensating cleanup on storage provider
      try {
        await this.storageProvider.deleteObject(objectKey);
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
   * Removes PostgreSQL metadata and cleans up storage provider object.
   */
  async deleteFile(fileId: string) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new FileStorageError(`File "${fileId}" not found.`, 'FILE_NOT_FOUND', 404);
    }

    // Verify parent version is not published
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

    // Delete DB record first (trigger will also reject if published)
    await this.db.delete(resourceFiles).where(eq(resourceFiles.id, fileId));

    // Delete object from storage provider
    try {
      await this.storageProvider.deleteObject(file.objectKey);
    } catch (storageErr) {
      console.error(`Failed to delete object from storage: ${file.objectKey}`, storageErr);
    }

    return file;
  }

  /**
   * Verifies the integrity of a stored file against storage provider.
   */
  async verifyFileIntegrity(fileId: string) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new FileStorageError(`File "${fileId}" not found.`, 'FILE_NOT_FOUND', 404);
    }

    const headResult = await this.storageProvider.headObject(file.objectKey);
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
