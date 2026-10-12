import { eq } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase, closeDatabase } from '../index.js';
import { educationUpdateCategories } from '../schemas.js';
import { fileURLToPath } from 'node:url';

export const CANONICAL_UPDATE_CATEGORIES = [
  {
    name: 'Curriculum Reforms',
    slug: 'curriculum-reforms',
    description: 'Updates and guidance on national and regional curriculum transitions (e.g. CBC, CBE).',
    status: 'ACTIVE' as const,
  },
  {
    name: 'Exam Timetables & Guidelines',
    slug: 'exam-guidelines',
    description: 'National assessment timetables, registration dates, and examination administration circulars.',
    status: 'ACTIVE' as const,
  },
  {
    name: 'Ministry Directives',
    slug: 'ministry-directives',
    description: 'Official policy directives, circulars, and announcements from Ministries of Education.',
    status: 'ACTIVE' as const,
  },
  {
    name: 'Teacher Professional Development',
    slug: 'teacher-development',
    description: 'TPD modules, workshop schedules, and capacity-building opportunities for educators.',
    status: 'ACTIVE' as const,
  },
  {
    name: 'Term Dates & Calendars',
    slug: 'term-dates',
    description: 'Official school term opening, midterm, and closing dates across academic calendars.',
    status: 'ACTIVE' as const,
  },
  {
    name: 'General Announcements',
    slug: 'general-announcements',
    description: 'General notices, school safety guidelines, and public education announcements.',
    status: 'ACTIVE' as const,
  },
];

export async function seedEducationUpdateCategories(
  dbInstance: AppDatabase = defaultDb,
): Promise<{ categoriesCount: number }> {
  for (const cat of CANONICAL_UPDATE_CATEGORIES) {
    const [existing] = await dbInstance
      .select({ id: educationUpdateCategories.id })
      .from(educationUpdateCategories)
      .where(eq(educationUpdateCategories.slug, cat.slug))
      .limit(1);

    if (!existing) {
      await dbInstance.insert(educationUpdateCategories).values(cat);
    }
  }

  return { categoriesCount: CANONICAL_UPDATE_CATEGORIES.length };
}

// Standalone execution support
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('education-updates-categories.ts'));

if (isDirectExecution) {
  seedEducationUpdateCategories()
    .then((result) => {
      console.log('Successfully seeded Education Update Categories:', result);
      return closeDatabase();
    })
    .catch((err) => {
      console.error('Failed to seed Education Update Categories:', err);
      process.exit(1);
    });
}
