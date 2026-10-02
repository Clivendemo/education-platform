import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db, closeDatabase } from '../../src/db/index.js';
import { users } from '../../src/db/schemas.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('RBAC HTTP Route Authorization Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);
  const app = buildApp({
    services: {
      authService,
      rbacService,
    },
  });

  const createdUserIds: string[] = [];

  let standardUserCookie: string;
  let standardUserId: string;

  let contentManagerCookie: string;
  let contentManagerId: string;

  beforeAll(async () => {
    await withDbRetry(() => seedRolesAndPermissions(db));

    // Register a standard user (automatically gets standard_user role with resource.read only)
    const stdEmail = `std-route-${Date.now()}@example.com`;
    const stdReg = await withDbRetry(() =>
      authService.register({
        email: stdEmail,
        password: 'Password123!',
        displayName: 'Standard Learner',
      }),
    );
    standardUserId = stdReg.user.id;
    createdUserIds.push(standardUserId);
    standardUserCookie = `${SESSION_COOKIE_NAME}=${stdReg.sessionToken}`;

    // Register a user and elevate to content_manager
    const mgrEmail = `mgr-route-${Date.now()}@example.com`;
    const mgrReg = await withDbRetry(() =>
      authService.register({
        email: mgrEmail,
        password: 'Password123!',
        displayName: 'Content Manager User',
      }),
    );
    contentManagerId = mgrReg.user.id;
    createdUserIds.push(contentManagerId);
    contentManagerCookie = `${SESSION_COOKIE_NAME}=${mgrReg.sessionToken}`;

    await withDbRetry(() =>
      rbacService.assignRole({
        userId: contentManagerId,
        roleSlug: 'content_manager',
      }),
    );
  }, 60000);

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        await withDbRetry(async () => {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }).catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 60000);

  describe('Unauthenticated Access (401 UNAUTHENTICATED)', () => {
    it('returns 401 UNAUTHENTICATED when accessing publication endpoints without session cookie', async () => {
      const dummyResourceId = '00000000-0000-0000-0000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${dummyResourceId}/publish`,
        payload: { versionId: '00000000-0000-0000-0000-000000000002' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHENTICATED');
      expect(body.error.message).toBe('Authentication is required to access this resource');
      expect(body.error.requestId).toBeDefined();
    });
  });

  describe('Forbidden Access (403 FORBIDDEN with Generic Message - Prompt 14 Correction 2)', () => {
    it('returns 403 FORBIDDEN with non-leaking generic message when authenticated user lacks permission', async () => {
      const dummyResourceId = '00000000-0000-0000-0000-000000000001';

      // standard_user has resource.read, but lacks resource.publish
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${dummyResourceId}/publish`,
        headers: {
          cookie: standardUserCookie,
        },
        payload: { versionId: '00000000-0000-0000-0000-000000000002' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('You do not have permission to perform this action.');
      expect(body.error.requestId).toBeDefined();

      // Ensure permission name is NOT leaked
      expect(body.error.message).not.toContain('resource.publish');
    });

    it('returns 403 FORBIDDEN when standard_user attempts to submit for review', async () => {
      const dummyResourceId = '00000000-0000-0000-0000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${dummyResourceId}/submit`,
        headers: {
          cookie: standardUserCookie,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('You do not have permission to perform this action.');
    });
  });

  describe('Authorized Access (User Possesses Required Permission)', () => {
    it('passes authorization gate when user possesses required permission', async () => {
      const dummyResourceId = '00000000-0000-0000-0000-000000000001';

      // content_manager possesses resource.publish
      // The request will pass the authorization gate and reach the publication service
      // (which may return 404 RESOURCE_NOT_FOUND since the dummy resource doesn't exist,
      // confirming authorization succeeded).
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${dummyResourceId}/publish`,
        headers: {
          cookie: contentManagerCookie,
        },
        payload: { versionId: '00000000-0000-0000-0000-000000000002' },
      });

      // Status must NOT be 401 or 403
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('allows GET publication history when user has resource.read permission', async () => {
      const dummyResourceId = '00000000-0000-0000-0000-000000000001';

      // standard_user has resource.read
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${dummyResourceId}/events`,
        headers: {
          cookie: standardUserCookie,
        },
      });

      // Authorization passed: standard_user is allowed to read events
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });
  });
});
