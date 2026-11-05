import React from 'react';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';
import { SurfaceCard } from '@/components/ui/surface-card';
import { VisualPlaceholder } from '@/components/ui/visual-placeholder';
import { fetchBackendHealthSnapshot } from '@/lib/api/server-client';

const CURRICULUM_BANDS = [
  {
    title: 'Early Years & Upper Primary',
    codeRange: 'PP1–PP2 · Grades 1–6',
    summary:
      'Foundational literacy, numeracy, environmental activities, and Kiswahili strand mapping aligned with KICD Competency-Based Curriculum designs.',
  },
  {
    title: 'Junior School Pathways',
    codeRange: 'Grades 7–9',
    summary:
      'Integrated science, pre-technical studies, agriculture, and social studies learning areas structured by strand, sub-strand, and term outcome.',
  },
  {
    title: 'Senior School & 8-4-4 Transition',
    codeRange: 'Grades 10–12 · Forms 3–4',
    summary:
      'Dual-taxonomy indexing supporting STEM, humanities, and creative arts Senior School tracks alongside active 8-4-4 examination preparation.',
  },
] as const;

const WORKSPACE_SAMPLE_ROWS = [
  {
    id: 'row-g7-sci',
    level: 'Grade 7',
    learningArea: 'Integrated Science',
    termWindow: 'Term 1 · Week 04',
    strand: 'Mixtures, Elements and Compounds',
    status: 'Curriculum-verified',
  },
  {
    id: 'row-g8-math',
    level: 'Grade 8',
    learningArea: 'Mathematics',
    termWindow: 'Term 1 · Week 05',
    strand: 'Linear Equations and Inequalities',
    status: 'Ready for lesson plan',
  },
  {
    id: 'row-f4-hist',
    level: 'Form 4',
    learningArea: 'History and Government',
    termWindow: 'Term 1 · Week 06',
    strand: 'Devolved Government in Kenya',
    status: 'Revision reference',
  },
] as const;

