import { fileURLToPath } from 'node:url';
import { eq, and, isNull } from 'drizzle-orm';
import { db as defaultDb, closeDatabase, type AppDatabase } from '../index.js';
import { qualityCheckTypes } from '../schemas.js';

export interface SeedQualityCheckType {
  code: string;
  name: string;
  description: string;
  requiredForVerification: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Approved Initial Verification Rubric (Prompt 24 / Technical Correction E)
 * 5 Mandatory Criteria (all must pass for official verification):
 *   1. CURRICULUM_ALIGNMENT
 *   2. FACTUAL_ACCURACY
 *   3. COMPLETENESS
 *   4. FILE_INTEGRITY_READABILITY
 *   5. PROVENANCE_RIGHTS
 * 2 Optional Criteria:
 *   6. GRADE_APPROPRIATENESS
 *   7. EXAM_RELEVANCE
 */
export const CANONICAL_CHECK_TYPES: SeedQualityCheckType[] = [
  {
    code: 'CURRICULUM_ALIGNMENT',
    name: 'Curriculum Alignment',
    description:
      'Content strictly aligns with the designated national curriculum framework, level, syllabus, and learning outcomes.',
    requiredForVerification: true,
    status: 'ACTIVE',
  },
  {
    code: 'FACTUAL_ACCURACY',
    name: 'Factual Accuracy',
    description:
      'Educational concepts, formulas, calculations, historical dates, scientific facts, and answers are verified accurate.',
    requiredForVerification: true,
    status: 'ACTIVE',
  },
  {
    code: 'COMPLETENESS',
    name: 'Completeness',
    description:
      'Resource includes all referenced question sections, diagrams, reading passages, and marking schemes/answers where expected.',
    requiredForVerification: true,
    status: 'ACTIVE',
  },
  {
    code: 'FILE_INTEGRITY_READABILITY',
    name: 'File Integrity & Readability',
    description:
      'Attached files are complete, properly rotated/formatted, uncorrupted, virus-free, and clearly legible for print or screen display.',
    requiredForVerification: true,
    status: 'ACTIVE',
  },
  {
    code: 'PROVENANCE_RIGHTS',
    name: 'Provenance & Rights Clearance',
    description:
      'Author/institution attribution, source, academic year, and term are authentic and confirmed clear of rights or copyright infringements.',
    requiredForVerification: true,
    status: 'ACTIVE',
  },
  {
    code: 'GRADE_APPROPRIATENESS',
    name: 'Grade Appropriateness',
    description:
      'Vocabulary, cognitive demand, typography, and presentation format are appropriate for the target student age and grade level.',
    requiredForVerification: false,
    status: 'ACTIVE',
  },
  {
    code: 'EXAM_RELEVANCE',
    name: 'Exam Relevance',
    description:
      'Structure, timing, and question types authentically simulate national examination formats and assessment guidelines.',
    requiredForVerification: false,
    status: 'ACTIVE',
  },
];

export async function seedQualityGovernance(db: AppDatabase = defaultDb): Promise<{
  inserted: number;
  updated: number;
  total: number;
}> {
  let inserted = 0;
  let updated = 0;

  for (const item of CANONICAL_CHECK_TYPES) {
    const [existing] = await db
      .select()
      .from(qualityCheckTypes)
      .where(
        and(
          eq(qualityCheckTypes.code, item.code),
          isNull(qualityCheckTypes.countryId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(qualityCheckTypes)
        .set({
          name: item.name,
          description: item.description,
          requiredForVerification: item.requiredForVerification,
          status: item.status,
          updatedAt: new Date(),
        })
        .where(eq(qualityCheckTypes.id, existing.id));
      updated++;
    } else {
      await db.insert(qualityCheckTypes).values({
        code: item.code,
        name: item.name,
        description: item.description,
        countryId: null, // Global criterion
        requiredForVerification: item.requiredForVerification,
        status: item.status,
      });
      inserted++;
    }
  }

  return { inserted, updated, total: CANONICAL_CHECK_TYPES.length };
}

// Direct execution CLI support
const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  seedQualityGovernance()
    .then((stats) => {
      console.log('Quality Governance criteria seeded successfully:', stats);
      return closeDatabase();
    })
    .catch(async (err) => {
      console.error('Failed to seed quality governance criteria:', err);
      await closeDatabase();
      process.exit(1);
    });
}
