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
import { DefaultSearchService } from '../../src/services/search.service.js';
import { PostgreSQLSearchProvider } from '../../src/services/search/postgresql-search.provider.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Public Search Neon Database Integration Tests', () => {
  let kenyaId: string;
  let tanzaniaId: string;
  let pastPaperTypeId: string;
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

  const searchService = new DefaultSearchService(new PostgreSQLSearchProvider(db));

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

    // 3. Setup Resource Type
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

    // 4. Setup Test Curriculum Hierarchy
    const [c] = await withDbRetry(async () =>
      db
        .insert(curricula)
        .values({
          countryId: kenyaId,
          code: `CBC_SEARCH_${Date.now()}`,
          name: 'Competency Based Curriculum Search Test',
          slug: `cbc-search-${Date.now()}`,
          status: 'ACTIVE',
        })
        .returning(),
    );
    curriculumId = c.id;
    createdCurriculaIds.push(c.id);

    const [cv] = await withDbRetry(async () =>
      db
        .insert(curriculumVersions)
        .values({
          curriculumId,
          countryId: kenyaId,
          versionName: 'CBC 2026 Search Edition',
          versionCode: `CBC-SEARCH-${Date.now()}`,
          slug: `cbc-search-v-${Date.now()}`,
          status: 'CURRENT',
        })
        .returning(),
    );
    curriculumVersionId = cv.id;

    const [el] = await withDbRetry(async () =>
      db
        .insert(educationLevels)
        .values({
          curriculumVersionId,
          code: `SS_SEARCH_${Date.now()}`,
          name: 'Senior Secondary Search Test',
          slug: `senior-search-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    educationLevelId = el.id;

    const [g] = await withDbRetry(async () =>
      db
        .insert(grades)
        .values({
          curriculumVersionId,
          educationLevelId,
          code: `G12_SEARCH_${Date.now()}`,
          name: 'Grade 12 Advanced FTS',
          slug: `g12-search-${Date.now()}`,
          sequenceOrder: 12,
          status: 'ACTIVE',
        })
        .returning(),
    );
    gradeId = g.id;

    const [p] = await withDbRetry(async () =>
      db
        .insert(pathways)
        .values({
          curriculumVersionId,
          educationLevelId,
          gradeId,
          code: `STEM_SEARCH_${Date.now()}`,
          name: 'STEM Pathway Search Test',
          slug: `stem-search-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    pathwayId = p.id;

    const [s] = await withDbRetry(async () =>
      db
        .insert(subjects)
        .values({
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          code: `PHYS_SEARCH_${Date.now()}`,
          name: 'Quantum Physics Mechanics',
          slug: `phys-search-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    subjectId = s.id;

    const [t] = await withDbRetry(async () =>
      db
        .insert(topics)
        .values({
          curriculumVersionId,
          subjectId,
          code: `THERMO_SEARCH_${Date.now()}`,
          name: 'Thermodynamics Wave Optics',
          slug: `thermo-search-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    topicId = t.id;

    // 5. Setup Test School
    const [sc] = await withDbRetry(async () =>
      db
        .insert(schools)
        .values({
          countryId: kenyaId,
          code: `SEARCH_SCH_${Date.now()}`,
          name: 'Nairobi Academy of Pure Sciences',
          schoolType: 'SECONDARY',
          status: 'ACTIVE',
        })
        .returning(),
    );
    testSchoolId = sc.id;
    createdSchoolIds.push(sc.id);
  });

  afterAll(async () => {
    try {
      if (createdResourceIds.length > 0) {
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
  });

  // Helper function to create resources with versions and files
  async function createTestResource(opts: {
    title: string;
    description?: string;
    resourceStatus: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
    versionStatus: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
    versionTitle?: string;
    versionNumber?: number;
    qualityLabel?: 'STANDARD' | 'VERIFIED' | 'PREMIUM';
    countryId?: string;
    schoolId?: string | null;
    gradeId?: string | null;
    subjectId?: string | null;
    topicId?: string | null;
    academicYear?: number;
    term?: number;
    files?: Array<{
      status: 'AVAILABLE' | 'QUARANTINED' | 'FAILED' | 'PENDING';
      isPrimary: boolean;
      filename: string;
    }>;
  }) {
    const slug = `search-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const effectiveCountryId = opts.countryId || kenyaId;
    const isKenya = effectiveCountryId === kenyaId;

    const [res] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: effectiveCountryId,
          resourceTypeId: pastPaperTypeId,
          schoolId: opts.schoolId !== undefined ? opts.schoolId : (isKenya ? testSchoolId : null),
          curriculumId: isKenya ? curriculumId : null,
          curriculumVersionId: isKenya ? curriculumVersionId : null,
          educationLevelId: isKenya ? educationLevelId : null,
          gradeId: opts.gradeId !== undefined ? opts.gradeId : (isKenya ? gradeId : null),
          pathwayId: isKenya ? pathwayId : null,
          subjectId: opts.subjectId !== undefined ? opts.subjectId : (isKenya ? subjectId : null),
          topicId: opts.topicId !== undefined ? opts.topicId : (isKenya ? topicId : null),
          title: opts.title,
          slug,
          description: opts.description || 'FTS test description',
          qualityLabel: opts.qualityLabel || 'STANDARD',
          status: opts.resourceStatus,
          academicYear: opts.academicYear || 2026,
          term: opts.term || 1,
        })
        .returning(),
    );
    createdResourceIds.push(res.id);

    const hasFiles = opts.files && opts.files.length > 0;
    // If files are attached, create in DRAFT first to respect fn_prevent_published_resource_file_insert
    const initialVersionStatus = hasFiles ? 'DRAFT' : opts.versionStatus;

    const [v] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: res.id,
          versionNumber: opts.versionNumber || 1,
          versionLabel: `v${opts.versionNumber || 1}.0.0`,
          title: opts.versionTitle || opts.title,
          status: initialVersionStatus,
          publishedAt: initialVersionStatus === 'PUBLISHED' ? new Date() : null,
        })
        .returning(),
    );

    if (hasFiles && opts.files) {
      for (let i = 0; i < opts.files.length; i++) {
        const file = opts.files[i];
        const uniqueCheck = `${Date.now()}${i}`.padStart(64, '0');
        await withDbRetry(async () =>
          db.insert(resourceFiles).values({
            resourceVersionId: v.id,
            storageProvider: 'CLOUDFLARE_R2',
            storageBucket: 'secret-r2-bucket',
            objectKey: `internal/keys/test-${Date.now()}-${i}.pdf`,
            originalFilename: file.filename,
            fileExtension: 'pdf',
            fileType: 'MAIN_DOCUMENT',
            mimeType: 'application/pdf',
            fileSizeBytes: 2048,
            checksumSha256: uniqueCheck,
            status: file.status,
            isPrimary: file.isPrimary,
            sequenceOrder: i + 1,
          }),
        );
      }

      // Transition to final version status if different from DRAFT
      if (opts.versionStatus !== 'DRAFT') {
        await withDbRetry(async () =>
          db
            .update(resourceVersions)
            .set({
              status: opts.versionStatus,
              publishedAt: opts.versionStatus === 'PUBLISHED' ? new Date() : null,
            })
            .where(eq(resourceVersions.id, v.id)),
        );
      }
    }

    return { resource: res, version: v };
  }

  describe('1. Public Visibility Rule Matrix (Sections 3, 24, 26)', () => {
    it('returns a PUBLISHED resource with a PUBLISHED version in search results', async () => {
      const uniqueTerm = `Chronotemp_${Date.now()}`;
      const { resource } = await createTestResource({
        title: `Comprehensive ${uniqueTerm} Examination`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      const result = await searchService.searchResources({
        q: uniqueTerm,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const matched = result.data.find((r) => r.id === resource.id);
      expect(matched).toBeDefined();
      expect(matched?.title).toContain(uniqueTerm);
      expect(matched?.searchScore).toBeGreaterThan(0);
    });

    it('strictly hides resources in non-published lifecycle statuses even if search term matches perfectly', async () => {
      const nonPublishedStatuses = [
        'DRAFT',
        'IN_REVIEW',
        'APPROVED',
        'ARCHIVED',
        'REJECTED',
      ] as const;

      for (const status of nonPublishedStatuses) {
        const uniqueTerm = `StealthStatus_${status}_${Date.now()}`;
        await createTestResource({
          title: `Secret Resource ${uniqueTerm}`,
          resourceStatus: status,
          versionStatus: 'PUBLISHED',
        });

        const result = await searchService.searchResources({
          q: uniqueTerm,
        });

        expect(result.data).toHaveLength(0);
        expect(result.meta.total).toBe(0);
      }
    });

    it('hides a resource with status=PUBLISHED if its version is DRAFT', async () => {
      const uniqueTerm = `UnpublishedVersion_${Date.now()}`;
      await createTestResource({
        title: `Resource Title ${uniqueTerm}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'DRAFT',
      });

      const result = await searchService.searchResources({
        q: uniqueTerm,
      });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('2. Single Published Version & Historical Isolation', () => {
    it('searches against the single PUBLISHED version and isolates unreleased DRAFT version metadata', async () => {
      const publishedTerm = `PublishedAstro_${Date.now()}`;
      const draftTerm = `DraftSupernova_${Date.now()}`;

      // 1. Create a published resource with v1 PUBLISHED
      const { resource } = await createTestResource({
        title: `Astrophysics Core: ${publishedTerm}`,
        versionTitle: `Astrophysics Core v1: ${publishedTerm}`,
        versionNumber: 1,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      // 2. Add an unreleased v2 in DRAFT status containing draftTerm
      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: resource.id,
          versionNumber: 2,
          versionLabel: 'v2.0.0',
          title: `Astrophysics Advanced: ${draftTerm}`,
          status: 'DRAFT',
          publishedAt: null,
        }),
      );

      // Search for draftTerm: must return NOTHING
      const draftSearchResult = await searchService.searchResources({
        q: draftTerm,
      });
      expect(draftSearchResult.data).toHaveLength(0);

      // Search for publishedTerm: returns resource with v1 details
      const publishedSearchResult = await searchService.searchResources({
        q: publishedTerm,
      });
      expect(publishedSearchResult.data.length).toBeGreaterThanOrEqual(1);
      const matched = publishedSearchResult.data.find((r) => r.id === resource.id);
      expect(matched).toBeDefined();
      expect(matched?.publishedVersion.versionNumber).toBe(1);
      expect(matched?.publishedVersion.title).toContain(publishedTerm);
    });
  });

  describe('3. Relevance Ranking & FTS Document Matching', () => {
    it('ranks title matches higher than description matches and enforces deterministic id tiebreaker', async () => {
      const ftsKeyword = `Biofluorescence_${Date.now()}`;

      // Resource A: keyword in title (Weight A)
      const { resource: resourceA } = await createTestResource({
        title: `Advanced ${ftsKeyword} Handbook`,
        description: 'Standard laboratory manual for senior students',
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      // Resource B: keyword only in description (Weight B)
      const { resource: resourceB } = await createTestResource({
        title: 'Laboratory Apparatus Manual',
        description: `Complete guide featuring experiments on ${ftsKeyword} in marine organisms`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      const result = await searchService.searchResources({
        q: ftsKeyword,
      });

      expect(result.data.length).toBe(2);

      const firstItem = result.data[0];
      const secondItem = result.data[1];

      // Resource A must have higher searchScore than Resource B
      expect(firstItem.id).toBe(resourceA.id);
      expect(secondItem.id).toBe(resourceB.id);
      expect(firstItem.searchScore!).toBeGreaterThan(secondItem.searchScore!);
    });

    it('supports case-insensitivity, phrase matching, and negation in search queries', async () => {
      const baseTerm = `Electrochemistry_${Date.now()}`;
      const phraseTerm = `Voltaic Cell Analysis`;

      const { resource } = await createTestResource({
        title: `${baseTerm}: ${phraseTerm}`,
        description: 'Galvanic reactions without radioactive elements',
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      // Case-insensitivity: lowercase query
      const resLower = await searchService.searchResources({
        q: baseTerm.toLowerCase(),
      });
      expect(resLower.data.some((r) => r.id === resource.id)).toBe(true);

      // Case-insensitivity: uppercase query
      const resUpper = await searchService.searchResources({
        q: baseTerm.toUpperCase(),
      });
      expect(resUpper.data.some((r) => r.id === resource.id)).toBe(true);

      // Exact phrase match
      const resPhrase = await searchService.searchResources({
        q: `"${phraseTerm}"`,
      });
      expect(resPhrase.data.some((r) => r.id === resource.id)).toBe(true);

      // Negation: search baseTerm -radioactive should NOT match because description has radioactive
      const resNegated = await searchService.searchResources({
        q: `${baseTerm} -radioactive`,
      });
      expect(resNegated.data.some((r) => r.id === resource.id)).toBe(false);
    });

    it('matches taxonomy fields such as subject name and school name', async () => {
      const taxonomyUnique = `TaxoUnique_${Date.now()}`;
      const { resource } = await createTestResource({
        title: `Academic Paper ${taxonomyUnique}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
      });

      // Search using part of the school name: "Nairobi Academy"
      const resultSchool = await searchService.searchResources({
        q: `"${taxonomyUnique}" "Nairobi Academy"`,
      });
      expect(resultSchool.data.some((r) => r.id === resource.id)).toBe(true);

      // Search using part of the subject name: "Quantum Physics"
      const resultSubject = await searchService.searchResources({
        q: `"${taxonomyUnique}" "Quantum Physics"`,
      });
      expect(resultSubject.data.some((r) => r.id === resource.id)).toBe(true);
    });
  });

  describe('4. Structured AND-Combined Filtering', () => {
    it('applies structured filters in conjunction with text search query', async () => {
      const filterTerm = `PolymerChemistry_${Date.now()}`;

      // Resource 1: Kenya, PREMIUM, Grade 12
      const { resource: resKe } = await createTestResource({
        title: `Organic Polymers: ${filterTerm}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        countryId: kenyaId,
        qualityLabel: 'PREMIUM',
      });

      // Resource 2: Tanzania, STANDARD, Grade 12 (schoolId: null to respect school-country constraint)
      const { resource: resTz } = await createTestResource({
        title: `Synthetic Polymers: ${filterTerm}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        countryId: tanzaniaId,
        schoolId: null,
        qualityLabel: 'STANDARD',
      });

      // 1. Text search alone matches both
      const resAll = await searchService.searchResources({
        q: filterTerm,
      });
      expect(resAll.data).toHaveLength(2);

      // 2. Text search + country=KE matches only Resource 1
      const resCountry = await searchService.searchResources({
        q: filterTerm,
        country: 'ke',
      });
      expect(resCountry.data).toHaveLength(1);
      expect(resCountry.data[0].id).toBe(resKe.id);
      expect(resTz.id).toBeDefined();

      // 3. Text search + quality=PREMIUM matches only Resource 1
      const resQuality = await searchService.searchResources({
        q: filterTerm,
        quality: 'PREMIUM',
      });
      expect(resQuality.data).toHaveLength(1);
      expect(resQuality.data[0].id).toBe(resKe.id);

      // 4. Text search + incompatible filter returns 0 results
      const resNone = await searchService.searchResources({
        q: filterTerm,
        quality: 'VERIFIED',
      });
      expect(resNone.data).toHaveLength(0);
      expect(resNone.meta.total).toBe(0);
    });
  });

  describe('5. Metadata-Only Resources & Storage Presentation Sanitization', () => {
    it('discovers a metadata-only published resource with zero files attached', async () => {
      const metaTerm = `ZeroFilesMeta_${Date.now()}`;
      const { resource } = await createTestResource({
        title: `Curriculum Guide: ${metaTerm}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        files: [], // Zero files
      });

      const result = await searchService.searchResources({
        q: metaTerm,
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(resource.id);
      expect(result.data[0].fileCount).toBe(0);
      expect(result.data[0].primaryFile).toBeNull();
    });

    it('presents AVAILABLE files without leaking storage buckets, keys, or R2 credentials', async () => {
      const storageTerm = `StorageSanitize_${Date.now()}`;
      const { resource } = await createTestResource({
        title: `Encrypted Document Analysis: ${storageTerm}`,
        resourceStatus: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        files: [
          { status: 'AVAILABLE', isPrimary: true, filename: 'public_exam.pdf' },
          { status: 'QUARANTINED', isPrimary: false, filename: 'quarantine.pdf' },
        ],
      });

      const result = await searchService.searchResources({
        q: storageTerm,
      });

      expect(result.data.length).toBe(1);
      const item = result.data[0];
      expect(item.id).toBe(resource.id);

      // Only AVAILABLE file is presented; QUARANTINED is excluded
      expect(item.fileCount).toBe(1);
      expect(item.primaryFile).toBeDefined();
      expect(item.primaryFile?.originalFilename).toBe('public_exam.pdf');

      // Security Invariant: Zero storage secrets in serialized JSON
      const jsonOutput = JSON.stringify(item);
      expect(jsonOutput).not.toContain('secret-r2-bucket');
      expect(jsonOutput).not.toContain('internal/keys');
      expect(jsonOutput).not.toContain('R2');
      expect(jsonOutput).not.toContain('storageProvider');
      expect(jsonOutput).not.toContain('storageBucket');
      expect(jsonOutput).not.toContain('objectKey');
      expect(jsonOutput).not.toContain('quarantine.pdf');
    });
  });

  describe('6. Deterministic Sorting & Pagination', () => {
    it('supports stable pagination with page, pageSize, total, and hasMore', async () => {
      const paginationPrefix = `PageBatch_${Date.now()}`;

      // Create 5 published resources with identical title terms
      for (let i = 1; i <= 5; i++) {
        await createTestResource({
          title: `${paginationPrefix} Volume ${i}`,
          resourceStatus: 'PUBLISHED',
          versionStatus: 'PUBLISHED',
        });
      }

      // Page 1: pageSize 2
      const page1 = await searchService.searchResources({
        q: paginationPrefix,
        page: 1,
        pageSize: 2,
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.meta.page).toBe(1);
      expect(page1.meta.pageSize).toBe(2);
      expect(page1.meta.total).toBe(5);
      expect(page1.meta.hasMore).toBe(true);

      // Page 2: pageSize 2
      const page2 = await searchService.searchResources({
        q: paginationPrefix,
        page: 2,
        pageSize: 2,
      });

      expect(page2.data).toHaveLength(2);
      expect(page2.meta.page).toBe(2);
      expect(page2.meta.hasMore).toBe(true);

      // Confirm non-overlapping items between page 1 and page 2
      const page1Ids = page1.data.map((r) => r.id);
      const page2Ids = page2.data.map((r) => r.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }

      // Page 3: pageSize 2 -> 1 item remaining, hasMore: false
      const page3 = await searchService.searchResources({
        q: paginationPrefix,
        page: 3,
        pageSize: 2,
      });

      expect(page3.data).toHaveLength(1);
      expect(page3.meta.page).toBe(3);
      expect(page3.meta.hasMore).toBe(false);
    });
  });
});
