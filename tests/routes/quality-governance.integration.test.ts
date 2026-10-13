import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { withDbRetry } from '../helpers/db-retry.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
} from '../../src/db/schemas.js';
import {
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../src/services/auth.service.js';
import { defaultRbacService } from '../../src/services/rbac.service.js';
import { defaultQualityGovernanceService } from '../../src/services/quality-governance.service.js';

describe('Quality Governance Route Integration Tests', () => {
  let app: FastifyInstance;
  let countryId: string;
  let resourceTypeId: string;
  let testResourceId: string;
  let testVersionId: string;
  let premiumResourceId: string;
  let premiumVersionId: string;

  // Users for RBAC separation of duties
  let standardUserToken: string;
  let reviewerUserToken: string;
  let reviewerUserId: string;
  let managerUserToken: string;
  let managerUserId: string;
  let adminUserToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // 1. Resolve country & resource type
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    countryId = c.id;

    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    resourceTypeId = rt.id;

    // 2. Register standard user
    const stdRes = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `qg_route_std_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Standard User',
      }),
    );
    standardUserToken = stdRes.sessionToken;

    // 3. Register content reviewer & assign content_reviewer role
    const revRes = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `qg_route_rev_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Content Reviewer',
      }),
    );
    reviewerUserToken = revRes.sessionToken;
    reviewerUserId = revRes.user.id;
    await withDbRetry(async () =>
      defaultRbacService.assignRole({
        userId: reviewerUserId,
        roleSlug: 'content_reviewer',
      }),
    );

    // 4. Register content manager & assign content_manager role
    const mgrRes = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `qg_route_mgr_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Content Manager',
      }),
    );
    managerUserToken = mgrRes.sessionToken;
    managerUserId = mgrRes.user.id;
    await withDbRetry(async () =>
      defaultRbacService.assignRole({
        userId: managerUserId,
        roleSlug: 'content_manager',
      }),
    );

    // 5. Register system admin & assign system_admin role
    const admRes = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `qg_route_adm_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'System Admin',
      }),
    );
    adminUserToken = admRes.sessionToken;
    await withDbRetry(async () =>
      defaultRbacService.assignRole({
        userId: admRes.user.id,
        roleSlug: 'system_admin',
      }),
    );

    // 6. Create published standard test resource
    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Route QG Standard Resource ${Date.now()}`,
          slug: `route-qg-standard-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    testResourceId = r.id;

    const [v] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Route QG Standard Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    testVersionId = v.id;

    // 7. Create published PREMIUM test resource (Correction A / Premium coexistence)
    const [rp] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Route QG Premium Resource ${Date.now()}`,
          slug: `route-qg-premium-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    premiumResourceId = rp.id;

    const [vp] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: premiumResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Route QG Premium Version 1',
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
          publishedAt: new Date(),
        })
        .returning(),
    );
    premiumVersionId = vp.id;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  const getCookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

  describe('1. Authentication and Authorization Boundaries', () => {
    it('rejects unauthenticated requests to quality admin routes (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/quality/check-types',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects standard users from accessing quality check types (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/quality/check-types',
        headers: { cookie: getCookie(standardUserToken) },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows content_reviewer to list check types (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/quality/check-types',
        headers: { cookie: getCookie(reviewerUserToken) },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.length).toBeGreaterThanOrEqual(7);
    });

    it('allows system_admin to list check types (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/quality/check-types',
        headers: { cookie: getCookie(adminUserToken) },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('2. Separation of Duties: Reviewer vs Manager', () => {
    it('allows content_reviewer to record quality check evaluations', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${testResourceId}/quality-checks`,
        headers: { cookie: getCookie(reviewerUserToken) },
        payload: {
          versionId: testVersionId,
          checkTypeCode: 'CURRICULUM_ALIGNMENT',
          status: 'PASSED',
          notes: 'Confirms CBC Kenya Junior School alignment.',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.checkTypeCode).toBe('CURRICULUM_ALIGNMENT');
      expect(json.data.status).toBe('PASSED');
      expect(json.data.checkedBy).toBe(reviewerUserId);
    });

    it('blocks content_reviewer from granting official verification (403 Forbidden)', async () => {
      // Content reviewer lacks 'quality.verify' permission
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${testResourceId}/verify`,
        headers: { cookie: getCookie(reviewerUserToken) },
        payload: {
          versionId: testVersionId,
          notes: 'Attempt by reviewer to verify directly',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('blocks content_reviewer from revoking verification (403 Forbidden)', async () => {
      // Content reviewer lacks 'quality.revoke' permission
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${testResourceId}/revoke-verification`,
        headers: { cookie: getCookie(reviewerUserToken) },
        payload: {
          versionId: testVersionId,
          reason: 'Attempt by reviewer to revoke directly',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('3. Complete Quality Verification & Revocation Workflow', () => {
    it('records all remaining mandatory checks', async () => {
      const remainingCodes = [
        'FACTUAL_ACCURACY',
        'COMPLETENESS',
        'FILE_INTEGRITY_READABILITY',
        'PROVENANCE_RIGHTS',
      ];

      for (const code of remainingCodes) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/resources/${testResourceId}/quality-checks`,
          headers: { cookie: getCookie(reviewerUserToken) },
          payload: {
            versionId: testVersionId,
            checkTypeCode: code,
            status: 'PASSED',
            notes: `Reviewer verified ${code}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('allows content_manager to grant official verification after mandatory checks pass', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${testResourceId}/verify`,
        headers: { cookie: getCookie(managerUserToken) },
        payload: {
          versionId: testVersionId,
          notes: 'Full editorial signoff for Verified mark.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.verificationStatus).toBe('VERIFIED');
      expect(json.data.verifiedBy).toBe(managerUserId);
    });

    it('allows content_manager to inspect full internal quality details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/resources/${testResourceId}/quality?versionId=${testVersionId}`,
        headers: { cookie: getCookie(managerUserToken) },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.isVerified).toBe(true);
      expect(json.data.checks.length).toBeGreaterThanOrEqual(5);
      expect(json.data.activeVerification).toBeDefined();
      expect(json.data.evaluationHistory.length).toBeGreaterThanOrEqual(5);
    });

    it('allows content_manager to revoke verification with mandatory reason', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${testResourceId}/revoke-verification`,
        headers: { cookie: getCookie(managerUserToken) },
        payload: {
          versionId: testVersionId,
          reason: 'Routine syllabus review: updated curriculum circular issued.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.verificationStatus).toBe('REVOKED');
      expect(json.data.reason).toBe(
        'Routine syllabus review: updated curriculum circular issued.',
      );
    });
  });

  describe('4. Public Projection & Information Hiding (Correction A)', () => {
    it('projects quality details publicly in catalogue without leaking private reviewer notes', async () => {
      // Re-verify test resource so it has active verification
      await defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: testResourceId,
        versionId: testVersionId,
        actorUserId: managerUserId,
      });

      // Public Catalogue detail request (no auth required)
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${testResourceId}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const resource = json.data;

      expect(resource.quality).toBeDefined();
      expect(resource.quality.isVerified).toBe(true);
      expect(resource.quality.displayMark).toBe('✓');
      expect(resource.quality.label).toBe('VERIFIED');
      expect(resource.quality.verifiedAt).toBeDefined();

      // STRICT ZERO INFORMATION LEAKAGE INVARIANTS:
      expect((resource as any).notes).toBeUndefined();
      expect((resource as any).checkedBy).toBeUndefined();
      expect((resource as any).verifiedBy).toBeUndefined();
      expect((resource as any).evaluationHistory).toBeUndefined();
      expect((resource as any).checks).toBeUndefined();
      expect((resource as any).verificationHistory).toBeUndefined();
    });

    it('allows Premium resource to also be Verified without changing commercial classification (Correction A)', async () => {
      // Pass all mandatory checks on premium resource
      const mandatoryCodes = [
        'CURRICULUM_ALIGNMENT',
        'FACTUAL_ACCURACY',
        'COMPLETENESS',
        'FILE_INTEGRITY_READABILITY',
        'PROVENANCE_RIGHTS',
      ];
      for (const code of mandatoryCodes) {
        await defaultQualityGovernanceService.recordQualityCheck({
          resourceId: premiumResourceId,
          versionId: premiumVersionId,
          checkTypeCode: code,
          status: 'PASSED',
          actorUserId: reviewerUserId,
        });
      }

      // Verify the premium resource version
      await defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: premiumResourceId,
        versionId: premiumVersionId,
        actorUserId: managerUserId,
      });

      // Public Catalogue detail
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${premiumResourceId}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const resource = json.data;

      // Quality badge reflects Verified ✓
      expect(resource.quality.isVerified).toBe(true);
      expect(resource.quality.displayMark).toBe('✓');

      // CRITICAL: Commercial classification remains strictly 'PREMIUM'
      // to ensure download entitlement verification is never bypassed!
      expect(resource.qualityLabel).toBe('PREMIUM');
    });
  });
});
