import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  contributors,
  contributorApplications,
  contributorSubmissions,
} from '../../src/db/schemas.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { contributorService } from '../../src/services/contributor.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { buildApp } from '../../src/app.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Contributor System HTTP Route Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);
  const app = buildApp({
    services: {
      authService,
      rbacService,
      contributorService,
    },
  });

  let adminCookie = '';
  let adminUserId = '';

  let userACookie = '';
  let userAId = '';

  let userBCookie = '';
  let userBId = '';

  let userCCookie = '';
  let userCId = '';

  const createdUserIds: string[] = [];
  const createdCountryIds: string[] = [];
  const cleanupResourceIds: string[] = [];

  let testCountryId: string;
  let testTypeId: string;

  beforeAll(async () => {
    // 1. Seed RBAC roles and permissions
    await withDbRetry(() => seedRolesAndPermissions(db));

    // 2. Create Admin user with system_admin role
    const adminEmail = `contrib-admin-${Date.now()}@example.com`;
    const adminReg = await withDbRetry(() =>
      authService.register({
        email: adminEmail,
        password: 'AdminPassword123!',
        displayName: 'Contributor Test Admin',
      }),
    );
    adminUserId = adminReg.user.id;
    createdUserIds.push(adminUserId);
    adminCookie = `${SESSION_COOKIE_NAME}=${adminReg.sessionToken}`;

    await withDbRetry(() =>
      rbacService.assignRole({
        userId: adminUserId,
        roleSlug: 'system_admin',
        createdBy: adminUserId,
      }),
    );

    // 3. Create User A (Applicant / Contributor)
    const userAEmail = `contrib-usera-${Date.now()}@example.com`;
    const userAReg = await withDbRetry(() =>
      authService.register({
        email: userAEmail,
        password: 'UserAPassword123!',
        displayName: 'Prof Alice Ochieng',
      }),
    );
    userAId = userAReg.user.id;
    createdUserIds.push(userAId);
    userACookie = `${SESSION_COOKIE_NAME}=${userAReg.sessionToken}`;

    // 4. Create User B (Second Applicant)
    const userBEmail = `contrib-userb-${Date.now()}@example.com`;
    const userBReg = await withDbRetry(() =>
      authService.register({
        email: userBEmail,
        password: 'UserBPassword123!',
        displayName: 'Dr Bob Mwangi',
      }),
    );
    userBId = userBReg.user.id;
    createdUserIds.push(userBId);
    userBCookie = `${SESSION_COOKIE_NAME}=${userBReg.sessionToken}`;

    // 5. Create User C (Standard User without contributor role)
    const userCEmail = `contrib-userc-${Date.now()}@example.com`;
    const userCReg = await withDbRetry(() =>
      authService.register({
        email: userCEmail,
        password: 'UserCPassword123!',
        displayName: 'Charlie Kimani',
      }),
    );
    userCId = userCReg.user.id;
    createdUserIds.push(userCId);
    userCCookie = `${SESSION_COOKIE_NAME}=${userCReg.sessionToken}`;

    // 6. Ensure active country and resource type for published resource tests
    const [existingCountry] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    if (existingCountry) {
      testCountryId = existingCountry.id;
    } else {
      const [newCountry] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Contributor Test Country',
            isoCode: 'CTC',
            urlPrefix: 'ctc',
            currencyCode: 'KES',
            status: 'ACTIVE',
          })
          .returning(),
      );
      testCountryId = newCountry.id;
      createdCountryIds.push(newCountry.id);
    }

    const [existingType] = await withDbRetry(() =>
      db.select().from(resourceTypes).where(eq(resourceTypes.status, 'ACTIVE')).limit(1),
    );
    if (existingType) {
      testTypeId = existingType.id;
    } else {
      const [newType] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `CT_${Date.now()}`,
            name: 'Contributor Type',
            slug: `ct-type-${Date.now()}`,
            pillar: 'NOTES_REVISION',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }
  }, 60000);

  afterAll(async () => {
    try {
      if (cleanupResourceIds.length > 0) {
        await withDbRetry(() =>
          db.delete(resources).where(inArray(resources.id, cleanupResourceIds)),
        ).catch(() => {});
      }
      if (createdUserIds.length > 0) {
        // Cascade cleanup of submissions, contributors, applications
        const contribRecords = await withDbRetry(() =>
          db
            .select({ id: contributors.id })
            .from(contributors)
            .where(inArray(contributors.userId, createdUserIds)),
        ).catch(() => []);
        const cIds = contribRecords.map((c) => c.id);
        if (cIds.length > 0) {
          await withDbRetry(() =>
            db.delete(contributorSubmissions).where(inArray(contributorSubmissions.contributorId, cIds)),
          ).catch(() => {});
        }
        await withDbRetry(() =>
          db.delete(contributorApplications).where(inArray(contributorApplications.userId, createdUserIds)),
        ).catch(() => {});
        await withDbRetry(() =>
          db.delete(contributors).where(inArray(contributors.userId, createdUserIds)),
        ).catch(() => {});
        await withDbRetry(() =>
          db.delete(users).where(inArray(users.id, createdUserIds)),
        ).catch(() => {});
      }
      if (createdCountryIds.length > 0) {
        await withDbRetry(() =>
          db.delete(countries).where(inArray(countries.id, createdCountryIds)),
        ).catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 60000);

  let createdAppId: string;
  let createdContributorSlug: string;
  let createdContributorId: string;
  let createdSubmissionId: string;

  describe('1. Contributor Application Workflow', () => {
    it('rejects unauthenticated application submissions with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contributor-applications',
        payload: {
          applicationText: 'I am a senior physics educator with 10 years experience.',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('allows authenticated standard user to submit an application', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contributor-applications',
        headers: { cookie: userACookie },
        payload: {
          applicationText: 'I am a senior physics educator with 10 years experience in CBC curriculum.',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data).toBeDefined();
      expect(json.data.status).toBe('SUBMITTED');
      expect(json.data.userId).toBe(userAId);
      createdAppId = json.data.id;
    });

    it('rejects duplicate pending application with 409 DUPLICATE_APPLICATION', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contributor-applications',
        headers: { cookie: userACookie },
        payload: {
          applicationText: 'Second duplicate application attempt.',
        },
      });

      expect(res.statusCode).toBe(409);
      const json = res.json();
      expect(json.error.code).toBe('DUPLICATE_APPLICATION');
    });
  });

  describe('2. Administrative Application Review', () => {
    it('forbids standard non-admin user from listing applications with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/contributor-applications',
        headers: { cookie: userCCookie },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows system admin to list pending contributor applications', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/contributor-applications?status=SUBMITTED',
        headers: { cookie: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.data)).toBe(true);
      const found = json.data.find((a: any) => a.id === createdAppId);
      expect(found).toBeDefined();
    });

    it('rejects application rejection without mandatory review notes with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/contributor-applications/${createdAppId}/review`,
        headers: { cookie: adminCookie },
        payload: {
          action: 'REJECT',
          notes: '   ',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('approves application, atomically creates profile and assigns contributor role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/contributor-applications/${createdAppId}/review`,
        headers: { cookie: adminCookie },
        payload: {
          action: 'APPROVE',
          notes: 'Verified qualifications and teaching credentials.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.application.status).toBe('APPROVED');
      expect(json.data.contributor).toBeDefined();
      expect(json.data.contributor.status).toBe('ACTIVE');
      expect(json.data.contributor.displayName).toBe('Prof Alice Ochieng');
      expect(json.data.contributor.profileSlug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

      createdContributorSlug = json.data.contributor.profileSlug;
      createdContributorId = json.data.contributor.id;

      // Verify RBAC contributor role is assigned
      const roles = await rbacService.getUserRoles(userAId);
      expect(roles.some((r) => r.roleSlug === 'contributor')).toBe(true);
    });

    it('rejects reviewing an already reviewed application with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/contributor-applications/${createdAppId}/review`,
        headers: { cookie: adminCookie },
        payload: {
          action: 'APPROVE',
        },
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error.code).toBe('APPLICATION_ALREADY_REVIEWED');
    });
  });

  describe('3. Contributor Workspace & Profile Management', () => {
    it('returns 404 for standard user accessing contributor profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor',
        headers: { cookie: userCCookie },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_A_CONTRIBUTOR');
    });

    it('returns contributor private profile for approved contributor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor',
        headers: { cookie: userACookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.userId).toBe(userAId);
      expect(json.data.status).toBe('ACTIVE');
      expect(json.data.profileSlug).toBe(createdContributorSlug);
    });

    it('updates own contributor profile display name and bio', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/contributor',
        headers: { cookie: userACookie },
        payload: {
          displayName: 'Prof Alice Ochieng PhD',
          bio: 'Specialist in CBC Junior Secondary Physics and Mathematics.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.displayName).toBe('Prof Alice Ochieng PhD');
      expect(json.data.bio).toBe('Specialist in CBC Junior Secondary Physics and Mathematics.');
    });
  });

  describe('4. Contributor Submission Ingestion Pathway', () => {
    it('creates draft candidate submission in KES currency', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/contributor/submissions',
        headers: { cookie: userACookie },
        payload: {
          title: 'CBC Grade 7 Integrated Science Complete Revision Pack',
          description: 'Comprehensive term 1 notes and practice questions.',
          proposedPriceMinor: 25000, // 250 KES
          proposedCurrencyCode: 'KES',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.status).toBe('DRAFT');
      expect(json.data.title).toBe('CBC Grade 7 Integrated Science Complete Revision Pack');
      expect(json.data.proposedPriceMinor).toBe(25000);
      expect(json.data.proposedCurrencyCode).toBe('KES');
      createdSubmissionId = json.data.id;
    });

    it('lists submissions for current contributor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/submissions',
        headers: { cookie: userACookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].id).toBe(createdSubmissionId);
    });

    it('retrieves submission details by id for owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/contributor/submissions/${createdSubmissionId}`,
        headers: { cookie: userACookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(createdSubmissionId);
    });

    it('blocks cross-contributor access to another contributor submission with 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/contributor/submissions/${createdSubmissionId}`,
        headers: { cookie: userBCookie },
      });

      // User B has no access or is not a contributor -> 404 / error
      expect([403, 404]).toContain(res.statusCode);
    });

    it('updates draft candidate submission', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/me/contributor/submissions/${createdSubmissionId}`,
        headers: { cookie: userACookie },
        payload: {
          title: 'CBC Grade 7 Integrated Science Complete Revision Pack - Final Edition',
          proposedPriceMinor: 30000,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.title).toBe('CBC Grade 7 Integrated Science Complete Revision Pack - Final Edition');
      expect(json.data.proposedPriceMinor).toBe(30000);
    });

    it('submits candidate submission transitioning from DRAFT to SUBMITTED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/contributor/submissions/${createdSubmissionId}/submit`,
        headers: { cookie: userACookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.status).toBe('SUBMITTED');
    });

    it('locks submitted submission against further edits returning 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/me/contributor/submissions/${createdSubmissionId}`,
        headers: { cookie: userACookie },
        payload: {
          title: 'Attempting to edit locked submission',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('SUBMISSION_LOCKED');
    });

    it('allows admin/editorial reviewer to review and approve submission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/contributor-submissions/${createdSubmissionId}/review`,
        headers: { cookie: adminCookie },
        payload: {
          action: 'APPROVE',
          notes: 'Meets high educational quality standards.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.status).toBe('APPROVED');
    });
  });

  describe('5. Public Contributor Discovery & Resource Attribution', () => {
    let publishedResId: string;

    beforeAll(async () => {
      // Create a published resource attributed to contributor
      const [res] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: testCountryId,
            resourceTypeId: testTypeId,
            title: 'Public CBC Science Resource by Alice',
            slug: `public-cbc-science-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
            contributorId: createdContributorId,
          })
          .returning(),
      );
      publishedResId = res.id;
      cleanupResourceIds.push(publishedResId);
    });

    it('lists public contributors with published resource count', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/contributors',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.data)).toBe(true);
      const found = json.data.find((c: any) => c.profileSlug === createdContributorSlug);
      expect(found).toBeDefined();
      expect(found.publishedResourcesCount).toBeGreaterThanOrEqual(1);

      // Verify no sensitive account fields leak
      expect(found.userId).toBeUndefined();
      expect(found.email).toBeUndefined();
    });

    it('retrieves public contributor profile by slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/contributors/${createdContributorSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.profileSlug).toBe(createdContributorSlug);
      expect(json.data.displayName).toBe('Prof Alice Ochieng PhD');
      expect(json.data.publishedResourcesCount).toBeGreaterThanOrEqual(1);
    });

    it('lists public published resources attributed to contributor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/contributors/${createdContributorSlug}/resources`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].id).toBe(publishedResId);
      expect(json.data[0].contributor.profileSlug).toBe(createdContributorSlug);
    });

    it('returns 404 for unknown contributor slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/contributors/non-existent-contributor-slug-xyz',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('6. Contributor Lifecycle & Suspension Rules', () => {
    it('allows admin to suspend a contributor', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/contributors/${createdContributorId}/status`,
        headers: { cookie: adminCookie },
        payload: {
          status: 'SUSPENDED',
          reason: 'Investigation into policy compliance.',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.status).toBe('SUSPENDED');
    });

    it('hides suspended contributor from public profile discovery with 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/contributors/${createdContributorSlug}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('forbids suspended contributor from updating profile with 403', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/contributor',
        headers: { cookie: userACookie },
        payload: {
          displayName: 'Attempted Update While Suspended',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CONTRIBUTOR_SUSPENDED');
    });

    it('forbids suspended contributor from creating submissions with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/contributor/submissions',
        headers: { cookie: userACookie },
        payload: {
          title: 'Forbidden Submission While Suspended',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CONTRIBUTOR_SUSPENDED');
    });

    it('re-activates contributor when admin sets status to ACTIVE', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/contributors/${createdContributorId}/status`,
        headers: { cookie: adminCookie },
        payload: {
          status: 'ACTIVE',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('ACTIVE');
    });
  });
});
