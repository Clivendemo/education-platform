import crypto from 'node:crypto';
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
  resourceFeedback,
  resourceFeedbackEvents,
  FEEDBACK_TYPES,
} from '../../src/db/schemas.js';
import {
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../src/services/auth.service.js';
import { defaultRbacService } from '../../src/services/rbac.service.js';
import {
  FEEDBACK_SESSION_COOKIE_NAME,
  hashFeedbackSessionToken,
} from '../../src/services/feedback.service.js';

describe('Resource Feedback Route Integration Tests', () => {
  let app: FastifyInstance;
  let countryId: string;
  let resourceTypeId: string;

  // Published test resource & versions
  let testResourceId: string;
  let testVersionId: string;
  let testResource2Id: string;
  let testVersion2Id: string;

  // Draft resource & version (to test rejection)
  let draftResourceId: string;
  let draftVersionId: string;

  // Users for RBAC separation of duties
  let standardUserToken: string;
  let standardUserId: string;
  let reviewerUserToken: string;
  let reviewerUserId: string;
  let managerUserToken: string;
  let managerUserId: string;
  let adminUserToken: string;
  let adminUserId: string;

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
        email: `feedback_std_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Standard User',
      }),
    );
    standardUserToken = stdRes.sessionToken;
    standardUserId = stdRes.user.id;

    // 3. Register content reviewer & assign content_reviewer role
    const revRes = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `feedback_rev_${Date.now()}@example.com`,
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
        email: `feedback_mgr_${Date.now()}@example.com`,
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
        email: `feedback_adm_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'System Admin',
      }),
    );
    adminUserToken = admRes.sessionToken;
    adminUserId = admRes.user.id;
    await withDbRetry(async () =>
      defaultRbacService.assignRole({
        userId: adminUserId,
        roleSlug: 'system_admin',
      }),
    );

    // 6. Create published test resource and versions
    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Route Feedback Test Resource ${Date.now()}`,
          slug: `route-feedback-test-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    testResourceId = r.id;

    const [v1] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Route Feedback Test Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    testVersionId = v1.id;

    const [r2] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Route Feedback Test Resource 2 ${Date.now()}`,
          slug: `route-feedback-test-2-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    testResource2Id = r2.id;

    const [v2] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResource2Id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Route Feedback Test 2 Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    testVersion2Id = v2.id;

    // 7. Create DRAFT test resource and version
    const [rd] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Route Feedback Draft Resource ${Date.now()}`,
          slug: `route-feedback-draft-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = rd.id;

    const [vd] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: draftResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Route Feedback Draft Version 1',
          status: 'DRAFT',
        })
        .returning(),
    );
    draftVersionId = vd.id;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  const getAuthCookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

  describe('1. Public Anonymous Feedback Submission', () => {
    it('generates rf_sid cookie and records feedback with SHA-256 hashed session_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'HELPFUL',
          details: 'Very clear explanation of the topic.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.resourceId).toBe(testResourceId);
      expect(body.data.resourceVersionId).toBe(testVersionId);
      expect(body.data.feedbackType).toBe('HELPFUL');
      expect(body.data.status).toBe('PENDING');

      // Check cookie header
      const cookieHeader = res.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : (cookieHeader as string);
      expect(cookieStr).toContain(FEEDBACK_SESSION_COOKIE_NAME);
      expect(cookieStr).toContain('HttpOnly');

      // Extract cookie value
      const match = cookieStr.match(new RegExp(`${FEEDBACK_SESSION_COOKIE_NAME}=([^;]+)`));
      expect(match).toBeTruthy();
      const rawCookieToken = match![1];

      // Verify DB storage: user_id IS NULL, session_id IS hashed
      const [dbRow] = await withDbRetry(async () =>
        db.select().from(resourceFeedback).where(eq(resourceFeedback.id, body.data.id)),
      );
      expect(dbRow).toBeDefined();
      expect(dbRow.userId).toBeNull();
      expect(dbRow.sessionId).toBe(hashFeedbackSessionToken(rawCookieToken));
      expect(dbRow.sessionId).not.toBe(rawCookieToken); // Raw token is NEVER stored
    });

    it('reuses existing rf_sid cookie when supplied in request', async () => {
      const existingToken = crypto.randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${existingToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'OUTDATED',
          details: 'References the 2021 guidelines.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();

      const [dbRow] = await withDbRetry(async () =>
        db.select().from(resourceFeedback).where(eq(resourceFeedback.id, body.data.id)),
      );
      expect(dbRow.userId).toBeNull();
      expect(dbRow.sessionId).toBe(hashFeedbackSessionToken(existingToken));
    });
  });

  describe('2. Authenticated Feedback Submission', () => {
    it('records feedback with user_id populated and session_id as NULL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: getAuthCookie(standardUserToken),
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'MISSING_INFORMATION',
          details: 'Needs answers to the practice problems.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();

      const [dbRow] = await withDbRetry(async () =>
        db.select().from(resourceFeedback).where(eq(resourceFeedback.id, body.data.id)),
      );
      expect(dbRow.userId).toBe(standardUserId);
      expect(dbRow.sessionId).toBeNull();
    });
  });

  describe('3. Controlled Taxonomy Validation', () => {
    it('accepts each of the 7 canonical feedback categories', async () => {
      for (const type of FEEDBACK_TYPES) {
        // Use a unique anonymous token per category to avoid cooldown conflicts
        const uniqueAnon = crypto.randomUUID();
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/resources/${testResource2Id}/feedback`,
          headers: {
            cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${uniqueAnon}`,
          },
          payload: {
            resourceVersionId: testVersion2Id,
            feedbackType: type,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects unapproved or fabricated feedback category', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'AWESOME_CONTENT',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects feedback details exceeding 1000 characters with 400 VALIDATION_ERROR', async () => {
      const longDetails = 'A'.repeat(1001);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'HELPFUL',
          details: longDetails,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts feedback details of exactly 1000 characters with 201 Created', async () => {
      const exactDetails = 'B'.repeat(1000);
      const anonToken = crypto.randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anonToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'HELPFUL',
          details: exactDetails,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBeDefined();
    });
  });

  describe('4. Resource & Version Publication Integrity', () => {
    it('rejects feedback for non-existent resource with 404 RESOURCE_NOT_FOUND', async () => {
      const nonExistent = crypto.randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${nonExistent}/feedback`,
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'HELPFUL',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('rejects feedback for DRAFT resource with 404 RESOURCE_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${draftResourceId}/feedback`,
        payload: {
          resourceVersionId: draftVersionId,
          feedbackType: 'HELPFUL',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('rejects feedback when version does not belong to resource', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        payload: {
          resourceVersionId: draftVersionId, // Belongs to draftResourceId, not testResourceId
          feedbackType: 'HELPFUL',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('RESOURCE_VERSION_NOT_FOUND');
    });
  });

  describe('5. Abuse Prevention & 1-Hour Duplicate Cooldown', () => {
    it('blocks duplicate submission within 1 hour for same identity + version + type with 429', async () => {
      const anonToken = crypto.randomUUID();

      // First submission: should succeed
      const firstRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anonToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'FILE_PROBLEM',
          details: 'First report: audio is broken.',
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // Immediate duplicate submission: should be rate-limited (429)
      const secondRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anonToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'FILE_PROBLEM',
          details: 'Second attempt: still broken.',
        },
      });
      expect(secondRes.statusCode).toBe(429);
      expect(secondRes.json().error.code).toBe('DUPLICATE_FEEDBACK_COOLDOWN');

      // Different feedbackType for same version: should succeed
      const diffTypeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anonToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'POOR_FORMATTING',
        },
      });
      expect(diffTypeRes.statusCode).toBe(201);
    });

    it('enforces cooldown per authenticated user account', async () => {
      // First submission by standardUser
      const firstRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: getAuthCookie(standardUserToken),
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'WRONG_CLASSIFICATION',
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // Second duplicate submission
      const secondRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: getAuthCookie(standardUserToken),
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'WRONG_CLASSIFICATION',
        },
      });
      expect(secondRes.statusCode).toBe(429);
      expect(secondRes.json().error.code).toBe('DUPLICATE_FEEDBACK_COOLDOWN');
    });
  });

  describe('6. Public Feedback Summary', () => {
    it('returns aggregate counts without leaking defect details, statuses, or notes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${testResourceId}/feedback-summary`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.resourceId).toBe(testResourceId);
      expect(typeof body.data.totalFeedback).toBe('number');
      expect(typeof body.data.helpfulCount).toBe('number');
      expect(body.data.totalFeedback).toBeGreaterThan(0);
      expect(body.data.helpfulCount).toBeGreaterThan(0);
      expect(body.data.totalFeedback).toBeGreaterThanOrEqual(body.data.helpfulCount);

      // Defensively verify keys: ONLY resourceId, totalFeedback, helpfulCount
      const keys = Object.keys(body.data);
      expect(keys.sort()).toEqual(['helpfulCount', 'resourceId', 'totalFeedback'].sort());
    });

    it('returns 404 RESOURCE_NOT_FOUND for draft or non-existent resource summary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${draftResourceId}/feedback-summary`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('strictly excludes dismissed (REJECTED) feedback from public summary count', async () => {
      // 1. Submit an initial feedback item
      const anonToken = crypto.randomUUID();
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anonToken}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'HELPFUL',
          details: 'Will be dismissed to test public summary exclusion.',
        },
      });
      expect(postRes.statusCode).toBe(201);
      const feedbackId = postRes.json().data.id;

      // 2. Fetch summary before rejection
      const beforeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${testResourceId}/feedback-summary`,
      });
      expect(beforeRes.statusCode).toBe(200);
      const totalBefore = beforeRes.json().data.totalFeedback;
      const helpfulBefore = beforeRes.json().data.helpfulCount;

      // 3. Admin triages the item to REJECTED (dismissed)
      const triageRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${feedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(managerUserToken),
        },
        payload: {
          status: 'REJECTED',
          internalNote: 'Spam or non-constructive feedback.',
        },
      });
      expect(triageRes.statusCode).toBe(200);

      // 4. Fetch summary after rejection -> must exclude the rejected feedback
      const afterRes = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${testResourceId}/feedback-summary`,
      });
      expect(afterRes.statusCode).toBe(200);
      expect(afterRes.json().data.totalFeedback).toBe(totalBefore - 1);
      expect(afterRes.json().data.helpfulCount).toBe(helpfulBefore - 1);
    });
  });

  describe('7. Staff Queue & RBAC Access Control', () => {
    let createdFeedbackId: string;

    beforeAll(async () => {
      // Create a feedback item for triage tests
      const anon = crypto.randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${testResourceId}/feedback`,
        headers: {
          cookie: `${FEEDBACK_SESSION_COOKIE_NAME}=${anon}`,
        },
        payload: {
          resourceVersionId: testVersionId,
          feedbackType: 'INCORRECT',
          details: 'Formula on page 4 has wrong constant.',
        },
      });
      createdFeedbackId = res.json().data.id;
    });

    it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/feedback',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects standard_user with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/feedback',
        headers: {
          cookie: getAuthCookie(standardUserToken),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('permits content_reviewer to list and view feedback queue (read-only)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/feedback?status=PENDING',
        headers: {
          cookie: getAuthCookie(reviewerUserToken),
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toBeDefined();

      // Detailed view
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/feedback/${createdFeedbackId}`,
        headers: {
          cookie: getAuthCookie(reviewerUserToken),
        },
      });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().data.feedback.id).toBe(createdFeedbackId);
    });

    it('strictly forbids content_reviewer from triaging feedback (read-only role)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${createdFeedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(reviewerUserToken),
        },
        payload: {
          status: 'UNDER_REVIEW',
          internalNote: 'Reviewer should not be able to triage',
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('permits content_manager to triage feedback and records audit event', async () => {
      // 1. Transition PENDING -> UNDER_REVIEW
      const res1 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${createdFeedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(managerUserToken),
        },
        payload: {
          status: 'UNDER_REVIEW',
          internalNote: 'Assigning to curriculum specialist for check.',
        },
      });
      expect(res1.statusCode).toBe(200);
      const body1 = res1.json().data;
      expect(body1.feedback.status).toBe('UNDER_REVIEW');
      expect(body1.feedback.reviewedBy).toBe(managerUserId);
      expect(body1.event.fromStatus).toBe('PENDING');
      expect(body1.event.toStatus).toBe('UNDER_REVIEW');
      expect(body1.event.actorUserId).toBe(managerUserId);

      // 2. Transition UNDER_REVIEW -> ACCEPTED
      const res2 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${createdFeedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(managerUserToken),
        },
        payload: {
          status: 'ACCEPTED',
          internalNote: 'Correction confirmed, bug filed.',
        },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().data.feedback.status).toBe('ACCEPTED');

      // 3. Transition ACCEPTED -> REOPENED
      const res3 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${createdFeedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(managerUserToken),
        },
        payload: {
          status: 'REOPENED',
          internalNote: 'Reopened pending author response.',
        },
      });
      expect(res3.statusCode).toBe(200);
      expect(res3.json().data.feedback.status).toBe('REOPENED');

      // 4. Verify full audit trail via GET /admin/feedback/:id
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/feedback/${createdFeedbackId}`,
        headers: {
          cookie: getAuthCookie(adminUserToken),
        },
      });
      expect(detailRes.statusCode).toBe(200);
      const events = detailRes.json().data.events;
      expect(events.length).toBe(3);
      expect(events[0].fromStatus).toBe('PENDING');
      expect(events[0].toStatus).toBe('UNDER_REVIEW');
      expect(events[1].fromStatus).toBe('UNDER_REVIEW');
      expect(events[1].toStatus).toBe('ACCEPTED');
      expect(events[2].fromStatus).toBe('ACCEPTED');
      expect(events[2].toStatus).toBe('REOPENED');
    });

    it('rejects invalid state machine transitions with 400', async () => {
      // Current state is REOPENED. Valid transitions: UNDER_REVIEW, ACCEPTED, REJECTED.
      // Transitioning to PENDING is invalid.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/feedback/${createdFeedbackId}/triage`,
        headers: {
          cookie: getAuthCookie(managerUserToken),
        },
        payload: {
          status: 'PENDING',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_FEEDBACK_TRANSITION');
    });
  });

  describe('8. Database Constraints & Trigger Immutability Defense', () => {
    it('database constraint enforces exactly one identity (chk_feedback_exactly_one_identity)', async () => {
      // Attempt to insert with BOTH userId and sessionId
      await expect(
        withDbRetry(async () =>
          db.insert(resourceFeedback).values({
            resourceId: testResourceId,
            resourceVersionId: testVersionId,
            userId: standardUserId,
            sessionId: 'some_hash',
            feedbackType: 'HELPFUL',
            status: 'PENDING',
          }),
        ),
      ).rejects.toThrow();

      // Attempt to insert with NEITHER userId nor sessionId
      await expect(
        withDbRetry(async () =>
          db.insert(resourceFeedback).values({
            resourceId: testResourceId,
            resourceVersionId: testVersionId,
            userId: null,
            sessionId: null,
            feedbackType: 'HELPFUL',
            status: 'PENDING',
          }),
        ),
      ).rejects.toThrow();
    });

    it('database trigger rejects feedback version belonging to another resource', async () => {
      let caughtErr: any;
      try {
        await withDbRetry(async () =>
          db.insert(resourceFeedback).values({
            resourceId: testResourceId,
            resourceVersionId: draftVersionId, // Version belongs to draftResourceId
            sessionId: 'valid_hash_123',
            feedbackType: 'HELPFUL',
            status: 'PENDING',
          }),
        );
      } catch (err: any) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
      expect(combined).toMatch(/does not belong to resource_id/);
    });

    it('database trigger prevents mutation or deletion of feedback events audit records', async () => {
      // Find an existing event
      const [event] = await withDbRetry(async () =>
        db.select().from(resourceFeedbackEvents).limit(1),
      );
      expect(event).toBeDefined();

      // Attempt UPDATE on event -> trigger MUST reject
      let updateErr: any;
      try {
        await withDbRetry(async () =>
          db
            .update(resourceFeedbackEvents)
            .set({ internalNote: 'Tampered note' })
            .where(eq(resourceFeedbackEvents.id, event.id)),
        );
      } catch (err: any) {
        updateErr = err;
      }
      expect(updateErr).toBeDefined();
      const updateCombined = `${updateErr?.message || ''} ${updateErr?.cause?.message || ''}`;
      expect(updateCombined).toMatch(/prohibited/i);

      // Attempt DELETE on event -> trigger MUST reject
      let deleteErr: any;
      try {
        await withDbRetry(async () =>
          db
            .delete(resourceFeedbackEvents)
            .where(eq(resourceFeedbackEvents.id, event.id)),
        );
      } catch (err: any) {
        deleteErr = err;
      }
      expect(deleteErr).toBeDefined();
      const deleteCombined = `${deleteErr?.message || ''} ${deleteErr?.cause?.message || ''}`;
      expect(deleteCombined).toMatch(/prohibited/i);
    });
  });
});
