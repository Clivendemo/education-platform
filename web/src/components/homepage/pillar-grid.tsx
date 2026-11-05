import React from 'react';
import { SurfaceCard } from '@/components/ui/surface-card';
import type { ResourcePillar, ResourceTypeResult } from '@/lib/api/types';

export interface PillarGridProps {
  resourceTypes: ResourceTypeResult[];
}

interface CanonicalPillarMeta {
  pillar: ResourcePillar;
  title: string;
  description: string;
}

const CANONICAL_PILLARS: readonly CanonicalPillarMeta[] = [
  {
    pillar: 'PAST_PAPERS',
    title: 'Past Papers & Marking Schemes',
    description:
      'Summative national examinations, KCSE mock papers, and term assessment tests with marking schemes.',
  },
  {
    pillar: 'LESSON_PLANS',
    title: 'Lesson Plans',
    description:
      'Structured pedagogical lesson planning templates and guides aligned with KICD curriculum designs.',
  },
  {
    pillar: 'SCHEMES_OF_WORK',
    title: 'Schemes of Work',
    description:
      'Term-level syllabus execution roadmaps, learning outcomes, and week-by-week instructional timetables.',
  },
  {
    pillar: 'NOTES_REVISION',
    title: 'Revision Notes & Study Guides',
    description:
      'Comprehensive strand notes, summary booklets, and learner revision materials across all grades.',
  },
  {
    pillar: 'SCHOOL_DOCUMENTS',
    title: 'School Documents & Forms',
    description:
      'Official institutional administration templates, learner assessment rubrics, and reporting formats.',
  },
  {
    pillar: 'ACADEMIC_CALENDAR',
    title: 'Academic Calendar & Events',
    description:
      'Official Ministry of Education term dates, KNEC examination timetables, and key academic milestones.',
  },
  {
    pillar: 'EDUCATION_UPDATES',
    title: 'Education Updates & Circulars',
    description:
      'Official policy circulars, curriculum implementation circulars, and national education news.',
  },
  {
    pillar: 'TEACHER_RESOURCES',
    title: 'Teacher Training & Professional Resources',
    description:
      'Educator guides, CBC facilitator manuals, rubrics, and continuous professional development materials.',
  },
];

export function PillarGrid({ resourceTypes }: PillarGridProps) {
  // Group active resource types by canonical pillar
  const typesByPillar = new Map<ResourcePillar, ResourceTypeResult[]>();
  for (const pillar of CANONICAL_PILLARS) {
    typesByPillar.set(pillar.pillar, []);
  }

  for (const rt of resourceTypes) {
    if (typesByPillar.has(rt.pillar)) {
      typesByPillar.get(rt.pillar)!.push(rt);
    }
  }

  return (
    <section id="pillars" aria-labelledby="pillars-heading" className="space-y-6">
      <div className="max-w-3xl space-y-2">
        <h2
          id="pillars-heading"
          className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl"
        >
          National Curriculum Content Pillars
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
          ElimuPin structures learning content across Kenya&apos;s eight canonical educational pillars.
          Active resource types are categorized under each national pillar.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {CANONICAL_PILLARS.map((item, index) => {
          const matchingTypes = typesByPillar.get(item.pillar) ?? [];
          const hasActiveTypes = matchingTypes.length > 0;

          return (
            <SurfaceCard
              key={item.pillar}
              as="article"
              padding="md"
              data-testid={`pillar-card-${item.pillar.toLowerCase()}`}
              className="flex flex-col justify-between gap-4 select-none"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-tabular text-xs font-semibold text-[var(--accent-secondary)]">
                    Pillar 0{index + 1}
                  </span>
                  {hasActiveTypes ? (
                    <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                      {matchingTypes.length} Active {matchingTypes.length === 1 ? 'Type' : 'Types'}
                    </span>
                  ) : (
                    <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
                      Curriculum materials in preparation
                    </span>
                  )}
                </div>

                <h3 className="text-base font-semibold leading-snug text-[var(--text-primary)]">
                  {item.title}
                </h3>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  {item.description}
                </p>
              </div>

              {hasActiveTypes ? (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[var(--border-hairline)]">
                  {matchingTypes.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </SurfaceCard>
          );
        })}
      </div>
    </section>
  );
}
