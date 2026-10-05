import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
} from '../../src/db/schemas.js';
import { defaultAuthService } from '../../src/services/auth.service.js';
import {
  DefaultLibraryService,
  ResourceVersionNotFoundError,
  ResourceVersionNotEligibleError,
} from '../../src/services/library.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('User Library Neon Database Integration Tests', () => {
  const libraryService = new DefaultLibraryService(db);
  const authService = defaultAuthService;

  let testCountryId: string;
  let testTypeId: string;

  let publishedResourceId: string;
  let publishedVersionId: string;

  let draftResourceId: string;
  let draftVersionId: string;

  let archivedResourceId: string;
  let archivedVersionId: string;

  let userAId: string;
  let userBId: string;

  const createdUserIds: string[] = [];
  const createdResourceIds: string[] = [];
  const createdCountryIds: string[] = [];

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
      let isoCode = 'YYY';
      for (let i = 0; i < 26; i++) {
        const candidate = `Y${String.fromCharCode(65 + i)}Y`;
        if (!usedSet.has(candidate)) {
          isoCode = candidate;
          break;
        }
      }
      const [country] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: `Library Test Country ${Date.now()}`,
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
            code: `LIB_TYPE_${Date.now()}`,
            name: 'Library Lesson Plan',
            slug: `lib-lesson-${Date.now()}`,
            pillar: 'CORE',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }

    // 3. Create published resource + published version
    const [pubRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Published Library Resource ${Date.now()}`,
          slug: `pub-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'VERIFIED',
        })
        .returning(),
    );
    publishedResourceId = pubRes.id;
    createdResourceIds.push(pubRes.id);

    const [pubVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: publishedResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Version 1.0.0',
          status: 'DRAFT',
        })
        .returning(),
    );
    publishedVersionId = pubVer.id;

    // Attach an AVAILABLE file to version while DRAFT (satisfies database trigger)
    await withDbRetry(async () =>
      db.insert(resourceFiles).values({
        resourceVersionId: publishedVersionId,
        storageProvider: 'CLOUDFLARE_R2',
        storageBucket: 'secret-test-bucket',
        objectKey: `secret/path/to/published-${Date.now()}-${Math.random()}.pdf`,
        originalFilename: 'worksheet.pdf',
        fileExtension: 'pdf',
        fileType: 'MAIN_DOCUMENT',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
        checksumSha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        isPrimary: true,
        sequenceOrder: 1,
      }),
    );

    // Transition version to PUBLISHED
    await withDbRetry(async () =>
      db
        .update(resourceVersions)
        .set({
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .where(eq(resourceVersions.id, publishedVersionId)),
    );

    // 4. Create draft resource + draft version (ineligible)
    const [draftRes] = await withDbRetry(async () =>
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
    draftResourceId = draftRes.id;
    createdResourceIds.push(draftRes.id);

    const [draftVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: draftResourceId,
          versionNumber: 1,
          versionLabel: 'v0.1.0',
          title: 'Draft Version',
          status: 'DRAFT',
        })
        .returning(),
    );
    draftVersionId = draftVer.id;

    // 5. Create archived resource + published version (ineligible due to parent status)
    const [archRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Archived Resource ${Date.now()}`,
          slug: `arch-res-${Date.now()}`,
          status: 'ARCHIVED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    archivedResourceId = archRes.id;
    createdResourceIds.push(archRes.id);

    const [archVer] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: archivedResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: 'Archived Version',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    archivedVersionId = archVer.id;

    // 6. Register two test users
    const regA = await withDbRetry(() =>
      authService.register({
        email: `lib-user-a-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Library User A',
      }),
    );
    userAId = regA.user.id;
    createdUserIds.push(userAId);

    const regB = await withDbRetry(() =>
      authService.register({
        email: `lib-user-b-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Library User B',
      }),
    );
    userBId = regB.user.id;
    createdUserIds.push(userBId);
  }, 180000);

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        await withDbRetry(() =>
          db.delete(users).where(inArray(users.id, createdUserIds)),
        ).catch(() => {});
      }
      if (createdResourceIds.length > 0) {
        await withDbRetry(() =>
          db.delete(resources).where(inArray(resources.id, createdResourceIds)),
        ).catch(() => {});
      }
      if (createdCountryIds.length > 0) {
        await withDbRetry(() =>
          db.delete(countries).where(inArray(countries.id, createdCountryIds)),
        ).catch(() => {});
      }
    } catch {
      // Ignore teardown errors
    }
  });

  describe('1. Save Eligibility & Persistence', () => {
    it('successfully saves a published resource version into user array', async () => {
      const res = await withDbRetry(() =>
        libraryService.saveResourceVersion(userAId, publishedVersionId),
      );

      expect(res.saved).toBe(true);
      expect(res.resourceVersionId).toBe(publishedVersionId);
      expect(res.item.id).toBe(publishedResourceId);
      expect(res.item.title).toContain('Published Library Resource');

      // Verify directly from PostgreSQL
      const [u] = await withDbRetry(() =>
        db.select({ saved: users.savedResourceVersionIds }).from(users).where(eq(users.id, userAId)),
      );
      expect(u.saved).toContain(publishedVersionId);
    });

    it('prevents duplicates: saving the same version repeatedly maintains a single array element', async () => {
      // Save again
      const res = await withDbRetry(() =>
        libraryService.saveResourceVersion(userAId, publishedVersionId),
      );
      expect(res.saved).toBe(true);

      const [u] = await withDbRetry(() =>
        db.select({ saved: users.savedResourceVersionIds }).from(users).where(eq(users.id, userAId)),
      );
      const matches = u.saved.filter((id) => id === publishedVersionId);
      expect(matches.length).toBe(1);
    });

    it('rejects saving a DRAFT version with ResourceVersionNotEligibleError', async () => {
      await expect(
        libraryService.saveResourceVersion(userAId, draftVersionId),
      ).rejects.toThrow(ResourceVersionNotEligibleError);

      const [u] = await withDbRetry(() =>
        db.select({ saved: users.savedResourceVersionIds }).from(users).where(eq(users.id, userAId)),
      );
      expect(u.saved).not.toContain(draftVersionId);
    });

    it('rejects saving an ARCHIVED resource with ResourceVersionNotEligibleError', async () => {
      await expect(
        libraryService.saveResourceVersion(userAId, archivedVersionId),
      ).rejects.toThrow(ResourceVersionNotEligibleError);
    });

    it('rejects saving a non-existent version with ResourceVersionNotFoundError', async () => {
      const nonExistent = '99999999-9999-4999-a999-999999999999';
      await expect(
        libraryService.saveResourceVersion(userAId, nonExistent),
      ).rejects.toThrow(ResourceVersionNotFoundError);
    });
  });

  describe('2. User Isolation', () => {
    it('isolates user libraries: User A saving a version does not affect User B', async () => {
      const checkB = await withDbRetry(() =>
        libraryService.isResourceVersionSaved(userBId, publishedVersionId),
      );
      expect(checkB.isSaved).toBe(false);

      const listB = await withDbRetry(() => libraryService.listSavedResources(userBId));
      expect(listB.data.length).toBe(0);
      expect(listB.pagination.total).toBe(0);
    });
  });

  describe('3. Check Status and Idempotent Removal', () => {
    it('accurately verifies isResourceVersionSaved', async () => {
      const checkSaved = await withDbRetry(() =>
        libraryService.isResourceVersionSaved(userAId, publishedVersionId),
      );
      expect(checkSaved.isSaved).toBe(true);

      const checkUnsaved = await withDbRetry(() =>
        libraryService.isResourceVersionSaved(userAId, draftVersionId),
      );
      expect(checkUnsaved.isSaved).toBe(false);
    });

    it('idempotently removes a saved resource version', async () => {
      const rem1 = await withDbRetry(() =>
        libraryService.removeResourceVersion(userAId, publishedVersionId),
      );
      expect(rem1.removed).toBe(true);

      // Verify from DB
      const [u] = await withDbRetry(() =>
        db.select({ saved: users.savedResourceVersionIds }).from(users).where(eq(users.id, userAId)),
      );
      expect(u.saved).not.toContain(publishedVersionId);

      // Remove again (idempotent)
      const rem2 = await withDbRetry(() =>
        libraryService.removeResourceVersion(userAId, publishedVersionId),
      );
      expect(rem2.removed).toBe(true);
    });
  });

  describe('4. Listing & Sanitized Storage Projection', () => {
    beforeAll(async () => {
      // Re-save for User A
      await withDbRetry(() =>
        libraryService.saveResourceVersion(userAId, publishedVersionId),
      );
    });

    it('projects saved resource items with public catalogue metadata and no R2 leakage', async () => {
      const res = await withDbRetry(() => libraryService.listSavedResources(userAId));

      expect(res.data.length).toBe(1);
      expect(res.pagination.total).toBe(1);

      const item = res.data[0];
      expect(item.id).toBe(publishedResourceId);
      expect(item.publishedVersion.id).toBe(publishedVersionId);
      expect(item.primaryFile?.originalFilename).toBe('worksheet.pdf');

      // Verify zero storage leakage
      const raw = JSON.stringify(item);
      expect(raw).not.toContain('secret-test-bucket');
      expect(raw).not.toContain('secret/path');
      expect(raw).not.toContain('CLOUDFLARE_R2');
    });
  });
});
