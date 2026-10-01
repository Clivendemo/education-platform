import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  schools,
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  pathways,
  subjects,
  topics,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
} from '../../src/db/schemas.js';
import { DbCatalogueService } from '../../src/services/catalogue.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Public Catalogue Neon Database Integration Tests', () => {
  let kenyaId: string;
  let tanzaniaId: string;
  let pastPaperTypeId: string;
  let notesTypeId: string;
  let testSchoolId: string;
  let curriculumId: string;
  let curriculumVersionId: string;
  let educationLevelId: string;
  let gradeId: string;
  let pathwayId: string;
  let subjectId: string;
  let topicId: string;

  const createdResourceIds: string[] = [];
  const createdSchoolIds: string[] = [];
  const createdCurriculaIds: string[] = [];
  const createdTypeIds: string[] = [];

  const catalogueService = new DbCatalogueService(db);

  beforeAll(async () => {
    // 1. Ensure Kenya exists
    const existingKenya = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1),
    );

    if (existingKenya.length > 0) {
      kenyaId = existingKenya[0].id;
    } else {
      const [inserted] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: 'Kenya',
            isoCode: 'KE',
            urlPrefix: 'ke',
          })
          .returning(),
      );
      kenyaId = inserted.id;
    }

    // 2. Ensure Tanzania exists
    const existingTz = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.isoCode, 'TZ')).limit(1),
    );

    if (existingTz.length > 0) {
      tanzaniaId = existingTz[0].id;
    } else {
      const [insertedTz] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: 'Tanzania',
            isoCode: 'TZ',
            urlPrefix: 'tz',
          })
          .returning(),
      );
      tanzaniaId = insertedTz.id;
    }

    // 3. Setup Resource Types
    const existingPastPaper = await withDbRetry(async () =>
      db
        .select()
        .from(resourceTypes)
        .where(eq(resourceTypes.code, 'PAST_PAPER'))
        .limit(1),
    );

    if (existingPastPaper.length > 0) {
      pastPaperTypeId = existingPastPaper[0].id;
    } else {
      const [newType] = await withDbRetry(async () =>
        db
          .insert(resourceTypes)
          .values({
            code: 'PAST_PAPER',
            name: 'Past Papers & Examinations',
            slug: 'past-papers',
            pillar: 'PAST_PAPERS',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      pastPaperTypeId = newType.id;
      createdTypeIds.push(newType.id);
    }

    const uniqueNotesCode = `NOTES_${Date.now()}`;
    const [notesType] = await withDbRetry(async () =>
      db
        .insert(resourceTypes)
        .values({
          code: uniqueNotesCode,
          name: 'Revision Notes & Summaries',
          slug: `notes-${Date.now()}`,
          pillar: 'NOTES_REVISION',
          sequenceOrder: 2,
          status: 'ACTIVE',
        })
        .returning(),
    );
    notesTypeId = notesType.id;
    createdTypeIds.push(notesType.id);

    // 4. Setup School
    const [sch] = await withDbRetry(async () =>
      db
        .insert(schools)
        .values({
          countryId: kenyaId,
          name: `[CATALOGUE-TEST] Alliance High School ${Date.now()}`,
          code: `SCH_CAT_${Date.now()}`,
          schoolType: 'SECONDARY',
          status: 'ACTIVE',
        })
        .returning(),
    );
    testSchoolId = sch.id;
    createdSchoolIds.push(sch.id);

    // 5. Setup Curriculum Hierarchy
    const [curr] = await withDbRetry(async () =>
      db
        .insert(curricula)
        .values({
          countryId: kenyaId,
          code: `CBC_CAT_${Date.now()}`,
          name: 'Competency-Based Curriculum Catalogue Test',
          slug: `cbc-cat-${Date.now()}`,
          status: 'ACTIVE',
        })
        .returning(),
    );
    curriculumId = curr.id;
    createdCurriculaIds.push(curr.id);

    const [cver] = await withDbRetry(async () =>
      db
        .insert(curriculumVersions)
        .values({
          curriculumId,
          countryId: kenyaId,
          versionName: 'CBC 2024 Edition',
          versionCode: `CBC-24-${Date.now()}`,
          slug: `cbc-2024-cat-${Date.now()}`,
          status: 'CURRENT',
        })
        .returning(),
    );
    curriculumVersionId = cver.id;

    const [edLvl] = await withDbRetry(async () =>
      db
        .insert(educationLevels)
        .values({
          curriculumVersionId,
          code: `SENIOR_${Date.now()}`,
          name: 'Senior School',
          slug: `senior-cat-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    educationLevelId = edLvl.id;

    const [grd] = await withDbRetry(async () =>
      db
        .insert(grades)
        .values({
          curriculumVersionId,
          educationLevelId,
          code: `G10_${Date.now()}`,
          name: 'Grade 10',
          slug: `g10-cat-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    gradeId = grd.id;

    const [pth] = await withDbRetry(async () =>
      db
        .insert(pathways)
        .values({
          curriculumVersionId,
          educationLevelId,
          gradeId,
          code: `STEM_${Date.now()}`,
          name: 'STEM',
          slug: `stem-cat-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    pathwayId = pth.id;

    const [sbj] = await withDbRetry(async () =>
      db
        .insert(subjects)
        .values({
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          code: `MATH_${Date.now()}`,
          name: 'Advanced Mathematics',
          slug: `math-cat-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    subjectId = sbj.id;

    const [tpc] = await withDbRetry(async () =>
      db
        .insert(topics)
        .values({
          curriculumVersionId,
          subjectId,
          code: `CALC_${Date.now()}`,
          name: 'Calculus I',
          slug: `calc-cat-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    topicId = tpc.id;
  }, 60000);

  afterAll(async () => {
    try {
      if (createdResourceIds.length > 0) {
        // Cascade cleanup files, versions, resources
        const vIds = await withDbRetry(async () =>
          db
            .select({ id: resourceVersions.id })
            .from(resourceVersions)
            .where(inArray(resourceVersions.resourceId, createdResourceIds)),
        );

        if (vIds.length > 0) {
          const versionIdList = vIds.map((v) => v.id);
          // Set versions back to DRAFT so files can be deleted without triggering immutability constraint
          await withDbRetry(async () =>
            db
              .update(resourceVersions)
              .set({ status: 'DRAFT', publishedAt: null })
              .where(inArray(resourceVersions.id, versionIdList)),
          ).catch(() => {});

          await withDbRetry(async () =>
            db
              .delete(resourceFiles)
              .where(inArray(resourceFiles.resourceVersionId, versionIdList)),
          ).catch(() => {});

          await withDbRetry(async () =>
            db
              .delete(resourceVersions)
              .where(inArray(resourceVersions.id, versionIdList)),
          ).catch(() => {});
        }

        await withDbRetry(async () =>
          db
            .delete(resources)
            .where(inArray(resources.id, createdResourceIds)),
        ).catch(() => {});
      }

      if (createdSchoolIds.length > 0) {
        await withDbRetry(async () =>
          db.delete(schools).where(inArray(schools.id, createdSchoolIds)),
        ).catch(() => {});
      }

      if (topicId)
        await withDbRetry(async () => db.delete(topics).where(eq(topics.id, topicId))).catch(() => {});
      if (subjectId)
        await withDbRetry(async () => db.delete(subjects).where(eq(subjects.id, subjectId))).catch(() => {});
      if (pathwayId)
        await withDbRetry(async () => db.delete(pathways).where(eq(pathways.id, pathwayId))).catch(() => {});
      if (gradeId)
        await withDbRetry(async () => db.delete(grades).where(eq(grades.id, gradeId))).catch(() => {});
      if (educationLevelId)
        await withDbRetry(async () =>
          db.delete(educationLevels).where(eq(educationLevels.id, educationLevelId)),
        ).catch(() => {});
      if (curriculumVersionId)
        await withDbRetry(async () =>
          db.delete(curriculumVersions).where(eq(curriculumVersions.id, curriculumVersionId)),
        ).catch(() => {});
      if (createdCurriculaIds.length > 0) {
        await withDbRetry(async () =>
          db.delete(curricula).where(inArray(curricula.id, createdCurriculaIds)),
        ).catch(() => {});
      }
      if (createdTypeIds.length > 0) {
        await withDbRetry(async () =>
          db.delete(resourceTypes).where(inArray(resourceTypes.id, createdTypeIds)),
        ).catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 120000);

  describe('1. Public Visibility Rule Matrix (Sections 3, 24, 26)', () => {
    it('exposes a PUBLISHED resource with a PUBLISHED version in public catalogue', async () => {
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            title: `[CATALOGUE] Published Calculus Past Paper ${Date.now()}`,
            slug: `pub-calc-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
            academicYear: 2026,
            term: 1,
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      const [ver] = await withDbRetry(async () =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: res.id,
            versionNumber: 1,
            versionLabel: 'v1.0',
            title: res.title,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
            publishedAt: new Date(),
          })
          .returning(),
      );

      // Verify discovery in public list
      const list = await catalogueService.listCatalogueResources({
        country: 'ke',
      });
      const found = list.data.find((item) => item.id === res.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe(res.title);
      expect(found?.publishedVersion.versionNumber).toBe(1);
      expect(found?.qualityLabel).toBe('VERIFIED');

      // Verify retrieval in public detail
      const detail = await catalogueService.getCatalogueResourceById(res.id);
      expect(detail).not.toBeNull();
      expect(detail?.id).toBe(res.id);
      expect(detail?.publishedVersion.id).toBe(ver.id);
    });

    it('hides resources in non-published lifecycle statuses (DRAFT, IN_REVIEW, APPROVED, ARCHIVED, REJECTED)', async () => {
      const statuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED', 'REJECTED'] as const;

      for (const st of statuses) {
        const [res] = await withDbRetry(async () =>
          db
            .insert(resources)
            .values({
              countryId: kenyaId,
              resourceTypeId: pastPaperTypeId,
              title: `[CATALOGUE] Non-published ${st} Resource ${Date.now()}`,
              slug: `non-pub-${st.toLowerCase()}-${Date.now()}`,
              status: st,
              qualityLabel: 'STANDARD',
            })
            .returning(),
        );
        createdResourceIds.push(res.id);

        await withDbRetry(async () =>
          db.insert(resourceVersions).values({
            resourceId: res.id,
            versionNumber: 1,
            versionLabel: 'v1.0',
            title: res.title,
            status: st,
            qualityLabel: 'STANDARD',
            publishedAt: null,
          }),
        );

        // Verify hidden in list
        const list = await catalogueService.listCatalogueResources({ country: 'ke' });
        const found = list.data.find((item) => item.id === res.id);
        expect(found).toBeUndefined();

        // Verify hidden in detail (returns null -> 404)
        const detail = await catalogueService.getCatalogueResourceById(res.id);
        expect(detail).toBeNull();
      }
    });

    it('hides a resource with status=PUBLISHED if its only version is DRAFT', async () => {
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            title: `[CATALOGUE] Published Resource With Draft Version ${Date.now()}`,
            slug: `pub-draft-ver-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: res.title,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
          publishedAt: null,
        }),
      );

      const list = await catalogueService.listCatalogueResources({ country: 'ke' });
      expect(list.data.find((item) => item.id === res.id)).toBeUndefined();

      const detail = await catalogueService.getCatalogueResourceById(res.id);
      expect(detail).toBeNull();
    });
  });

  describe('2. Single Published Version & Historical Isolation (Sections 4, 26)', () => {
    it('exposes only the single PUBLISHED version when a newer DRAFT version exists', async () => {
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: notesTypeId,
            title: `[CATALOGUE] Calculus Multi-Version Revision ${Date.now()}`,
            slug: `multi-ver-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      // v1 is PUBLISHED
      const [v1] = await withDbRetry(async () =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: res.id,
            versionNumber: 1,
            versionLabel: 'v1.0',
            title: 'Calculus Notes v1.0 Released',
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
            publishedAt: new Date(),
          })
          .returning(),
      );

      // v2 is DRAFT (internal iteration)
      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 2,
          versionLabel: 'v2.0-draft',
          title: 'Calculus Notes v2.0 Internal Draft',
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
          publishedAt: null,
        }),
      );

      const detail = await catalogueService.getCatalogueResourceById(res.id);
      expect(detail).not.toBeNull();
      // Must expose only v1.0
      expect(detail?.publishedVersion.versionNumber).toBe(1);
      expect(detail?.publishedVersion.versionLabel).toBe('v1.0');
      expect(detail?.publishedVersion.id).toBe(v1.id);
      expect(detail?.publishedVersion.title).toBe('Calculus Notes v1.0 Released');
    });
  });

  describe('3. Metadata-Only Resources & File Presentation (Correction 2 & Section 15)', () => {
    it('discovers a PUBLISHED resource even when it has NO files attached', async () => {
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            title: `[CATALOGUE] Metadata-Only Exam ${Date.now()}`,
            slug: `meta-only-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: res.title,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
          publishedAt: new Date(),
        }),
      );

      const detail = await catalogueService.getCatalogueResourceById(res.id);
      expect(detail).not.toBeNull();
      expect(detail?.fileCount).toBe(0);
      expect(detail?.primaryFile).toBeNull();
      expect(detail?.files).toEqual([]);
    });

    it('presents AVAILABLE files without leaking storage buckets, keys, or R2 credentials', async () => {
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            title: `[CATALOGUE] Resource with Files ${Date.now()}`,
            slug: `with-files-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      const [ver] = await withDbRetry(async () =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: res.id,
            versionNumber: 1,
            versionLabel: 'v1.0',
            title: res.title,
            status: 'DRAFT',
            qualityLabel: 'VERIFIED',
            publishedAt: null,
          })
          .returning(),
      );

      // Add 1 AVAILABLE primary file while version is DRAFT
      const uniqueSuffix = Date.now();
      await withDbRetry(async () =>
        db.insert(resourceFiles).values({
          resourceVersionId: ver.id,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'secret-r2-bucket',
          objectKey: `protected/internal/path/exam_paper_${uniqueSuffix}.pdf`,
          originalFilename: 'exam_paper.pdf',
          fileExtension: 'pdf',
          fileType: 'MAIN_DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: 1048576,
          checksumSha256: uniqueSuffix.toString().padStart(64, '0'),
          status: 'AVAILABLE',
          isPrimary: true,
          sequenceOrder: 1,
        }),
      );

      // Add 1 QUARANTINED file (should be excluded from public catalogue)
      await withDbRetry(async () =>
        db.insert(resourceFiles).values({
          resourceVersionId: ver.id,
          storageProvider: 'CLOUDFLARE_R2',
          storageBucket: 'quarantine-bucket',
          objectKey: `quarantine/malicious_payload_${uniqueSuffix}.pdf`,
          originalFilename: 'malicious_payload.pdf',
          fileExtension: 'pdf',
          fileType: 'SUPPLEMENTARY',
          mimeType: 'application/pdf',
          fileSizeBytes: 524288,
          checksumSha256: (uniqueSuffix + 1).toString().padStart(64, '0'),
          status: 'QUARANTINED',
          isPrimary: false,
          sequenceOrder: 2,
        }),
      );

      // Transition version to PUBLISHED
      await withDbRetry(async () =>
        db
          .update(resourceVersions)
          .set({
            status: 'PUBLISHED',
            publishedAt: new Date(),
          })
          .where(eq(resourceVersions.id, ver.id)),
      );

      const detail = await catalogueService.getCatalogueResourceById(res.id);
      expect(detail).not.toBeNull();
      expect(detail?.fileCount).toBe(1); // Only AVAILABLE file counted
      expect(detail?.files).toHaveLength(1);
      expect(detail?.files[0].originalFilename).toBe('exam_paper.pdf');
      expect(detail?.files[0].isPrimary).toBe(true);

      // Verify quarantine file is completely excluded
      expect(
        detail?.files.some((f) => f.originalFilename === 'malicious_payload.pdf'),
      ).toBe(false);

      // Verify zero leakage of internal storage details
      const exposed = detail?.files[0] as unknown as Record<string, unknown>;
      expect(exposed.storageBucket).toBeUndefined();
      expect(exposed.objectKey).toBeUndefined();
      expect(exposed.storageProvider).toBeUndefined();
      expect(exposed.storageMetadata).toBeUndefined();
    });
  });

  describe('4. Structured AND-Combined Filtering (Sections 7, 8, 9, 10, 26)', () => {
    let targetResourceId: string;
    let targetTitle: string;

    beforeAll(async () => {
      targetTitle = `[CATALOGUE-FILTER-TEST] Senior Math Paper ${Date.now()}`;
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            schoolId: testSchoolId,
            curriculumId,
            curriculumVersionId,
            educationLevelId,
            gradeId,
            pathwayId,
            subjectId,
            topicId,
            title: targetTitle,
            slug: `filter-target-${Date.now()}`,
            status: 'PUBLISHED',
            qualityLabel: 'PREMIUM',
            academicYear: 2026,
            term: 2,
          })
          .returning(),
      );
      targetResourceId = res.id;
      createdResourceIds.push(res.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: targetTitle,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
          publishedAt: new Date(),
        }),
      );
    });

    it('filters accurately by country public identifier (ke) and UUID', async () => {
      expect(tanzaniaId).toBeDefined();
      const result = await catalogueService.listCatalogueResources({ country: 'ke' });
      expect(result.data.some((r) => r.id === targetResourceId)).toBe(true);

      const tzResult = await catalogueService.listCatalogueResources({ country: 'tz' });
      expect(tzResult.data.some((r) => r.id === targetResourceId)).toBe(false);

      const tzUuidResult = await catalogueService.listCatalogueResources({ country: tanzaniaId });
      expect(tzUuidResult.data.some((r) => r.id === targetResourceId)).toBe(false);
    });

    it('filters accurately by resourceType', async () => {
      const result = await catalogueService.listCatalogueResources({
        resourceType: 'past-papers',
      });
      expect(result.data.some((r) => r.id === targetResourceId)).toBe(true);
    });

    it('filters accurately by quality label (PREMIUM)', async () => {
      const premiumResult = await catalogueService.listCatalogueResources({
        quality: 'PREMIUM',
      });
      expect(premiumResult.data.some((r) => r.id === targetResourceId)).toBe(true);

      const standardResult = await catalogueService.listCatalogueResources({
        quality: 'STANDARD',
      });
      expect(standardResult.data.some((r) => r.id === targetResourceId)).toBe(false);
    });

    it('filters accurately by school, and allows non-school resources when school filter is omitted', async () => {
      // 1. School filter supplied
      const schoolResult = await catalogueService.listCatalogueResources({
        school: testSchoolId,
      });
      expect(schoolResult.data.some((r) => r.id === targetResourceId)).toBe(true);

      // 2. School filter omitted: both school and non-school resources are discoverable
      const generalResult = await catalogueService.listCatalogueResources({
        country: 'ke',
      });
      expect(generalResult.data.some((r) => r.id === targetResourceId)).toBe(true);
    });

    it('applies AND-combination across country + grade + subject + quality + term', async () => {
      const combinedMatch = await catalogueService.listCatalogueResources({
        country: 'ke',
        grade: gradeId,
        subject: subjectId,
        quality: 'PREMIUM',
        academicYear: 2026,
        term: 2,
      });
      expect(combinedMatch.data.some((r) => r.id === targetResourceId)).toBe(true);

      // Mismatch in one condition (e.g. term = 1 instead of 2) yields empty/exclusion
      const mismatch = await catalogueService.listCatalogueResources({
        country: 'ke',
        grade: gradeId,
        subject: subjectId,
        quality: 'PREMIUM',
        term: 1,
      });
      expect(mismatch.data.some((r) => r.id === targetResourceId)).toBe(false);
    });
  });

  describe('5. Deterministic Sorting & Pagination (Sections 12, 13, 26)', () => {
    it('supports deterministic sorting options (newest, oldest, title)', async () => {
      const newest = await catalogueService.listCatalogueResources({
        country: 'ke',
        sort: 'newest',
        pageSize: 10,
      });
      expect(newest.data.length).toBeGreaterThan(0);

      const oldest = await catalogueService.listCatalogueResources({
        country: 'ke',
        sort: 'oldest',
        pageSize: 10,
      });
      expect(oldest.data.length).toBeGreaterThan(0);

      const byTitle = await catalogueService.listCatalogueResources({
        country: 'ke',
        sort: 'title',
        pageSize: 10,
      });
      expect(byTitle.data.length).toBeGreaterThan(0);

      // Title sort ordering verification
      for (let i = 0; i < byTitle.data.length - 1; i++) {
        expect(
          byTitle.data[i].title.localeCompare(byTitle.data[i + 1].title),
        ).toBeLessThanOrEqual(0);
      }
    });

    it('supports stable pagination with page, pageSize, total, and hasMore', async () => {
      const p1 = await catalogueService.listCatalogueResources({
        country: 'ke',
        page: 1,
        pageSize: 2,
      });
      expect(p1.meta.page).toBe(1);
      expect(p1.meta.pageSize).toBe(2);
      expect(p1.data.length).toBeLessThanOrEqual(2);

      if (p1.meta.total > 2) {
        expect(p1.meta.hasMore).toBe(true);
        const p2 = await catalogueService.listCatalogueResources({
          country: 'ke',
          page: 2,
          pageSize: 2,
        });
        expect(p2.meta.page).toBe(2);
        // Page 1 and Page 2 records must be disjoint
        const p1Ids = new Set(p1.data.map((r) => r.id));
        for (const item of p2.data) {
          expect(p1Ids.has(item.id)).toBe(false);
        }
      }
    });
  });
});
