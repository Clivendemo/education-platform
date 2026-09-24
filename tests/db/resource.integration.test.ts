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
} from '../../src/db/schemas.js';
import { DbResourceService } from '../../src/services/resource.service.js';

describe('Resource Engine Database Integration Tests', () => {
  let kenyaId: string;
  let tanzaniaId: string;
  let pastPaperTypeId: string;
  let notesTypeId: string;
  let schoolId: string;
  let curriculumId: string;
  let curriculumVersionId: string;
  let educationLevelId: string;
  let gradeId: string;
  let pathwayId: string;
  let subjectId: string;
  let topicId: string;

  const createdSchoolIds: string[] = [];
  const createdResourceIds: string[] = [];
  const createdCurriculaIds: string[] = [];
  const createdTypeIds: string[] = [];

  const resourceService = new DbResourceService(db);

  beforeAll(async () => {
    // 1. Setup Kenya & Tanzania
    const existingKenya = await db
      .select()
      .from(countries)
      .where(eq(countries.isoCode, 'KE'))
      .limit(1);

    if (existingKenya.length > 0) {
      kenyaId = existingKenya[0].id;
    } else {
      const [inserted] = await db
        .insert(countries)
        .values({
          name: 'Kenya',
          isoCode: 'KE',
          urlPrefix: 'ke',
        })
        .returning();
      kenyaId = inserted.id;
    }

    const existingTz = await db
      .select()
      .from(countries)
      .where(eq(countries.isoCode, 'TZ'))
      .limit(1);

    if (existingTz.length > 0) {
      tanzaniaId = existingTz[0].id;
    } else {
      const [insertedTz] = await db
        .insert(countries)
        .values({
          name: 'Tanzania',
          isoCode: 'TZ',
          urlPrefix: 'tz',
        })
        .returning();
      tanzaniaId = insertedTz.id;
    }

    // 2. Setup Resource Types
    const [type1] = await db
      .insert(resourceTypes)
      .values({
        code: `TEST_TYPE_${Date.now()}_1`,
        name: 'Test Examination Paper',
        slug: `test-exam-${Date.now()}`,
        pillar: 'PAST_PAPERS',
        description: 'Testing examination type',
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    pastPaperTypeId = type1.id;
    createdTypeIds.push(type1.id);

    const [type2] = await db
      .insert(resourceTypes)
      .values({
        code: `TEST_TYPE_${Date.now()}_2`,
        name: 'Test Revision Notes',
        slug: `test-notes-${Date.now()}`,
        pillar: 'NOTES_REVISION',
        description: 'Testing notes type',
        sequenceOrder: 2,
        status: 'ACTIVE',
      })
      .returning();
    notesTypeId = type2.id;
    createdTypeIds.push(type2.id);

    // 3. Setup a School in Kenya
    const [sc] = await db
      .insert(schools)
      .values({
        countryId: kenyaId,
        name: `Test Academy ${Date.now()}`,
        code: `TAC-${Date.now()}`,
        schoolType: 'SECONDARY',
        status: 'ACTIVE',
      })
      .returning();
    schoolId = sc.id;
    createdSchoolIds.push(sc.id);

    // 4. Setup Curriculum Hierarchy
    const [cur] = await db
      .insert(curricula)
      .values({
        countryId: kenyaId,
        name: `Curriculum ${Date.now()}`,
        slug: `curr-${Date.now()}`,
        status: 'ACTIVE',
      })
      .returning();
    curriculumId = cur.id;
    createdCurriculaIds.push(cur.id);

    const [ver] = await db
      .insert(curriculumVersions)
      .values({
        curriculumId,
        countryId: kenyaId,
        versionName: 'Version 2024',
        slug: `ver-2024-${Date.now()}`,
        status: 'CURRENT',
      })
      .returning();
    curriculumVersionId = ver.id;

    const [lvl] = await db
      .insert(educationLevels)
      .values({
        curriculumVersionId,
        name: 'Senior Level',
        slug: `senior-${Date.now()}`,
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    educationLevelId = lvl.id;

    const [grd] = await db
      .insert(grades)
      .values({
        curriculumVersionId,
        educationLevelId,
        name: 'Grade 10',
        slug: `g10-${Date.now()}`,
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    gradeId = grd.id;

    const [pth] = await db
      .insert(pathways)
      .values({
        curriculumVersionId,
        educationLevelId,
        gradeId,
        name: 'STEM',
        slug: `stem-${Date.now()}`,
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    pathwayId = pth.id;

    const [sbj] = await db
      .insert(subjects)
      .values({
        curriculumVersionId,
        educationLevelId,
        gradeId,
        pathwayId,
        name: 'Mathematics',
        slug: `math-${Date.now()}`,
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    subjectId = sbj.id;

    const [tpc] = await db
      .insert(topics)
      .values({
        curriculumVersionId,
        subjectId,
        name: 'Calculus',
        slug: `calc-${Date.now()}`,
        sequenceOrder: 1,
        status: 'ACTIVE',
      })
      .returning();
    topicId = tpc.id;
  });

  afterAll(async () => {
    try {
      // Clean up created resources & versions in batch
      if (createdResourceIds.length > 0) {
        await db
          .delete(resourceVersions)
          .where(inArray(resourceVersions.resourceId, createdResourceIds));
        await db
          .delete(resources)
          .where(inArray(resources.id, createdResourceIds));
      }
      // Clean up schools created during test
      if (createdSchoolIds.length > 0) {
        await db
          .delete(schools)
          .where(inArray(schools.id, createdSchoolIds));
      }
      // Clean up created curriculum hierarchy
      if (topicId) await db.delete(topics).where(eq(topics.id, topicId));
      if (subjectId) await db.delete(subjects).where(eq(subjects.id, subjectId));
      if (pathwayId) await db.delete(pathways).where(eq(pathways.id, pathwayId));
      if (gradeId) await db.delete(grades).where(eq(grades.id, gradeId));
      if (educationLevelId) await db.delete(educationLevels).where(eq(educationLevels.id, educationLevelId));
      if (curriculumVersionId) await db.delete(curriculumVersions).where(eq(curriculumVersions.id, curriculumVersionId));
      if (createdCurriculaIds.length > 0) {
        await db.delete(curricula).where(inArray(curricula.id, createdCurriculaIds));
      }
      // Clean up created resource types
      if (createdTypeIds.length > 0) {
        await db.delete(resourceTypes).where(inArray(resourceTypes.id, createdTypeIds));
      }
    } finally {
      await closeDatabase();
    }
  }, 60000);

  describe('1. Valid Resource Creation & Hierarchical Linking', () => {
    it('creates a general resource without curriculum relationship', async () => {
      const uniqueSlug = `gen-res-${Date.now()}`;
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] General School Calendar Notice',
          slug: uniqueSlug,
          description: 'Non-curriculum notice',
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning();
      createdResourceIds.push(res.id);

      expect(res.id).toBeDefined();
      expect(res.curriculumId).toBeNull();
      expect(res.subjectId).toBeNull();

      const fetched = await resourceService.getResourceById(res.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.title).toBe('[STRUCTURAL-TEST] General School Calendar Notice');
      expect(fetched?.country.isoCode).toBe('KE');
    });

    it('creates a fully curriculum-linked resource down to topic', async () => {
      const uniqueSlug = `cur-res-${Date.now()}`;
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: notesTypeId,
          schoolId,
          curriculumId,
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          subjectId,
          topicId,
          title: '[STRUCTURAL-TEST] Grade 10 Calculus Revision Summary',
          slug: uniqueSlug,
          status: 'PUBLISHED',
          qualityLabel: 'VERIFIED',
          academicYear: 2025,
          term: 2,
        })
        .returning();
      createdResourceIds.push(res.id);

      expect(res.id).toBeDefined();
      expect(res.topicId).toBe(topicId);
      expect(res.schoolId).toBe(schoolId);
      expect(res.academicYear).toBe(2025);
      expect(res.term).toBe(2);

      const fetched = await resourceService.getResourceById(res.id);
      expect(fetched?.curriculum.gradeId).toBe(gradeId);
      expect(fetched?.curriculum.topicId).toBe(topicId);
      expect(fetched?.qualityLabel).toBe('VERIFIED');
    });

    it('creates multiple versions on a resource with version ordering', async () => {
      const uniqueSlug = `ver-res-${Date.now()}`;
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Multi-Version Mock Exam',
          slug: uniqueSlug,
          status: 'PUBLISHED',
        })
        .returning();
      createdResourceIds.push(res.id);

      // Insert version 1 (PUBLISHED)
      const [v1] = await db
        .insert(resourceVersions)
        .values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Mock Exam v1',
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
          publishedAt: new Date(),
        })
        .returning();

      // Insert version 2 (IN_REVIEW)
      const [v2] = await db
        .insert(resourceVersions)
        .values({
          resourceId: res.id,
          versionNumber: 2,
          versionLabel: 'v2.0',
          title: 'Mock Exam v2 (Corrected)',
          changeSummary: 'Fixed question 4 typos',
          status: 'IN_REVIEW',
          qualityLabel: 'VERIFIED',
        })
        .returning();

      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);

      const versions = await resourceService.listResourceVersions(res.id, {
        includeUnpublished: true,
      });
      expect(versions).toHaveLength(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
      expect(versions[1].changeSummary).toBe('Fixed question 4 typos');
    });
  });

  describe('2. Published Resource-Version Immutability & Version-Number Policy', () => {
    it('prohibits modifying a PUBLISHED resource version through the application service', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Immutable Version Resource',
          slug: `immut-ver-${Date.now()}`,
          status: 'PUBLISHED',
        })
        .returning();
      createdResourceIds.push(res.id);

      // Create a published version via service
      const pubVersion = await resourceService.createResourceVersion({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0',
        title: 'Original Published Document',
        status: 'PUBLISHED',
      });

      // Modifying the published version via the application service MUST fail
      await expect(
        resourceService.updateResourceVersion(pubVersion.id, {
          title: 'Tampered Title Attempt',
        }),
      ).rejects.toThrow(/Published resource versions are immutable/i);
    });

    it('prohibits modifying a PUBLISHED resource version through direct database updates (trigger defense)', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] DB Trigger Immutability Resource',
          slug: `db-immut-${Date.now()}`,
          status: 'PUBLISHED',
        })
        .returning();
      createdResourceIds.push(res.id);

      const [pubVersion] = await db
        .insert(resourceVersions)
        .values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Official Final Exam',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning();

      // Direct SQL update on a PUBLISHED version must be rejected by the trigger
      let threwTriggerError = false;
      try {
        await db
          .update(resourceVersions)
          .set({ title: 'Modified Official Exam' })
          .where(eq(resourceVersions.id, pubVersion.id));
      } catch (err: any) {
        threwTriggerError = true;
        expect(err.cause?.message || err.message).toMatch(
          /Published resource versions are immutable/i,
        );
      }
      expect(threwTriggerError).toBe(true);
    });

    it('allows modifying an unpublished (DRAFT) version through the application service', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Draft Editable Resource',
          slug: `draft-edit-${Date.now()}`,
          status: 'DRAFT',
        })
        .returning();
      createdResourceIds.push(res.id);

      const draftVersion = await resourceService.createResourceVersion({
        resourceId: res.id,
        title: 'Initial Draft',
        status: 'DRAFT',
      });

      const updated = await resourceService.updateResourceVersion(draftVersion.id, {
        title: 'Revised Draft Title',
        changeSummary: 'Updated draft content before publication',
      });

      expect(updated.title).toBe('Revised Draft Title');
      expect(updated.changeSummary).toBe('Updated draft content before publication');
    });

    it('enforces correction policy: corrections create a new version with higher version_number', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Version Correction Policy Test',
          slug: `corr-pol-${Date.now()}`,
          status: 'PUBLISHED',
        })
        .returning();
      createdResourceIds.push(res.id);

      // Version 1 (Published)
      const v1 = await resourceService.createResourceVersion({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0',
        title: 'Resource Version 1.0',
        status: 'PUBLISHED',
      });
      expect(v1.versionNumber).toBe(1);

      // Correction: instead of mutating v1, create a higher version (v2) in DRAFT
      const v2 = await resourceService.createResourceVersion({
        resourceId: res.id,
        versionNumber: 2,
        versionLabel: 'v2.0',
        title: 'Resource Version 2.0 (Errata Corrected)',
        changeSummary: 'Corrected errata in section 3',
        status: 'DRAFT',
      });
      expect(v2.versionNumber).toBe(2);
      expect(v2.versionNumber).toBeGreaterThan(v1.versionNumber);

      // Demonstrates non-gapless / flexible numbering: jumps (e.g. from 2 to 5) are accepted
      const v5 = await resourceService.createResourceVersion({
        resourceId: res.id,
        versionNumber: 5,
        versionLabel: 'v5.0 Major Overhaul',
        title: 'Resource Version 5.0',
        status: 'IN_REVIEW',
      });
      expect(v5.versionNumber).toBe(5);
    });
  });

  describe('3. Database Integrity Constraints & Rejections', () => {
    it('enforces composite foreign key fk_resources_school_country: rejects cross-country school assignment', async () => {
      // Create Tanzania school
      const [tzSchool] = await db
        .insert(schools)
        .values({
          countryId: tanzaniaId,
          name: `TZ School ${Date.now()}`,
          schoolType: 'SECONDARY',
        })
        .returning();
      createdSchoolIds.push(tzSchool.id);

      // Attempting to assign Tanzania school to Kenya resource violates composite FK (school_id, country_id)
      await expect(
        db.insert(resources).values({
          countryId: kenyaId, // Kenya resource
          resourceTypeId: pastPaperTypeId,
          schoolId: tzSchool.id, // Tanzania school
          title: '[STRUCTURAL-TEST] Cross School Composite FK Mismatch',
          slug: `cross-sch-${Date.now()}`,
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate version number for the same resource', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Duplicate Version Test',
          slug: `dup-ver-${Date.now()}`,
        })
        .returning();
      createdResourceIds.push(res.id);

      await db.insert(resourceVersions).values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0',
        title: 'Initial',
      });

      await expect(
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 1,
          versionLabel: 'v1.0-duplicate',
          title: 'Duplicate version 1',
        }),
      ).rejects.toThrow();
    });

    it('rejects version number <= 0', async () => {
      const [res] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Zero Version Test',
          slug: `zero-ver-${Date.now()}`,
        })
        .returning();
      createdResourceIds.push(res.id);

      await expect(
        db.insert(resourceVersions).values({
          resourceId: res.id,
          versionNumber: 0,
          versionLabel: 'v0.0',
          title: 'Zero Version',
        }),
      ).rejects.toThrow();
    });

    it('rejects parent-dependency violation: topic provided without subject', async () => {
      await expect(
        db.insert(resources).values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Orphan Topic Resource',
          slug: `orphan-topic-${Date.now()}`,
          topicId, // Provided
          subjectId: null, // Missing!
        }),
      ).rejects.toThrow();
    });

    it('rejects parent-dependency violation: subject provided without grade', async () => {
      await expect(
        db.insert(resources).values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Orphan Subject Resource',
          slug: `orphan-subject-${Date.now()}`,
          subjectId, // Provided
          gradeId: null, // Missing!
        }),
      ).rejects.toThrow();
    });

    it('rejects cross-country curriculum relationship: Kenya resource with Tanzania curriculum', async () => {
      // Create Tanzania curriculum
      const [tzCur] = await db
        .insert(curricula)
        .values({
          countryId: tanzaniaId,
          name: `TZ Curriculum ${Date.now()}`,
          slug: `tz-curr-${Date.now()}`,
        })
        .returning();
      createdCurriculaIds.push(tzCur.id);

      await expect(
        db.insert(resources).values({
          countryId: kenyaId, // Kenya resource
          resourceTypeId: pastPaperTypeId,
          curriculumId: tzCur.id, // Tanzania curriculum
          title: '[STRUCTURAL-TEST] Cross Country Mismatch',
          slug: `cross-cur-${Date.now()}`,
        }),
      ).rejects.toThrow();
    });

    it('enforces RESTRICT on deleting a school referenced by a resource', async () => {
      const [tempSchool] = await db
        .insert(schools)
        .values({
          countryId: kenyaId,
          name: `Deletable School ${Date.now()}`,
          schoolType: 'PRIMARY',
        })
        .returning();
      createdSchoolIds.push(tempSchool.id);

      const [depRes] = await db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          schoolId: tempSchool.id,
          title: '[STRUCTURAL-TEST] School Dependent Resource',
          slug: `dep-sch-${Date.now()}`,
        })
        .returning();
      createdResourceIds.push(depRes.id);

      // Attempting to delete the school must fail due to RESTRICT
      await expect(
        db.delete(schools).where(eq(schools.id, tempSchool.id)),
      ).rejects.toThrow();
    });

    it('rejects invalid resource status and invalid quality label', async () => {
      // Invalid status
      await expect(
        db.insert(resources).values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Invalid Status',
          slug: `inv-status-${Date.now()}`,
          status: 'UNAPPROVED' as any,
        }),
      ).rejects.toThrow();

      // Invalid quality label
      await expect(
        db.insert(resources).values({
          countryId: kenyaId,
          resourceTypeId: pastPaperTypeId,
          title: '[STRUCTURAL-TEST] Invalid Quality',
          slug: `inv-qual-${Date.now()}`,
          qualityLabel: 'FIVE_STARS' as any,
        }),
      ).rejects.toThrow();
    });
  });
});
