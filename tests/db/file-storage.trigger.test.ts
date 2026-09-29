import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
} from '../../src/db/schemas.js';

describe('Prompt 09: File Storage Neon Database Integrity & Publication Triggers', () => {
  let countryId: string;
  let typeId: string;
  let testResourceId: string;
  let draftVersionId: string;
  let publishedVersionId: string;
  let anotherDraftVersionId: string;

  const createdFileIds: string[] = [];
  const dummySha = 'a'.repeat(64);
  const dummySha2 = 'b'.repeat(64);

  async function expectDbError(
    operation: Promise<any> | (() => Promise<any>),
    pattern?: RegExp,
  ) {
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
        if (typeof operation === 'function') {
          await operation();
        } else {
          await operation;
        }
        expect.unreachable('Expected database operation to fail but it succeeded');
      } catch (err: any) {
        const causeErrors =
          err.cause?.errors?.map((e: any) => `${e.message} ${e.code}`).join(' ') || '';
        const fullMessage = `${err.message} ${err.cause?.message || ''} ${err.cause?.detail || ''} ${causeErrors} ${err.cause?.code || ''} ${err.code || ''}`;
        if (
          (fullMessage.includes('ECONNRESET') ||
            fullMessage.includes('Connection terminated') ||
            fullMessage.includes('ETIMEDOUT') ||
            fullMessage.includes('socket hang up')) &&
          attempts < 3 &&
          typeof operation === 'function'
        ) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (pattern) {
          expect(fullMessage).toMatch(pattern);
        }
        return;
      }
    }
  }

  beforeAll(async () => {
    // 1. Ensure test country
    const existing = await db
      .select()
      .from(countries)
      .where(eq(countries.isoCode, 'KE'))
      .limit(1);

    if (existing.length > 0) {
      countryId = existing[0].id;
    } else {
      const [c] = await db
        .insert(countries)
        .values({
          name: 'Kenya',
          isoCode: 'KE',
          urlPrefix: 'ke',
        })
        .returning();
      countryId = c.id;
    }

    // 2. Ensure test resource type
    const [t] = await db
      .insert(resourceTypes)
      .values({
        code: `STORAGE_TEST_${Date.now()}`,
        name: 'Storage Test Paper',
        slug: `storage-test-${Date.now()}`,
        pillar: 'PAST_PAPERS',
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    typeId = t.id;

    // 3. Create test resource
    const [res] = await db
      .insert(resources)
      .values({
        countryId,
        resourceTypeId: typeId,
        title: 'File Storage Integration Test Resource',
        slug: `storage-test-resource-${Date.now()}`,
        status: 'DRAFT',
      })
      .returning();
    testResourceId = res.id;

    // 4. Create DRAFT version 1
    const [v1] = await db
      .insert(resourceVersions)
      .values({
        resourceId: testResourceId,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: 'Draft Version 1',
        status: 'DRAFT',
      })
      .returning();
    draftVersionId = v1.id;

    // 5. Create PUBLISHED version 2
    const [v2] = await db
      .insert(resourceVersions)
      .values({
        resourceId: testResourceId,
        versionNumber: 2,
        versionLabel: 'v2.0.0',
        title: 'Published Version 2',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      })
      .returning();
    publishedVersionId = v2.id;

    // 6. Create another DRAFT version 3
    const [v3] = await db
      .insert(resourceVersions)
      .values({
        resourceId: testResourceId,
        versionNumber: 3,
        versionLabel: 'v3.0.0',
        title: 'Draft Version 3',
        status: 'DRAFT',
      })
      .returning();
    anotherDraftVersionId = v3.id;
  });

  afterAll(async () => {
    // Cleanup created files
    for (const fId of createdFileIds) {
      await db.delete(resourceFiles).where(eq(resourceFiles.id, fId)).catch(() => {});
    }

    // Cleanup versions and resource
    if (draftVersionId) {
      await db.delete(resourceVersions).where(eq(resourceVersions.id, draftVersionId)).catch(() => {});
    }
    if (anotherDraftVersionId) {
      await db.delete(resourceVersions).where(eq(resourceVersions.id, anotherDraftVersionId)).catch(() => {});
    }
    if (publishedVersionId) {
      await db.delete(resourceVersions).where(eq(resourceVersions.id, publishedVersionId)).catch(() => {});
    }
    if (testResourceId) {
      await db.delete(resources).where(eq(resources.id, testResourceId)).catch(() => {});
    }
    if (typeId) {
      await db.delete(resourceTypes).where(eq(resourceTypes.id, typeId)).catch(() => {});
    }
  });

  describe('1. Legitimate Pre-Publication File Mutation on DRAFT Versions', () => {
    it('successfully inserts a file record into a DRAFT resource version via direct SQL', async () => {
      const [file] = await db
        .insert(resourceFiles)
        .values({
          resourceVersionId: draftVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'test-bucket',
          objectKey: `resources/${testResourceId}/versions/${draftVersionId}/file-1.pdf`,
          originalFilename: 'syllabus_2026.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 1048576,
          checksumSha256: dummySha,
          status: 'AVAILABLE',
          isPrimary: true,
          sequenceOrder: 1,
        })
        .returning();

      expect(file).toBeDefined();
      expect(file.id).toBeDefined();
      expect(file.originalFilename).toBe('syllabus_2026.pdf');
      expect(file.fileExtension).toBe('pdf');
      createdFileIds.push(file.id);
    });

    it('successfully updates metadata on a file belonging to a DRAFT version (proving trigger is not over-broad)', async () => {
      const fileId = createdFileIds[0];

      const [updated] = await db
        .update(resourceFiles)
        .set({
          originalFilename: 'syllabus_2026_revised.pdf',
          sequenceOrder: 2,
        })
        .where(eq(resourceFiles.id, fileId))
        .returning();

      expect(updated.originalFilename).toBe('syllabus_2026_revised.pdf');
      expect(updated.sequenceOrder).toBe(2);

      // Revert sequenceOrder to 1
      await db
        .update(resourceFiles)
        .set({ sequenceOrder: 1 })
        .where(eq(resourceFiles.id, fileId));
    });

    it('successfully moves a file between two DRAFT versions', async () => {
      const [draftFile] = await db
        .insert(resourceFiles)
        .values({
          resourceVersionId: draftVersionId,
          storageBucket: 'test-bucket',
          objectKey: `resources/${testResourceId}/versions/${draftVersionId}/file-move.pdf`,
          originalFilename: 'to_move.pdf',
          fileExtension: 'pdf',
          fileType: 'SUPPLEMENTARY',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          checksumSha256: dummySha2,
          sequenceOrder: 5,
        })
        .returning();

      createdFileIds.push(draftFile.id);

      // Move to another DRAFT version
      const [moved] = await db
        .update(resourceFiles)
        .set({ resourceVersionId: anotherDraftVersionId })
        .where(eq(resourceFiles.id, draftFile.id))
        .returning();

      expect(moved.resourceVersionId).toBe(anotherDraftVersionId);
    });

    it('successfully deletes a file belonging to a DRAFT version', async () => {
      const [draftFile] = await db
        .insert(resourceFiles)
        .values({
          resourceVersionId: draftVersionId,
          storageBucket: 'test-bucket',
          objectKey: `resources/${testResourceId}/versions/${draftVersionId}/file-del.pdf`,
          originalFilename: 'to_delete.pdf',
          fileExtension: 'pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 4096,
          checksumSha256: 'c'.repeat(64),
          sequenceOrder: 9,
        })
        .returning();

      await expect(
        db.delete(resourceFiles).where(eq(resourceFiles.id, draftFile.id)),
      ).resolves.not.toThrow();

      const check = await db
        .select()
        .from(resourceFiles)
        .where(eq(resourceFiles.id, draftFile.id));
      expect(check).toHaveLength(0);
    });
  });

  describe('2. Direct SQL Publication Protection Triggers (Defense-in-Depth)', () => {
    it('rejects direct SQL INSERT of a file into a PUBLISHED resource version (trg_prevent_published_resource_file_insert)', async () => {
      await expectDbError(
        db.insert(resourceFiles).values({
          resourceVersionId: publishedVersionId,
          storageBucket: 'test-bucket',
          objectKey: `resources/${testResourceId}/versions/${publishedVersionId}/violating-file.pdf`,
          originalFilename: 'illegal_insert.pdf',
          fileExtension: 'pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 5000,
          checksumSha256: 'd'.repeat(64),
          status: 'AVAILABLE',
          sequenceOrder: 1,
        }),
        /Cannot attach file to a PUBLISHED resource version/i,
      );
    });

    it('rejects direct SQL UPDATE on a file belonging to a PUBLISHED resource version', async () => {
      // Setup: Create an isolated resource and draft version, insert file, then publish it
      const [isolatedRes] = await db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId: typeId,
          title: 'Isolated Resource for Publication Trigger Test',
          slug: `isolated-pub-test-${Date.now()}`,
          status: 'DRAFT',
        })
        .returning();

      const [isolatedVersion] = await db
        .insert(resourceVersions)
        .values({
          resourceId: isolatedRes.id,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Version to be published',
          status: 'DRAFT',
        })
        .returning();

      const [fileForPub] = await db
        .insert(resourceFiles)
        .values({
          resourceVersionId: isolatedVersion.id,
          storageBucket: 'test-bucket',
          objectKey: `resources/${isolatedRes.id}/versions/${isolatedVersion.id}/file-publish.pdf`,
          originalFilename: 'will_be_published.pdf',
          fileExtension: 'pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 8192,
          checksumSha256: 'e'.repeat(64),
          sequenceOrder: 1,
        })
        .returning();

      createdFileIds.push(fileForPub.id);

      // Transition isolatedVersion to PUBLISHED
      await db
        .update(resourceVersions)
        .set({ status: 'PUBLISHED', publishedAt: new Date() })
        .where(eq(resourceVersions.id, isolatedVersion.id));

      // 1. Attempting to UPDATE any field on this file must be blocked by trg_prevent_published_resource_file_update
      await expectDbError(
        () =>
          db
            .update(resourceFiles)
            .set({ originalFilename: 'modified_name.pdf' })
            .where(eq(resourceFiles.id, fileForPub.id)),
        /Cannot modify or move file belonging to a PUBLISHED resource version/i,
      );

      // 2. Attempting to move file from PUBLISHED to DRAFT must be blocked
      await expectDbError(
        () =>
          db
            .update(resourceFiles)
            .set({ resourceVersionId: draftVersionId })
            .where(eq(resourceFiles.id, fileForPub.id)),
        /Cannot modify or move file belonging to a PUBLISHED resource version/i,
      );

      // 3. Attempting to DELETE file from PUBLISHED version must be blocked by trg_prevent_published_resource_file_delete
      await expectDbError(
        () => db.delete(resourceFiles).where(eq(resourceFiles.id, fileForPub.id)),
        /Cannot delete file belonging to a PUBLISHED resource version/i,
      );
    });

    it('rejects moving a file from a DRAFT version into a PUBLISHED version', async () => {
      const fileId = createdFileIds[0]; // currently in draftVersionId

      await expectDbError(
        db
          .update(resourceFiles)
          .set({ resourceVersionId: publishedVersionId })
          .where(eq(resourceFiles.id, fileId)),
        /Cannot move file into a PUBLISHED resource version/i,
      );
    });
  });

  describe('3. Database Constraints & Invariants', () => {
    it('enforces partial unique index for single primary file per version (uq_resource_files_primary_version)', async () => {
      // createdFileIds[0] is already isPrimary=true in draftVersionId
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/second-primary.pdf`,
            originalFilename: 'second_primary.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: 'f'.repeat(64),
            isPrimary: true, // Duplicate primary!
            sequenceOrder: 2,
          }),
        /uq_resource_files_primary_version|unique|duplicate/i,
      );
    });

    it('enforces unique sequence_order per version (uq_resource_files_version_seq)', async () => {
      // createdFileIds[0] has sequenceOrder = 1 in draftVersionId
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/dup-seq.pdf`,
            originalFilename: 'dup_seq.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: '1'.repeat(64),
            isPrimary: false,
            sequenceOrder: 1, // Duplicate sequence order!
          }),
        /uq_resource_files_version_seq|unique|duplicate/i,
      );
    });

    it('rejects non-positive byte size (chk_resource_files_file_size_bytes)', async () => {
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/zero-byte.pdf`,
            originalFilename: 'zero.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 0,
            checksumSha256: '2'.repeat(64),
            sequenceOrder: 10,
          }),
        /chk_resource_files_file_size_bytes/i,
      );
    });

    it('rejects invalid SHA-256 length (chk_resource_files_sha256)', async () => {
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/bad-sha.pdf`,
            originalFilename: 'bad_sha.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: 'shortsha',
            sequenceOrder: 11,
          }),
        /chk_resource_files_sha256/i,
      );
    });

    it('rejects invalid status value (chk_resource_files_status)', async () => {
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/bad-stat.pdf`,
            originalFilename: 'bad_stat.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: '3'.repeat(64),
            status: 'CORRUPTED' as any,
            sequenceOrder: 12,
          }),
        /chk_resource_files_status/i,
      );
    });

    it('enforces unique (resource_version_id, checksum_sha256) constraint (uq_resource_files_version_checksum)', async () => {
      // createdFileIds[0] has checksumSha256 = dummySha in draftVersionId
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/dup-checksum.pdf`,
            originalFilename: 'dup_checksum.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 2048,
            checksumSha256: dummySha, // Duplicate checksum in same version!
            sequenceOrder: 20,
          }),
        /uq_resource_files_version_checksum|unique|duplicate/i,
      );
    });

    it('rejects invalid storage_provider value (chk_resource_files_storage_provider)', async () => {
      await expectDbError(
        () =>
          db.insert(resourceFiles).values({
            resourceVersionId: draftVersionId,
            storageProvider: 'INVALID_PROVIDER' as any,
            storageBucket: 'test-bucket',
            objectKey: `resources/${testResourceId}/versions/${draftVersionId}/bad-provider.pdf`,
            originalFilename: 'bad_provider.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: '4'.repeat(64),
            sequenceOrder: 21,
          }),
        /chk_resource_files_storage_provider/i,
      );
    });

    it('accepts QUARANTINED file status and persists storage_metadata JSONB', async () => {
      const [quarantinedFile] = await db
        .insert(resourceFiles)
        .values({
          resourceVersionId: draftVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'test-bucket',
          objectKey: `resources/${testResourceId}/versions/${draftVersionId}/quarantined.pdf`,
          originalFilename: 'suspicious_upload.pdf',
          fileExtension: 'pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          checksumSha256: '5'.repeat(64),
          status: 'QUARANTINED',
          storageMetadata: {
            scanStatus: 'FLAGGED',
            scannerEngine: 'ClamAV',
            threatScore: 85,
          },
          sequenceOrder: 22,
        })
        .returning();

      expect(quarantinedFile).toBeDefined();
      expect(quarantinedFile.status).toBe('QUARANTINED');
      expect((quarantinedFile.storageMetadata as any)?.scanStatus).toBe('FLAGGED');
      createdFileIds.push(quarantinedFile.id);
    });
  });
});
