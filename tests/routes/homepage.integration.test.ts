import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  auditLogs,
  calendarEvents,
  calendarEventTypes,
  calendars,
  countries,
  curricula,
  curriculumVersions,
  educationLevels,
  educationUpdateCategories,
  educationUpdates,
  grades,
  pathways,
  resourceFiles,
  resources,
  resourceTypes,
  resourceVersions,
  schools,
  subjects,
} from '../../src/db/schemas.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import {
  DefaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { DefaultAuditService } from '../../src/services/audit.service.js';
import { defaultGeographyService } from '../../src/services/geography.service.js';
import { HomepageCacheService } from '../../src/services/homepage-cache.js';
import { DefaultHomepageService } from '../../src/services/homepage.service.js';
import { DefaultHomepageAdminService } from '../../src/services/homepage-admin.service.js';
import { buildApp } from '../../src/app.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(
  process.env.DATABASE_TEST_URL || process.env.DATABASE_URL,
);

describe.skipIf(!isDbAvailable)(
  'Prompt 32: Homepage Intelligence Public & Admin HTTP Routes Integration Suite (P1–P2 + A1–A9)',
  () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

    const authService = new DefaultAuthService(db);
    const rbacService = new DefaultRbacService(db);
    const auditService = new DefaultAuditService(db);
    const cacheService = new HomepageCacheService();
    const homepageService = new DefaultHomepageService(
      db,
      defaultGeographyService,
      cacheService,
      auditService,
    );
    const homepageAdminService = new DefaultHomepageAdminService(
      db,
      homepageService,
      cacheService,
      auditService,
    );

    const app = buildApp({
      logger: false,
      services: {
        authService,
        rbacService,
        auditService,
        geographyService: defaultGeographyService,
        homepageService,
        homepageAdminService,
      },
    });

    const createdCountryIds: string[] = [];

    let countryAId: string;
    let countryAIso: string;
    let countryAPrefix: string;

    let countryBId: string;
    let countryBIso: string;

    // Actors
    let sysAdminCookie: string;
    let countryAManagerCookie: string;
    let countryAManagerId: string;
    let countryAReviewerCookie: string;
    let schoolOnlyManagerCookie: string;
    let standardUserCookie: string;

    // Seeded Country A & B entities
    let countryAResource1Id: string;
    let countryAResource2Id: string;
    let countryAResourceArchivableId: string;
    let countryASubjectId: string;
    let countryAUpdateId: string;
    let countryACalendarEventId: string;
    let countryBCfgId: string;

    const SECRET_STORAGE_KEY_MARKER = `secret-storage-key-do-not-leak-${suffix}`;
    let fileIdx = 1;

    beforeAll(async () => {
      await withDbRetry(() => seedRolesAndPermissions(db));

      const existingCountries = await withDbRetry(() =>
        db.select().from(countries),
      );
      const usedIso = new Set(existingCountries.map((c) => c.isoCode));
      const pickIso = (prefixChar: string): string => {
        for (let i = 0; i < 26; i++) {
          for (let j = 0; j < 26; j++) {
            const code = `${prefixChar}${String.fromCharCode(65 + i)}${String.fromCharCode(65 + j)}`;
            if (!usedIso.has(code)) {
              usedIso.add(code);
              return code;
            }
          }
        }
        throw new Error('Exhausted test ISO codes');
      };

      countryAIso = pickIso('P');
      countryAPrefix = `hra-${suffix.slice(-6)}`;
      const [cA] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `HPRoute Country A ${suffix}`,
            isoCode: countryAIso,
            urlPrefix: countryAPrefix,
            currencyCode: 'KES',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryAId = cA.id;
      createdCountryIds.push(countryAId);

      countryBIso = pickIso('Q');
      const [cB] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `HPRoute Country B ${suffix}`,
            isoCode: countryBIso,
            urlPrefix: `hrb-${suffix.slice(-6)}`,
            currencyCode: 'UGX',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryBId = cB.id;
      createdCountryIds.push(countryBId);

      // Register users & roles
      const registerActor = async (tag: string, name: string) => {
        const reg = await withDbRetry(() =>
          authService.register({
            email: `hproute-${tag}-${suffix}@example.com`,
            password: 'SecurePassword123!',
            displayName: name,
          }),
        );
        return {
          id: reg.user.id,
          cookie: `${SESSION_COOKIE_NAME}=${reg.sessionToken}`,
        };
      };

      const sysAdmin = await registerActor('sys', 'HP System Admin');
      sysAdminCookie = sysAdmin.cookie;
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: sysAdmin.id,
          roleSlug: 'system_admin',
        }),
      );

      const cAMgr = await registerActor('camgr', 'Country A Content Manager');
      countryAManagerId = cAMgr.id;
      countryAManagerCookie = cAMgr.cookie;
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: cAMgr.id,
          roleSlug: 'content_manager',
          scopeType: 'COUNTRY',
          scopeId: countryAId,
        }),
      );

      const cARev = await registerActor('carev', 'Country A Content Reviewer');
      countryAReviewerCookie = cARev.cookie;
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: cARev.id,
          roleSlug: 'content_reviewer',
          scopeType: 'COUNTRY',
          scopeId: countryAId,
        }),
      );

      const [schoolA] = await withDbRetry(() =>
        db
          .insert(schools)
          .values({
            countryId: countryAId,
            name: `HPRoute School ${suffix}`,
            code: `HPRSCH_${suffix}`.slice(0, 40),
            schoolType: 'SECONDARY',
            status: 'ACTIVE',
          })
          .returning(),
      );

      const schMgr = await registerActor('schmgr', 'School Scoped Manager');
      schoolOnlyManagerCookie = schMgr.cookie;
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: schMgr.id,
          roleSlug: 'content_manager',
          scopeType: 'SCHOOL',
          scopeId: schoolA.id,
        }),
      );

      const stdUser = await registerActor('std', 'Standard Learner');
      standardUserCookie = stdUser.cookie;

      // Seed Country A taxonomy + content across all 4 entity types
      const [rt] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `HPR_TYPE_${suffix}`.toUpperCase().slice(0, 30),
            name: `HPRoute Paper ${suffix}`,
            slug: `hpr-paper-${suffix}`,
            pillar: 'PAST_PAPERS',
            status: 'ACTIVE',
            sequenceOrder: 951,
          })
          .returning(),
      );

      const [cur] = await withDbRetry(() =>
        db
          .insert(curricula)
          .values({
            countryId: countryAId,
            name: `HPRoute CBC ${suffix}`,
            slug: `hpr-cbc-${suffix}`,
            code: 'CBC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [ver] = await withDbRetry(() =>
        db
          .insert(curriculumVersions)
          .values({
            curriculumId: cur.id,
            countryId: countryAId,
            versionName: '2026 Current',
            slug: `hpr-ver-${suffix}`,
            status: 'CURRENT',
          })
          .returning(),
      );
      const [lvl] = await withDbRetry(() =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId: ver.id,
            name: 'Senior School',
            slug: `hpr-lvl-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [grd] = await withDbRetry(() =>
        db
          .insert(grades)
          .values({
            curriculumVersionId: ver.id,
            educationLevelId: lvl.id,
            name: 'Grade 10',
            slug: `hpr-g10-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [pw] = await withDbRetry(() =>
        db
          .insert(pathways)
          .values({
            curriculumVersionId: ver.id,
            educationLevelId: lvl.id,
            gradeId: grd.id,
            name: 'STEM',
            slug: `hpr-stem-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [sub] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: ver.id,
            educationLevelId: lvl.id,
            gradeId: grd.id,
            pathwayId: pw.id,
            name: 'Integrated Physics',
            slug: `hpr-phys-${suffix}`,
            code: 'PHY10',
            description: 'Core Grade 10 STEM Physics',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryASubjectId = sub.id;

      const seedPublishedRes = async (tag: string, useSecretMarker = false) => {
        const [r] = await withDbRetry(() =>
          db
            .insert(resources)
            .values({
              countryId: countryAId,
              resourceTypeId: rt.id,
              curriculumId: cur.id,
              curriculumVersionId: ver.id,
              educationLevelId: lvl.id,
              gradeId: grd.id,
              pathwayId: pw.id,
              subjectId: sub.id,
              title: `HPRoute Resource ${tag} ${suffix}`,
              slug: `hpr-res-${tag}-${suffix}`,
              description: `Published resource ${tag}`,
              status: 'PUBLISHED',
              qualityLabel: 'VERIFIED',
            })
            .returning(),
        );
        const [vDraft] = await withDbRetry(() =>
          db
            .insert(resourceVersions)
            .values({
              resourceId: r.id,
              versionNumber: 1,
              versionLabel: '1.0',
              title: `HPRoute Resource ${tag} v1`,
              status: 'DRAFT',
              qualityLabel: 'VERIFIED',
            })
            .returning(),
        );
        const fi = fileIdx++;
        await withDbRetry(() =>
          db.insert(resourceFiles).values({
            resourceVersionId: vDraft.id,
            storageProvider: 'CLOUDFLARE_R2',
            storageBucket: 'private-edu-bucket',
            objectKey: useSecretMarker
              ? SECRET_STORAGE_KEY_MARKER
              : `resources/${r.id}/versions/${vDraft.id}/f-${fi}-${suffix}.pdf`,
            originalFilename: `physics-${fi}.pdf`,
            fileExtension: 'pdf',
            fileType: 'MAIN_DOCUMENT',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: fi.toString(16).padStart(64, 'b'),
            status: 'AVAILABLE',
            isPrimary: true,
            sequenceOrder: 1,
          }),
        );
        await withDbRetry(() =>
          db
            .update(resourceVersions)
            .set({
              status: 'PUBLISHED',
              publishedAt: new Date('2026-10-10T00:00:00.000Z'),
            })
            .where(eq(resourceVersions.id, vDraft.id)),
        );
        return r.id;
      };

      countryAResource1Id = await seedPublishedRes('one', true);
      countryAResource2Id = await seedPublishedRes('two', false);
      countryAResourceArchivableId = await seedPublishedRes('archivable', false);

      // Update in Country A
      const [uCat] = await withDbRetry(() =>
        db
          .insert(educationUpdateCategories)
          .values({
            name: `HPRoute Notices ${suffix}`,
            slug: `hpr-not-${suffix}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [upd] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: countryAId,
            categoryId: uCat.id,
            title: `HPRoute Circular ${suffix}`,
            slug: `hpr-upd-${suffix}`,
            summary: 'Important term examination circular',
            body: 'Full circular content',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2026-10-12T00:00:00.000Z'),
          })
          .returning(),
      );
      countryAUpdateId = upd.id;

      // Official Calendar Event in Country A
      const [evType] = await withDbRetry(() =>
        db
          .insert(calendarEventTypes)
          .values({
            name: `HPRoute Exam Date ${suffix}`,
            slug: `hpr-evtype-${suffix}`,
            status: 'ACTIVE',
            displayOrder: 1,
          })
          .returning(),
      );
      const [cal] = await withDbRetry(() =>
        db
          .insert(calendars)
          .values({
            name: `HPRoute Official Calendar ${suffix}`,
            calendarScope: 'OFFICIAL',
            countryId: countryAId,
            academicYear: '2099',
            status: 'ACTIVE',
          })
          .returning(),
      );
      const [ev] = await withDbRetry(() =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: cal.id,
            eventTypeId: evType.id,
            title: `HPRoute National Physics Practical ${suffix}`,
            startDate: '2099-11-10',
            endDate: '2099-11-12',
            sourceType: 'OFFICIAL',
            visibility: 'PUBLIC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryACalendarEventId = ev.id;

      // Create a Country B draft via system_admin so we have an existing cross-country configuration ID for anti-enumeration testing
      const cbCreateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/homepage/drafts',
        headers: { cookie: sysAdminCookie },
        payload: {
          countryId: countryBId,
          title: 'Country B Confidential Draft',
        },
      });
      expect(cbCreateRes.statusCode).toBe(201);
      countryBCfgId = cbCreateRes.json().data.id;
    }, 180000);

    afterAll(async () => {
      try {
        await app.close();
        if (createdCountryIds.length > 0) {
          await withDbRetry(() =>
            db
              .update(calendars)
              .set({ status: 'INACTIVE' })
              .where(inArray(calendars.countryId, createdCountryIds)),
          ).catch(() => {});
          await withDbRetry(() =>
            db
              .update(countries)
              .set({ status: 'INACTIVE' })
              .where(inArray(countries.id, createdCountryIds)),
          ).catch(() => {});
        }
        await withDbRetry(() =>
          db.execute(sql`
            UPDATE "calendar"."calendars" AS cal
            SET "status" = 'INACTIVE'
            FROM "geography"."countries" AS c
            WHERE cal."country_id" = c."id"
              AND c."status" = 'INACTIVE'
              AND cal."status" = 'ACTIVE'
          `),
        ).catch(() => {});
      } finally {
        await closeDatabase();
      }
    }, 60000);

    describe('1. T-PUBLIC-HOMEPAGE-ROUTES (P1, P2, C63 unregistered slot route, D1/D2 6 slots, zero secret leakage)', () => {
      it('resolves default KE on P1, resolves ISO/prefix/UUID on P1 & P2, enforces Cache-Control: no-store, rejects whitespace/unknown country, and does not register /homepage/slots/:slotKey', async () => {
        // Default KE resolution (never mutated!)
        const keRes = await app.inject({
          method: 'GET',
          url: '/api/v1/homepage',
        });
        expect(keRes.statusCode).toBe(200);
        expect(keRes.headers['cache-control']).toBe('no-store');
        const keBody = keRes.json();
        expect(keBody.data.country.isoCode).toBe('KE');
        expect(keBody.data.sections).toHaveLength(6);
        expect(keBody.data.sections.map((s: any) => s.slotKey)).toEqual([
          'trending_resources',
          'most_downloaded_resources',
          'curated_resources',
          'education_updates',
          'calendar_highlights',
          'curriculum_shortcuts',
        ]);

        // P1 Country A by ISO, prefix, and UUID + P2 by URL prefix
        for (const url of [
          `/api/v1/homepage?country=${countryAIso}`,
          `/api/v1/homepage?country=${countryAPrefix}`,
          `/api/v1/homepage?country=${countryAId}`,
          `/api/v1/countries/${countryAPrefix}/homepage`,
        ]) {
          const res = await app.inject({ method: 'GET', url });
          expect(res.statusCode).toBe(200);
          expect(res.headers['cache-control']).toBe('no-store');
          const payload = res.json();
          expect(payload.data.country.id).toBe(countryAId);
          expect(payload.data.source).toBe('DEFAULT_FALLBACK');
          expect(payload.data.sections).toHaveLength(6);

          // Verify Slot #6 curriculum_shortcuts hydrates CurriculumShortcutCardDto (D2)
          const shortcutSlot = payload.data.sections[5];
          expect(shortcutSlot.slotKey).toBe('curriculum_shortcuts');
          expect(shortcutSlot.entityType).toBe('SUBJECT');
          const physCard = shortcutSlot.items.find(
            (i: any) => i.id === countryASubjectId,
          );
          expect(physCard).toBeDefined();
          expect(physCard.entityType).toBe('SUBJECT');
          expect(physCard.publishedResourceCount).toBeGreaterThanOrEqual(3);
          expect(physCard.grade.name).toBe('Grade 10');
          expect(physCard.pathway.name).toBe('STEM');

          // Zero storage key / bucket leakage anywhere in public response
          expect(res.body).not.toContain(SECRET_STORAGE_KEY_MARKER);
          expect(res.body).not.toContain('private-edu-bucket');
          expect(res.body).not.toContain('objectKey');
          expect(res.body).not.toContain('storageKey');
        }

        // Whitespace country identifier rejected with 400 + Cache-Control: no-store
        const wsRes = await app.inject({
          method: 'GET',
          url: '/api/v1/homepage?country=%20KE%20',
        });
        expect(wsRes.statusCode).toBe(400);
        expect(wsRes.headers['cache-control']).toBe('no-store');

        // Unknown country -> 404 COUNTRY_NOT_FOUND + Cache-Control: no-store
        const unkRes = await app.inject({
          method: 'GET',
          url: '/api/v1/countries/zz-nonexistent/homepage',
        });
        expect(unkRes.statusCode).toBe(404);
        expect(unkRes.headers['cache-control']).toBe('no-store');
        expect(unkRes.json().error.code).toBe('COUNTRY_NOT_FOUND');

        // C63: Single-slot public route is NOT registered
        const slotRouteRes = await app.inject({
          method: 'GET',
          url: '/api/v1/homepage/slots/trending_resources',
        });
        expect(slotRouteRes.statusCode).toBe(404);
      });
    });

    describe('2. T-RBAC-SCOPE-MATRIX & Live Anti-Enumeration (A1–A9)', () => {
      it('enforces 401 unauthenticated, 403 SCHOOL/standard_user/content_reviewer boundaries, explicit-country 403 (including unverified countryId FK-safe audit), and opaque-ID 404 anti-enumeration', async () => {
        // 1. Unauthenticated -> 401 + private, no-store
        const unauthRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/homepage',
        });
        expect(unauthRes.statusCode).toBe(401);
        expect(unauthRes.headers['cache-control']).toBe('private, no-store');

        // 2. standard_user & SCHOOL-only content_manager -> 403 FORBIDDEN
        for (const cookie of [standardUserCookie, schoolOnlyManagerCookie]) {
          const deniedRes = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/homepage',
            headers: { cookie },
          });
          expect(deniedRes.statusCode).toBe(403);
          expect(deniedRes.headers['cache-control']).toBe('private, no-store');
          expect(deniedRes.json().error.code).toBe('FORBIDDEN');
        }

        // 3. Country-A content_reviewer: allowed A2 & A5 (read), denied A1 (manage) & A9 (publish)
        const revList = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/homepage?countryId=${countryAId}`,
          headers: { cookie: countryAReviewerCookie },
        });
        expect(revList.statusCode).toBe(200);

        const revPreview = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/preview',
          headers: { cookie: countryAReviewerCookie },
          payload: { countryId: countryAId },
        });
        expect(revPreview.statusCode).toBe(200);

        const revCreateDenied = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAReviewerCookie },
          payload: { countryId: countryAId, title: 'Reviewer Draft Attempt' },
        });
        expect(revCreateDenied.statusCode).toBe(403);

        // 4. Country-A content_manager probing Country B explicit-country routes -> 403 + DENIED audit
        const crossExplicit = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: { countryId: countryBId, title: 'Cross Country Draft' },
        });
        expect(crossExplicit.statusCode).toBe(403);

        // Unverified nonexistent countryId on explicit-country route -> 403 without 23503 FK crash (country_id degraded to null in audit_logs)
        const bogusCountryId = '88888888-8888-4888-8888-888888888888';
        const unverifiedCountryRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: { countryId: bogusCountryId, title: 'Bogus Country Draft' },
        });
        expect(unverifiedCountryRes.statusCode).toBe(403);

        const [latestMgrAudit] = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, countryAManagerId),
              eq(auditLogs.outcome, 'DENIED'),
            ),
          )
          .orderBy(desc(auditLogs.occurredAt))
          .limit(1);
        expect(latestMgrAudit).toBeDefined();
        expect(latestMgrAudit.countryId).toBeNull();
        expect((latestMgrAudit.context as any)?.requestedCountryId).toBe(
          bogusCountryId,
        );

        // 5. Country-A content_manager probing Country B opaque configuration ID vs nonexistent UUID -> byte-identical 404!
        const missingCfgId = '77777777-7777-4777-8777-777777777777';
        const crossOpaque = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/homepage/configurations/${countryBCfgId}`,
          headers: {
            cookie: countryAManagerCookie,
            'x-request-id': 'live-anti-enum-req-1',
          },
        });
        const missingOpaque = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/homepage/configurations/${missingCfgId}`,
          headers: {
            cookie: countryAManagerCookie,
            'x-request-id': 'live-anti-enum-req-1',
          },
        });
        expect(crossOpaque.statusCode).toBe(404);
        expect(missingOpaque.statusCode).toBe(404);
        expect(crossOpaque.body).toBe(missingOpaque.body);

        // Verify cross-country probe wrote a DENIED audit log while nonexistent ID did NOT
        const crossAudits = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, countryAManagerId),
              eq(auditLogs.entityId, countryBCfgId),
              eq(auditLogs.outcome, 'DENIED'),
            ),
          );
        expect(crossAudits.length).toBeGreaterThanOrEqual(1);

        const missingAudits = await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.entityId, missingCfgId));
        expect(missingAudits).toHaveLength(0);

        // 6. A2 list without countryId for Country-A-scoped actor never leaks Country B configurations
        const scopedList = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/homepage',
          headers: { cookie: countryAManagerCookie },
        });
        expect(scopedList.statusCode).toBe(200);
        const listedIds = scopedList.json().data.map((c: any) => c.id);
        expect(listedIds).not.toContain(countryBCfgId);
      });
    });

    describe('3. Full Editorial Lifecycle End-to-End (A1 -> A4 -> A5 -> A6 -> A8 -> A7 -> P1/P2 -> A9 Rollback)', () => {
      it('executes draft creation, slot curation, preview timestamp fail-closed checks, schedule overlap/unschedule/cancel, strict discard, publish, public serving, and rollback with stale-target protection', async () => {
        // 1. Create Draft d0 -> Schedule -> Verify A8 discard rejects SCHEDULED (409) -> Cancel via A6 -> ARCHIVED
        const d0Res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Country A Scheduled Test v1',
          },
        });
        expect(d0Res.statusCode).toBe(201);
        const d0Id = d0Res.json().data.id;

        // Duplicate active draft -> 409 ACTIVE_DRAFT_ALREADY_EXISTS
        const dupDraftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Duplicate Draft',
          },
        });
        expect(dupDraftRes.statusCode).toBe(409);
        expect(dupDraftRes.json().error.code).toBe(
          'ACTIVE_DRAFT_ALREADY_EXISTS',
        );

        // Schedule d0 for [2028-05-01T10:00Z, 2028-05-01T14:00Z)
        const sched0Res = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${d0Id}/schedule`,
          headers: { cookie: countryAManagerCookie },
          payload: {
            action: 'SCHEDULE',
            scheduledStartAt: '2028-05-01T10:00:00.000Z',
            scheduledUntilAt: '2028-05-01T14:00:00.000Z',
          },
        });
        expect(sched0Res.statusCode).toBe(200);
        expect(sched0Res.json().data.status).toBe('SCHEDULED');

        // C65: A8 discard MUST reject SCHEDULED configuration with 409 INVALID_CONFIGURATION_STATE
        const illegalDiscardRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/drafts/${d0Id}/discard`,
          headers: { cookie: countryAManagerCookie },
          payload: { reason: 'Trying to discard a scheduled configuration' },
        });
        expect(illegalDiscardRes.statusCode).toBe(409);
        expect(illegalDiscardRes.json().error.code).toBe(
          'INVALID_CONFIGURATION_STATE',
        );

        // Create second draft dOverlap and attempt overlapping schedule [12:00Z, 16:00Z) -> 409 SCHEDULE_WINDOW_OVERLAP
        const dOverlapRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Overlap Draft',
          },
        });
        expect(dOverlapRes.statusCode).toBe(201);
        const dOverlapId = dOverlapRes.json().data.id;

        const overlapSchedRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${dOverlapId}/schedule`,
          headers: { cookie: countryAManagerCookie },
          payload: {
            action: 'SCHEDULE',
            scheduledStartAt: '2028-05-01T12:00:00.000Z',
            scheduledUntilAt: '2028-05-01T16:00:00.000Z',
          },
        });
        expect(overlapSchedRes.statusCode).toBe(409);
        expect(overlapSchedRes.json().error.code).toBe(
          'SCHEDULE_WINDOW_OVERLAP',
        );

        // Discard dOverlap cleanly via A8 (DRAFT -> DISCARDED)
        const discardOverlapRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/drafts/${dOverlapId}/discard`,
          headers: { cookie: countryAManagerCookie },
          payload: { reason: 'Discarding overlap test draft' },
        });
        expect(discardOverlapRes.statusCode).toBe(200);
        expect(discardOverlapRes.json().data.status).toBe('DISCARDED');

        // Unschedule d0 (SCHEDULED -> DRAFT), then Cancel after re-scheduling -> ARCHIVED
        const unschedRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${d0Id}/schedule`,
          headers: { cookie: countryAManagerCookie },
          payload: { action: 'UNSCHEDULE' },
        });
        expect(unschedRes.statusCode).toBe(200);
        expect(unschedRes.json().data.status).toBe('DRAFT');

        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${d0Id}/schedule`,
          headers: { cookie: countryAManagerCookie },
          payload: {
            action: 'SCHEDULE',
            scheduledStartAt: '2028-05-01T10:00:00.000Z',
            scheduledUntilAt: '2028-05-01T14:00:00.000Z',
          },
        });

        const cancelSchedRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${d0Id}/schedule`,
          headers: { cookie: countryAManagerCookie },
          payload: {
            action: 'CANCEL',
            reason: 'Campaign postponed indefinitely',
          },
        });
        expect(cancelSchedRes.statusCode).toBe(200);
        expect(cancelSchedRes.json().data.status).toBe('DISCARDED');

        // 2. Create Draft vPub1 with curated slots across RESOURCE, UPDATE, CALENDAR_EVENT, and SUBJECT
        const vPub1DraftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Country A Editorial Homepage vPub1',
            notes: 'Curated exam preparation homepage',
          },
        });
        expect(vPub1DraftRes.statusCode).toBe(201);
        const vPub1Id = vPub1DraftRes.json().data.id;

        const patchRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/homepage/drafts/${vPub1Id}`,
          headers: { cookie: countryAManagerCookie },
          payload: {
            slots: [
              {
                slotKey: 'curated_resources',
                mode: 'MANUAL_OVERRIDE',
                sectionTitle: 'Featured Physics Papers',
                maxItems: 4,
                items: [
                  {
                    position: 1,
                    entityId: countryAResourceArchivableId,
                    pinNote: 'Top revision paper',
                  },
                ],
              },
              {
                slotKey: 'trending_resources',
                mode: 'CURATED_HYBRID',
                sectionTitle: 'Trending Now',
                maxItems: 6,
                items: [
                  {
                    position: 1,
                    entityId: countryAResource1Id,
                    startsAt: '2026-01-01T00:00:00.000Z',
                    endsAt: '2030-01-01T00:00:00.000Z',
                  },
                ],
              },
              {
                slotKey: 'education_updates',
                mode: 'CURATED_HYBRID',
                items: [{ position: 1, entityId: countryAUpdateId }],
              },
              {
                slotKey: 'calendar_highlights',
                mode: 'CURATED_HYBRID',
                items: [{ position: 1, entityId: countryACalendarEventId }],
              },
              {
                slotKey: 'curriculum_shortcuts',
                mode: 'CURATED_HYBRID',
                sectionTitle: 'Featured STEM Shortcuts',
                items: [{ position: 1, entityId: countryASubjectId }],
              },
            ],
          },
        });
        expect(patchRes.statusCode).toBe(200);

        // 3. A5 Preview fail-closed timestamp checks (C61) + valid preview diagnostics
        for (const badEvalAt of [null, '', '2026-10-29', 'not-a-timestamp']) {
          const badPrev = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/homepage/preview',
            headers: { cookie: countryAManagerCookie },
            payload: {
              configurationId: vPub1Id,
              evaluateAt: badEvalAt,
            },
          });
          expect(badPrev.statusCode).toBe(400);
          expect(badPrev.json().error.code).toBe(
            'INVALID_EVALUATION_TIMESTAMP',
          );
        }

        const okPrev = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/preview',
          headers: { cookie: countryAManagerCookie },
          payload: {
            configurationId: vPub1Id,
            evaluateAt: '2026-11-01T12:00:00.000Z',
          },
        });
        expect(okPrev.statusCode).toBe(200);
        expect(okPrev.json().data.source).toBe('CONFIGURATION_PREVIEW');
        expect(
          okPrev.json().data.diagnostics.every((d: any) => d.included === true),
        ).toBe(true);

        // 4. A7 Publish vPub1 -> Verify P2 immediately serves PUBLISHED_CONFIGURATION
        const pub1Res = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${vPub1Id}/publish`,
          headers: { cookie: countryAManagerCookie },
          payload: {},
        });
        expect(pub1Res.statusCode).toBe(200);
        expect(pub1Res.json().data.status).toBe('PUBLISHED');

        const livePublic1 = await app.inject({
          method: 'GET',
          url: `/api/v1/countries/${countryAPrefix}/homepage`,
        });
        expect(livePublic1.statusCode).toBe(200);
        expect(livePublic1.json().data.source).toBe('PUBLISHED_CONFIGURATION');
        expect(livePublic1.json().data.configuration.id).toBe(vPub1Id);
        expect(livePublic1.json().data.sections[2].title).toBe(
          'Featured Physics Papers',
        );
        expect(livePublic1.json().data.sections[2].items[0].isPinned).toBe(
          true,
        );

        // 5. Create & Publish vPub2 (cloning from vPub1, switching curated_resources item to countryAResource2Id)
        const vPub2DraftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Country A Editorial Homepage vPub2',
            sourceConfigurationId: vPub1Id,
            slots: [
              {
                slotKey: 'curated_resources',
                mode: 'MANUAL_OVERRIDE',
                sectionTitle: 'vPub2 Curated Papers',
                maxItems: 4,
                items: [{ position: 1, entityId: countryAResource2Id }],
              },
            ],
          },
        });
        expect(vPub2DraftRes.statusCode).toBe(201);
        const vPub2Id = vPub2DraftRes.json().data.id;

        const pub2Res = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${vPub2Id}/publish`,
          headers: { cookie: countryAManagerCookie },
          payload: {},
        });
        expect(pub2Res.statusCode).toBe(200);

        // 6. A9 Rollback from vPub2 to vPub1 -> creates new PUBLISHED clone
        const rbOkRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/rollback',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            targetConfigurationId: vPub1Id,
            reason: 'Restoring vPub1 Featured Physics Papers layout',
          },
        });
        expect(rbOkRes.statusCode).toBe(200);
        const rbPayload = rbOkRes.json().data;
        expect(rbPayload.rolledBackConfigurationId).toBe(vPub2Id);
        expect(rbPayload.targetSourceConfigurationId).toBe(vPub1Id);
        expect(rbPayload.cloneConfiguration.status).toBe('PUBLISHED');
        expect(rbPayload.cloneConfiguration.restoredFromConfigurationId).toBe(
          vPub1Id,
        );

        // Public P1 immediately serves the rolled-back clone!
        const liveAfterRb = await app.inject({
          method: 'GET',
          url: `/api/v1/homepage?country=${countryAIso}`,
        });
        expect(liveAfterRb.statusCode).toBe(200);
        expect(liveAfterRb.json().data.configuration.id).toBe(
          rbPayload.cloneConfiguration.id,
        );
        expect(liveAfterRb.json().data.sections[2].title).toBe(
          'Featured Physics Papers',
        );

        // 7. Stale-target rollback protection (422 INELIGIBLE_ROLLBACK_TARGET):
        // Publish vPub3 using countryAResource2Id, then archive countryAResourceArchivableId so vPub1's MANUAL_OVERRIDE slot has 0 eligible items!
        const vPub3DraftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/drafts',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            title: 'Country A vPub3',
            slots: [
              {
                slotKey: 'curated_resources',
                mode: 'MANUAL_OVERRIDE',
                sectionTitle: 'vPub3 Safe Curated',
                items: [{ position: 1, entityId: countryAResource2Id }],
              },
            ],
          },
        });
        const vPub3Id = vPub3DraftRes.json().data.id;
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/homepage/configurations/${vPub3Id}/publish`,
          headers: { cookie: countryAManagerCookie },
          payload: {},
        });

        await db
          .update(resources)
          .set({ status: 'ARCHIVED' })
          .where(eq(resources.id, countryAResourceArchivableId));

        const staleRbRes = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/homepage/rollback',
          headers: { cookie: countryAManagerCookie },
          payload: {
            countryId: countryAId,
            targetConfigurationId: vPub1Id,
            reason: 'Attempting rollback to stale target with archived resource',
          },
        });
        expect(staleRbRes.statusCode).toBe(422);
        expect(staleRbRes.json().error.code).toBe(
          'INELIGIBLE_ROLLBACK_TARGET',
        );

        // Verify vPub3 remained untouched as PUBLISHED!
        const vPub3Check = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/homepage/configurations/${vPub3Id}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(vPub3Check.statusCode).toBe(200);
        expect(vPub3Check.json().data.status).toBe('PUBLISHED');
      });
    });
  },
);
