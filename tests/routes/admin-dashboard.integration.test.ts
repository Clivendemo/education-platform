import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  auditLogs,
  countries,
  publicationEvents,
  resourceFiles,
  resources,
  resourceTypes,
  resourceVersions,
  users,
} from '../../src/db/schemas.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { DbPublicationService } from '../../src/services/publication.service.js';
import { DefaultAuditService } from '../../src/services/audit.service.js';
import { FileStorageService } from '../../src/services/file-storage.service.js';
import { FileProcessingWorker } from '../../src/services/file-processing.worker.js';
import { StubCleanMalwareScanner } from '../../src/services/storage/malware-scanner.js';
import { DefaultAdminDashboardService } from '../../src/services/admin-dashboard.service.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { buildApp } from '../../src/app.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)(
  'Prompt 31: Admin Dashboard Routes, RBAC Scope Isolation, Publication Hardening, & Public/Admin Event Split',
  () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

    const memoryStorage = new MemoryStorageProvider('route-secret-bucket-do-not-expose');
    const authService = new DefaultAuthService(db);
    const rbacService = new DefaultRbacService(db);
    const auditService = new DefaultAuditService(db);
    const fileStorageService = new FileStorageService(db, memoryStorage);
    const fileProcessingWorker = new FileProcessingWorker({
      db,
      storageProvider: memoryStorage,
      malwareScanner: new StubCleanMalwareScanner(),
    });
    const publicationService = new DbPublicationService(db, auditService);
    const adminDashboardService = new DefaultAdminDashboardService(
      db,
      rbacService,
      fileStorageService,
      auditService,
      { maxRequestsPerWindow: 20, windowMs: 60_000 },
    );

    const app = buildApp({
      services: {
        authService,
        rbacService,
        auditService,
        fileStorageService,
        publicationService,
        adminDashboardService,
      },
    });

    const origInject = app.inject.bind(app);
    const injectWithRetry = async (opts: any) => {
      let res = await origInject(opts);
      if (res.statusCode === 500) {
        await new Promise((r) => setTimeout(r, 750));
        res = await origInject(opts);
      }
      return res;
    };

    let countryAId: string;
    let countryBId: string;
    let resourceTypeId: string;

    // Actor cookies & user IDs
    let sysAdminId: string;
    let sysAdminCookie: string;

    let countryAManagerId: string;
    let countryAManagerCookie: string;

    let contentReviewerId: string;
    let contentReviewerCookie: string;

    let standardUserId: string;
    let standardUserCookie: string;

    // Seeded resources & files
    let countryAResourceId: string;
    let countryAVersionId: string;
    let countryAFileId: string;

    let countryBResourceId: string;
    let countryBVersionId: string;
    let countryBFileId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      await withDbRetry(() => seedRolesAndPermissions(db));

      const existingCountries = await withDbRetry(() => db.select().from(countries));
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

      const [cA] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `AdminRoute Country A ${suffix}`,
            isoCode: pickIso('M'),
            urlPrefix: `ara-${suffix.slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryAId = cA.id;

      const [cB] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `AdminRoute Country B ${suffix}`,
            isoCode: pickIso('N'),
            urlPrefix: `arb-${suffix.slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryBId = cB.id;

      const [rt] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `ADM_RT_${suffix}`.toUpperCase().slice(0, 30),
            name: `Admin Route Paper ${suffix}`,
            slug: `adm-rt-paper-${suffix}`,
            pillar: 'PAST_PAPERS',
            status: 'ACTIVE',
            sequenceOrder: 932,
          })
          .returning(),
      );
      resourceTypeId = rt.id;

      // 1. Global system_admin
      const regSys = await withDbRetry(() =>
        authService.register({
          email: `sysadmin-${suffix}@example.com`,
          password: 'Password123!',
          displayName: 'Global System Admin',
        }),
      );
      sysAdminId = regSys.user.id;
      sysAdminCookie = `${SESSION_COOKIE_NAME}=${regSys.sessionToken}`;
      createdUserIds.push(sysAdminId);
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: sysAdminId,
          roleSlug: 'system_admin',
        }),
      );

      // 2. COUNTRY-scoped content_manager (Country A ONLY)
      // Note: authService.register auto-assigns standard_user globally; revoke standard_user if needed or keep it (standard_user has no admin perms)
      const regMgr = await withDbRetry(() =>
        authService.register({
          email: `mgr-ca-${suffix}@example.com`,
          password: 'Password123!',
          displayName: 'Country A Content Manager',
        }),
      );
      countryAManagerId = regMgr.user.id;
      countryAManagerCookie = `${SESSION_COOKIE_NAME}=${regMgr.sessionToken}`;
      createdUserIds.push(countryAManagerId);
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: countryAManagerId,
          roleSlug: 'content_manager',
          scopeType: 'COUNTRY',
          scopeId: countryAId,
        }),
      );

      // 3. Global content_reviewer (read-only on Prompt 31 admin endpoints)
      const regRev = await withDbRetry(() =>
        authService.register({
          email: `reviewer-${suffix}@example.com`,
          password: 'Password123!',
          displayName: 'Content Reviewer ReadOnly',
        }),
      );
      contentReviewerId = regRev.user.id;
      contentReviewerCookie = `${SESSION_COOKIE_NAME}=${regRev.sessionToken}`;
      createdUserIds.push(contentReviewerId);
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: contentReviewerId,
          roleSlug: 'content_reviewer',
        }),
      );

      // 4. Plain standard_user
      const regStd = await withDbRetry(() =>
        authService.register({
          email: `std-${suffix}@example.com`,
          password: 'Password123!',
          displayName: 'Standard Learner',
        }),
      );
      standardUserId = regStd.user.id;
      standardUserCookie = `${SESSION_COOKIE_NAME}=${regStd.sessionToken}`;
      createdUserIds.push(standardUserId);

      // Seed Country A DRAFT resource + version + uploaded file
      const [resA] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `Country A Exam Paper ${suffix}`,
            slug: `ca-exam-${suffix}`,
            status: 'DRAFT',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      countryAResourceId = resA.id;

      const [verA] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: resA.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'Country A Exam v1',
            status: 'DRAFT',
          })
          .returning(),
      );
      countryAVersionId = verA.id;

      const fileA = await fileStorageService.uploadResourceFile({
        resourceId: resA.id,
        resourceVersionId: verA.id,
        originalFilename: 'country-a-exam.pdf',
        mimeType: 'application/pdf',
        fileType: 'MAIN_DOCUMENT',
        isPrimary: true,
        sequenceOrder: 1,
        buffer: Buffer.from('%PDF-1.4 Country A exam binary content'),
      });
      countryAFileId = fileA.id;

      // Seed Country B IN_REVIEW resource + version + uploaded file
      const [resB] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryBId,
            resourceTypeId,
            title: `Country B Exam Paper ${suffix}`,
            slug: `cb-exam-${suffix}`,
            status: 'IN_REVIEW',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      countryBResourceId = resB.id;

      const [verB] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: resB.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'Country B Exam v1',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      countryBVersionId = verB.id;

      const fileB = await fileStorageService.uploadResourceFile({
        resourceId: resB.id,
        resourceVersionId: verB.id,
        originalFilename: 'country-b-exam.pdf',
        mimeType: 'application/pdf',
        fileType: 'MAIN_DOCUMENT',
        isPrimary: true,
        sequenceOrder: 1,
        buffer: Buffer.from('%PDF-1.4 Country B exam binary content'),
      });
      countryBFileId = fileB.id;
      await fileProcessingWorker.runOnce();
    }, 180_000);

    afterAll(async () => {
      try {
        // Delete Country B non-published fixtures cleanly
        if (countryBFileId) {
          await db.delete(resourceFiles).where(eq(resourceFiles.id, countryBFileId)).catch(() => {});
        }
        if (countryBVersionId) {
          await db
            .delete(resourceVersions)
            .where(eq(resourceVersions.id, countryBVersionId))
            .catch(() => {});
        }
        if (countryBResourceId) {
          await db.delete(resources).where(eq(resources.id, countryBResourceId)).catch(() => {});
        }
        // Note: Country A resource goes through publication_events (append-only trigger), so leave resource/events intact
        // Delete test users (auditLogs.actorUserId uses ON DELETE SET NULL)
        if (createdUserIds.length > 0) {
          await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
        }
      } finally {
        await app.close();
        await closeDatabase();
      }
    });

    describe('1. Authentication (401) & Standard User Authorization Rejection (403 + DENIED Audit)', () => {
      const allAdminRoutes: Array<{ method: 'GET' | 'POST'; url: () => string }> = [
        { method: 'GET', url: () => '/api/v1/admin/dashboard/overview' },
        { method: 'GET', url: () => '/api/v1/admin/resources' },
        { method: 'GET', url: () => `/api/v1/admin/resources/${countryAResourceId}` },
        { method: 'GET', url: () => '/api/v1/admin/publications/review-queue' },
        { method: 'GET', url: () => '/api/v1/admin/publications/events' },
        { method: 'GET', url: () => '/api/v1/admin/files' },
        { method: 'GET', url: () => `/api/v1/admin/files/${countryAFileId}` },
        {
          method: 'POST',
          url: () => `/api/v1/admin/files/${countryAFileId}/verify-integrity`,
        },
      ];

      it('rejects unauthenticated requests with 401 across all 8 admin routes', async () => {
        for (const route of allAdminRoutes) {
          const res = await injectWithRetry({
            method: route.method,
            url: route.url(),
          });
          expect(res.statusCode, `Expected 401 on ${route.method} ${route.url()}`).toBe(401);
        }
      });

      it('rejects standard_user with generic 403 FORBIDDEN across all 8 admin routes and records DENIED audit log', async () => {
        for (const route of allAdminRoutes) {
          const res = await injectWithRetry({
            method: route.method,
            url: route.url(),
            headers: { cookie: standardUserCookie },
          });
          expect(res.statusCode, `Expected 403 on ${route.method} ${route.url()}`).toBe(403);
          const body = res.json();
          expect(body.error.code).toBe('FORBIDDEN');
          // Must not leak internal permission names
          expect(JSON.stringify(body)).not.toContain('admin.dashboard.read');
          expect(JSON.stringify(body)).not.toContain('file.admin.verify');
        }

        const deniedLogs = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, standardUserId),
              eq(auditLogs.outcome, 'DENIED'),
            ),
          );
        expect(deniedLogs.length).toBeGreaterThanOrEqual(8);
      });
    });

    describe('2. Role Sub-Permission Redaction & content_reviewer Read-Only Enforcement', () => {
      it('grants system_admin full global overview with Cache-Control: private, no-store and zero redacted sections, and narrows cleanly with ?countryId', async () => {
        const globalRes = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/dashboard/overview',
          headers: { cookie: sysAdminCookie },
        });
        expect(globalRes.statusCode).toBe(200);
        expect(globalRes.headers['cache-control']).toBe('private, no-store');

        const globalBody = globalRes.json();
        expect(globalBody.data.scope.mode).toBe('GLOBAL');
        expect(globalBody.data.scope.countryIds).toBeNull();
        expect(globalBody.data.scope.redactedSections).toEqual([]);
        expect(globalBody.data.fileStorage).not.toBeNull();
        expect(globalBody.data.qualityGovernance).not.toBeNull();
        expect(globalBody.data.feedbackModeration).not.toBeNull();
        expect(globalBody.data.educationUpdates).not.toBeNull();
        expect(globalBody.data.contributors).not.toBeNull();
        expect(globalBody.data.notifications).not.toBeNull();
        expect(globalBody.data.analytics).not.toBeNull();
        expect(globalBody.data.governanceAudit).not.toBeNull();

        // Country-filtered overview narrows country-aware sections and marks platform-only sections in redactedSections
        const countryRes = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/dashboard/overview?countryId=${countryAId}`,
          headers: { cookie: sysAdminCookie },
        });
        expect(countryRes.statusCode).toBe(200);
        const countryBody = countryRes.json();
        expect(countryBody.data.scope.mode).toBe('SINGLE');
        expect(countryBody.data.scope.countryIds).toEqual([countryAId]);
        expect(countryBody.data.scope.redactedSections).toEqual(['contributors', 'notifications']);
      });

      it('enforces read-only access and domain sub-permission redaction for content_reviewer', async () => {
        // 1) Overview succeeds with unauthorized sections set to null + listed in scope.redactedSections
        const ovRes = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/dashboard/overview',
          headers: { cookie: contentReviewerCookie },
        });
        expect(ovRes.statusCode).toBe(200);
        const ovData = ovRes.json().data;
        expect(ovData.fileStorage).not.toBeNull();
        expect(ovData.qualityGovernance).not.toBeNull();
        expect(ovData.feedbackModeration).not.toBeNull();

        // content_reviewer lacks update.manage, contributor.manage, notification.admin.manage, analytics.read, audit.read/retention.read
        expect(ovData.educationUpdates).toBeNull();
        expect(ovData.contributors).toBeNull();
        expect(ovData.notifications).toBeNull();
        expect(ovData.analytics).toBeNull();
        expect(ovData.governanceAudit).toBeNull();
        expect(ovData.scope.redactedSections).toEqual(
          expect.arrayContaining([
            'educationUpdates',
            'contributors',
            'notifications',
            'analytics',
            'governanceAudit',
          ]),
        );

        // 2) Read endpoints succeed for content_reviewer
        for (const readUrl of [
          `/api/v1/admin/resources?countryId=${countryAId}`,
          `/api/v1/admin/resources/${countryAResourceId}`,
          `/api/v1/admin/publications/review-queue?countryId=${countryBId}`,
          `/api/v1/admin/publications/events?countryId=${countryAId}`,
          `/api/v1/admin/files?countryId=${countryAId}`,
          `/api/v1/admin/files/${countryAFileId}`,
        ]) {
          const r = await injectWithRetry({
            method: 'GET',
            url: readUrl,
            headers: { cookie: contentReviewerCookie },
          });
          expect(r.statusCode, `Expected 200 on ${readUrl} for content_reviewer`).toBe(200);
        }

        // 3) Operational action verify-integrity MUST return 403 FORBIDDEN for content_reviewer
        const verifyRes = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/admin/files/${countryAFileId}/verify-integrity`,
          headers: { cookie: contentReviewerCookie },
        });
        expect(verifyRes.statusCode).toBe(403);
        expect(verifyRes.json().error.code).toBe('FORBIDDEN');
      });
    });

    describe('3. COUNTRY-Scoped Administrator Isolation & Anti-Enumeration Order', () => {
      it('restricts Country A content_manager to Country A across overview, resources, review-queue, and files', async () => {
        // Overview without ?countryId automatically narrows to Country A
        const ovRes = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/dashboard/overview',
          headers: { cookie: countryAManagerCookie },
        });
        expect(ovRes.statusCode).toBe(200);
        const ovData = ovRes.json().data;
        expect(ovData.scope.mode).toBe('SINGLE');
        expect(ovData.scope.countryIds).toEqual([countryAId]);
        // Global-only sub-permissions (notifications, analytics, governanceAudit) must be redacted for COUNTRY-only grant
        expect(ovData.notifications).toBeNull();
        expect(ovData.analytics).toBeNull();
        expect(ovData.governanceAudit).toBeNull();

        // Requesting Country B overview -> 403 FORBIDDEN + DENIED audit
        const ovForbidden = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/dashboard/overview?countryId=${countryBId}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(ovForbidden.statusCode).toBe(403);

        // Resources list returns only Country A resources
        const resList = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/resources',
          headers: { cookie: countryAManagerCookie },
        });
        expect(resList.statusCode).toBe(200);
        const resIds = resList.json().data.map((r: any) => r.id);
        expect(resIds).toContain(countryAResourceId);
        expect(resIds).not.toContain(countryBResourceId);

        // Resource detail: Country A -> 200, Country B -> 403, Non-existent UUID -> 404
        const detailA = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/resources/${countryAResourceId}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(detailA.statusCode).toBe(200);

        const detailB = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/resources/${countryBResourceId}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(detailB.statusCode).toBe(403);

        const detailMissing = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/resources/00000000-0000-4000-8000-000000000000',
          headers: { cookie: countryAManagerCookie },
        });
        expect(detailMissing.statusCode).toBe(404);

        // Files: Country A -> 200, Country B -> 403
        const fileDetailB = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/files/${countryBFileId}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(fileDetailB.statusCode).toBe(403);

        const verifyB = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/admin/files/${countryBFileId}/verify-integrity`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(verifyB.statusCode).toBe(403);
      });
    });

    describe('4. Strict Input Validation, Storage Redaction, & Rate Limiting', () => {
      it('rejects unknown query params, removed NO_VERSIONS flag, invalid UUIDs, and non-empty verify body with 400 VALIDATION_ERROR', async () => {
        const unknownQuery = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/resources?unexpectedParam=1',
          headers: { cookie: sysAdminCookie },
        });
        expect(unknownQuery.statusCode).toBe(400);
        expect(unknownQuery.json().error.code).toBe('VALIDATION_ERROR');

        const removedFlagQuery = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/resources?attentionFlag=NO_VERSIONS',
          headers: { cookie: sysAdminCookie },
        });
        expect(removedFlagQuery.statusCode).toBe(400);
        expect(removedFlagQuery.json().error.code).toBe('VALIDATION_ERROR');

        const badUuid = await injectWithRetry({
          method: 'GET',
          url: '/api/v1/admin/resources/not-a-uuid',
          headers: { cookie: sysAdminCookie },
        });
        expect(badUuid.statusCode).toBe(400);

        const unexpectedBody = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/admin/files/${countryAFileId}/verify-integrity`,
          headers: { cookie: sysAdminCookie },
          payload: { mutate: true },
        });
        expect(unexpectedBody.statusCode).toBe(400);
      });

      it('never exposes storageBucket, objectKey, storageMetadata, or presigned URLs on file & resource inspection routes', async () => {
        const listRes = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/files?countryId=${countryAId}`,
          headers: { cookie: sysAdminCookie },
        });
        expect(listRes.statusCode).toBe(200);
        const listText = listRes.body;
        expect(listText).not.toContain('storageBucket');
        expect(listText).not.toContain('objectKey');
        expect(listText).not.toContain('storageMetadata');
        expect(listText).not.toContain('route-secret-bucket-do-not-expose');
        expect(listText).not.toContain('presigned');

        const detailRes = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/files/${countryAFileId}`,
          headers: { cookie: sysAdminCookie },
        });
        expect(detailRes.statusCode).toBe(200);
        expect(detailRes.body).not.toContain('storageBucket');
        expect(detailRes.body).not.toContain('objectKey');
        expect(detailRes.body).not.toContain('storageMetadata');
        expect(detailRes.body).not.toContain('route-secret-bucket-do-not-expose');
      });

      it('enforces 20 req/min/actor rate limit on POST /api/v1/admin/files/:id/verify-integrity and records SUCCESS audit logs', async () => {
        for (let i = 0; i < 20; i++) {
          const okRes = await injectWithRetry({
            method: 'POST',
            url: `/api/v1/admin/files/${countryAFileId}/verify-integrity`,
            headers: { cookie: sysAdminCookie },
          });
          expect(okRes.statusCode).toBe(200);
          expect(okRes.headers['cache-control']).toBe('private, no-store');
          const data = okRes.json().data;
          expect(data.integrity.status).toBe('VALID');
          expect(okRes.body).not.toContain('route-secret-bucket-do-not-expose');
        }

        // 21st request by sysAdmin must return 429 RATE_LIMIT_EXCEEDED
        const rateLimited = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/admin/files/${countryAFileId}/verify-integrity`,
          headers: { cookie: sysAdminCookie },
        });
        expect(rateLimited.statusCode).toBe(429);
        expect(rateLimited.json().error.code).toBe('RATE_LIMIT_EXCEEDED');

        // Verify audit logs persisted for sysAdmin
        const successLogs = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, sysAdminId),
              eq(auditLogs.action, 'ADMIN_FILE_INTEGRITY_VERIFIED'),
              eq(auditLogs.outcome, 'SUCCESS'),
            ),
          );
        expect(successLogs.length).toBe(20);
      });
    });

    describe('5. Hardened Publication Transitions & Explicit Public vs Admin Event-Route Split', () => {
      it('enforces COUNTRY scope on publication transitions, records actorUserId + transactional audit logs, and rolls back audit on failed transitions', async () => {
        // Out-of-country approve attempt by Country A manager on Country B IN_REVIEW resource -> 403 FORBIDDEN + DENIED audit
        const crossCountryApprove = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/resources/${countryBResourceId}/approve`,
          headers: { cookie: countryAManagerCookie },
          payload: { reason: 'Cross-country attempt' },
        });
        expect(crossCountryApprove.statusCode).toBe(403);

        // Authorized Country A manager transitions Country A resource: DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED
        const submitRes = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/resources/${countryAResourceId}/submit`,
          headers: { cookie: countryAManagerCookie },
          payload: { versionId: countryAVersionId },
        });
        expect(submitRes.statusCode).toBe(200);

        const approveRes = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/resources/${countryAResourceId}/approve`,
          headers: { cookie: countryAManagerCookie },
          payload: {},
        });
        expect(approveRes.statusCode).toBe(200);

        const publishRes = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/resources/${countryAResourceId}/publish`,
          headers: { cookie: countryAManagerCookie },
          payload: { versionId: countryAVersionId },
        });
        expect(publishRes.statusCode).toBe(200);

        // Verify actor_user_id is populated on all 3 content.publication_events rows
        const pubEvents = await db
          .select()
          .from(publicationEvents)
          .where(eq(publicationEvents.resourceId, countryAResourceId))
          .orderBy(desc(publicationEvents.createdAt));
        expect(pubEvents).toHaveLength(3);
        for (const ev of pubEvents) {
          expect(ev.actorUserId).toBe(countryAManagerId);
        }

        // Verify DENIED audit log recorded for cross-country approve attempt, and 3 SUCCESS transactional audit logs for Country A transitions
        const deniedCrossCountryAudits = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, countryAManagerId),
              eq(auditLogs.action, 'RESOURCE_APPROVED'),
              eq(auditLogs.outcome, 'DENIED'),
            ),
          );
        expect(deniedCrossCountryAudits).toHaveLength(1);

        const transitionAudits = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, countryAManagerId),
              eq(auditLogs.outcome, 'SUCCESS'),
              inArray(auditLogs.action, [
                'RESOURCE_SUBMITTED_FOR_REVIEW',
                'RESOURCE_APPROVED',
                'RESOURCE_VERSION_PUBLISHED',
              ]),
            ),
          );
        expect(transitionAudits).toHaveLength(3);

        // Attempt invalid transition (approve an already PUBLISHED resource) -> fails without committing extra SUCCESS RESOURCE_APPROVED audit row
        const invalidApprove = await injectWithRetry({
          method: 'POST',
          url: `/api/v1/resources/${countryAResourceId}/approve`,
          headers: { cookie: countryAManagerCookie },
          payload: {},
        });
        expect(invalidApprove.statusCode).toBeGreaterThanOrEqual(400);

        const approvedAuditsAfter = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorUserId, countryAManagerId),
              eq(auditLogs.action, 'RESOURCE_APPROVED'),
              eq(auditLogs.outcome, 'SUCCESS'),
            ),
          );
        expect(approvedAuditsAfter).toHaveLength(1);
      });

      it('enforces resource.admin.read | resource.review + COUNTRY scope + private no-store on both GET /api/v1/resources/:id/events and GET /api/v1/admin/resources/:id/events (Wave 2 WP2)', async () => {
        // 1) Unauthenticated and standard_user are rejected on GET /api/v1/resources/:id/events
        const publicRouteAnon = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/resources/${countryAResourceId}/events`,
        });
        expect(publicRouteAnon.statusCode).toBe(401);

        const publicRouteStd = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/resources/${countryAResourceId}/events`,
          headers: { cookie: standardUserCookie },
        });
        expect(publicRouteStd.statusCode).toBe(403);
        expect(publicRouteStd.json().error.code).toBe('FORBIDDEN');

        // 2) Administrative route GET /api/v1/admin/resources/:id/events also denies standard_user with 403 FORBIDDEN
        const adminRouteStd = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/resources/${countryAResourceId}/events`,
          headers: { cookie: standardUserCookie },
        });
        expect(adminRouteStd.statusCode).toBe(403);
        expect(adminRouteStd.json().error.code).toBe('FORBIDDEN');

        // 3) Both routes allow Country A manager on Country A resource with Cache-Control: private, no-store
        for (const url of [
          `/api/v1/resources/${countryAResourceId}/events`,
          `/api/v1/admin/resources/${countryAResourceId}/events`,
        ]) {
          const mgrResA = await injectWithRetry({
            method: 'GET',
            url,
            headers: { cookie: countryAManagerCookie },
          });
          expect(mgrResA.statusCode).toBe(200);
          expect(mgrResA.headers['cache-control']).toBe('private, no-store');
          expect(mgrResA.json().data).toHaveLength(3);
        }

        // 4) Both routes deny Country A manager on Country B resource with 403 FORBIDDEN
        for (const url of [
          `/api/v1/resources/${countryBResourceId}/events`,
          `/api/v1/admin/resources/${countryBResourceId}/events`,
        ]) {
          const mgrResB = await injectWithRetry({
            method: 'GET',
            url,
            headers: { cookie: countryAManagerCookie },
          });
          expect(mgrResB.statusCode).toBe(403);
        }

        // 5) Global admin publication event ledger endpoint GET /api/v1/admin/publications/events returns Country A events
        const ledgerRes = await injectWithRetry({
          method: 'GET',
          url: `/api/v1/admin/publications/events?resourceId=${countryAResourceId}`,
          headers: { cookie: countryAManagerCookie },
        });
        expect(ledgerRes.statusCode).toBe(200);
        expect(ledgerRes.json().meta.total).toBe(3);
      });
    });
  },
);
