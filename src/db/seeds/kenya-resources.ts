import { eq } from 'drizzle-orm';
import { db as defaultDb, closeDatabase } from '../index.js';
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
} from '../schemas.js';

/**
 * Controlled 8 MVP Resource Pillars and Structural Types
 */
export const STRUCTURAL_RESOURCE_TYPES = [
  {
    code: 'PAST_PAPER',
    name: 'Past Papers & Examinations',
    slug: 'past-papers',
    pillar: 'PAST_PAPERS',
    description: 'Summative examinations, mock exams, and test papers',
    sequenceOrder: 1,
  },
  {
    code: 'LESSON_PLAN',
    name: 'Lesson Plans',
    slug: 'lesson-plans',
    pillar: 'LESSON_PLANS',
    description: 'Structured pedagogical lesson planning templates and guides',
    sequenceOrder: 2,
  },
  {
    code: 'SCHEME_OF_WORK',
    name: 'Schemes of Work',
    slug: 'schemes-of-work',
    pillar: 'SCHEMES_OF_WORK',
    description: 'Term-level syllabus execution plans and timetables',
    sequenceOrder: 3,
  },
  {
    code: 'NOTES_REVISION',
    name: 'Notes & Revision',
    slug: 'notes-revision',
    pillar: 'NOTES_REVISION',
    description: 'Comprehensive topic notes, summaries, and revision booklets',
    sequenceOrder: 4,
  },
  {
    code: 'SCHOOL_DOC',
    name: 'School Forms & Documents',
    slug: 'school-forms-documents',
    pillar: 'SCHOOL_DOCUMENTS',
    description: 'Administrative school templates, fee structures, and admission forms',
    sequenceOrder: 5,
  },
  {
    code: 'ACADEMIC_CALENDAR',
    name: 'Academic Calendar',
    slug: 'academic-calendar',
    pillar: 'ACADEMIC_CALENDAR',
    description: 'Term dates, holiday schedules, and official school calendars',
    sequenceOrder: 6,
  },
  {
    code: 'EDUCATION_UPDATE',
    name: 'Education Updates',
    slug: 'education-updates',
    pillar: 'EDUCATION_UPDATES',
    description: 'Policy announcements, syllabus circulars, and educational news',
    sequenceOrder: 7,
  },
  {
    code: 'TEACHER_RESOURCE',
    name: 'Teacher Resources',
    slug: 'teacher-resources',
    pillar: 'TEACHER_RESOURCES',
    description: 'Teacher professional development, rubrics, and assessment guides',
    sequenceOrder: 8,
  },
] as const;

/**
 * Seed controlled structural Resource Types and sample synthetic structural resources.
 * Execution is strictly idempotent.
 *
 * NOTE: All demo resources use explicit "[STRUCTURAL-TEST]" prefixes to indicate they
 * are synthetic test fixtures, NOT official ministry or school publications.
 */
