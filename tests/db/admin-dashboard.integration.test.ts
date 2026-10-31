import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, getDatabasePool, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  permissions,
  resourceFeedback,
  resourceFiles,
  resources,
  resourceTypes,
  resourceVersions,
  rolePermissions,
  roles,
  users,
} from '../../src/db/schemas.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import {
  FileStorageService,
} from '../../src/services/file-storage.service.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { DefaultAuditService } from '../../src/services/audit.service.js';
import {
  ADMIN_ATTENTION_FLAGS,
  DefaultAdminDashboardService,
  type AdminAttentionFlag,
} from '../../src/services/admin-dashboard.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

interface ExplainPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: ExplainPlanNode[];
}

function collectNodeTypes(node: ExplainPlanNode, acc: string[] = []): string[] {
  acc.push(node['Node Type']);
  for (const child of node.Plans ?? []) {
    collectNodeTypes(child, acc);
  }
  return acc;
}

function collectIndexNames(node: ExplainPlanNode, acc: string[] = []): string[] {
  if (node['Index Name']) {
    acc.push(node['Index Name']);
  }
  for (const child of node.Plans ?? []) {
    collectIndexNames(child, acc);
  }
  return acc;
}

async function runExplainJson(
  querySql: string,
  queryParams: unknown[],
  opts?: { disableSeqScan?: boolean },
): Promise<{
  rootPlan: ExplainPlanNode;
  nodeTypes: string[];
  indexNames: string[];
  executionTimeMs: number;
}> {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (opts?.disableSeqScan) {
      await client.query('SET LOCAL enable_seqscan = off');
    }
    const res = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${querySql}`,
      queryParams,
    );
    await client.query('ROLLBACK');

    const explainPayload = res.rows[0]['QUERY PLAN'][0];
    const rootPlan = explainPayload.Plan as ExplainPlanNode;
    return {
      rootPlan,
      nodeTypes: collectNodeTypes(rootPlan),
      indexNames: collectIndexNames(rootPlan),
      executionTimeMs: Number(explainPayload['Execution Time'] ?? 0),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)(
  'Prompt 31: Admin Dashboard PostgreSQL Indexes, EXPLAIN Plans, & 6-Flag Attention Parity',
  () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const memoryStorage = new MemoryStorageProvider('test-admin-memory-bucket');
    const rbacService = new DefaultRbacService(db);
    const fileStorageService = new FileStorageService(db, memoryStorage);
    const auditService = new DefaultAuditService(db);
    const adminService = new DefaultAdminDashboardService(
      db,
      rbacService,
      fileStorageService,
      auditService,
    );

    let countryAId: string;
    let countryBId: string;
    let resourceTypeId: string;
    let adminUserId: string;

    // Seeded fixture resource IDs in Country A
    let r1CleanPublishedId: string;
    let r1PublishedFileId: string;
    let r2PubNoPrimaryFileId: string;
    let r3PubOverlap3FlagsId: string;
    let r4InReviewCleanId: string;
    let r5InReviewOverlap4FlagsId: string;
    let r6ApprovedCleanCandidateId: string;
    let r7ApprovedMissingCandidateId: string;
    let r8ArchivedIgnoredId: string;

    // Seeded fixture resource ID in Country B
    let r9CountryBInReviewId: string;

    const cleanupFeedbackIds: string[] = [];
    const cleanupNonPublishedFileIds: string[] = [];
    const cleanupNonPublishedVersionIds: string[] = [];
    const cleanupNonPublishedResourceIds: string[] = [];

    beforeAll(async () => {
      await withDbRetry(() => seedRolesAndPermissions(db));

      // Create two isolated ACTIVE countries for deterministic counts & scope checks
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
            name: `AdminDB Country A ${suffix}`,
            isoCode: pickIso('A'),
            urlPrefix: `ada-${suffix.slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryAId = cA.id;

      const [cB] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `AdminDB Country B ${suffix}`,
            isoCode: pickIso('B'),
            urlPrefix: `adb-${suffix.slice(-6)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryBId = cB.id;

      const [rt] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `ADM_DB_${suffix}`.toUpperCase().slice(0, 30),
            name: `Admin DB Paper ${suffix}`,
            slug: `adm-db-paper-${suffix}`,
            pillar: 'PAST_PAPERS',
            status: 'ACTIVE',
            sequenceOrder: 931,
          })
          .returning(),
      );
      resourceTypeId = rt.id;

      const [u] = await withDbRetry(() =>
        db
          .insert(users)
          .values({
            email: `admin-db-${suffix}@example.com`,
            displayName: 'Admin DB Test Actor',
            status: 'ACTIVE',
          })
          .returning(),
      );
      adminUserId = u.id;
      await withDbRetry(() =>
        rbacService.assignRole({
          userId: adminUserId,
          roleSlug: 'system_admin',
        }),
      );

      // Helper for 64-char hex SHA-256
      let shaCounter = 1;
      const nextSha = () => (shaCounter++).toString(16).padStart(64, 'a');

      // R1: Clean PUBLISHED resource (PUBLISHED v1 + primary AVAILABLE file in MemoryStorage + HELPFUL PENDING feedback + ACCEPTED/REJECTED defect feedback) -> []
      const [r1] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R1 Clean Published ${suffix}`,
            slug: `r1-clean-pub-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
          })
          .returning(),
      );
      r1CleanPublishedId = r1.id;

      const [r1v1Draft] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r1.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R1 v1',
            status: 'IN_REVIEW',
            qualityLabel: 'VERIFIED',
          })
          .returning(),
      );

      // Upload real payload into MemoryStorageProvider BEFORE transitioning version to PUBLISHED (respecting immutability trigger)
      const pdfBytes = Buffer.from('%PDF-1.4 Admin integrity test payload');
      const uploadedFile = await fileStorageService.uploadResourceFile({
        resourceId: r1.id,
        resourceVersionId: r1v1Draft.id,
        originalFilename: 'kcse-math-2025.pdf',
        mimeType: 'application/pdf',
        fileType: 'MAIN_DOCUMENT',
        isPrimary: true,
        sequenceOrder: 1,
        buffer: pdfBytes,
      });
      r1PublishedFileId = uploadedFile.id;

      await withDbRetry(() =>
        db
          .update(resourceVersions)
          .set({ status: 'PUBLISHED', publishedAt: new Date() })
          .where(eq(resourceVersions.id, r1v1Draft.id)),
      );

      // Feedback on R1 that MUST NOT trigger HAS_OPEN_DEFECT_FEEDBACK:
      // 1) HELPFUL with PENDING status
      // 2) INCORRECT with ACCEPTED status
      // 3) FILE_PROBLEM with REJECTED status
      const r1FeedbackRows = await withDbRetry(() =>
        db
          .insert(resourceFeedback)
          .values([
            {
              resourceId: r1.id,
              resourceVersionId: r1v1Draft.id,
              sessionId: nextSha(),
              feedbackType: 'HELPFUL',
              status: 'PENDING',
            },
            {
              resourceId: r1.id,
              resourceVersionId: r1v1Draft.id,
              sessionId: nextSha(),
              feedbackType: 'INCORRECT',
              details: 'Typo fixed already',
              status: 'ACCEPTED',
              reviewedBy: adminUserId,
              reviewedAt: new Date(),
            },
            {
              resourceId: r1.id,
              resourceVersionId: r1v1Draft.id,
              sessionId: nextSha(),
              feedbackType: 'FILE_PROBLEM',
              details: 'Not reproducible',
              status: 'REJECTED',
              reviewedBy: adminUserId,
              reviewedAt: new Date(),
            },
          ])
          .returning(),
      );
      cleanupFeedbackIds.push(...r1FeedbackRows.map((f) => f.id));

      // R2: PUBLISHED with non-primary AVAILABLE file only -> ['PUBLISHED_WITHOUT_AVAILABLE_FILE']
      const [r2] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R2 Published Without Primary ${suffix}`,
            slug: `r2-pub-noprim-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      r2PubNoPrimaryFileId = r2.id;

      const [r2v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r2.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R2 v1',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      await withDbRetry(() =>
        db.insert(resourceFiles).values({
          resourceVersionId: r2v1.id,
          storageProvider: 'MEMORY',
          storageBucket: 'test-admin-memory-bucket',
          objectKey: `r2/${suffix}/supp.pdf`,
          originalFilename: 'supplementary.pdf',
          fileExtension: 'pdf',
          fileType: 'SUPPLEMENTARY',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          checksumSha256: nextSha(),
          status: 'AVAILABLE',
          isPrimary: false,
          sequenceOrder: 1,
        }),
      );
      await withDbRetry(() =>
        db
          .update(resourceVersions)
          .set({ status: 'PUBLISHED', publishedAt: new Date() })
          .where(eq(resourceVersions.id, r2v1.id)),
      );

      // R3: PUBLISHED with QUARANTINED primary file + REOPENED OUTDATED feedback
      // -> Overlapping 3 flags: ['PUBLISHED_WITHOUT_AVAILABLE_FILE', 'HAS_PROBLEMATIC_FILES', 'HAS_OPEN_DEFECT_FEEDBACK']
      const [r3] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R3 Published Overlap 3 Flags ${suffix}`,
            slug: `r3-pub-overlap-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'PREMIUM',
          })
          .returning(),
      );
      r3PubOverlap3FlagsId = r3.id;

      const [r3v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r3.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R3 v1',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      await withDbRetry(() =>
        db.insert(resourceFiles).values({
          resourceVersionId: r3v1.id,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'secret-r2-bucket-never-leak',
          objectKey: `private/${suffix}/r3-quarantined.pdf`,
          originalFilename: 'r3-quarantined.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          checksumSha256: nextSha(),
          status: 'QUARANTINED',
          isPrimary: true,
          sequenceOrder: 1,
        }),
      );
      await withDbRetry(() =>
        db
          .update(resourceVersions)
          .set({ status: 'PUBLISHED', publishedAt: new Date() })
          .where(eq(resourceVersions.id, r3v1.id)),
      );
      const [r3Fb] = await withDbRetry(() =>
        db
          .insert(resourceFeedback)
          .values({
            resourceId: r3.id,
            resourceVersionId: r3v1.id,
            sessionId: nextSha(),
            feedbackType: 'OUTDATED',
            details: 'Syllabus changed in 2026',
            status: 'REOPENED',
            reviewedBy: adminUserId,
            reviewedAt: new Date(),
          })
          .returning(),
      );
      cleanupFeedbackIds.push(r3Fb.id);

      // R4: IN_REVIEW with valid IN_REVIEW candidate version -> ['PENDING_REVIEW']
      const [r4] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R4 In Review Clean ${suffix}`,
            slug: `r4-in-review-${suffix}`,
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      r4InReviewCleanId = r4.id;
      cleanupNonPublishedResourceIds.push(r4.id);

      const [r4v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r4.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R4 v1',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      cleanupNonPublishedVersionIds.push(r4v1.id);

      // R5: Previously PUBLISHED v1 (received UNDER_REVIEW defect feedback), now parent is IN_REVIEW with v2 DRAFT + FAILED file (zero IN_REVIEW candidate versions!)
      // -> Overlapping 4 flags: ['PENDING_REVIEW', 'IN_REVIEW_WITHOUT_CANDIDATE_VERSION', 'HAS_PROBLEMATIC_FILES', 'HAS_OPEN_DEFECT_FEEDBACK']
      const [r5] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R5 In Review Overlap 4 Flags ${suffix}`,
            slug: `r5-inreview-overlap-${suffix}`,
            status: 'PUBLISHED',
          })
          .returning(),
      );
      r5InReviewOverlap4FlagsId = r5.id;

      const [r5v1Pub] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r5.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R5 v1 Previously Published',
            status: 'PUBLISHED',
            publishedAt: new Date(),
          })
          .returning(),
      );

      const [r5Fb] = await withDbRetry(() =>
        db
          .insert(resourceFeedback)
          .values({
            resourceId: r5.id,
            resourceVersionId: r5v1Pub.id,
            sessionId: nextSha(),
            feedbackType: 'MISSING_INFORMATION',
            details: 'Page 4 missing',
            status: 'UNDER_REVIEW',
            reviewedBy: adminUserId,
            reviewedAt: new Date(),
          })
          .returning(),
      );
      cleanupFeedbackIds.push(r5Fb.id);

      const [r5v2Draft] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r5.id,
            versionNumber: 2,
            versionLabel: '2.0',
            title: 'R5 v2 Draft Only',
            status: 'DRAFT',
          })
          .returning(),
      );

      await withDbRetry(() =>
        db
          .insert(resourceFiles)
          .values({
            resourceVersionId: r5v2Draft.id,
            storageProvider: 'CLOUDFLARE_R2',
            storageBucket: 'secret-r2-bucket-never-leak',
            objectKey: `private/${suffix}/r5-failed.pdf`,
            originalFilename: 'r5-failed.pdf',
            fileExtension: 'pdf',
            fileType: 'MAIN_DOCUMENT',
            mimeType: 'application/pdf',
            fileSizeBytes: 512,
            checksumSha256: nextSha(),
            status: 'FAILED',
            isPrimary: true,
            sequenceOrder: 1,
          }),
      );

      // Transition parent resource R5 to IN_REVIEW while v2 is still DRAFT (no IN_REVIEW version exists)
      await withDbRetry(() =>
        db
          .update(resources)
          .set({ status: 'IN_REVIEW' })
          .where(eq(resources.id, r5.id)),
      );

      // R6: APPROVED with IN_REVIEW candidate version (canonical DbPublicationService.approveResource state) -> ['APPROVED_AWAITING_PUBLISH']
      const [r6] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R6 Approved Clean Candidate ${suffix}`,
            slug: `r6-approved-clean-${suffix}`,
            status: 'APPROVED',
          })
          .returning(),
      );
      r6ApprovedCleanCandidateId = r6.id;
      cleanupNonPublishedResourceIds.push(r6.id);

      const [r6v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r6.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R6 v1 Candidate',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      cleanupNonPublishedVersionIds.push(r6v1.id);

      // R7: APPROVED without IN_REVIEW candidate version (only DRAFT v1) -> ['APPROVED_AWAITING_PUBLISH', 'IN_REVIEW_WITHOUT_CANDIDATE_VERSION']
      const [r7] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R7 Approved Missing Candidate ${suffix}`,
            slug: `r7-approved-nocand-${suffix}`,
            status: 'APPROVED',
          })
          .returning(),
      );
      r7ApprovedMissingCandidateId = r7.id;
      cleanupNonPublishedResourceIds.push(r7.id);

      const [r7v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r7.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R7 v1 Draft',
            status: 'DRAFT',
          })
          .returning(),
      );
      cleanupNonPublishedVersionIds.push(r7v1.id);

      // R8: Previously PUBLISHED resource (with PENDING defect feedback + QUARANTINED file on v2), now parent is ARCHIVED -> []
      const [r8] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId,
            title: `R8 Archived Ignored ${suffix}`,
            slug: `r8-archived-${suffix}`,
            status: 'PUBLISHED',
          })
          .returning(),
      );
      r8ArchivedIgnoredId = r8.id;

      const [r8v1Pub] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r8.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R8 v1 Published',
            status: 'PUBLISHED',
            publishedAt: new Date(),
          })
          .returning(),
      );

      const [r8Fb] = await withDbRetry(() =>
        db
          .insert(resourceFeedback)
          .values({
            resourceId: r8.id,
            resourceVersionId: r8v1Pub.id,
            sessionId: nextSha(),
            feedbackType: 'INCORRECT',
            details: 'Archived defect',
            status: 'PENDING',
          })
          .returning(),
      );
      cleanupFeedbackIds.push(r8Fb.id);

      const [r8v2Draft] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r8.id,
            versionNumber: 2,
            versionLabel: '2.0',
            title: 'R8 v2 With Quarantined File',
            status: 'DRAFT',
          })
          .returning(),
      );

      await withDbRetry(() =>
        db
          .insert(resourceFiles)
          .values({
            resourceVersionId: r8v2Draft.id,
            storageProvider: 'CLOUDFLARE_R2',
            storageBucket: 'secret-r2-bucket-never-leak',
            objectKey: `private/${suffix}/r8-quarantined.pdf`,
            originalFilename: 'r8-quarantined.pdf',
            fileExtension: 'pdf',
            fileType: 'MAIN_DOCUMENT',
            mimeType: 'application/pdf',
            fileSizeBytes: 512,
            checksumSha256: nextSha(),
            status: 'QUARANTINED',
            isPrimary: true,
            sequenceOrder: 1,
          }),
      );

      await withDbRetry(() =>
        db
          .update(resources)
          .set({ status: 'ARCHIVED' })
          .where(eq(resources.id, r8.id)),
      );

      // R9: Country B IN_REVIEW resource -> ['PENDING_REVIEW']
      const [r9] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryBId,
            resourceTypeId,
            title: `R9 Country B In Review ${suffix}`,
            slug: `r9-cb-inreview-${suffix}`,
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      r9CountryBInReviewId = r9.id;
      cleanupNonPublishedResourceIds.push(r9.id);

      const [r9v1] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: r9.id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'R9 v1',
            status: 'IN_REVIEW',
          })
          .returning(),
      );
      cleanupNonPublishedVersionIds.push(r9v1.id);
    }, 180_000);

    afterAll(async () => {
      try {
        if (cleanupFeedbackIds.length > 0) {
          await db
            .delete(resourceFeedback)
            .where(inArray(resourceFeedback.id, cleanupFeedbackIds))
            .catch(() => {});
        }
        if (cleanupNonPublishedFileIds.length > 0) {
          await db
            .delete(resourceFiles)
            .where(inArray(resourceFiles.id, cleanupNonPublishedFileIds))
            .catch(() => {});
        }
        if (cleanupNonPublishedVersionIds.length > 0) {
          await db
            .delete(resourceVersions)
            .where(inArray(resourceVersions.id, cleanupNonPublishedVersionIds))
            .catch(() => {});
        }
        if (cleanupNonPublishedResourceIds.length > 0) {
          await db
            .delete(resources)
            .where(inArray(resources.id, cleanupNonPublishedResourceIds))
            .catch(() => {});
        }
        if (adminUserId) {
          // Note: governance.audit_logs FK uses ON DELETE SET NULL and trigger permits FK nullification
          await db.delete(users).where(eq(users.id, adminUserId)).catch(() => {});
        }
      } finally {
        await closeDatabase();
      }
    });

    describe('1. Migration 0020_admin_dashboard_indexes.sql & RBAC Seed Catalog Verification', () => {
      it('verifies all 18 additive indexes exist in pg_indexes including the 4 partial review-queue indexes', async () => {
        const expectedIndexes = [
          // 11 on content.resources
          'idx_resources_updated_at_id_desc',
          'idx_resources_created_at_id_desc',
          'idx_resources_lower_title_id_asc',
          'idx_resources_country_updated_desc',
          'idx_resources_country_created_desc',
          'idx_resources_status_updated_desc',
          'idx_resources_country_status_updated_desc',
          'idx_resources_review_queue_updated_desc',
          'idx_resources_review_queue_created_desc',
          'idx_resources_country_review_queue_updated_desc',
          'idx_resources_country_review_queue_created_desc',
          // 3 on content.publication_events
          'idx_pub_events_created_id_desc',
          'idx_pub_events_type_created_id_desc',
          'idx_pub_events_resource_created_id_desc',
          // 4 on files.resource_files
          'idx_res_files_created_id_desc',
          'idx_res_files_updated_id_desc',
          'idx_res_files_size_id_desc',
          'idx_res_files_status_created_id_desc',
        ];

        const rows = await db.execute(
          sql`SELECT schemaname, tablename, indexname, indexdef
              FROM pg_indexes
              WHERE schemaname IN ('content', 'files')`,
        );
        const byName = new Map<string, string>();
        for (const r of rows.rows as Array<{ indexname: string; indexdef: string }>) {
          byName.set(r.indexname, r.indexdef);
        }

        for (const idxName of expectedIndexes) {
          expect(byName.has(idxName), `Missing expected index ${idxName}`).toBe(true);
        }

        // Verify partial index predicates on all 4 review-queue indexes
        for (const partialIdx of [
          'idx_resources_review_queue_updated_desc',
          'idx_resources_review_queue_created_desc',
          'idx_resources_country_review_queue_updated_desc',
          'idx_resources_country_review_queue_created_desc',
        ]) {
          const def = byName.get(partialIdx) ?? '';
          expect(def).toContain('IN_REVIEW');
          expect(def).toContain('APPROVED');
        }
      });

      it('verifies the 4 Prompt-31 permissions, 106 canonical role_permissions mappings, read-only content_reviewer mappings, and seed fast-path recovery', async () => {
        const pRows = await db
          .select()
          .from(permissions)
          .where(
            inArray(permissions.name, [
              'admin.dashboard.read',
              'resource.admin.read',
              'file.admin.read',
              'file.admin.verify',
            ]),
          );
        expect(pRows).toHaveLength(4);
        for (const p of pRows) {
          expect(p.scopeType).toBe('ANY');
          expect(p.status).toBe('ACTIVE');
        }

        const reviewerPerms = await db
          .select({ name: permissions.name })
          .from(rolePermissions)
          .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(eq(roles.slug, 'content_reviewer'));

        const reviewerPermSet = new Set(reviewerPerms.map((r) => r.name));
        expect(reviewerPermSet.has('admin.dashboard.read')).toBe(true);
        expect(reviewerPermSet.has('resource.admin.read')).toBe(true);
        expect(reviewerPermSet.has('file.admin.read')).toBe(true);
        expect(reviewerPermSet.has('file.admin.verify')).toBe(false);

        // Verify canonical matrix total = 106 (48 + 34 + 13 + 5 + 4 + 2)
        const canonicalCounts = await db
          .select({
            slug: roles.slug,
            cnt: sql<number>`count(${rolePermissions.permissionId})::int`,
          })
          .from(roles)
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .where(
            inArray(roles.slug, [
              'system_admin',
              'content_manager',
              'content_reviewer',
              'contributor',
              'verified_teacher',
              'standard_user',
            ]),
          )
          .groupBy(roles.slug);
        const bySlug = Object.fromEntries(canonicalCounts.map((r) => [r.slug, r.cnt]));
        expect(bySlug).toEqual({
          system_admin: 48,
          content_manager: 34,
          content_reviewer: 13,
          contributor: 5,
          verified_teacher: 4,
          standard_user: 2,
        });
        const totalCanonicalMappings = Object.values(bySlug).reduce((a, b) => a + b, 0);
        expect(totalCanonicalMappings).toBe(106);

        // Verify fast-path does NOT skip missing Prompt-31 mappings or INACTIVE Prompt-31 permissions
        // Executed inside an isolated rolled-back transaction so parallel Vitest workers are unaffected.
        const [cmRole] = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.slug, 'content_manager'))
          .limit(1);
        const verifyPerm = pRows.find((p) => p.name === 'file.admin.verify')!;
        const dashPerm = pRows.find((p) => p.name === 'admin.dashboard.read')!;

        await expect(
          db.transaction(async (tx) => {
            await tx
              .delete(rolePermissions)
              .where(
                and(
                  eq(rolePermissions.roleId, cmRole.id),
                  eq(rolePermissions.permissionId, verifyPerm.id),
                ),
              );
            await tx
              .update(permissions)
              .set({ status: 'INACTIVE' })
              .where(eq(permissions.id, dashPerm.id));

            const reseeded = await seedRolesAndPermissions(tx as any);
            expect(reseeded.mappingsCount).toBe(106);

            const [restoredDash] = await tx
              .select()
              .from(permissions)
              .where(eq(permissions.id, dashPerm.id));
            expect(restoredDash.status).toBe('ACTIVE');

            const [restoredMapping] = await tx
              .select()
              .from(rolePermissions)
              .where(
                and(
                  eq(rolePermissions.roleId, cmRole.id),
                  eq(rolePermissions.permissionId, verifyPerm.id),
                ),
              );
            expect(restoredMapping).toBeDefined();

            const fastPathResult = await seedRolesAndPermissions(tx as any);
            expect(fastPathResult).toEqual({
              rolesCount: 6,
              permissionsCount: 48,
              mappingsCount: 106,
            });

            throw new Error('INTENTIONAL_TX_ROLLBACK');
          }),
        ).rejects.toThrow('INTENTIONAL_TX_ROLLBACK');

        // Confirm live DB fast-path also returns exact 6 / 48 / 106 counts
        const liveFastPath = await seedRolesAndPermissions(db);
        expect(liveFastPath).toEqual({
          rolesCount: 6,
          permissionsCount: 48,
          mappingsCount: 106,
        });
      });
    });

    describe('2. Canonical 6-Flag Attention Predicates, Overlapping Flags, & 4-Way Cross-Endpoint Parity', () => {
      const countryAAccess = {
        granted: true,
        hasGlobalGrant: false,
        countryIds: [countryAId],
      };
      const globalAccess = {
        granted: true,
        hasGlobalGrant: true,
        countryIds: [],
      };

      it('evaluates exact single and overlapping attention flags for every seeded Country A resource', async () => {
        const expectedByResourceId = new Map<string, AdminAttentionFlag[]>([
          [r1CleanPublishedId, []],
          [r2PubNoPrimaryFileId, ['PUBLISHED_WITHOUT_AVAILABLE_FILE']],
          [
            r3PubOverlap3FlagsId,
            [
              'PUBLISHED_WITHOUT_AVAILABLE_FILE',
              'HAS_PROBLEMATIC_FILES',
              'HAS_OPEN_DEFECT_FEEDBACK',
            ],
          ],
          [r4InReviewCleanId, ['PENDING_REVIEW']],
          [
            r5InReviewOverlap4FlagsId,
            [
              'PENDING_REVIEW',
              'IN_REVIEW_WITHOUT_CANDIDATE_VERSION',
              'HAS_PROBLEMATIC_FILES',
              'HAS_OPEN_DEFECT_FEEDBACK',
            ],
          ],
          [r6ApprovedCleanCandidateId, ['APPROVED_AWAITING_PUBLISH']],
          [
            r7ApprovedMissingCandidateId,
            ['APPROVED_AWAITING_PUBLISH', 'IN_REVIEW_WITHOUT_CANDIDATE_VERSION'],
          ],
          [r8ArchivedIgnoredId, []],
        ]);

        // 1) Check listResources row flags
        const listResult = await adminService.listResources(
          { pageSize: 50 },
          { granted: true, hasGlobalGrant: false, countryIds: [countryAId] },
        );
        expect(listResult.meta.total).toBe(8);

        for (const item of listResult.data) {
          const id = item.id as string;
          const expected = expectedByResourceId.get(id);
          expect(expected, `Unexpected resource ${id}`).toBeDefined();
          expect(item.attentionFlags).toEqual(expected);

          // 2) Check getResourceById detail parity for every single resource
          const detail = await adminService.getResourceById(
            id,
            adminUserId,
            { granted: true, hasGlobalGrant: false, countryIds: [countryAId] },
          );
          expect(detail.attentionFlags).toEqual(expected);
        }

        // 3) Check getReviewQueue parity on all queued (IN_REVIEW + APPROVED) Country A resources
        const queueResult = await adminService.getReviewQueue(
          { queueState: 'ALL', pageSize: 50 },
          { granted: true, hasGlobalGrant: false, countryIds: [countryAId] },
        );
        expect(queueResult.meta.total).toBe(4);
        for (const qItem of queueResult.data) {
          const id = qItem.id as string;
          expect(qItem.attentionFlags).toEqual(expectedByResourceId.get(id));
        }
      });

      it('maintains 4-way cross-endpoint count parity across overview, ?attentionFlag list filter, review-queue, and detail for Country A & Global scopes', async () => {
        const scopedAccess = {
          granted: true,
          hasGlobalGrant: false,
          countryIds: [countryAId],
        };

        const overviewA = (await adminService.getOverview({
          actorUserId: adminUserId,
          dashboardAccess: scopedAccess,
        })) as any;

        // Deterministic Country A flag totals from R1..R8 (note overlapping flags on R3, R5, R7):
        // R1: []
        // R2: [PUBLISHED_WITHOUT_AVAILABLE_FILE]
        // R3: [PUBLISHED_WITHOUT_AVAILABLE_FILE, HAS_PROBLEMATIC_FILES, HAS_OPEN_DEFECT_FEEDBACK]
        // R4: [PENDING_REVIEW]
        // R5: [PENDING_REVIEW, IN_REVIEW_WITHOUT_CANDIDATE_VERSION, HAS_PROBLEMATIC_FILES, HAS_OPEN_DEFECT_FEEDBACK]
        // R6: [APPROVED_AWAITING_PUBLISH]
        // R7: [APPROVED_AWAITING_PUBLISH, IN_REVIEW_WITHOUT_CANDIDATE_VERSION]
        // R8: []
        // Distinct resources requiring attention = 6 (R2, R3, R4, R5, R6, R7)
        expect(overviewA.attentionSummary).toEqual({
          totalResourcesRequiringAttention: 6,
          byFlag: {
            PENDING_REVIEW: 2,
            APPROVED_AWAITING_PUBLISH: 2,
            PUBLISHED_WITHOUT_AVAILABLE_FILE: 2,
            IN_REVIEW_WITHOUT_CANDIDATE_VERSION: 2,
            HAS_PROBLEMATIC_FILES: 2,
            HAS_OPEN_DEFECT_FEEDBACK: 2,
          },
        });

        // Verify Country A ?attentionFlag=<FLAG> list total equals overviewA.attentionSummary.byFlag[flag]
        for (const flag of ADMIN_ATTENTION_FLAGS) {
          const filtered = await adminService.listResources(
            { attentionFlag: flag, pageSize: 50 },
            scopedAccess,
          );
          expect(filtered.meta.total).toBe(overviewA.attentionSummary.byFlag[flag]);
          for (const row of filtered.data) {
            expect(row.attentionFlags as string[]).toContain(flag);
          }
        }

        // Verify Global unscoped parity across the entire Neon database
        const overviewGlobal = (await adminService.getOverview({
          actorUserId: adminUserId,
          dashboardAccess: globalAccess,
        })) as any;

        for (const flag of ADMIN_ATTENTION_FLAGS) {
          const filteredGlobal = await adminService.listResources(
            { attentionFlag: flag, pageSize: 1 },
            globalAccess,
          );
          expect(filteredGlobal.meta.total).toBe(
            overviewGlobal.attentionSummary.byFlag[flag],
          );
        }

        // Verify Country B isolation
        const overviewB = (await adminService.getOverview({
          actorUserId: adminUserId,
          dashboardAccess: {
            granted: true,
            hasGlobalGrant: false,
            countryIds: [countryBId],
          },
        })) as any;
        expect(overviewB.resources.total).toBe(1);
        expect(overviewB.attentionSummary.byFlag.PENDING_REVIEW).toBe(1);
        expect(r9CountryBInReviewId).toBeDefined();
        void countryAAccess;
      });
    });

    describe('3. Database-Backed EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) Query Plan Verification', () => {
      const globalAccess = {
        granted: true,
        hasGlobalGrant: true,
        countryIds: [],
      };

      it('proves review-queue queries (queueState = ALL, global & single-country, asc & desc, updatedAt & createdAt) match partial indexes with zero Sort nodes', async () => {
        const scenarios: Array<{
          label: string;
          params: Parameters<typeof adminService.buildReviewQueueListQuery>[0];
          expectedIndex: string;
        }> = [
          {
            label: 'global queueState=ALL updatedAt ASC',
            params: { queueState: 'ALL', sortBy: 'updatedAt', sortOrder: 'asc', pageSize: 20 },
            expectedIndex: 'idx_resources_review_queue_updated_desc',
          },
          {
            label: 'global queueState=ALL updatedAt DESC',
            params: { queueState: 'ALL', sortBy: 'updatedAt', sortOrder: 'desc', pageSize: 20 },
            expectedIndex: 'idx_resources_review_queue_updated_desc',
          },
          {
            label: 'global queueState=ALL createdAt ASC',
            params: { queueState: 'ALL', sortBy: 'createdAt', sortOrder: 'asc', pageSize: 20 },
            expectedIndex: 'idx_resources_review_queue_created_desc',
          },
          {
            label: 'single-country queueState=ALL updatedAt ASC',
            params: {
              countryId: countryAId,
              queueState: 'ALL',
              sortBy: 'updatedAt',
              sortOrder: 'asc',
              pageSize: 20,
            },
            expectedIndex: 'idx_resources_country_review_queue_updated_desc',
          },
          {
            label: 'single-country queueState=ALL updatedAt DESC',
            params: {
              countryId: countryAId,
              queueState: 'ALL',
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedIndex: 'idx_resources_country_review_queue_updated_desc',
          },
          {
            label: 'single-country queueState=ALL createdAt DESC',
            params: {
              countryId: countryAId,
              queueState: 'ALL',
              sortBy: 'createdAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedIndex: 'idx_resources_country_review_queue_created_desc',
          },
        ];

        for (const sc of scenarios) {
          const built = adminService.buildReviewQueueListQuery(sc.params, globalAccess);
          const { sql: querySql, params: queryParams } = built.listQuery.toSQL();

          // 1) Forced-index EXPLAIN (enable_seqscan = off) proves exact partial-index predicate & ordering match (zero Sort nodes)
          const forcedPlan = await runExplainJson(querySql, queryParams, {
            disableSeqScan: true,
          });
          expect(
            forcedPlan.indexNames,
            `Scenario "${sc.label}" did not select ${sc.expectedIndex}; got ${JSON.stringify(forcedPlan.indexNames)}`,
          ).toContain(sc.expectedIndex);
          expect(
            forcedPlan.nodeTypes,
            `Scenario "${sc.label}" introduced an unexpected Sort node: ${JSON.stringify(forcedPlan.nodeTypes)}`,
          ).not.toContain('Sort');

          // 2) Natural planner EXPLAIN (enable_seqscan = on) executes cleanly
          const naturalPlan = await runExplainJson(querySql, queryParams, {
            disableSeqScan: false,
          });
          expect(naturalPlan.executionTimeMs).toBeGreaterThanOrEqual(0);
        }
      });

      it('proves admin resource list queries use ordered composite indexes with zero Sort nodes', async () => {
        const scenarios: Array<{
          label: string;
          params: Parameters<typeof adminService.buildAdminResourcesListQuery>[0];
          expectedAnyOfIndexes: string[];
        }> = [
          {
            label: 'global default updatedAt DESC',
            params: { sortBy: 'updatedAt', sortOrder: 'desc', pageSize: 20 },
            expectedAnyOfIndexes: ['idx_resources_updated_at_id_desc'],
          },
          {
            label: 'country-scoped updatedAt DESC',
            params: {
              countryId: countryAId,
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedAnyOfIndexes: ['idx_resources_country_updated_desc'],
          },
          {
            label: 'global selective status (REJECTED) + updatedAt DESC',
            params: {
              status: 'REJECTED',
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedAnyOfIndexes: ['idx_resources_status_updated_desc'],
          },
          {
            label: 'global high-frequency status (PUBLISHED) + updatedAt DESC',
            params: {
              status: 'PUBLISHED',
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedAnyOfIndexes: [
              'idx_resources_status_updated_desc',
              'idx_resources_updated_at_id_desc',
            ],
          },
          {
            label: 'country + status + updatedAt DESC',
            params: {
              countryId: countryAId,
              status: 'REJECTED',
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              pageSize: 20,
            },
            expectedAnyOfIndexes: [
              'idx_resources_country_status_updated_desc',
              'idx_resources_country_updated_desc',
            ],
          },
        ];

        for (const sc of scenarios) {
          const built = adminService.buildAdminResourcesListQuery(sc.params, globalAccess);
          const { sql: querySql, params: queryParams } = built.listQuery.toSQL();

          const forcedPlan = await runExplainJson(querySql, queryParams, {
            disableSeqScan: true,
          });
          const matched = sc.expectedAnyOfIndexes.some((idx) =>
            forcedPlan.indexNames.includes(idx),
          );
          expect(
            matched,
            `Scenario "${sc.label}" did not use any of ${JSON.stringify(sc.expectedAnyOfIndexes)}; got ${JSON.stringify(forcedPlan.indexNames)}`,
          ).toBe(true);
          expect(forcedPlan.nodeTypes).not.toContain('Sort');
        }
      });
    });

    describe('4. Read-Only File Integrity Verification on PUBLISHED Version', () => {
      it('verifies binary integrity against storage without mutating PUBLISHED resource_files row or tripping immutability triggers', async () => {
        const [beforeRow] = await db
          .select()
          .from(resourceFiles)
          .where(eq(resourceFiles.id, r1PublishedFileId));
        expect(beforeRow).toBeDefined();

        const result = (await adminService.verifyFileIntegrity(
          r1PublishedFileId,
          {
            actorUserId: adminUserId,
            actorSnapshot: {
              actorType: 'AUTHENTICATED',
              actorRole: 'system_admin',
              emailDomain: 'example.com',
            },
            requestId: `req-db-${suffix}`.slice(0, 64),
          },
          { granted: true, hasGlobalGrant: true, countryIds: [] },
        )) as any;

        expect(result.immutableUnderPublishedVersion).toBe(true);
        expect(result.integrity.status).toBe('VALID');
        expect(result.integrity.existsInStorage).toBe(true);
        expect(result.integrity.sizeMatches).toBe(true);
        expect(result.integrity.checksumMatches).toBe(true);

        const [afterRow] = await db
          .select()
          .from(resourceFiles)
          .where(eq(resourceFiles.id, r1PublishedFileId));

        expect(afterRow.status).toBe(beforeRow.status);
        expect(afterRow.checksumSha256).toBe(beforeRow.checksumSha256);
        expect(afterRow.updatedAt.toISOString()).toBe(beforeRow.updatedAt.toISOString());
      });
    });
  },
);
