import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
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
} from '../../src/db/schemas.js';
import { DefaultSeoService } from '../../src/services/seo.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Resource SEO Service Neon Database Integration Tests', () => {
  let kenyaId: string;
  let pastPaperTypeId: string;
  let curriculumId: string;
  let curriculumVersionId: string;
  let educationLevelId: string;
  let gradeId: string;
  let pathwayId: string;
  let subjectId: string;
  let topicId: string;

  const createdResourceIds: string[] = [];
  const createdCurriculaIds: string[] = [];
  const createdTypeIds: string[] = [];

  const seoService = new DefaultSeoService(
    db,
    'https://test-platform.example.com',
    'Custom Educational Platform',
  );

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

    // 2. Setup Resource Type
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

    // 3. Setup Curriculum Hierarchy
    const [c] = await withDbRetry(async () =>
      db
        .insert(curricula)
        .values({
          countryId: kenyaId,
          code: `SEO_CURR_${Date.now()}`,
          name: 'Competency-Based Curriculum',
          slug: `seo-curr-${Date.now()}`,
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
          versionName: 'CBC 2026 Edition',
          versionCode: `CBC_2026_${Date.now()}`,
          slug: `cbc-2026-${Date.now()}`,
          status: 'CURRENT',
        })
        .returning(),
    );
    curriculumVersionId = cv.id;

    const [lvl] = await withDbRetry(async () =>
      db
        .insert(educationLevels)
        .values({
          curriculumVersionId,
          code: `SEO_SS_${Date.now()}`,
          name: 'Senior School',
          slug: `senior-seo-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    educationLevelId = lvl.id;

    const [g] = await withDbRetry(async () =>
      db
        .insert(grades)
        .values({
          curriculumVersionId,
          educationLevelId,
          code: `SEO_G10_${Date.now()}`,
          name: 'Grade 10',
          slug: `g10-seo-${Date.now()}`,
          sequenceOrder: 1,
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
          code: `SEO_STEM_${Date.now()}`,
          name: 'STEM',
          slug: `stem-seo-${Date.now()}`,
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
          code: `SEO_MATH_${Date.now()}`,
          name: 'Mathematics',
          slug: `math-seo-${Date.now()}`,
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
          code: `SEO_CALC_${Date.now()}`,
          name: 'Calculus',
          slug: `calc-seo-${Date.now()}`,
          sequenceOrder: 1,
          status: 'ACTIVE',
        })
        .returning(),
    );
    topicId = t.id;
  }, 60000);

  afterAll(async () => {
    try {
      if (createdResourceIds.length > 0) {
        await withDbRetry(async () => {
          await db
            .delete(resourceVersions)
            .where(inArray(resourceVersions.resourceId, createdResourceIds));
          await db.delete(resources).where(inArray(resources.id, createdResourceIds));
        });
      }

      if (createdCurriculaIds.length > 0) {
        await withDbRetry(async () => {
          await db.delete(topics).where(eq(topics.subjectId, subjectId));
          await db.delete(subjects).where(eq(subjects.id, subjectId));
          await db.delete(pathways).where(eq(pathways.id, pathwayId));
          await db.delete(grades).where(eq(grades.id, gradeId));
          await db.delete(educationLevels).where(eq(educationLevels.id, educationLevelId));
          await db.delete(curriculumVersions).where(eq(curriculumVersions.id, curriculumVersionId));
          await db.delete(curricula).where(inArray(curricula.id, createdCurriculaIds));
        });
      }

      if (createdTypeIds.length > 0) {
        await withDbRetry(async () => {
          await db.delete(resourceTypes).where(inArray(resourceTypes.id, createdTypeIds));
        });
      }
    } finally {
      await closeDatabase();
    }
  });

  it('returns valid SEO metadata for a PUBLISHED resource with a PUBLISHED version', async () => {
    const timestamp = Date.now();
    const slug = `seo-test-math-pub-${timestamp}`;

    const [res] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          curriculumId,
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          subjectId,
          topicId,
          title: 'Grade 10 Mathematics Term 1 Examination 2026',
          slug,
          description: 'Official CBC Term 1 Examination for Grade 10 Mathematics with Marking Scheme.',
          status: 'PUBLISHED',
          qualityLabel: 'VERIFIED',
          academicYear: 2026,
          term: 1,
        })
        .returning(),
    );
    createdResourceIds.push(res.id);

    await withDbRetry(async () =>
      db.insert(resourceVersions).values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: 'Grade 10 Mathematics Term 1 Examination 2026 (Final)',
        description: 'Official CBC Term 1 Examination for Grade 10 Mathematics with Marking Scheme.',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }),
    );

    const seoData = await seoService.getResourceSeoMetadata(res.id);

    expect(seoData).not.toBeNull();
    expect(seoData?.id).toBe(res.id);
    expect(seoData?.slug).toBe(slug);
    expect(seoData?.title).toBe('Grade 10 Mathematics Term 1 Examination 2026 (Final)');
    expect(seoData?.canonicalUrl).toBe(
      `https://test-platform.example.com/ke/resources/${slug}`,
    );
    expect(seoData?.openGraph.url).toBe(
      `https://test-platform.example.com/ke/resources/${slug}`,
    );
    expect(seoData?.openGraph.type).toBe('article');
    expect(seoData?.openGraph.siteName).toBe('Custom Educational Platform');
    expect(seoData?.openGraph.locale).toBe('en_KE');
    expect(seoData?.twitter.card).toBe('summary');
    expect(seoData?.robots).toEqual({ index: true, follow: true });
  });

  it('strictly hides SEO metadata for unpublished resource lifecycle statuses', async () => {
    const unpublishedStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;

    for (const st of unpublishedStatuses) {
      const slug = `seo-test-${st.toLowerCase()}-${Date.now()}`;
      const [res] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId: pastPaperTypeId,
            title: `Resource in ${st}`,
            slug,
            description: `Testing ${st} status boundary`,
            status: st,
          })
          .returning(),
      );
      createdResourceIds.push(res.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: `Resource in ${st}`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        }),
      );

      const seoData = await seoService.getResourceSeoMetadata(res.id);
      expect(seoData).toBeNull();
    }
  });

  it('hides SEO metadata if resource is PUBLISHED but its version is DRAFT', async () => {
    const slug = `seo-test-draft-version-${Date.now()}`;
    const [res] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: 'Published Resource with Draft Version',
          slug,
          description: 'Testing version boundary',
          status: 'PUBLISHED',
        })
        .returning(),
    );
    createdResourceIds.push(res.id);

    await withDbRetry(async () =>
      db.insert(resourceVersions).values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: 'Draft Version',
        status: 'DRAFT',
      }),
    );

    const seoData = await seoService.getResourceSeoMetadata(res.id);
    expect(seoData).toBeNull();
  });

  it('generates a deterministic fallback description when resource and version have null description', async () => {
    const timestamp = Date.now();
    const slug = `seo-test-fallback-desc-${timestamp}`;

    const [res] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          curriculumId,
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          subjectId,
          topicId,
          title: 'Grade 10 Calculus Practice Test',
          slug,
          description: null,
          status: 'PUBLISHED',
        })
        .returning(),
    );
    createdResourceIds.push(res.id);

    await withDbRetry(async () =>
      db.insert(resourceVersions).values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: 'Grade 10 Calculus Practice Test',
        description: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }),
    );

    const seoData = await seoService.getResourceSeoMetadata(res.id);

    expect(seoData).not.toBeNull();
    expect(seoData?.description).toContain('Grade 10 Calculus Practice Test');
    expect(seoData?.description).toContain('Past Papers & Examinations');
    expect(seoData?.description).toContain('Kenya');
    expect(seoData?.openGraph.description).toBe(seoData?.description);
    expect(seoData?.twitter.description).toBe(seoData?.description);
  });
});
