import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
} from '../../src/db/schemas.js';
import { FileStorageService } from '../../src/services/file-storage.service.js';
import { FileProcessingWorker } from '../../src/services/file-processing.worker.js';
import { StubCleanMalwareScanner } from '../../src/services/storage/malware-scanner.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import type { HeadObjectResult } from '../../src/services/storage/storage-provider.interface.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Prompt 09 + Wave 1 WP6: FileStorageService Quarantine Upload, Scan & Promotion', () => {
  let countryId: string;
  let typeId: string;
  let resourceId: string;
  let draftVersionId: string;
  let publishedVersionId: string;

  let storageProvider: MemoryStorageProvider;
  let service: FileStorageService;
  let worker: FileProcessingWorker;
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    storageProvider = new MemoryStorageProvider('kenya-education-platform-test-bucket');
    service = new FileStorageService(db, storageProvider, 5 * 1024 * 1024, 'test');
    worker = new FileProcessingWorker({
      db,
      storageProvider,
      malwareScanner: new StubCleanMalwareScanner(),
    });

    const existing = await withDbRetry(() =>
      db
        .select()
        .from(countries)
        .where(eq(countries.isoCode, 'KE'))
        .limit(1),
    );

    if (existing.length > 0) {
      countryId = existing[0].id;
    } else {
      const [c] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Kenya',
            isoCode: 'KE',
            urlPrefix: 'ke',
          })
          .returning(),
      );
      countryId = c.id;
    }

    const [t] = await withDbRetry(() =>
      db
        .insert(resourceTypes)
        .values({
          code: `FILE_SRV_TEST_${Date.now()}`,
          name: 'Service Test Type',
          slug: `srv-test-${Date.now()}`,
          pillar: 'PAST_PAPERS',
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    typeId = t.id;

    const [r] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId: typeId,
          title: 'File Service Integration Test Resource',
          slug: `file-srv-test-${Date.now()}`,
          status: 'DRAFT',
        })
        .returning(),
    );
    resourceId = r.id;

    const [vDraft] = await withDbRetry(() =>
      db
        .insert(resourceVersions)
        .values({
          resourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Draft Resource Version',
          status: 'DRAFT',
        })
        .returning(),
    );
    draftVersionId = vDraft.id;

    const [vPub] = await withDbRetry(() =>
      db
        .insert(resourceVersions)
        .values({
          resourceId,
          versionNumber: 2,
          versionLabel: 'v2.0.0',
          title: 'Published Resource Version',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    publishedVersionId = vPub.id;
  }, 60000);

  afterAll(async () => {
    for (const id of createdFileIds) {
      await db.delete(resourceFiles).where(eq(resourceFiles.id, id)).catch(() => {});
    }
    if (draftVersionId) {
      await db.delete(resourceVersions).where(eq(resourceVersions.id, draftVersionId)).catch(() => {});
    }
    if (publishedVersionId) {
      await db.delete(resourceVersions).where(eq(resourceVersions.id, publishedVersionId)).catch(() => {});
    }
    if (resourceId) {
      await db.delete(resources).where(eq(resources.id, resourceId)).catch(() => {});
    }
    if (typeId) {
      await db.delete(resourceTypes).where(eq(resourceTypes.id, typeId)).catch(() => {});
    }
  });

  describe('1. Quarantine Staging, Scan Promotion & Verification Flow', () => {
    it('stages upload to quarantine/ as PENDING, then promotes to resources/ as AVAILABLE + CLEAN after scan', async () => {
      const fileContent = Buffer.from('%PDF-1.4\nMock KCSE 2025 Mathematics Paper 1 Content');
      const expectedSha = crypto.createHash('sha256').update(fileContent).digest('hex').toLowerCase();
      const unsafeFilename = '../../path/traversal/KCSE_Math_2025_Paper1.pdf';

      const stagedFile = await service.uploadResourceFile({
        resourceId,
        resourceVersionId: draftVersionId,
        originalFilename: unsafeFilename,
        mimeType: 'application/pdf',
        buffer: fileContent,
        fileType: 'MAIN_DOCUMENT',
        isPrimary: true,
        sequenceOrder: 1,
      });

      createdFileIds.push(stagedFile.id);

      expect(stagedFile).toBeDefined();
      expect(stagedFile.status).toBe('PENDING');
      expect(stagedFile.malwareScanStatus).toBe('PENDING');
      expect(stagedFile.checksumSha256).toBe(expectedSha);
      expect(stagedFile.fileSizeBytes).toBe(fileContent.length);
      expect(stagedFile.fileExtension).toBe('pdf');
      expect(stagedFile.isPrimary).toBe(true);
      expect(stagedFile.sequenceOrder).toBe(1);
      expect(stagedFile.originalFilename).toBe('KCSE_Math_2025_Paper1.pdf');
      expect(stagedFile.objectKey).toBe(
        `quarantine/test/resources/${resourceId}/versions/${draftVersionId}/${stagedFile.id}.pdf`,
      );
      expect(stagedFile.objectKey).not.toContain('KCSE_Math');

      // Run FileProcessingWorker to scan and promote staged object
      await worker.runOnce();

      const promotedFile = (await service.getFileById(stagedFile.id))!;
      expect(promotedFile.status).toBe('AVAILABLE');
      expect(promotedFile.malwareScanStatus).toBe('CLEAN');
      expect(promotedFile.objectKey).toBe(
        `resources/${resourceId}/versions/${draftVersionId}/${stagedFile.id}.pdf`,
      );

      // Staged quarantine object was deleted; promoted target object exists with verified SHA-256
      expect(await storageProvider.objectExists(stagedFile.objectKey)).toBe(false);
      expect(await storageProvider.objectExists(promotedFile.objectKey)).toBe(true);

      const head = await storageProvider.headObject(promotedFile.objectKey);
      expect(head).not.toBeNull();
      expect(head!.metadata['sha256-checksum']).toBe(expectedSha);

      const integrity = await service.verifyFileIntegrity(stagedFile.id);
      expect(integrity.status).toBe('VALID');
      expect(integrity.checksumMatches).toBe(true);
      expect(integrity.sizeMatches).toBe(true);
    });

    it('rejects upload and performs compensating R2 cleanup when storage SHA-256 metadata mismatches', async () => {
      class CorruptingStorageProvider extends MemoryStorageProvider {
        override async headObject(key: string): Promise<HeadObjectResult | null> {
          const res = await super.headObject(key);
          if (!res) return null;
          return {
            ...res,
            metadata: {
              ...res.metadata,
              'sha256-checksum': 'tampered_mismatched_sha256_hash_that_fails_verification0000000000',
            },
          };
        }
      }

      const corruptProvider = new CorruptingStorageProvider('test-corrupt-bucket');
      const corruptService = new FileStorageService(db, corruptProvider);

      const fileContent = Buffer.from('%PDF-1.4\nCorrupted upload simulation test payload');

      await expect(
        corruptService.uploadResourceFile({
          resourceId,
          resourceVersionId: draftVersionId,
          originalFilename: 'marking_scheme.pdf',
          mimeType: 'application/pdf',
          buffer: fileContent,
          fileType: 'MARKING_SCHEME',
          isPrimary: false,
          sequenceOrder: 2,
        }),
      ).rejects.toThrow(/Storage verification failed/i);

      expect(corruptProvider.getStoredCount()).toBe(0);

      const filesInDb = await db
        .select()
        .from(resourceFiles)
        .where(eq(resourceFiles.originalFilename, 'marking_scheme.pdf'));
      expect(filesInDb).toHaveLength(0);
    });

    it('performs compensating R2 cleanup when database insert fails', async () => {
      const fileContent = Buffer.from('%PDF-1.4\nDuplicate sequence order test payload');

      await expect(
        service.uploadResourceFile({
          resourceId,
          resourceVersionId: draftVersionId,
          originalFilename: 'second_primary_attempt.pdf',
          mimeType: 'application/pdf',
          buffer: fileContent,
          fileType: 'SUPPLEMENTARY',
          isPrimary: true, // Violates single primary file constraint!
          sequenceOrder: 2,
        }),
      ).rejects.toThrow();

      const checkFiles = await db
        .select()
        .from(resourceFiles)
        .where(eq(resourceFiles.originalFilename, 'second_primary_attempt.pdf'));
      expect(checkFiles).toHaveLength(0);
    });

    it('rejects upload when resource version is already PUBLISHED (application-level invariant)', async () => {
      const fileContent = Buffer.from('%PDF-1.4\nIllegal upload to published version');

      await expect(
        service.uploadResourceFile({
          resourceId,
          resourceVersionId: publishedVersionId,
          originalFilename: 'illegal.pdf',
          mimeType: 'application/pdf',
          buffer: fileContent,
          fileType: 'MAIN_DOCUMENT',
        }),
      ).rejects.toThrow(/Cannot attach a file to an already PUBLISHED resource version/i);
    });

    it('rejects invalid or disallowed MIME types', async () => {
      const fileContent = Buffer.from('Binary executable content');

      await expect(
        service.uploadResourceFile({
          resourceId,
          resourceVersionId: draftVersionId,
          originalFilename: 'malware.exe',
          mimeType: 'application/x-msdownload',
          buffer: fileContent,
        }),
      ).rejects.toThrow(/MIME type "application\/x-msdownload" is not allowed/i);
    });

    it('rejects empty file buffers', async () => {
      await expect(
        service.uploadResourceFile({
          resourceId,
          resourceVersionId: draftVersionId,
          originalFilename: 'empty.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/Uploaded file buffer is empty/i);
    });

    it('rejects files exceeding maximum file size', async () => {
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
      Buffer.from('%PDF-1.4\n').copy(largeBuffer, 0);
      await expect(
        service.uploadResourceFile({
          resourceId,
          resourceVersionId: draftVersionId,
          originalFilename: 'huge.pdf',
          mimeType: 'application/pdf',
          buffer: largeBuffer,
        }),
      ).rejects.toThrow(/exceeds maximum permitted size/i);
    });
  });

  describe('2. Querying and Deletion Lifecycle', () => {
    it('retrieves files by id and lists files for a version ordered by sequence order', async () => {
      const fileId = createdFileIds[0];
      const retrieved = await service.getFileById(fileId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(fileId);

      const list = await service.listFilesForVersion(draftVersionId);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].id).toBe(fileId);

      const primary = await service.getPrimaryFileForVersion(draftVersionId);
      expect(primary).not.toBeNull();
      expect(primary!.id).toBe(fileId);
      expect(primary!.isPrimary).toBe(true);
    });

    it('deletes a file and its staged/promoted storage objects when parent version is DRAFT', async () => {
      const fileContent = Buffer.from('%PDF-1.4\nDisposable file content for deletion test');
      const uploaded = await service.uploadResourceFile({
        resourceId,
        resourceVersionId: draftVersionId,
        originalFilename: 'disposable.pdf',
        mimeType: 'application/pdf',
        buffer: fileContent,
        fileType: 'SUPPLEMENTARY',
        isPrimary: false,
        sequenceOrder: 10,
      });

      expect(await storageProvider.objectExists(uploaded.objectKey)).toBe(true);

      const deleted = await service.deleteFile(uploaded.id);
      expect(deleted.id).toBe(uploaded.id);

      const check = await service.getFileById(uploaded.id);
      expect(check).toBeNull();

      expect(await storageProvider.objectExists(uploaded.objectKey)).toBe(false);
    });
  });
});
