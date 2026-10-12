import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  countries,
  educationUpdates,
  educationUpdateCategories,
} from '../../src/db/schemas.js';
import { EducationUpdateService } from '../../src/services/education-update.service.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { seedEducationUpdateCategories } from '../../src/db/seeds/education-updates-categories.js';
import { buildApp } from '../../src/app.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Prompt 23: Education Updates Fastify API Integration', () => {
  const updateService = new EducationUpdateService(db);
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);

  const app = buildApp({
    services: {
      educationUpdateService: updateService,
      authService,
      rbacService,
    },
  });

  let adminCookie = '';
  let standardUserCookie = '';
  const createdUserIds: string[] = [];
  const cleanupUpdateIds: string[] = [];

  let kenyaId: string;
  let testCategoryId: string;

  beforeAll(async () => {
    await withDbRetry(() => seedRolesAndPermissions(db));
    await withDbRetry(() => seedEducationUpdateCategories(db));

    // Resolve or create Kenya
    const [ke] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1),
    );
    if (ke) {
      kenyaId = ke.id;
    } else {
      const [newKe] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Kenya Test',
            isoCode: 'KE',
            urlPrefix: 'ke',
            status: 'ACTIVE',
          })
          .returning(),
      );
      kenyaId = newKe.id;
    }

    // Resolve category
    const [cat] = await withDbRetry(() =>
      db.select().from(educationUpdateCategories).limit(1),
    );
    testCategoryId = cat.id;

    // Register admin user
    const adminEmail = `update-admin-${Date.now()}@example.com`;
    const adminReg = await withDbRetry(() =>
      authService.register({
        email: adminEmail,
        password: 'AdminPassword123!',
        displayName: 'Update Admin',
      }),
    );
    createdUserIds.push(adminReg.user.id);
    await withDbRetry(() =>
      rbacService.assignRole({
        userId: adminReg.user.id,
        roleSlug: 'system_admin',
      }),
    );
    adminCookie = `${SESSION_COOKIE_NAME}=${adminReg.sessionToken}`;

    // Register standard user
    const userEmail = `standard-user-${Date.now()}@example.com`;
    const userReg = await withDbRetry(() =>
      authService.register({
        email: userEmail,
        password: 'UserPassword123!',
        displayName: 'Standard User',
      }),
    );
    createdUserIds.push(userReg.user.id);
    standardUserCookie = `${SESSION_COOKIE_NAME}=${userReg.sessionToken}`;
  });

  afterAll(async () => {
    if (cleanupUpdateIds.length > 0) {
      await withDbRetry(() =>
        db
          .delete(educationUpdates)
          .where(inArray(educationUpdates.id, cleanupUpdateIds)),
      );
    }
    if (createdUserIds.length > 0) {
      await withDbRetry(() =>
        db.delete(users).where(inArray(users.id, createdUserIds)),
      );
    }
    await closeDatabase();
  });

  describe('Public Endpoints (Anonymous Access)', () => {
    it('GET /api/v1/updates/categories returns 200 OK without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/updates/categories',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('slug');
      expect(body.data[0]).toHaveProperty('name');
    });

    it('GET /api/v1/updates returns 200 OK and paginated structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/updates?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toBeDefined();
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(10);
    });

    it('GET /api/v1/updates/:slug returns 404 for non-existent or unpublished update', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/updates/non-existent-update-slug',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Administrative Endpoints & RBAC Protection', () => {
    it('POST /api/v1/admin/updates returns 401 Unauthorized without auth cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        payload: {
          title: 'Unauthenticated Attempt',
          body: 'Content',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('POST /api/v1/admin/updates returns 403 Forbidden for standard_user lacking update.create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        headers: {
          cookie: standardUserCookie,
        },
        payload: {
          title: 'Forbidden Attempt',
          body: 'Content',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /api/v1/admin/updates creates draft update for system_admin (201 Created)', async () => {
      const slug = `route-admin-draft-${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        headers: {
          cookie: adminCookie,
        },
        payload: {
          title: 'Ministry Circular on Term 3 Reopening',
          slug,
          summary: 'Approved opening dates and school guidelines.',
          body: 'Full official advisory from the Ministry of Education.',
          countryId: kenyaId,
          categoryId: testCategoryId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.publicationStatus).toBe('DRAFT');
      expect(body.data.publishedAt).toBeNull();
      cleanupUpdateIds.push(body.data.id);
    });

    it('full publication workflow: create draft -> publish -> verify public -> archive -> verify hidden', async () => {
      const slug = `route-workflow-${Date.now()}`;

      // 1. Create draft
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        headers: {
          cookie: adminCookie,
        },
        payload: {
          title: 'Assessment Guidelines for Special Needs Schools',
          slug,
          body: 'Comprehensive accommodation rules for national examinations.',
          countryId: kenyaId,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const updateId = createRes.json().data.id;
      cleanupUpdateIds.push(updateId);

      // Verify draft is hidden from public /api/v1/updates/:slug
      const publicDraftRes = await app.inject({
        method: 'GET',
        url: `/api/v1/updates/${slug}`,
      });
      expect(publicDraftRes.statusCode).toBe(404);

      // 2. Publish
      const publishRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/updates/${updateId}/publish`,
        headers: {
          cookie: adminCookie,
        },
      });
      expect(publishRes.statusCode).toBe(200);
      expect(publishRes.json().data.publicationStatus).toBe('PUBLISHED');
      expect(publishRes.json().data.publishedAt).not.toBeNull();

      // 3. Verify public retrieval works now
      const publicPubRes = await app.inject({
        method: 'GET',
        url: `/api/v1/updates/${slug}`,
      });
      expect(publicPubRes.statusCode).toBe(200);
      const pubBody = publicPubRes.json().data;
      expect(pubBody.slug).toBe(slug);
      expect(pubBody.publicationStatus).toBe('PUBLISHED');
      expect(pubBody.seo.canonicalUrl).toContain(`/ke/updates/${slug}`);

      // 4. Archive
      const archiveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/updates/${updateId}/archive`,
        headers: {
          cookie: adminCookie,
        },
      });
      expect(archiveRes.statusCode).toBe(200);
      expect(archiveRes.json().data.publicationStatus).toBe('ARCHIVED');

      // 5. Verify immediately hidden from public endpoint
      const publicArchivedRes = await app.inject({
        method: 'GET',
        url: `/api/v1/updates/${slug}`,
      });
      expect(publicArchivedRes.statusCode).toBe(404);
    });
  });
});
