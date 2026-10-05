import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  resourceVersions,
} from '../../src/db/schemas.js';
import {
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../src/services/auth.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('User Library HTTP Route Integration Tests', () => {
  const app = buildApp();
  const authService = defaultAuthService;

  let testCountryId: string;
  let testTypeId: string;

  let publishedResourceId: string;
  let publishedVersionId: string;

  let draftResourceId: string;
  let draftVersionId: string;

  let userACookie: string;
  let userAId: string;

  let userBCookie: string;
  let userBId: string;

  const createdUserIds: string[] = [];
  const createdResourceIds: string[] = [];
  const createdCountryIds: string[] = [];

  beforeAll(async () => {
    // 1. Create country
    const randAlpha = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const randNum = Math.floor(Math.random() * 10);
    const isoCode = `K${randAlpha}${randNum}`.substring(0, 3);
    const urlPrefix = `krl${Date.now().toString().slice(-4)}${randNum}`;

    const [country] = await withDbRetry(async () =>
      db
        .insert(countries)
        .values({
          name: `Route Lib Country ${Date.now()}`,
          isoCode,
          urlPrefix,
          status: 'ACTIVE',
        })
        .returning(),
    );
    testCountryId = country.id;
    createdCountryIds.push(country.id);

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
            code: `RLIB_${Date.now()}`,
            name: 'Route Lib Type',
            slug: `rlib-${Date.now()}`,
            pillar: 'CORE',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }

    // 3. Create published resource and published version
    const [pubRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Published Resource ${Date.now()}`,
          slug: `route-pub-${Date.now()}`,
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
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    publishedVersionId = pubVer.id;

    // 4. Create draft resource and draft version
    const [dRes] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testTypeId,
          title: `Route Draft Resource ${Date.now()}`,
          slug: `route-draft-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = dRes.id;
    createdResourceIds.push(dRes.id);

    const [dVer] = await withDbRetry(async () =>
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
    draftVersionId = dVer.id;

    // 5. Register User A and User B
    const regA = await withDbRetry(() =>
      authService.register({
        email: `route-user-a-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Route User A',
      }),
    );
    userAId = regA.user.id;
    createdUserIds.push(userAId);
    userACookie = `${SESSION_COOKIE_NAME}=${regA.sessionToken}`;

    const regB = await withDbRetry(() =>
      authService.register({
        email: `route-user-b-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Route User B',
      }),
    );
    userBId = regB.user.id;
    createdUserIds.push(userBId);
    userBCookie = `${SESSION_COOKIE_NAME}=${regB.sessionToken}`;
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
      // Ignore cleanup
    }
  });

  describe('1. Unauthenticated Requests (401 UNAUTHENTICATED)', () => {
    it('returns 401 when saving without session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/library/resources/${publishedVersionId}`,
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when removing without session cookie', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/library/resources/${publishedVersionId}`,
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when checking saved status without session cookie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/library/resources/${publishedVersionId}`,
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when listing library without session cookie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/library/resources',
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('2. Parameter Validation (400 BAD_REQUEST)', () => {
    it('returns 400 when resourceVersionId is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/library/resources/invalid-uuid-format',
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Eligibility & Error Handling', () => {
    it('returns 400 RESOURCE_VERSION_NOT_ELIGIBLE when attempting to save a DRAFT version', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/library/resources/${draftVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESOURCE_VERSION_NOT_ELIGIBLE');
    });

    it('returns 404 RESOURCE_VERSION_NOT_FOUND when version does not exist', async () => {
      const nonExistent = '88888888-8888-4888-a888-888888888888';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/library/resources/${nonExistent}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESOURCE_VERSION_NOT_FOUND');
    });
  });

  describe('4. Full Lifecycle & User Isolation', () => {
    it('saves a published version to User A library', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.saved).toBe(true);
      expect(body.data.resourceVersionId).toBe(publishedVersionId);
      expect(body.data.item.id).toBe(publishedResourceId);
    });

    it('verifies that GET /library/resources/:id indicates isSaved = true for User A', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.isSaved).toBe(true);
      expect(body.data.resourceVersionId).toBe(publishedVersionId);
    });

    it('enforces User Isolation: User B sees isSaved = false and empty list', async () => {
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userBCookie },
      });
      expect(checkRes.statusCode).toBe(200);
      const checkBody = JSON.parse(checkRes.body);
      expect(checkBody.data.isSaved).toBe(false);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/library/resources',
        headers: { cookie: userBCookie },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.data.length).toBe(0);
      expect(listBody.pagination.total).toBe(0);
    });

    it('lists the saved resource for User A with public projection', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/library/resources',
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(publishedResourceId);
      expect(body.data[0].publishedVersion.id).toBe(publishedVersionId);
      expect(body.pagination.total).toBe(1);
    });

    it('idempotently removes the saved version for User A', async () => {
      const res1 = await app.inject({
        method: 'DELETE',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.body);
      expect(body1.data.removed).toBe(true);

      // Verify isSaved is now false
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(checkRes.statusCode).toBe(200);
      const checkBody = JSON.parse(checkRes.body);
      expect(checkBody.data.isSaved).toBe(false);

      // Remove again (idempotent)
      const res2 = await app.inject({
        method: 'DELETE',
        url: `/api/v1/library/resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res2.statusCode).toBe(200);
    });
  });

  describe('5. docs/API_SPEC.md Section 33 Aliases (/api/v1/me/saved-resources)', () => {
    it('supports saving via POST /api/v1/me/saved-resources/:id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/saved-resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.saved).toBe(true);
    });

    it('supports listing via GET /api/v1/me/saved-resources', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/saved-resources',
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBe(1);
    });

    it('supports checking via GET /api/v1/me/saved-resources/:id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/saved-resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.isSaved).toBe(true);
    });

    it('supports removing via DELETE /api/v1/me/saved-resources/:id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/saved-resources/${publishedVersionId}`,
        headers: { cookie: userACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.removed).toBe(true);
    });
  });
});