export default async function HomePage() {
  const readiness = await fetchBackendHealthSnapshot();

  return (
    <div className="space-y-16">
      {/* Section 1: Asymmetric Hero Split with 16:9 Placeholder Focal Frame */}
      <section aria-labelledby="hero-heading" className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-6">
          <p className="text-xs font-semibold tracking-wider uppercase text-[var(--accent-secondary)]">
            Kenya Curriculum Infrastructure · Phase 1 Foundation
          </p>
          <h1
            id="hero-heading"
            className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl lg:text-5xl lg:leading-[1.12]"
          >
            Structured curriculum alignment for Kenyan classrooms.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            ElimuPin organizes Competency-Based Curriculum (CBC) and 8-4-4 teaching materials by
            verified learning area, strand, and academic term so teachers spend less time searching
            and more time teaching.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href="#curriculum"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent-primary)] px-5 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              Explore Curriculum Structure
            </a>
            <a
              href="#workspace"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              View Workspace Layout
            </a>
          </div>
        </div>

        <div className="lg:col-span-6">
          <VisualPlaceholder
            aspectRatio="16:9"
            slot="homepage-hero"
            label="Kenyan secondary school classroom collaborative lesson desk placeholder frame"
            captionTitle="Homepage Hero Focal Slot"
            captionMeta="16:9 · Placeholder Only"
          />
        </div>
      </section>

      {/* Section 2: Kenyan Curriculum Bands */}
      <section id="curriculum" aria-labelledby="curriculum-heading" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 id="curriculum-heading" className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            National Curriculum Coverage
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Built around Kenya&apos;s official education taxonomy from Pre-Primary through Senior
            School and 8-4-4 completion cohorts.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {CURRICULUM_BANDS.map((band) => (
            <SurfaceCard key={band.title} as="article" className="flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <p className="font-mono-tabular text-xs font-medium text-[var(--text-muted)]">
                  {band.codeRange}
                </p>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">{band.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {band.summary}
                </p>
              </div>
            </SurfaceCard>
          ))}
        </div>
      </section>

      {/* Section 3: Approved Visual Slot Geometry & Accessibility Contract */}
      <section
        id="visual-architecture"
        aria-labelledby="visual-architecture-heading"
        className="space-y-6"
      >
        <div className="max-w-2xl space-y-2">
          <h2
            id="visual-architecture-heading"
            className="text-2xl font-bold tracking-tight text-[var(--text-primary)]"
          >
            Curated Media &amp; Resource Preview Slots
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Aspect-ratio-locked placeholder surfaces reserve layout stability for upcoming curated
            subject illustrations and moderated document previews while isolating unmoderated uploads.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <SurfaceCard className="space-y-4 md:col-span-5">
            <div className="w-24">
              <VisualPlaceholder
                aspectRatio="1:1"
                slot="subject-category"
                decorative
              />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Subject Category Motif Slot (1:1 Decorative)
              </h3>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Adjacent heading text carries full semantic meaning, so the square motif frame is
                marked strictly decorative for screen readers.
              </p>
            </div>
          </SurfaceCard>

          <SurfaceCard className="space-y-4 md:col-span-7">
            <VisualPlaceholder
              aspectRatio="4:3"
              slot="resource-preview"
              label="Structured Grade 8 Integrated Science lesson scheme preview frame"
              captionTitle="Learning Resource Preview Slot"
              captionMeta="4:3 · Moderated Preview Boundary"
            />
          </SurfaceCard>
        </div>
      </section>

      {/* Section 4: Restrained Teacher Workspace Row Density (Zero Decorative Thumbnails) */}
      <section id="workspace" aria-labelledby="workspace-heading" className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl space-y-2">
            <h2
              id="workspace-heading"
              className="text-2xl font-bold tracking-tight text-[var(--text-primary)]"
            >
              Educator Planning Density
            </h2>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Task-critical planning tables omit decorative cover thumbnails in every row to keep
              scanning fast on low-bandwidth connections.
            </p>
          </div>
          <Button variant="secondary" disabled aria-disabled="true">
            Phase 2 Catalogue Pending
          </Button>
        </div>

        <SurfaceCard padding="none" data-testid="teacher-workspace-preview" className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-secondary)]">
                <th scope="col" className="px-5 py-3.5">Level</th>
                <th scope="col" className="px-5 py-3.5">Learning Area</th>
                <th scope="col" className="px-5 py-3.5">Strand Focus</th>
                <th scope="col" className="px-5 py-3.5">Term Window</th>
                <th scope="col" className="px-5 py-3.5">Alignment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)]">
              {WORKSPACE_SAMPLE_ROWS.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--bg-subtle)]/60">
                  <td className="px-5 py-3.5 font-medium whitespace-nowrap text-[var(--text-primary)]">
                    {row.level}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-[var(--text-primary)]">
                    {row.learningArea}
                  </td>
                  <td className="px-5 py-3.5 text-[var(--text-secondary)]">{row.strand}</td>
                  <td className="font-mono-tabular px-5 py-3.5 whitespace-nowrap text-[var(--text-muted)]">
                    {row.termWindow}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-[var(--text-secondary)]">
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      </section>

      {/* Section 5: API Integration Readiness Boundary */}
      <section id="readiness" aria-labelledby="readiness-heading" className="space-y-4">
        <h2 id="readiness-heading" className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          API Integration Boundary
        </h2>
        {readiness.reachable ? (
          <StatusNotice tone="ok" title="Fastify /api/v1 service connection verified">
            Active country baseline <span className="font-mono-tabular">{readiness.countryCode}</span>{' '}
            is synchronized with the backend health contract.
          </StatusNotice>
        ) : (
          <StatusNotice tone="info" title="Frontend foundation running in standalone mode">
            The Next.js App Router shell, CSRF transition barrier, and `/api/v1` proxy contract are
            configured for country baseline{' '}
            <span className="font-mono-tabular">{readiness.countryCode}</span> and will connect
            automatically when the Fastify API service is active.
          </StatusNotice>
        )}
      </section>
    </div>
  );
}
