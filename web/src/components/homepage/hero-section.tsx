import React from 'react';
import { VisualPlaceholder } from '@/components/ui/visual-placeholder';
import { AutocompleteSearch } from './autocomplete-search';

export interface HeroSectionProps {
  country?: string;
}

export function HeroSection({ country = 'ke' }: HeroSectionProps) {
  return (
    <section
      id="search"
      aria-labelledby="hero-heading"
      className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12"
    >
      <div className="space-y-6 lg:col-span-6">
        <p className="text-xs font-semibold tracking-wider uppercase text-[var(--accent-secondary)]">
          Kenya National Curriculum Infrastructure · Phase 2
        </p>
        <h1
          id="hero-heading"
          className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl lg:text-5xl lg:leading-[1.12]"
        >
          Structured curriculum alignment for Kenyan classrooms.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
          ElimuPin organizes Competency-Based Curriculum (CBC) and 8-4-4 teaching materials
          by verified learning area, strand, and academic term so teachers spend less time
          searching and more time teaching.
        </p>

        <div className="pt-2">
          <AutocompleteSearch country={country} />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <a
            href="#pillars"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent-primary)] px-5 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Explore Content Pillars
          </a>
          <a
            href="#trending"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            View Trending Resources
          </a>
        </div>
      </div>

      <div className="lg:col-span-6">
        <VisualPlaceholder
          aspectRatio="16:9"
          slot="homepage-hero"
          label="Kenyan secondary classroom collaborative lesson desk placeholder frame"
          captionTitle="National Curriculum Focal Frame"
          captionMeta="16:9 · Verified Placeholder"
        />
      </div>
    </section>
  );
}