export async function seedKenyaResources(dbInstance = defaultDb) {
  // 1. Ensure Kenya Country exists
  const existingKenya = await dbInstance
    .select()
    .from(countries)
    .where(eq(countries.isoCode, 'KE'))
    .limit(1);

  if (existingKenya.length === 0) {
    throw new Error('Kenya country record must be seeded before seeding resources.');
  }
  const kenya = existingKenya[0];

  // 2. Seed Controlled 8 Resource Types (Idempotent)
  const typeMap: Record<string, string> = {};
  for (const t of STRUCTURAL_RESOURCE_TYPES) {
    const existingType = await dbInstance
      .select()
      .from(resourceTypes)
      .where(eq(resourceTypes.code, t.code))
      .limit(1);

    if (existingType.length > 0) {
      typeMap[t.code] = existingType[0].id;
    } else {
      const [inserted] = await dbInstance
        .insert(resourceTypes)
        .values({
          code: t.code,
          name: t.name,
          slug: t.slug,
          pillar: t.pillar,
          description: t.description,
          sequenceOrder: t.sequenceOrder,
          status: 'ACTIVE',
        })
        .returning();
      typeMap[t.code] = inserted.id;
    }
  }

  // 3. Look up existing Curriculum entities for Kenya (seeded in Prompt 06)
  const existingCurriculum = await dbInstance
    .select()
    .from(curricula)
    .where(eq(curricula.countryId, kenya.id))
    .limit(1);

  let curriculumId: string | null = null;
  let curriculumVersionId: string | null = null;
  let educationLevelId: string | null = null;
  let gradeId: string | null = null;
  let pathwayId: string | null = null;
  let subjectId: string | null = null;
  let topicId: string | null = null;

  if (existingCurriculum.length > 0) {
    curriculumId = existingCurriculum[0].id;

    const versions = await dbInstance
      .select()
      .from(curriculumVersions)
      .where(eq(curriculumVersions.curriculumId, curriculumId))
      .limit(1);

    if (versions.length > 0) {
      curriculumVersionId = versions[0].id;

      // Find Senior School Level
      const levels = await dbInstance
        .select()
        .from(educationLevels)
        .where(eq(educationLevels.curriculumVersionId, curriculumVersionId));
      const seniorSchool = levels.find((l) => l.slug === 'senior-school') || levels[0];
      if (seniorSchool) {
        educationLevelId = seniorSchool.id;

        // Find Grade 10
        const allGrades = await dbInstance
          .select()
          .from(grades)
          .where(eq(grades.educationLevelId, educationLevelId));
        const grade10 = allGrades.find((g) => g.slug === 'grade-10') || allGrades[0];
        if (grade10) {
          gradeId = grade10.id;

          // Find STEM pathway
          const allPathways = await dbInstance
            .select()
            .from(pathways)
            .where(eq(pathways.gradeId, gradeId));
          const stemPathway = allPathways.find((p) => p.slug === 'stem') || allPathways[0];
          if (stemPathway) {
            pathwayId = stemPathway.id;
          }

          // Find Advanced Math Subject
          const allSubjects = await dbInstance
            .select()
            .from(subjects)
            .where(eq(subjects.gradeId, gradeId));
          const advMath = allSubjects.find((s) => s.slug === 'advanced-mathematics') || allSubjects[0];
          if (advMath) {
            subjectId = advMath.id;

            // Find Topic
            const allTopics = await dbInstance
              .select()
              .from(topics)
              .where(eq(topics.subjectId, subjectId));
            const algebraTopic = allTopics.find((tp) => tp.slug === 'algebra') || allTopics[0];
            if (algebraTopic) {
              topicId = algebraTopic.id;
            }
          }
        }
      }
    }
  }

  // 4. Seed Synthetic Resource 1: General Resource (No Curriculum Hierarchy)
  // Example: Generic Academic Calendar
  const generalSlug = 'test-generic-academic-calendar-2026';
  let generalResource = await dbInstance
    .select()
    .from(resources)
    .where(eq(resources.slug, generalSlug))
    .limit(1);

  let generalResourceId: string;
  if (generalResource.length === 0) {
    const [inserted] = await dbInstance
      .insert(resources)
      .values({
        countryId: kenya.id,
        resourceTypeId: typeMap['ACADEMIC_CALENDAR'],
        title: '[STRUCTURAL-TEST] Generic Academic Term Calendar 2026',
        slug: generalSlug,
        description: 'Synthetic structural demo calendar demonstrating non-curriculum resource linking.',
        status: 'PUBLISHED',
        qualityLabel: 'STANDARD',
        sourceName: 'Sample Educational Board',
        sourceReference: 'TEST-CIRCULAR-2026/01',
        academicYear: 2026,
        term: 1,
      })
      .returning();
    generalResourceId = inserted.id;

    // Seed Version 1
    await dbInstance.insert(resourceVersions).values({
      resourceId: generalResourceId,
      versionNumber: 1,
      versionLabel: 'v1.0',
      title: '[STRUCTURAL-TEST] Generic Academic Term Calendar 2026 (Initial Draft)',
      description: 'First version of synthetic structural calendar.',
      changeSummary: 'Initial publication',
      status: 'PUBLISHED',
      qualityLabel: 'STANDARD',
      publishedAt: new Date(),
    });
  } else {
    generalResourceId = generalResource[0].id;
  }

  // 5. Seed Synthetic Resource 2: Curriculum-Linked Multi-Version Resource
  // Example: Grade 10 Numeracy Practice
  if (curriculumId && curriculumVersionId && educationLevelId && gradeId && subjectId) {
    const curSlug = 'test-synthetic-grade-10-numeracy-practice';
    const existingCurResource = await dbInstance
      .select()
      .from(resources)
      .where(eq(resources.slug, curSlug))
      .limit(1);

    let curResourceId: string;
    if (existingCurResource.length === 0) {
      const [inserted] = await dbInstance
        .insert(resources)
        .values({
          countryId: kenya.id,
          resourceTypeId: typeMap['NOTES_REVISION'],
          curriculumId,
          curriculumVersionId,
          educationLevelId,
          gradeId,
          pathwayId,
          subjectId,
          topicId,
          title: '[STRUCTURAL-TEST] Synthetic Grade 10 Numeracy Practice',
          slug: curSlug,
          description: 'Synthetic revision questions illustrating complete hierarchy traversal from country to subtopic.',
          status: 'PUBLISHED',
          qualityLabel: 'VERIFIED',
          sourceName: 'Sample Pedagogical Guild',
          sourceReference: 'TEST-NUM-G10-REV1',
          academicYear: 2025,
          term: 1,
        })
        .returning();
      curResourceId = inserted.id;

      // Version 1 (Published)
      await dbInstance.insert(resourceVersions).values({
        resourceId: curResourceId,
        versionNumber: 1,
        versionLabel: 'v1.0',
        title: '[STRUCTURAL-TEST] Synthetic Grade 10 Numeracy Practice (Edition 1)',
        description: 'First edition of synthetic revision questions.',
        changeSummary: 'Initial published edition',
        status: 'PUBLISHED',
        qualityLabel: 'VERIFIED',
        publishedAt: new Date(),
      });

      // Version 2 (In Review / Next Revision)
      await dbInstance.insert(resourceVersions).values({
        resourceId: curResourceId,
        versionNumber: 2,
        versionLabel: 'v2.0-draft',
        title: '[STRUCTURAL-TEST] Synthetic Grade 10 Numeracy Practice (Edition 2 Draft)',
        description: 'Second edition draft containing expanded exercises.',
        changeSummary: 'Added supplementary quadratic equations',
        status: 'IN_REVIEW',
        qualityLabel: 'VERIFIED',
        publishedAt: null,
      });
    }
  }

  return {
    seededTypesCount: Object.keys(typeMap).length,
    kenyaId: kenya.id,
  };
}

// Direct execution CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  seedKenyaResources()
    .then((res) => {
      console.log('✅ Successfully seeded structural Resource Engine fixtures:', res);
      return closeDatabase();
    })
    .catch((err) => {
      console.error('❌ Failed to seed structural Resource Engine fixtures:', err);
      process.exit(1);
    });
}
