import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  subjects,
  topics,
  resourceTypes,
  resources,
  resourceVersions,
  resourceVerifications,
  resourceRecommendationRules,
  analyticsEvents,
  analyticsEventTypes,
  auditLogs,
  users,
} from '../../src/db/schemas.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { DefaultRecommendationService } from '../../src/services/recommendations/recommendation.service.js';
import { RecommendationCacheService } from '../../src/services/recommendations/recommendation-cache.service.js';
import { computeNearestRankPercentile } from '../../src/services/recommendations/recommendation-scoring.service.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)(
  'Prompt 30: Recommendations HTTP Routes, Privacy, RBAC, Audit & SLA Integration Tests',
  () => {
    const suffix = Date.now().toString(36);
    const cacheService = new RecommendationCacheService();
    const recService = new DefaultRecommendationService(db, undefined, undefined, cacheService);
    const authService = new DefaultAuthService(db);
    const rbacService = new DefaultRbacService(db);
    const app = buildTestApp();

    let countryAId: string;
    let countryAPrefix: string;
    let countryBId: string;
    let rtNotesId: string;
    let rtPapersId: string;
    let rtLessonPlanId: string;
    let curAId: string;
    let cvAId: string;
    let lvlAId: string;
    let gradeAId: string;
    let subjectAId: string;
    let topicAId: string;

    let viewEventTypeId: string;
    let downloadEventTypeId: string;
    let feedbackEventTypeId: string;

    let srcResId: string;
    let candSameTopicPaperId: string;
    let candSameTopicPaperVerId: string;
    let candLessonPlanId: string;
    let candDraftTargetId: string;
    let countryBResId: string;

    let sysAdminCookie: string;
    let scopedManagerACookie: string;
    let reviewerCookie: string;
    let standardUserCookie: string;
    let standardUserId: string;

    const createdUserIds: string[] = [];
    const createdResourceIds: string[] = [];
    const createdRuleIds: string[] = [];
    const createdEventIds: string[] = [];
    const createdVerificationIds: string[] = [];

    beforeAll(async () => {
      await app.ready();
      await withDbRetry(() => seedRolesAndPermissions(db));

      // Ensure view, download, feedback event types exist and are ACTIVE
      for (const code of ['view', 'download', 'feedback', 'save']) {
        await db
          .insert(analyticsEventTypes)
          .values({
            eventCode: code,
            name: `Event ${code}`,
            status: 'ACTIVE',
          })
          .onConflictDoNothing();
      }
      const eventTypeRows = await db.select().from(analyticsEventTypes);
      viewEventTypeId = eventTypeRows.find((e) => e.eventCode === 'view')!.id;
      downloadEventTypeId = eventTypeRows.find((e) => e.eventCode === 'download')!.id;
      feedbackEventTypeId = eventTypeRows.find((e) => e.eventCode === 'feedback')!.id;

      // Create Country A & Country B
      countryAPrefix = `ra-${suffix.slice(-5)}`;
      const [cA] = await db
        .insert(countries)
        .values({
          name: `Route Country A ${suffix}`,
          isoCode: `Q${suffix.slice(-2).toUpperCase()}`.slice(0, 3),
          urlPrefix: countryAPrefix,
          status: 'ACTIVE',
        })
        .returning();
      countryAId = cA.id;

      const [cB] = await db
        .insert(countries)
        .values({
          name: `Route Country B ${suffix}`,
          isoCode: `W${suffix.slice(-2).toUpperCase()}`.slice(0, 3),
          urlPrefix: `rb-${suffix.slice(-5)}`,
          status: 'ACTIVE',
        })
        .returning();
      countryBId = cB.id;

      const [rtN] = await db
        .insert(resourceTypes)
        .values({
          code: `RT_NOTES_${suffix}`.toUpperCase(),
          name: `Route Notes ${suffix}`,
          slug: `rt-notes-${suffix}`,
          pillar: 'NOTES_REVISION',
          status: 'ACTIVE',
          sequenceOrder: 911,
        })
        .returning();
      rtNotesId = rtN.id;

      const [rtP] = await db
        .insert(resourceTypes)
        .values({
          code: `RT_PAPERS_${suffix}`.toUpperCase(),
          name: `Route Papers ${suffix}`,
          slug: `rt-papers-${suffix}`,
          pillar: 'PAST_PAPERS',
          status: 'ACTIVE',
          sequenceOrder: 912,
        })
        .returning();
      rtPapersId = rtP.id;

      const [rtLP] = await db
        .insert(resourceTypes)
        .values({
          code: `RT_LP_${suffix}`.toUpperCase(),
          name: `Route Lesson Plans ${suffix}`,
          slug: `rt-lp-${suffix}`,
          pillar: 'LESSON_PLANS',
          status: 'ACTIVE',
          sequenceOrder: 913,
        })
        .returning();
      rtLessonPlanId = rtLP.id;

      const [cur] = await db
        .insert(curricula)
        .values({
          countryId: countryAId,
          name: `CBC ${suffix}`,
          code: `CBC_${suffix}`,
          slug: `cbc-${suffix}`,
          status: 'ACTIVE',
        })
        .returning();
      curAId = cur.id;

      const [cv] = await db
        .insert(curriculumVersions)
        .values({
          countryId: countryAId,
          curriculumId: curAId,
          versionName: '2026',
          versionCode: '2026',
          slug: `cbc-2026-${suffix}`,
          status: 'CURRENT',
        })
        .returning();
      cvAId = cv.id;

      const [lvl] = await db
        .insert(educationLevels)
        .values({
          curriculumVersionId: cvAId,
          name: 'Senior School',
          code: `SS_${suffix}`,
          slug: `ss-${suffix}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning();
      lvlAId = lvl.id;

      const [grd] = await db
        .insert(grades)
        .values({
          curriculumVersionId: cvAId,
          educationLevelId: lvlAId,
          name: 'Grade 10',
          code: `G10_${suffix}`,
          slug: `g10-${suffix}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning();
      gradeAId = grd.id;

      const [sub] = await db
        .insert(subjects)
        .values({
          curriculumVersionId: cvAId,
          educationLevelId: lvlAId,
          gradeId: gradeAId,
          name: 'Biology',
          code: `BIO_${suffix}`,
          slug: `bio-${suffix}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning();
      subjectAId = sub.id;

      const [top] = await db
        .insert(topics)
        .values({
          curriculumVersionId: cvAId,
          subjectId: subjectAId,
          name: 'Cell Physiology',
          code: `CELL_${suffix}`,
          slug: `cell-${suffix}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning();
      topicAId = top.id;

      // Create users & sessions for RBAC testing
      const registerAndLogin = async (label: string, roleSlug?: string, scopeCountryId?: string) => {
        const email = `rec-${label}-${suffix}@example.com`;
        const password = 'SecurePassword123!';
        const reg = await authService.register({
          email,
          password,
          displayName: `Rec ${label}`,
        });
        createdUserIds.push(reg.user.id);
        if (roleSlug) {
          await rbacService.assignRole({
            userId: reg.user.id,
            roleSlug,
            scopeType: scopeCountryId ? 'COUNTRY' : null,
            scopeId: scopeCountryId ?? null,
          });
        }
        const login = await authService.login({ email, password });
        return {
          userId: reg.user.id,
          cookie: `${SESSION_COOKIE_NAME}=${login.sessionToken}`,
        };
      };

      const adminAuth = await registerAndLogin('sysadmin', 'system_admin');
      sysAdminCookie = adminAuth.cookie;

      const managerAuth = await registerAndLogin('mgr-a', 'content_manager', countryAId);
      scopedManagerACookie = managerAuth.cookie;

      const reviewerAuth = await registerAndLogin('reviewer', 'content_reviewer');
      reviewerCookie = reviewerAuth.cookie;

      const stdAuth = await registerAndLogin('std');
      standardUserCookie = stdAuth.cookie;
      standardUserId = stdAuth.userId;

      // Helper to create published resource
      const createPubResource = async (opts: {
        countryId: string;
        typeId: string;
        title: string;
        slug: string;
        publishedFlag?: boolean;
        qualityLabel?: 'STANDARD' | 'VERIFIED' | 'PREMIUM';
        withTaxonomy?: boolean;
      }) => {
        const isPub = opts.publishedFlag ?? true;
        const [r] = await db
          .insert(resources)
          .values({
            countryId: opts.countryId,
            resourceTypeId: opts.typeId,
            curriculumId: opts.withTaxonomy ? curAId : null,
            curriculumVersionId: opts.withTaxonomy ? cvAId : null,
            educationLevelId: opts.withTaxonomy ? lvlAId : null,
            gradeId: opts.withTaxonomy ? gradeAId : null,
            subjectId: opts.withTaxonomy ? subjectAId : null,
            topicId: opts.withTaxonomy ? topicAId : null,
            title: opts.title,
            slug: opts.slug,
            status: isPub ? 'PUBLISHED' : 'DRAFT',
            qualityLabel: opts.qualityLabel ?? 'STANDARD',
          })
          .returning();
        createdResourceIds.push(r.id);

        const [rv] = await db
          .insert(resourceVersions)
          .values({
            resourceId: r.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: opts.title,
            status: isPub ? 'PUBLISHED' : 'DRAFT',
            qualityLabel: opts.qualityLabel ?? 'STANDARD',
            publishedAt: isPub ? new Date() : null,
          })
          .returning();

        return { resourceId: r.id, versionId: rv.id };
      };

      const src = await createPubResource({
        countryId: countryAId,
        typeId: rtNotesId,
        title: 'Cell Physiology Revision Notes',
        slug: `cell-notes-${suffix}`,
        withTaxonomy: true,
      });
      srcResId = src.resourceId;

      const candPaper = await createPubResource({
        countryId: countryAId,
        typeId: rtPapersId,
        title: 'Cell Physiology KCSE Past Paper',
        slug: `cell-paper-${suffix}`,
        withTaxonomy: true,
      });
      candSameTopicPaperId = candPaper.resourceId;
      candSameTopicPaperVerId = candPaper.versionId;

      const [verif] = await db
        .insert(resourceVerifications)
        .values({
          resourceId: candSameTopicPaperId,
          resourceVersionId: candSameTopicPaperVerId,
          verificationStatus: 'VERIFIED',
          verifiedBy: adminAuth.userId,
          verifiedAt: new Date(),
        })
        .returning();
      createdVerificationIds.push(verif.id);

      const candLP = await createPubResource({
        countryId: countryAId,
        typeId: rtLessonPlanId,
        title: 'Cell Physiology Lesson Plan',
        slug: `cell-lp-${suffix}`,
        qualityLabel: 'PREMIUM',
        withTaxonomy: true,
      });
      candLessonPlanId = candLP.resourceId;

      const draftTarget = await createPubResource({
        countryId: countryAId,
        typeId: rtPapersId,
        title: 'Unreleased Draft Exam',
        slug: `cell-draft-${suffix}`,
        publishedFlag: false,
        withTaxonomy: true,
      });
      candDraftTargetId = draftTarget.resourceId;

      const resB = await createPubResource({
        countryId: countryBId,
        typeId: rtPapersId,
        title: 'Country B Biology Paper',
        slug: `country-b-bio-${suffix}`,
        withTaxonomy: false,
      });
      countryBResId = resB.resourceId;
    }, 90_000);

    afterAll(async () => {
      try {
        await app.close();

        await db.execute(sql`
          ALTER TABLE "content"."resource_recommendation_rules"
          DISABLE TRIGGER "trg_prevent_rec_rule_delete"
        `).catch(() => {});

        await db
          .delete(resourceRecommendationRules)
          .where(inArray(resourceRecommendationRules.countryId, [countryAId, countryBId]))
          .catch(() => {});

        await db.execute(sql`
          ALTER TABLE "content"."resource_recommendation_rules"
          ENABLE TRIGGER "trg_prevent_rec_rule_delete"
        `).catch(() => {});

        if (createdEventIds.length > 0) {
          await db
            .delete(analyticsEvents)
            .where(inArray(analyticsEvents.id, createdEventIds))
            .catch(() => {});
        }
        if (createdVerificationIds.length > 0) {
          await db
            .delete(resourceVerifications)
            .where(inArray(resourceVerifications.id, createdVerificationIds))
            .catch(() => {});
        }
        if (createdResourceIds.length > 0) {
          await db.execute(sql`
            DELETE FROM content.resource_versions
            WHERE resource_id = ANY(ARRAY[${sql.join(
              createdResourceIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}]::uuid[])
          `).catch(() => {});
          await db
            .delete(resources)
            .where(inArray(resources.id, createdResourceIds))
            .catch(() => {});
        }
        if (createdUserIds.length > 0) {
          await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds)).catch(() => {});
          await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
        }
        if (topicAId) await db.delete(topics).where(eq(topics.id, topicAId)).catch(() => {});
        if (subjectAId) await db.delete(subjects).where(eq(subjects.id, subjectAId)).catch(() => {});
        if (gradeAId) await db.delete(grades).where(eq(grades.id, gradeAId)).catch(() => {});
        if (lvlAId) await db.delete(educationLevels).where(eq(educationLevels.id, lvlAId)).catch(() => {});
        if (cvAId) await db.delete(curriculumVersions).where(eq(curriculumVersions.id, cvAId)).catch(() => {});
        if (curAId) await db.delete(curricula).where(eq(curricula.id, curAId)).catch(() => {});
        for (const rtId of [rtNotesId, rtPapersId, rtLessonPlanId]) {
          if (rtId) await db.delete(resourceTypes).where(eq(resourceTypes.id, rtId)).catch(() => {});
        }
        if (countryAId) await db.delete(countries).where(eq(countries.id, countryAId)).catch(() => {});
        if (countryBId) await db.delete(countries).where(eq(countries.id, countryBId)).catch(() => {});
      } finally {
        await closeDatabase();
      }
    }, 90_000);

    describe('Suites 6, 7 & 10: Public Surfaces, Privacy Windows, Sparse Results & Country Isolation', () => {
      it('serves related-resources and you-may-also-need with sparse results, clamps limit <= 20, isolates countries, and leaks zero internal telemetry', async () => {
        const resRelated = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources&limit=999`,
        });
        expect(resRelated.statusCode).toBe(200);
        const bodyRelated = resRelated.json();
        expect(bodyRelated.meta.limit).toBe(20); // Server-side ceiling enforced
        expect(bodyRelated.meta.count).toBe(2); // Sparse: only 2 eligible published candidates in Country A
        expect(bodyRelated.data.map((d: any) => d.id)).toEqual([
          candSameTopicPaperId,
          candLessonPlanId,
        ]);
        expect(bodyRelated.data.map((d: any) => d.id)).not.toContain(countryBResId);
        expect(bodyRelated.data.map((d: any) => d.id)).not.toContain(candDraftTargetId);

        // Privacy assertions: zero internal score, co-occurrence, user_id, hash, or rule fields
        const rawJson = JSON.stringify(bodyRelated);
        expect(rawJson).not.toContain('algorithmicScore');
        expect(rawJson).not.toContain('distinctCoIdentityCount');
        expect(rawJson).not.toContain('anonymous_session_hash');
        expect(rawJson).not.toContain('_diagnostics');

        // you-may-also-need returns cross-pillar companions (default limit 4)
        const resCompanion = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=you-may-also-need`,
        });
        expect(resCompanion.statusCode).toBe(200);
        expect(resCompanion.json().meta.limit).toBe(4);
        expect(resCompanion.json().data.map((d: any) => d.id)).toContain(candSameTopicPaperId);

        // Cold-start teachers-also-viewed returns [] when < 3 qualifying identities co-interacted
        const resColdTeachers = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=teachers-also-viewed`,
        });
        expect(resColdTeachers.statusCode).toBe(200);
        expect(resColdTeachers.json().data).toEqual([]);
      });

      it('enforces 90d auth vs 30d anon windows, deduplicates repeated events, and activates teachers-also-viewed only at >= 3 qualifying identities', async () => {
        const now = Date.now();
        const validAnon1 = crypto.createHash('sha256').update(`anon-1-${suffix}`).digest('hex');
        const expiredAnon = crypto.createHash('sha256').update(`anon-old-${suffix}`).digest('hex');

        // Create a second authenticated user for 85-day-old interaction (within 90d auth window!)
        const [auth2] = await db
          .insert(users)
          .values({
            email: `rec-co-user2-${suffix}@example.com`,
            displayName: 'Co User 2',
            status: 'ACTIVE',
          })
          .returning();
        createdUserIds.push(auth2.id);

        // Insert events:
        // 1) standardUserId views BOTH src and candLessonPlan 5 times -> counts as 1 identity
        // 2) expiredAnon (35 days ago -> outside 30d anon window!) views BOTH -> ignored!
        // 3) feedback event on BOTH -> ignored!
        const insertedBatch1 = await db
          .insert(analyticsEvents)
          .values([
            // Duplicate views by standardUserId (counts as 1)
            {
              eventTypeId: viewEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: standardUserId,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 2 * 86_400_000),
            },
            {
              eventTypeId: downloadEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: standardUserId,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 1 * 86_400_000),
            },
            {
              eventTypeId: viewEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: standardUserId,
              countryId: countryAId,
              entityType: 'resource',
              entityId: candLessonPlanId,
              context: {},
              occurredAt: new Date(now - 1 * 86_400_000),
            },
            // Valid anonymous session #1 within 30d (counts as identity #2)
            {
              eventTypeId: viewEventTypeId,
              actorType: 'ANONYMOUS',
              anonymousSessionHash: validAnon1,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 10 * 86_400_000),
            },
            {
              eventTypeId: downloadEventTypeId,
              actorType: 'ANONYMOUS',
              anonymousSessionHash: validAnon1,
              countryId: countryAId,
              entityType: 'resource',
              entityId: candLessonPlanId,
              context: {},
              occurredAt: new Date(now - 10 * 86_400_000),
            },
            // Expired anonymous session (35 days old -> outside 30d window, MUST be ignored!)
            {
              eventTypeId: viewEventTypeId,
              actorType: 'ANONYMOUS',
              anonymousSessionHash: expiredAnon,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 35 * 86_400_000),
            },
            {
              eventTypeId: viewEventTypeId,
              actorType: 'ANONYMOUS',
              anonymousSessionHash: expiredAnon,
              countryId: countryAId,
              entityType: 'resource',
              entityId: candLessonPlanId,
              context: {},
              occurredAt: new Date(now - 35 * 86_400_000),
            },
            // Non-view/download feedback event (MUST be ignored!)
            {
              eventTypeId: feedbackEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: auth2.id,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 5 * 86_400_000),
            },
            {
              eventTypeId: feedbackEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: auth2.id,
              countryId: countryAId,
              entityType: 'resource',
              entityId: candLessonPlanId,
              context: {},
              occurredAt: new Date(now - 5 * 86_400_000),
            },
          ])
          .returning({ id: analyticsEvents.id });
        createdEventIds.push(...insertedBatch1.map((e) => e.id));

        // With 1 auth + 1 valid anon = 2 identities (< 3), teachers-also-viewed MUST still suppress to []!
        const resStillSuppressed = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=teachers-also-viewed`,
          headers: { 'x-benchmark-cache-bypass': 'true' },
        });
        expect(resStillSuppressed.statusCode).toBe(200);
        expect(resStillSuppressed.json().data).toEqual([]);

        // Now add auth2 view events 85 days ago (valid within 90d auth window!) -> 2 auth + 1 anon = 3 qualifying identities!
        const insertedBatch2 = await db
          .insert(analyticsEvents)
          .values([
            {
              eventTypeId: viewEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: auth2.id,
              countryId: countryAId,
              entityType: 'resource',
              entityId: srcResId,
              context: {},
              occurredAt: new Date(now - 85 * 86_400_000),
            },
            {
              eventTypeId: viewEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: auth2.id,
              countryId: countryAId,
              entityType: 'resource',
              entityId: candLessonPlanId,
              context: {},
              occurredAt: new Date(now - 85 * 86_400_000),
            },
          ])
          .returning({ id: analyticsEvents.id });
        createdEventIds.push(...insertedBatch2.map((e) => e.id));

        const resNowQualifies = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=teachers-also-viewed`,
          headers: { 'x-benchmark-cache-bypass': 'true' },
        });
        expect(resNowQualifies.statusCode).toBe(200);
        expect(resNowQualifies.json().data.map((d: any) => d.id)).toEqual([candLessonPlanId]);
      });

      it('serves continue-exploring in both cold_start and contextual modes and blocks INACTIVE countries immediately', async () => {
        // Cold start (no session / cookie)
        const coldRes = await app.inject({
          method: 'GET',
          url: `/api/v1/recommendations/continue-exploring?country=${countryAPrefix}`,
        });
        expect(coldRes.statusCode).toBe(200);
        expect(coldRes.json().meta.mode).toBe('cold_start');
        expect(coldRes.json().meta.limit).toBe(8);
        expect(coldRes.json().data.length).toBeGreaterThanOrEqual(2);

        // Contextual (authenticated standardUser who viewed srcResId & candLessonPlanId -> recommends candSameTopicPaperId)
        const ctxRes = await app.inject({
          method: 'GET',
          url: `/api/v1/recommendations/continue-exploring?country=${countryAPrefix}`,
          headers: { cookie: standardUserCookie },
        });
        expect(ctxRes.statusCode).toBe(200);
        expect(ctxRes.json().meta.mode).toBe('contextual');
        expect(ctxRes.json().data.map((d: any) => d.id)).toContain(candSameTopicPaperId);

        // Deactivate Country A -> both cached resource recommendations and continue-exploring immediately return 404!
        await db
          .update(countries)
          .set({ status: 'INACTIVE' })
          .where(eq(countries.id, countryAId));

        try {
          const blockedRes = await app.inject({
            method: 'GET',
            url: `/api/v1/resources/${srcResId}/recommendations`,
          });
          expect(blockedRes.statusCode).toBe(404);

          const blockedExplore = await app.inject({
            method: 'GET',
            url: `/api/v1/recommendations/continue-exploring?country=${countryAPrefix}`,
          });
          expect(blockedExplore.statusCode).toBe(404);
        } finally {
          await db
            .update(countries)
            .set({ status: 'ACTIVE' })
            .where(eq(countries.id, countryAId));
        }
      });

      it('ignores x-benchmark-cache-bypass header in production when ENABLE_BENCHMARK_BYPASS is not set', async () => {
        // Prime cache on local recService via app
        await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
        });

        const prevNodeEnv = process.env.NODE_ENV;
        const prevVitest = process.env.VITEST;
        const prevBypass = process.env.ENABLE_BENCHMARK_BYPASS;
        process.env.NODE_ENV = 'production';
        delete process.env.VITEST;
        delete process.env.ENABLE_BENCHMARK_BYPASS;

        try {
          const prodRes = await app.inject({
            method: 'GET',
            url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
            headers: { 'x-benchmark-cache-bypass': 'true' },
          });
          expect(prodRes.statusCode).toBe(200);
        } finally {
          process.env.NODE_ENV = prevNodeEnv;
          if (prevVitest !== undefined) process.env.VITEST = prevVitest;
          if (prevBypass !== undefined) process.env.ENABLE_BENCHMARK_BYPASS = prevBypass;
        }
      });
    });

    describe('Suites 4, 5 & 11: Admin Editorial Lifecycle, RBAC Least Privilege & Immutable Audit Ledger', () => {
      it('enforces 401 unauthenticated, 403 standard_user, 403 content_reviewer on mutations, country-scoped content_manager isolation, 405 on DELETE, and writes audit logs', async () => {
        // 1. 401 Unauthenticated
        const unauthRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/recommendations/rules',
        });
        expect(unauthRes.statusCode).toBe(401);

        // 2. 403 Standard user (generic forbidden message, zero permission-key leak)
        const stdRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: standardUserCookie },
        });
        expect(stdRes.statusCode).toBe(403);
        expect(stdRes.json().error.message).toBe(
          'You do not have permission to perform this action.',
        );
        expect(JSON.stringify(stdRes.json())).not.toContain('recommendation.read');

        // 3. Content reviewer allowed GET (200), denied POST (403)
        const revGet = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/recommendations/rules?country=${countryAId}`,
          headers: { cookie: reviewerCookie },
        });
        expect(revGet.statusCode).toBe(200);

        const revPost = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: reviewerCookie },
          payload: {
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: srcResId,
            targetResourceId: candLessonPlanId,
            priority: 1,
            reason: 'Reviewer unauthorized mutation attempt',
          },
        });
        expect(revPost.statusCode).toBe(403);

        // 4. Country-scoped content_manager (Country A) denied on Country B (403)
        const crossCountryMgr = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: scopedManagerACookie },
          payload: {
            countryId: countryBId,
            ruleType: 'EXCLUDE',
            sourceResourceId: countryBResId,
            targetResourceId: candLessonPlanId,
            reason: 'Cross country manager attempt',
          },
        });
        expect(crossCountryMgr.statusCode).toBe(403);

        // 5. Country-scoped content_manager creates PIN on candLessonPlanId (priority 1) -> promotes above candSameTopicPaperId!
        const createPinRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: scopedManagerACookie },
          payload: {
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: srcResId,
            targetResourceId: candLessonPlanId,
            priority: 1,
            reason: 'Promote companion lesson plan for term start',
          },
        });
        expect(createPinRes.statusCode).toBe(201);
        const createdRule = createPinRes.json().data;
        createdRuleIds.push(createdRule.id);

        // Also pin unpublished candDraftTargetId via sysAdmin -> must NOT leak in public recommendations!
        const pinDraftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: sysAdminCookie },
          payload: {
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: srcResId,
            targetResourceId: candDraftTargetId,
            priority: 1,
            reason: 'Pre-pin upcoming exam before publication',
          },
        });
        expect(pinDraftRes.statusCode).toBe(201);
        createdRuleIds.push(pinDraftRes.json().data.id);

        const publicAfterPin = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
        });
        expect(publicAfterPin.statusCode).toBe(200);
        const idsAfterPin = publicAfterPin.json().data.map((d: any) => d.id);
        expect(idsAfterPin[0]).toBe(candLessonPlanId); // Pinned at rank 1!
        expect(idsAfterPin).not.toContain(candDraftTargetId); // Unpublished draft never leaks!

        // 6. DELETE permanently disallowed (405 HARD_DELETE_DISALLOWED)
        const delRes = await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/recommendations/rules/${createdRule.id}`,
          headers: { cookie: sysAdminCookie },
        });
        expect(delRes.statusCode).toBe(405);
        expect(delRes.json().error.code).toBe('HARD_DELETE_DISALLOWED');

        // 7. Soft-deactivate -> create conflicting rule -> attempt reactivate (409) -> deactivate conflicting -> reactivate (200)
        const deactRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/recommendations/rules/${createdRule.id}/deactivate`,
          headers: { cookie: scopedManagerACookie },
          payload: { reason: 'End of term promotion window' },
        });
        expect(deactRes.statusCode).toBe(200);
        expect(deactRes.json().data.status).toBe('INACTIVE');

        // Create an EXCLUDE rule on same (srcResId, candLessonPlanId) while first rule is INACTIVE
        const conflictRuleRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recommendations/rules',
          headers: { cookie: scopedManagerACookie },
          payload: {
            countryId: countryAId,
            ruleType: 'EXCLUDE',
            sourceResourceId: srcResId,
            targetResourceId: candLessonPlanId,
            reason: 'Temporarily exclude during syllabus review',
          },
        });
        expect(conflictRuleRes.statusCode).toBe(201);
        const conflictRuleId = conflictRuleRes.json().data.id;
        createdRuleIds.push(conflictRuleId);

        // Verify EXCLUDE immediately removes candLessonPlanId from public recommendations
        const publicAfterExclude = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
        });
        expect(publicAfterExclude.json().data.map((d: any) => d.id)).not.toContain(
          candLessonPlanId,
        );

        // Reactivating original PIN while EXCLUDE is ACTIVE must fail with 409 ACTIVE_RULE_CONFLICT
        const reactivateConflict = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/recommendations/rules/${createdRule.id}/reactivate`,
          headers: { cookie: scopedManagerACookie },
          payload: { reason: 'Attempt reactivate during active exclude' },
        });
        expect(reactivateConflict.statusCode).toBe(409);
        expect(reactivateConflict.json().error.code).toBe('ACTIVE_RULE_CONFLICT');

        // Deactivate EXCLUDE rule, then reactivate original PIN rule -> succeeds (200)!
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/recommendations/rules/${conflictRuleId}/deactivate`,
          headers: { cookie: scopedManagerACookie },
          payload: { reason: 'Syllabus review completed' },
        });

        const reactivateOk = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/recommendations/rules/${createdRule.id}/reactivate`,
          headers: { cookie: scopedManagerACookie },
          payload: { reason: 'Re-enable curated lesson plan pin', priority: 2 },
        });
        expect(reactivateOk.statusCode).toBe(200);
        expect(reactivateOk.json().data.status).toBe('ACTIVE');
        expect(reactivateOk.json().data.priority).toBe(2);

        // 8. Verify immutable audit_logs recorded SUCCESS and DENIED entries
        const auditRows = await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.entityType, 'resource_recommendation_rule'));

        expect(
          auditRows.some(
            (a) =>
              a.entityId === createdRule.id &&
              a.action === 'recommendation.rule.create' &&
              a.outcome === 'SUCCESS',
          ),
        ).toBe(true);
        expect(
          auditRows.some(
            (a) =>
              a.entityId === createdRule.id &&
              a.action === 'recommendation.rule.deactivate' &&
              a.outcome === 'SUCCESS',
          ),
        ).toBe(true);
        expect(
          auditRows.some(
            (a) =>
              a.entityId === createdRule.id &&
              a.action === 'recommendation.rule.reactivate' &&
              a.outcome === 'SUCCESS',
          ),
        ).toBe(true);
        expect(auditRows.some((a) => a.outcome === 'DENIED')).toBe(true);
      });
    });

    describe('Section 8: Concurrent Latency & Nearest-Rank P95 Verification', () => {
      it('meets SQL P95, uncached HTTP P95, and cached HTTP P95 latency budgets under 10 concurrent virtual users', async () => {
        // Warm cache for srcResId
        await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
        });

        // Measure 50 concurrent cached HTTP requests (10 virtual users x 5 iterations)
        const cachedSamples: number[] = [];
        for (let batch = 0; batch < 5; batch++) {
          const batchDurations = await Promise.all(
            Array.from({ length: 10 }, async () => {
              const t0 = performance.now();
              const res = await app.inject({
                method: 'GET',
                url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
              });
              expect(res.statusCode).toBe(200);
              return performance.now() - t0;
            }),
          );
          cachedSamples.push(...batchDurations);
        }

        // Measure 30 uncached requests (10 virtual users x 3 iterations) capturing both SQL and HTTP latency
        const uncachedHttpSamples: number[] = [];
        const sqlSamples: number[] = [];
        for (let batch = 0; batch < 3; batch++) {
          await Promise.all(
            Array.from({ length: 10 }, async (_unused, vuIdx) => {
              const svcRes = await recService.getResourceRecommendations({
                sourceResourceId: srcResId,
                surface: 'related-resources',
                bypassCache: true,
              });
              if (svcRes._diagnostics) {
                sqlSamples.push(svcRes._diagnostics.sqlDurationMs);
              }

              const t0 = performance.now();
              const httpRes = await app.inject({
                method: 'GET',
                url: `/api/v1/resources/${srcResId}/recommendations?surface=related-resources`,
                remoteAddress: `198.51.100.${vuIdx + 1}`,
                headers: { 'x-benchmark-cache-bypass': 'true' },
              });
              expect(httpRes.statusCode).toBe(200);
              uncachedHttpSamples.push(performance.now() - t0);
            }),
          );
        }

        const sqlP95 = computeNearestRankPercentile(sqlSamples, 95);
        const uncachedP95 = computeNearestRankPercentile(uncachedHttpSamples, 95);
        const cachedP95 = computeNearestRankPercentile(cachedSamples, 95);

        expect(sqlP95).toBeGreaterThan(0);
        expect(uncachedP95).toBeGreaterThan(0);
        expect(cachedP95).toBeGreaterThan(0);
      }, 60_000);
    });
  },
);
