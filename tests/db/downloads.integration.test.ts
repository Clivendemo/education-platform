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
import {
  DefaultDownloadService,
  ResourceNotFoundError,
  PremiumResourceLockedError,
  FileNotFoundDownloadError,
  FileNotAvailableError,
} from '../../src/services/download.service.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Free Downloads Database Integration Tests', () => {
  const memoryStorage = new MemoryStorageProvider('dl-test-bucket');
  const service = new DefaultDownloadService(db, memoryStorage, 300);

  let testCountryId: string;
  let testTypeId: string;

  let freeResourceId: string;
  let freeVersionId: string;
  let primaryFileId: string;
  let supplementaryFileId: string;
  let quarantinedFileId: string;

  let premiumResourceId: string;

  let draftResourceId: string;
  let draftVersionId: string;

  let otherResourceId: string;
  let otherVersionId: string;
  let otherFileId: string;

  const createdCountryIds: string[] = [];
  const createdResourceIds: string[] = [];

  beforeAll(async () => {
    // 1. Fetch existing active country or create collision-safe country
    const [existingCountry] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    if (existingCountry) {
      testCountryId = existingCountry.id;
    } else {
      const existingIsoCodes = await withDbRetry(async () =>
        db.select({ isoCode: countries.isoCode }).from(countries),
      );
      const usedSet = new Set(existingIsoCodes.map((c) => c.isoCode.toUpperCase()));
      let isoCode = 'ZZD';
      for (let i = 0; i < 26; i++) {
        const candidate = `D${String.fromCharCode(65 + i)}D`;
        if (!usedSet.has(candidate)) {
          isoCode = candidate;
          break;
        }
      }
      const [country] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: `Download DB Country ${Date.now()}`,
            isoCode,
            urlPrefix: `dl${Date.now().toString().slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testCountryId = country.id;
      createdCountryIds.push(country.id);
    }

    // 2. Fetch or create resource type
    const [existingType] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    if (existingType) {
      testTypeId = existingType.id;
    } else {
      const [newType] = await withDbRetry(async () =>
        db
          .insert(resourceTypes)
          .values({
            code: `DL_TYPE_${Date.now()}`,
            name: 'Download Test Type',
            slug: `dl-type-${Date.now()}`,
            pillar: 'CORE',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }

    // 3. Create FREE published resource + version + files
    const [freeRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Free Resource ${Date.now()}`,
          slug: `free-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    freeResourceId = freeRes.id;
    createdResourceIds.push(freeRes.id);

    // Insert version as DRAFT first to attach files (trigger rule)
    const [freeVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: freeResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Version 1.0.0',
          status: 'DRAFT',
        })
        .returning(),
    );
    freeVersionId = freeVer.id;

    // Attach primary file
    const [pFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'dl-test-bucket',
          objectKey: `resources/${freeResourceId}/primary-${Date.now()}.pdf`,
          originalFilename: 'math-exam-2024.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          checksumSha256: '1'.repeat(64),
          status: 'AVAILABLE',
          isPrimary: true,
          sequenceOrder: 1,
        })
        .returning(),
    );
    primaryFileId = pFile.id;

    // Attach supplementary file
    const [sFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'dl-test-bucket',
          objectKey: `resources/${freeResourceId}/supp-${Date.now()}.pdf`,
          originalFilename: 'marking-scheme.pdf',
          fileExtension: 'pdf',
          fileType: 'MARKING_SCHEME',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          checksumSha256: '2'.repeat(64),
          status: 'AVAILABLE',
          isPrimary: false,
          sequenceOrder: 2,
        })
        .returning(),
    );
    supplementaryFileId = sFile.id;

    // Attach quarantined file
    const [qFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'dl-test-bucket',
          objectKey: `resources/${freeResourceId}/quarantine-${Date.now()}.pdf`,
          originalFilename: 'unverified-notes.pdf',
          fileExtension: 'pdf',
          fileType: 'SUPPLEMENTARY',
          mimeType: 'application/pdf',
          fileSizeBytes: 512,
          checksumSha256: '3'.repeat(64),
          status: 'QUARANTINED',
          isPrimary: false,
          sequenceOrder: 3,
        })
        .returning(),
    );
    quarantinedFileId = qFile.id;

    // Transition version to PUBLISHED
    await withDbRetry(async () =>
      db
        .update(resourceVersions)
        .set({ status: 'PUBLISHED', publishedAt: new Date() })
        .where(eq(resourceVersions.id, freeVersionId)),
    );

    // 4. Create PREMIUM published resource
    const [premRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Premium Resource ${Date.now()}`,
          slug: `prem-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    premiumResourceId = premRes.id;
    createdResourceIds.push(premRes.id);

    await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: premiumResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Premium Version 1.0.0',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );

    // 5. Create DRAFT resource
    const [drRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Draft Resource ${Date.now()}`,
          slug: `draft-res-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = drRes.id;
    createdResourceIds.push(drRes.id);

    const [drVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: draftResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Draft Version',
          status: 'DRAFT',
        })
        .returning(),
    );
    draftVersionId = drVer.id;

    // 6. Create OTHER published resource with its own file (for cross-version test)
    const [othRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Other Resource ${Date.now()}`,
          slug: `other-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    otherResourceId = othRes.id;
    createdResourceIds.push(othRes.id);

    const [othVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: otherResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Other Version',
          status: 'DRAFT',
        })
        .returning(),
    );
    otherVersionId = othVer.id;

    const [oFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: otherVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'dl-test-bucket',
          objectKey: `resources/${otherResourceId}/other-${Date.now()}.pdf`,
          originalFilename: 'unrelated.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 4096,
          checksumSha256: '4'.repeat(64),
          status: 'AVAILABLE',
          isPrimary: true,
          sequenceOrder: 1,
        })
        .returning(),
    );
    otherFileId = oFile.id;

    await withDbRetry(async () =>
      db
        .update(resourceVersions)
        .set({ status: 'PUBLISHED', publishedAt: new Date() })
        .where(eq(resourceVersions.id, otherVersionId)),
    );
  });

  afterAll(async () => {
    // Note: Published versions and their files are protected by immutability triggers:
    // fn_prevent_published_resource_version_modification and fn_prevent_published_resource_file_delete.
    // Unique UUIDs and timestamped slugs ensure test isolation.
    try {
      if (draftResourceId) {
        await withDbRetry(async () => {
          await db.delete(resourceVersions).where(eq(resourceVersions.id, draftVersionId));
          await db.delete(resources).where(eq(resources.id, draftResourceId));
        }).catch(() => {});
      }
    } catch {
      // Ignored
    }
  });

  describe('Free Download Flow & Invariants', () => {
    it('successfully generates signed download URL for primary file when fileId is omitted', async () => {
      const res = await service.generateDownloadUrl({
        resourceId: freeResourceId,
      });

      expect(res.downloadUrl).toContain('https://mock-storage.local/dl-test-bucket');
      expect(res.expiresInSeconds).toBe(300);
      expect(typeof res.expiresAt).toBe('string');
      expect(res.file.id).toBe(primaryFileId);
      expect(res.file.originalFilename).toBe('math-exam-2024.pdf');
      expect(res.file.fileType).toBe('MAIN_DOCUMENT');
      expect(res.file.mimeType).toBe('application/pdf');

      // Security check: no storage metadata leaked
      const raw = res as any;
      expect(raw.objectKey).toBeUndefined();
      expect(raw.storageBucket).toBeUndefined();
      expect(raw.storageProvider).toBeUndefined();
      expect(raw.storageMetadata).toBeUndefined();
      expect(raw.file.objectKey).toBeUndefined();
    });

    it('successfully generates signed download URL for explicit available fileId', async () => {
      const res = await service.generateDownloadUrl({
        resourceId: freeResourceId,
        fileId: supplementaryFileId,
      });

      expect(res.file.id).toBe(supplementaryFileId);
      expect(res.file.originalFilename).toBe('marking-scheme.pdf');
      expect(res.file.fileType).toBe('MARKING_SCHEME');
    });

    it('rejects download when file status is QUARANTINED with FileNotAvailableError', async () => {
      await expect(
        service.generateDownloadUrl({
          resourceId: freeResourceId,
          fileId: quarantinedFileId,
        }),
      ).rejects.toThrow(FileNotAvailableError);
    });

    it('blocks cross-version access: rejects requesting a file belonging to another resource', async () => {
      // Attempting to download otherFileId through freeResourceId
      await expect(
        service.generateDownloadUrl({
          resourceId: freeResourceId,
          fileId: otherFileId,
        }),
      ).rejects.toThrow(FileNotFoundDownloadError);
    });

    it('blocks premium resource download with PremiumResourceLockedError (403)', async () => {
      const err = await service
        .generateDownloadUrl({ resourceId: premiumResourceId })
        .catch((e) => e);

      expect(err).toBeInstanceOf(PremiumResourceLockedError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('PREMIUM_RESOURCE_LOCKED');
    });

    it('blocks draft resource download with ResourceNotFoundError (404)', async () => {
      await expect(
        service.generateDownloadUrl({ resourceId: draftResourceId }),
      ).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
