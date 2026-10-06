import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
} from '../../src/db/schemas.js';
import {
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../src/services/auth.service.js';
import { DefaultDownloadService } from '../../src/services/download.service.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Free Downloads HTTP Route Integration Tests', () => {
  const memoryStorage = new MemoryStorageProvider('route-dl-bucket');
  const downloadService = new DefaultDownloadService(db, memoryStorage, 300);
  const authService = defaultAuthService;

  const app = buildApp({
    services: {
      downloadService,
      authService,
    },
  });

  let testCountryId: string;
  let testTypeId: string;

  let freeResourceId: string;
  let freeVersionId: string;
  let primaryFileId: string;
  let supplementaryFileId: string;
  let quarantinedFileId: string;

  let premiumResourceId: string;
  let draftResourceId: string;

  let otherResourceId: string;
  let otherFileId: string;

  let authenticatedCookie: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Fetch or create country
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
      let isoCode = 'ZZR';
      for (let i = 0; i < 26; i++) {
        const candidate = `R${String.fromCharCode(65 + i)}R`;
        if (!usedSet.has(candidate)) {
          isoCode = candidate;
          break;
        }
      }
      const [country] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: `Download Route Country ${Date.now()}`,
            isoCode,
            urlPrefix: `dr${Date.now().toString().slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testCountryId = country.id;
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
            code: `RDL_TYPE_${Date.now()}`,
            name: 'Route Download Type',
            slug: `rdl-type-${Date.now()}`,
            pillar: 'CORE',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }

    // 3. Register authenticated test user
    const reg = await withDbRetry(async () =>
      authService.register({
        email: `download-user-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Download Tester',
      }),
    );
    createdUserIds.push(reg.user.id);
    authenticatedCookie = `${SESSION_COOKIE_NAME}=${reg.sessionToken}`;

    // 4. Create FREE published resource + files
    const [freeRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Free Resource ${Date.now()}`,
          slug: `route-free-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    freeResourceId = freeRes.id;

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

    const [pFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'route-dl-bucket',
          objectKey: `resources/${freeResourceId}/primary-${Date.now()}.pdf`,
          originalFilename: 'cbc-primary-guide.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 1048576,
          checksumSha256: 'a'.repeat(64),
          status: 'AVAILABLE',
          isPrimary: true,
          sequenceOrder: 1,
        })
        .returning(),
    );
    primaryFileId = pFile.id;

    const [sFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'route-dl-bucket',
          objectKey: `resources/${freeResourceId}/supp-${Date.now()}.pdf`,
          originalFilename: 'activity-sheet.pdf',
          fileExtension: 'pdf',
          fileType: 'ACTIVITY_SHEET',
          mimeType: 'application/pdf',
          fileSizeBytes: 524288,
          checksumSha256: 'b'.repeat(64),
          status: 'AVAILABLE',
          isPrimary: false,
          sequenceOrder: 2,
        })
        .returning(),
    );
    supplementaryFileId = sFile.id;

    const [qFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: freeVersionId,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'route-dl-bucket',
          objectKey: `resources/${freeResourceId}/quarantine-${Date.now()}.pdf`,
          originalFilename: 'pending-scan.pdf',
          fileExtension: 'pdf',
          fileType: 'SUPPLEMENTARY',
          mimeType: 'application/pdf',
          fileSizeBytes: 262144,
          checksumSha256: 'c'.repeat(64),
          status: 'QUARANTINED',
          isPrimary: false,
          sequenceOrder: 3,
        })
        .returning(),
    );
    quarantinedFileId = qFile.id;

    await withDbRetry(async () =>
      db
        .update(resourceVersions)
        .set({ status: 'PUBLISHED', publishedAt: new Date() })
        .where(eq(resourceVersions.id, freeVersionId)),
    );

    // 5. Create PREMIUM published resource
    const [premRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Premium Resource ${Date.now()}`,
          slug: `route-prem-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    premiumResourceId = premRes.id;

    await withDbRetry(async () =>
      db.insert(resourceVersions).values({
        resourceId: premiumResourceId,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: 'Premium Version',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }),
    );

    // 6. Create DRAFT resource
    const [drRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Draft Resource ${Date.now()}`,
          slug: `route-draft-res-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = drRes.id;

    // 7. Create OTHER published resource with its own file
    const [othRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Other Resource ${Date.now()}`,
          slug: `route-other-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    otherResourceId = othRes.id;

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

    const [oFile] = await withDbRetry(async () =>
      db
        .insert(resourceFiles)
        .values({
          resourceVersionId: othVer.id,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'route-dl-bucket',
          objectKey: `resources/${otherResourceId}/other-${Date.now()}.pdf`,
          originalFilename: 'other.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          checksumSha256: 'd'.repeat(64),
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
        .where(eq(resourceVersions.id, othVer.id)),
    );
  });

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        await withDbRetry(async () => {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }).catch(() => {});
      }
    } catch {
      // Ignored
    }
  });

  describe('1. Anonymous & Authenticated Access (Correction 3)', () => {
    it('allows anonymous download with NO session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.downloadUrl).toBeDefined();
      expect(body.data.expiresInSeconds).toBe(300);
      expect(body.data.file.id).toBe(primaryFileId);
      expect(body.data.file.originalFilename).toBe('cbc-primary-guide.pdf');

      // Security check (Correction 1)
      expect(body.data.objectKey).toBeUndefined();
      expect(body.data.storageBucket).toBeUndefined();
      expect(body.data.storageProvider).toBeUndefined();
      expect(body.data.file.objectKey).toBeUndefined();
    });

    it('allows authenticated download with valid session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        headers: { cookie: authenticatedCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.downloadUrl).toBeDefined();
      expect(body.data.file.id).toBe(primaryFileId);
    });

    it('allows download when session cookie is invalid or expired (treats as anonymous)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=invalid_or_expired_token` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.downloadUrl).toBeDefined();
      expect(body.data.file.id).toBe(primaryFileId);
    });
  });

  describe('2. Parameter Validation & File Selection', () => {
    it('returns 400 VALIDATION_ERROR when resource ID is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/resources/not-a-valid-uuid/download',
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when fileId in body is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        payload: { fileId: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('successfully downloads specific file when valid fileId is provided in body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        payload: { fileId: supplementaryFileId },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.file.id).toBe(supplementaryFileId);
      expect(body.data.file.originalFilename).toBe('activity-sheet.pdf');
    });
  });

  describe('3. Gating & Error Invariants', () => {
    it('blocks download of PREMIUM resources with 403 PREMIUM_RESOURCE_LOCKED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${premiumResourceId}/download`,
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('PREMIUM_RESOURCE_LOCKED');
    });

    it('blocks download of DRAFT resources with 404 RESOURCE_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${draftResourceId}/download`,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('returns 404 RESOURCE_NOT_FOUND for non-existent resource UUID', async () => {
      const nonExistentId = '99999999-9999-4999-a999-999999999999';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${nonExistentId}/download`,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('blocks cross-version file access: returns 404 FILE_NOT_FOUND when requesting another resource file', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        payload: { fileId: otherFileId },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FILE_NOT_FOUND');
    });

    it('blocks quarantined file download with 400 FILE_NOT_AVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${freeResourceId}/download`,
        payload: { fileId: quarantinedFileId },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FILE_NOT_AVAILABLE');
    });
  });
});
