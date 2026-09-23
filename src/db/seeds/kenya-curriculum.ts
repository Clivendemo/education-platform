import { sql, eq } from 'drizzle-orm';
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
} from '../schemas.js';

/**
 * Seed minimal controlled Kenya curriculum hierarchy.
 * Demonstrates:
 * Kenya
 * → Curriculum (CBC)
 * → Curriculum Version (CBC 2024)
 * → Education Levels (Pre-Primary, Primary, Junior School, Senior School)
 * → Grades (Grade 1 [no pathway], Grade 10 [with pathways])
 * → Pathways (STEM, Arts & Sports Science, Social Sciences)
 * → Subjects (Grade 1 English [no pathway], Grade 10 Mathematics [STEM pathway])
 * → Topics (Algebra -> Linear Inequalities)
 *
 * Execution is strictly idempotent.
 */
export async function seedKenyaCurriculum(dbInstance = defaultDb) {
  // 1. Ensure Kenya Country exists
  const existingKenya = await dbInstance
    .select()
    .from(countries)
    .where(eq(countries.isoCode, 'KE'))
    .limit(1);

  let kenyaId: string;
  if (existingKenya.length > 0) {
    kenyaId = existingKenya[0].id;
  } else {
    const [inserted] = await dbInstance
      .insert(countries)
      .values({
        name: 'Kenya',
        isoCode: 'KE',
        urlPrefix: 'ke',
        defaultLanguageCode: 'en',
        currencyCode: 'KES',
        educationTerminologyConfig: {
          primaryLevelTerm: 'Primary School',
          secondaryLevelTerm: 'Secondary School',
          curriculumName: 'Competency-Based Curriculum (CBC)',
        },
        paymentConfig: {
          primaryPaymentMethod: 'M-PESA',
        },
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: countries.isoCode,
        set: { name: 'Kenya', status: 'ACTIVE' },
      })
      .returning();
    kenyaId = inserted.id;
  }

  // 2. Seed CBC Curriculum
  const [cbcCurriculum] = await dbInstance
    .insert(curricula)
    .values({
      countryId: kenyaId,
      name: 'Competency-Based Curriculum',
      slug: 'cbc',
      code: 'CBC',
      description: 'National competence-based educational curriculum for Kenya.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [curricula.countryId, curricula.slug],
      set: {
        name: 'Competency-Based Curriculum',
        code: 'CBC',
        status: 'ACTIVE',
      },
    })
    .returning();

  // 3. Seed CBC Curriculum Version
  const [cbcVersion] = await dbInstance
    .insert(curriculumVersions)
    .values({
      curriculumId: cbcCurriculum.id,
      countryId: kenyaId,
      versionName: 'Basic Education Curriculum Framework (2024)',
      versionCode: 'CBC-2024',
      slug: 'cbc-2024',
      effectiveFrom: '2024-01-01',
      status: 'CURRENT',
      description:
        'Official 2-6-3-3-3 Basic Education Curriculum Framework version.',
    })
    .onConflictDoUpdate({
      target: [curriculumVersions.curriculumId, curriculumVersions.slug],
      set: {
        versionName: 'Basic Education Curriculum Framework (2024)',
        versionCode: 'CBC-2024',
        status: 'CURRENT',
      },
    })
    .returning();

  // 4. Seed Education Levels (Deterministic sequence ordering)
  const levelsData = [
    {
      name: 'Pre-Primary',
      slug: 'pre-primary',
      code: 'PP',
      sequenceOrder: 1,
      description: 'Pre-Primary education (PP1 - PP2)',
    },
    {
      name: 'Primary School',
      slug: 'primary-school',
      code: 'PRI',
      sequenceOrder: 2,
      description: 'Lower and Upper Primary (Grade 1 - Grade 6)',
    },
    {
      name: 'Junior School',
      slug: 'junior-school',
      code: 'JS',
      sequenceOrder: 3,
      description: 'Junior Secondary School (Grade 7 - Grade 9)',
    },
    {
      name: 'Senior School',
      slug: 'senior-school',
      code: 'SS',
      sequenceOrder: 4,
      description: 'Senior Secondary School (Grade 10 - Grade 12)',
    },
  ];

  const seededLevels: Record<string, string> = {};
  for (const lvl of levelsData) {
    const [record] = await dbInstance
      .insert(educationLevels)
      .values({
        curriculumVersionId: cbcVersion.id,
        name: lvl.name,
        slug: lvl.slug,
        code: lvl.code,
        sequenceOrder: lvl.sequenceOrder,
        description: lvl.description,
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: [educationLevels.curriculumVersionId, educationLevels.slug],
        set: {
          name: lvl.name,
          sequenceOrder: lvl.sequenceOrder,
          status: 'ACTIVE',
        },
      })
      .returning();
    seededLevels[lvl.slug] = record.id;
  }

  // 5. Seed Grades
  // 5a. Grade 1 under Primary School (demonstrates grade WITHOUT pathways)
  const [grade1] = await dbInstance
    .insert(grades)
    .values({
      curriculumVersionId: cbcVersion.id,
      educationLevelId: seededLevels['primary-school'],
      name: 'Grade 1',
      slug: 'grade-1',
      code: 'G1',
      sequenceOrder: 1,
      description: 'First grade of Primary education',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [grades.curriculumVersionId, grades.slug],
      set: {
        name: 'Grade 1',
        sequenceOrder: 1,
        educationLevelId: seededLevels['primary-school'],
        status: 'ACTIVE',
      },
    })
    .returning();

  // 5b. Grade 10 under Senior School (demonstrates grade WITH pathways)
  const [grade10] = await dbInstance
    .insert(grades)
    .values({
      curriculumVersionId: cbcVersion.id,
      educationLevelId: seededLevels['senior-school'],
      name: 'Grade 10',
      slug: 'grade-10',
      code: 'G10',
      sequenceOrder: 10,
      description: 'First grade of Senior School',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [grades.curriculumVersionId, grades.slug],
      set: {
        name: 'Grade 10',
        sequenceOrder: 10,
        educationLevelId: seededLevels['senior-school'],
        status: 'ACTIVE',
      },
    })
    .returning();

  // 6. Seed Pathways under Grade 10
  const pathwaysData = [
    {
      name: 'Science, Technology, Engineering and Mathematics (STEM)',
      slug: 'stem',
      code: 'STEM',
      sequenceOrder: 1,
      description: 'STEM pathway for Senior School learners.',
    },
    {
      name: 'Social Sciences',
      slug: 'social-sciences',
      code: 'SOC-SCI',
      sequenceOrder: 2,
      description: 'Social sciences and humanities pathway.',
    },
    {
      name: 'Arts and Sports Science',
      slug: 'arts-sports',
      code: 'ARTS-SPORTS',
      sequenceOrder: 3,
      description: 'Creative arts and sports science pathway.',
    },
  ];

  const seededPathways: Record<string, string> = {};
  for (const pw of pathwaysData) {
    const [record] = await dbInstance
      .insert(pathways)
      .values({
        curriculumVersionId: cbcVersion.id,
        educationLevelId: seededLevels['senior-school'],
        gradeId: grade10.id,
        name: pw.name,
        slug: pw.slug,
        code: pw.code,
        sequenceOrder: pw.sequenceOrder,
        description: pw.description,
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: [pathways.gradeId, pathways.slug],
        set: {
          name: pw.name,
          sequenceOrder: pw.sequenceOrder,
          status: 'ACTIVE',
        },
      })
      .returning();
    seededPathways[pw.slug] = record.id;
  }

  // 7. Seed Subjects
  // 7a. Grade 1 subject without pathway (e.g. Mathematics Activities)
  const [grade1Math] = await dbInstance
    .insert(subjects)
    .values({
      curriculumVersionId: cbcVersion.id,
      educationLevelId: seededLevels['primary-school'],
      gradeId: grade1.id,
      pathwayId: null,
      name: 'Mathematical Activities',
      slug: 'mathematical-activities',
      code: 'G1-MATH',
      sequenceOrder: 1,
      description: 'Foundational numeracy for Grade 1.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [subjects.gradeId, subjects.slug],
      targetWhere: sql`${subjects.pathwayId} IS NULL`,
      set: {
        name: 'Mathematical Activities',
        sequenceOrder: 1,
        status: 'ACTIVE',
      },
    })
    .returning();

  // 7b. Grade 10 subject within STEM pathway (Advanced Mathematics)
  const [grade10Math] = await dbInstance
    .insert(subjects)
    .values({
      curriculumVersionId: cbcVersion.id,
      educationLevelId: seededLevels['senior-school'],
      gradeId: grade10.id,
      pathwayId: seededPathways['stem'],
      name: 'Advanced Mathematics',
      slug: 'advanced-mathematics',
      code: 'G10-ADV-MATH',
      sequenceOrder: 1,
      description: 'Advanced mathematics for STEM learners in Grade 10.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [subjects.gradeId, subjects.pathwayId, subjects.slug],
      targetWhere: sql`${subjects.pathwayId} IS NOT NULL`,
      set: {
        name: 'Advanced Mathematics',
        sequenceOrder: 1,
        status: 'ACTIVE',
      },
    })
    .returning();

  // 8. Seed Topics under Grade 10 Advanced Mathematics
  // Top-level topic: Algebra
  const [algebraTopic] = await dbInstance
    .insert(topics)
    .values({
      curriculumVersionId: cbcVersion.id,
      subjectId: grade10Math.id,
      parentId: null,
      name: 'Algebra',
      slug: 'algebra',
      code: 'G10-MATH-ALG',
      sequenceOrder: 1,
      description: 'Algebraic equations, functions and operations.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [topics.subjectId, topics.slug],
      targetWhere: sql`${topics.parentId} IS NULL`,
      set: {
        name: 'Algebra',
        sequenceOrder: 1,
        status: 'ACTIVE',
      },
    })
    .returning();

  // Sub-topic: Linear Inequalities
  const [inequalitiesTopic] = await dbInstance
    .insert(topics)
    .values({
      curriculumVersionId: cbcVersion.id,
      subjectId: grade10Math.id,
      parentId: algebraTopic.id,
      name: 'Linear Inequalities',
      slug: 'linear-inequalities',
      code: 'G10-MATH-INEQ',
      sequenceOrder: 1,
      description: 'Solving and graphing linear inequalities in two variables.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [topics.parentId, topics.slug],
      targetWhere: sql`${topics.parentId} IS NOT NULL`,
      set: {
        name: 'Linear Inequalities',
        sequenceOrder: 1,
        status: 'ACTIVE',
      },
    })
    .returning();

  // Top-level topic for Grade 1: Numbers
  const [numbersTopic] = await dbInstance
    .insert(topics)
    .values({
      curriculumVersionId: cbcVersion.id,
      subjectId: grade1Math.id,
      parentId: null,
      name: 'Numbers and Operations',
      slug: 'numbers-and-operations',
      code: 'G1-MATH-NUM',
      sequenceOrder: 1,
      description: 'Whole number identification, counting, and simple addition.',
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [topics.subjectId, topics.slug],
      targetWhere: sql`${topics.parentId} IS NULL`,
      set: {
        name: 'Numbers and Operations',
        sequenceOrder: 1,
        status: 'ACTIVE',
      },
    })
    .returning();

  return {
    countryId: kenyaId,
    curriculumId: cbcCurriculum.id,
    curriculumVersionId: cbcVersion.id,
    educationLevels: seededLevels,
    grades: {
      grade1: grade1.id,
      grade10: grade10.id,
    },
    pathways: seededPathways,
    subjects: {
      grade1Math: grade1Math.id,
      grade10Math: grade10Math.id,
    },
    topics: {
      algebra: algebraTopic.id,
      linearInequalities: inequalitiesTopic.id,
      numbers: numbersTopic.id,
    },
  };
}

if (process.argv[1]?.endsWith('kenya-curriculum.ts')) {
  seedKenyaCurriculum()
    .then((result) => {
      console.log('Seeded Kenya Curriculum hierarchy successfully:');
      console.log(JSON.stringify(result, null, 2));
      return closeDatabase();
    })
    .catch((err) => {
      console.error('Failed seeding Kenya curriculum:', err);
      process.exit(1);
    });
}
