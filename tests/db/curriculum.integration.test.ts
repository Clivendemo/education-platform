import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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
} from '../../src/db/schemas.js';
import { seedKenyaGeography } from '../../src/db/seeds/kenya-geography.js';
import { seedKenyaCurriculum } from '../../src/db/seeds/kenya-curriculum.js';
import { DbCurriculumService } from '../../src/services/curriculum.service.js';

const isDbAvailable = Boolean(
  process.env.DATABASE_TEST_URL || process.env.DATABASE_URL,
);

describe.skipIf(!isDbAvailable)('Curriculum Database Integration Tests', () => {
  const service = new DbCurriculumService(db);
  let kenyaCountryId: string;
  let seededData: Awaited<ReturnType<typeof seedKenyaCurriculum>>;

  // Track created test IDs for isolated cleanup
  const createdTopicIds: string[] = [];
  const createdSubjectIds: string[] = [];
  const createdPathwayIds: string[] = [];
  const createdGradeIds: string[] = [];
  const createdLevelIds: string[] = [];
  const createdVersionIds: string[] = [];
  const createdCurriculumIds: string[] = [];
  const createdCountryIds: string[] = [];

  beforeAll(async () => {
    // 1. Ensure Kenya country exists
    await seedKenyaGeography();
    const kenya = (
      await db
        .select()
        .from(countries)
        .where(eq(countries.isoCode, 'KE'))
        .limit(1)
    )[0];
    kenyaCountryId = kenya.id;

    // 2. Seed Kenya curriculum foundation
    seededData = await seedKenyaCurriculum(db);
  });

  afterAll(async () => {
    // Clean up any test records in reverse hierarchy order
    if (createdTopicIds.length > 0) {
      await db.delete(topics).where(sql`${topics.id} IN ${createdTopicIds}`);
    }
    if (createdSubjectIds.length > 0) {
      await db.delete(subjects).where(sql`${subjects.id} IN ${createdSubjectIds}`);
    }
    if (createdPathwayIds.length > 0) {
      await db.delete(pathways).where(sql`${pathways.id} IN ${createdPathwayIds}`);
    }
    if (createdGradeIds.length > 0) {
      await db.delete(grades).where(sql`${grades.id} IN ${createdGradeIds}`);
    }
    if (createdLevelIds.length > 0) {
      await db.delete(educationLevels).where(sql`${educationLevels.id} IN ${createdLevelIds}`);
    }
    if (createdVersionIds.length > 0) {
      await db.delete(curriculumVersions).where(sql`${curriculumVersions.id} IN ${createdVersionIds}`);
    }
    if (createdCurriculumIds.length > 0) {
      await db.delete(curricula).where(sql`${curricula.id} IN ${createdCurriculumIds}`);
    }
    if (createdCountryIds.length > 0) {
      await db.delete(countries).where(sql`${countries.id} IN ${createdCountryIds}`);
    }

    await closeDatabase();
  });

  describe('1. Valid Curriculum Hierarchy and Retrieval', () => {
    it('creates a custom curriculum and retrieves it via service', async () => {
      const [customCurriculum] = await db
        .insert(curricula)
        .values({
          countryId: kenyaCountryId,
          name: 'Technical and Vocational Education',
          slug: 'tvet-curriculum',
          code: 'TVET',
          status: 'ACTIVE',
        })
        .returning();
      createdCurriculumIds.push(customCurriculum.id);

      const fetched = await service.getCurriculumById(customCurriculum.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Technical and Vocational Education');
      expect(fetched?.slug).toBe('tvet-curriculum');
      expect(fetched?.country.isoCode).toBe('KE');
    });

    it('creates a curriculum version with status and date tracking', async () => {
      const [customVersion] = await db
        .insert(curriculumVersions)
        .values({
          curriculumId: seededData.curriculumId,
          countryId: kenyaCountryId,
          versionName: 'CBC 2026 Revised',
          versionCode: 'CBC-2026',
          slug: 'cbc-2026-revised',
          effectiveFrom: '2026-01-01',
          status: 'PLANNED',
        })
        .returning();
      createdVersionIds.push(customVersion.id);

      const fetched = await service.getCurriculumVersionById(customVersion.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.versionName).toBe('CBC 2026 Revised');
      expect(fetched?.status).toBe('PLANNED');
      expect(fetched?.effectiveFrom).toBe('2026-01-01');
    });

    it('creates education levels with deterministic sequence ordering', async () => {
      const levels = await service.listEducationLevels(
        seededData.curriculumVersionId,
      );
      expect(levels.length).toBeGreaterThanOrEqual(4);

      // Verify strictly ascending sequence_order
      for (let i = 0; i < levels.length - 1; i++) {
        expect(levels[i].sequenceOrder).toBeLessThan(levels[i + 1].sequenceOrder);
      }

      const prePrimary = levels.find((l) => l.slug === 'pre-primary');
      const seniorSchool = levels.find((l) => l.slug === 'senior-school');
      expect(prePrimary?.sequenceOrder).toBe(1);
      expect(seniorSchool?.sequenceOrder).toBe(4);
    });

    it('creates grades under education levels with sequence ordering', async () => {
      const seniorSchoolId = seededData.educationLevels['senior-school'];
      const gradesList = await service.listGrades(seniorSchoolId);
      expect(gradesList.length).toBeGreaterThanOrEqual(1);

      const grade10 = gradesList.find((g) => g.slug === 'grade-10');
      expect(grade10).toBeDefined();
      expect(grade10?.sequenceOrder).toBe(10);
    });

    it('demonstrates optional pathway creation (grades with and without pathways)', async () => {
      // Grade 10 has pathways
      const pathwaysList = await service.listPathways(
        seededData.grades.grade10,
      );
      expect(pathwaysList.length).toBe(3);
      expect(pathwaysList.map((p) => p.slug)).toEqual(
        expect.arrayContaining(['stem', 'social-sciences', 'arts-sports']),
      );

      // Grade 1 has no pathways
      const grade1Pathways = await service.listPathways(
        seededData.grades.grade1,
      );
      expect(grade1Pathways).toHaveLength(0);
    });

    it('creates subjects under a pathway as well as direct grade subjects without pathway', async () => {
      // Grade 10 subject with pathway
      const stemSubjects = await service.listSubjects({
        pathwayId: seededData.pathways['stem'],
      });
      expect(stemSubjects.length).toBeGreaterThanOrEqual(1);
      const math = stemSubjects.find((s) => s.slug === 'advanced-mathematics');
      expect(math?.pathwayId).toBe(seededData.pathways['stem']);

      // Grade 1 subject without pathway
      const grade1Subjects = await service.listSubjects({
        gradeId: seededData.grades.grade1,
      });
      expect(grade1Subjects.length).toBeGreaterThanOrEqual(1);
      const g1Math = grade1Subjects.find(
        (s) => s.slug === 'mathematical-activities',
      );
      expect(g1Math?.pathwayId).toBeNull();
    });

    it('creates hierarchical topic and sub-topic structures', async () => {
      const mathSubjectId = seededData.subjects.grade10Math;

      // Top level topics (parentId is null)
      const topTopics = await service.listTopics(mathSubjectId, {
        parentId: null,
      });
      expect(topTopics.some((t) => t.slug === 'algebra')).toBe(true);

      const algebra = topTopics.find((t) => t.slug === 'algebra')!;
      expect(algebra.parentId).toBeNull();

      // Sub-topics under algebra
      const subTopics = await service.listTopics(mathSubjectId, {
        parentId: algebra.id,
      });
      expect(
        subTopics.some((t) => t.slug === 'linear-inequalities'),
      ).toBe(true);
      const ineq = subTopics.find((t) => t.slug === 'linear-inequalities')!;
      expect(ineq.parentId).toBe(algebra.id);
    });

    it('filters inactive and historical records by default in public queries', async () => {
      // Create an inactive version
      const [inactiveVersion] = await db
        .insert(curriculumVersions)
        .values({
          curriculumId: seededData.curriculumId,
          countryId: kenyaCountryId,
          versionName: 'Deprecated CBC 2015',
          versionCode: 'CBC-2015',
          slug: 'cbc-2015-deprecated',
          status: 'INACTIVE',
        })
        .returning();
      createdVersionIds.push(inactiveVersion.id);

      // Default public query excludes INACTIVE
      const publicVersions = await service.listCurriculumVersions(
        seededData.curriculumId,
      );
      expect(
        publicVersions.some((v) => v.id === inactiveVersion.id),
      ).toBe(false);

      // Explicit query with includeInactive includes it
      const allVersions = await service.listCurriculumVersions(
        seededData.curriculumId,
        { includeInactive: true },
      );
      expect(
        allVersions.some((v) => v.id === inactiveVersion.id),
      ).toBe(true);
    });
  });

  describe('2. Database Rejection of Invalid Relationships & Integrity Constraints', () => {
    it('rejects curriculum creation with nonexistent country reference', async () => {
      const nonExistentCountryId = '00000000-0000-0000-0000-000000000099';
      await expect(
        db.insert(curricula).values({
          countryId: nonExistentCountryId,
          name: 'Invalid Country Curriculum',
          slug: 'invalid-country-curr',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects incompatible country relationships in curriculum versions', async () => {
      // Create a second test country (e.g. Uganda)
      const [uganda] = await db
        .insert(countries)
        .values({
          name: 'Uganda Test Country',
          isoCode: 'UG',
          urlPrefix: 'ug',
          defaultLanguageCode: 'en',
          currencyCode: 'UGX',
          status: 'ACTIVE',
        })
        .returning();
      createdCountryIds.push(uganda.id);

      // Attempt to link a curriculum version to Kenya's curriculum, but specify countryId = Uganda!
      // This MUST be rejected by composite foreign key fk_curriculum_versions_curriculum_country
      await expect(
        db.insert(curriculumVersions).values({
          curriculumId: seededData.curriculumId, // Kenya's CBC
          countryId: uganda.id, // Uganda
          versionName: 'Incompatible Country Version',
          slug: 'incompatible-country-ver',
          status: 'CURRENT',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid grade/education-level relationships across different curriculum versions', async () => {
      // Create a second curriculum version
      const [version2] = await db
        .insert(curriculumVersions)
        .values({
          curriculumId: seededData.curriculumId,
          countryId: kenyaCountryId,
          versionName: 'Version 2 Test',
          slug: 'version-2-test',
          status: 'PLANNED',
        })
        .returning();
      createdVersionIds.push(version2.id);

      // Attempt to insert a grade with version2, but referencing an education level from version1!
      // This MUST be rejected by fk_grades_level_version
      const version1LevelId = seededData.educationLevels['primary-school'];

      await expect(
        db.insert(grades).values({
          curriculumVersionId: version2.id, // Version 2
          educationLevelId: version1LevelId, // Education level belonging to Version 1!
          name: 'Mismatched Grade',
          slug: 'mismatched-grade',
          sequenceOrder: 1,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid pathway/grade relationships across different levels', async () => {
      // Attempt to link a pathway to Grade 10 (which belongs to Senior School),
      // but specify educationLevelId = Primary School!
      // This MUST be rejected by fk_pathways_grade_level
      const primarySchoolLevelId = seededData.educationLevels['primary-school'];

      await expect(
        db.insert(pathways).values({
          curriculumVersionId: seededData.curriculumVersionId,
          educationLevelId: primarySchoolLevelId, // Primary School level
          gradeId: seededData.grades.grade10, // Grade 10 (Senior School!)
          name: 'Mismatched Pathway',
          slug: 'mismatched-pathway',
          sequenceOrder: 1,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid subject/pathway relationships where pathway belongs to another grade', async () => {
      // Attempt to assign the STEM pathway (which belongs to Grade 10) to a subject in Grade 1!
      // This MUST be rejected by fk_subjects_pathway_grade
      await expect(
        db.insert(subjects).values({
          curriculumVersionId: seededData.curriculumVersionId,
          educationLevelId: seededData.educationLevels['primary-school'],
          gradeId: seededData.grades.grade1, // Grade 1
          pathwayId: seededData.pathways['stem'], // STEM pathway belongs to Grade 10!
          name: 'Invalid Cross-Grade Subject',
          slug: 'invalid-subject',
          sequenceOrder: 1,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid topic/subject relationships where parent topic belongs to another subject', async () => {
      // Top topic is under Grade 10 Advanced Math
      const mathTopicId = seededData.topics.algebra;

      // Attempt to insert a topic under Grade 1 Math, but specifying parentId from Grade 10 Advanced Math!
      // This MUST be rejected by fk_topics_parent_subject
      await expect(
        db.insert(topics).values({
          curriculumVersionId: seededData.curriculumVersionId,
          subjectId: seededData.subjects.grade1Math, // Grade 1 Math
          parentId: mathTopicId, // Topic belonging to Grade 10 Math!
          name: 'Cross-Subject Subtopic',
          slug: 'cross-subject-subtopic',
          sequenceOrder: 1,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects self-parenting topic where id equals parent_id', async () => {
      const topicId = '11111111-2222-3333-4444-555555555555';
      await expect(
        db.insert(topics).values({
          id: topicId,
          curriculumVersionId: seededData.curriculumVersionId,
          subjectId: seededData.subjects.grade10Math,
          parentId: topicId, // Self-parenting!
          name: 'Self Parent Topic',
          slug: 'self-parent-topic',
          sequenceOrder: 99,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate scoped identifiers within the same parent scope', async () => {
      // Attempt to insert duplicate education level slug within the same curriculum version
      await expect(
        db.insert(educationLevels).values({
          curriculumVersionId: seededData.curriculumVersionId,
          name: 'Duplicate Senior School',
          slug: 'senior-school', // Already exists in CBC-2024!
          sequenceOrder: 99,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();

      // Attempt to insert duplicate sequenceOrder within the same curriculum version
      await expect(
        db.insert(educationLevels).values({
          curriculumVersionId: seededData.curriculumVersionId,
          name: 'Another Level With Seq 1',
          slug: 'another-level-seq-1',
          sequenceOrder: 1, // Pre-primary already has sequenceOrder 1!
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid sequence values where sequenceOrder <= 0', async () => {
      await expect(
        db.insert(educationLevels).values({
          curriculumVersionId: seededData.curriculumVersionId,
          name: 'Zero Sequence Level',
          slug: 'zero-seq-level',
          sequenceOrder: 0, // Must be > 0!
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('prevents deletion of curriculum version when child education levels exist (orphaned records prevention)', async () => {
      // Attempt to delete curriculum version while education levels reference it
      await expect(
        db
          .delete(curriculumVersions)
          .where(eq(curriculumVersions.id, seededData.curriculumVersionId)),
      ).rejects.toThrow();
    });
  });
});
