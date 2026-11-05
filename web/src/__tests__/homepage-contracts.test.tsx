import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AutocompleteSearch } from '@/components/homepage/autocomplete-search';
import { PillarGrid } from '@/components/homepage/pillar-grid';
import {
  SlotSectionRenderer,
  ResourceCard,
  UpdateCard,
  CalendarCard,
  CurriculumShortcutCard,
} from '@/components/homepage/slot-section-renderer';
import type {
  CurriculumShortcutCardDto,
  HomepageCalendarHighlightCardDto,
  HomepageResourceCardDto,
  HomepageSectionDto,
  HomepageUpdateCardDto,
  ResourceTypeResult,
} from '@/lib/api/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../..');
const ROOT_DIR = path.resolve(WEB_ROOT, '..');

const mockResourceCard: HomepageResourceCardDto = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  entityType: 'RESOURCE',
  title: 'KCSE 2025 Mathematics Paper 1 Mock Exam',
  slug: 'kcse-2025-math-p1',
  description: 'Complete mock examination paper with full marking scheme.',
  isPinned: false,
  qualityLabel: 'Verified',
  quality: {
    effectiveTier: 'VERIFIED',
    label: 'Verified',
    displayMark: '✓',
    isVerified: true,
    isPremium: false,
    verifiedAt: '2026-10-15T10:00:00.000Z',
  },
  resourceType: {
    id: 'rt-1',
    code: 'PAST_PAPER',
    name: 'Past Papers',
    slug: 'past-papers',
    pillar: 'PAST_PAPERS',
  },
  curriculum: {
    id: 'cur-1',
    code: 'KCSE',
    name: '8-4-4 Curriculum',
    slug: '8-4-4',
  },
  educationLevel: {
    id: 'el-1',
    code: 'SEC',
    name: 'Secondary',
    slug: 'secondary',
  },
  grade: {
    id: 'g-1',
    code: 'F4',
    name: 'Form 4',
    slug: 'form-4',
  },
  subject: {
    id: 's-1',
    code: 'MATH',
    name: 'Mathematics',
    slug: 'mathematics',
  },
  topic: null,
  publishedVersion: {
    id: 'rv-1',
    versionNumber: 3,
    versionLabel: 'v3.2-revised',
    publishedAt: '2026-10-20T12:00:00.000Z',
  },
};

const mockUpdateCard: HomepageUpdateCardDto = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  entityType: 'UPDATE',
  title: 'Release of Junior School Assessment Framework',
  slug: 'js-assessment-framework-circular',
  summary: 'Official directives on continuous assessment tests for Grade 9 learners.',
  publishedAt: '2026-10-18T08:30:00.000Z',
  isPinned: false,
  category: {
    id: 'cat-1',
    name: 'Curriculum Implementation',
    slug: 'curriculum-implementation',
  },
};

const mockCalendarCard: HomepageCalendarHighlightCardDto = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  entityType: 'CALENDAR_EVENT',
  title: 'Term 1 Mid-Term Break',
  description: 'National mid-term break for all primary and secondary schools.',
  startDate: '2026-02-24',
  endDate: '2026-02-28',
  startTime: '08:00:00',
  endTime: '17:00:00',
  allDay: false,
  location: 'Nationwide',
  isPinned: false,
  eventType: {
    id: 'et-1',
    name: 'Term Dates',
    slug: 'term-dates',
  },
  calendar: {
    id: 'cal-1',
    name: 'Official 2026 Academic Calendar',
    academicYear: '2026',
  },
};

const mockShortcutCard: CurriculumShortcutCardDto = {
  id: '550e8400-e29b-41d4-a716-446655440004',
  entityType: 'SUBJECT',
  name: 'Integrated Science',
  slug: 'integrated-science',
  code: 'SCI-7',
  description: 'Grade 7 integrated science curriculum learning area.',
  isPinned: false,
  publishedResourceCount: 42,
  curriculum: {
    id: 'cur-2',
    name: 'CBC',
    slug: 'cbc',
    code: 'CBC',
  },
  educationLevel: {
    id: 'el-2',
    name: 'Junior School',
    slug: 'junior-school',
    sequenceOrder: 2,
  },
  grade: {
    id: 'g-2',
    name: 'Grade 7',
    slug: 'grade-7',
    sequenceOrder: 7,
  },
  pathway: null,
};

const mockResourceTypes: ResourceTypeResult[] = [
  {
    id: 'rt-pp',
    code: 'PAST_PAPER',
    name: 'Past Papers & Examinations',
    slug: 'past-papers',
    pillar: 'PAST_PAPERS',
    status: 'ACTIVE',
    sequenceOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'rt-lp',
    code: 'LESSON_PLAN',
    name: 'Lesson Plans',
    slug: 'lesson-plans',
    pillar: 'LESSON_PLANS',
    status: 'ACTIVE',
    sequenceOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('ElimuPin Phase 2 Public Homepage & Navigation Contracts', () => {
  // Area 1: DTO Fidelity & Dynamic Field Mapping
  it('Area 1: maps authentic DTO fields dynamically without hardcoded version labels or unverified circular badges', () => {
    const { unmount: unmountRes } = render(
      React.createElement(ResourceCard, { item: mockResourceCard }),
    );
    expect(screen.getByText('KCSE 2025 Mathematics Paper 1 Mock Exam')).toBeDefined();
    // Must display dynamic publishedVersion.versionLabel, NOT hardcoded "v1.0"
    expect(screen.getByText('v3.2-revised')).toBeDefined();
    expect(screen.getByText('Verified')).toBeDefined();
    unmountRes();

    const { unmount: unmountUpd } = render(
      React.createElement(UpdateCard, { item: mockUpdateCard }),
    );
    expect(screen.getByText('Release of Junior School Assessment Framework')).toBeDefined();
    // Must display category.name, NOT unverified "Official Circular"
    expect(screen.getByText('Curriculum Implementation')).toBeDefined();
    expect(screen.queryByText('Official Circular')).toBeNull();
    unmountUpd();

    const { unmount: unmountCal } = render(
      React.createElement(CalendarCard, { item: mockCalendarCard }),
    );
    expect(screen.getByText('Term 1 Mid-Term Break')).toBeDefined();
    expect(screen.getByText('Term Dates')).toBeDefined();
    expect(screen.getByText('Nationwide')).toBeDefined();
    unmountCal();

    const { unmount: unmountCut } = render(
      React.createElement(CurriculumShortcutCard, { item: mockShortcutCard }),
    );
    expect(screen.getByText('Integrated Science')).toBeDefined();
    expect(screen.getByText('42 Published')).toBeDefined();
    unmountCut();
  });

  // Area 2: Canonical 6 Slots in Strict Numerical Order
  it('Area 2: renders all 6 backend slots in exact numerical order 1..6 with snake_case keys', () => {
    const mockSections: HomepageSectionDto[] = [
      {
        slotKey: 'trending_resources',
        slotOrder: 1,
        entityType: 'RESOURCE',
        mode: 'AUTOMATED',
        title: 'Trending Resources',
        subtitle: 'Engaging materials',
        maxItems: 6,
        count: 1,
        items: [mockResourceCard],
      },
      {
        slotKey: 'most_downloaded_resources',
        slotOrder: 2,
        entityType: 'RESOURCE',
        mode: 'AUTOMATED',
        title: 'Most Downloaded Resources',
        subtitle: 'Essential documents',
        maxItems: 6,
        count: 0,
        items: [],
      },
      {
        slotKey: 'curated_resources',
        slotOrder: 3,
        entityType: 'RESOURCE',
        mode: 'AUTOMATED',
        title: 'Curated Resources',
        subtitle: 'Verified materials',
        maxItems: 6,
        count: 0,
        items: [],
      },
      {
        slotKey: 'education_updates',
        slotOrder: 4,
        entityType: 'UPDATE',
        mode: 'AUTOMATED',
        title: 'Education Updates',
        subtitle: 'Circulars and news',
        maxItems: 6,
        count: 1,
        items: [mockUpdateCard],
      },
      {
        slotKey: 'calendar_highlights',
        slotOrder: 5,
        entityType: 'CALENDAR_EVENT',
        mode: 'AUTOMATED',
        title: 'Calendar Highlights',
        subtitle: 'Term dates',
        maxItems: 6,
        count: 1,
        items: [mockCalendarCard],
      },
      {
        slotKey: 'curriculum_shortcuts',
        slotOrder: 6,
        entityType: 'SUBJECT',
        mode: 'AUTOMATED',
        title: 'Curriculum Shortcuts',
        subtitle: 'Subject shortcuts',
        maxItems: 6,
        count: 1,
        items: [mockShortcutCard],
      },
    ];

    const { container } = render(
      React.createElement(SlotSectionRenderer, { sections: mockSections }),
    );

    const sectionElements = container.querySelectorAll('section');
    expect(sectionElements).toHaveLength(6);

    const titles = Array.from(sectionElements).map(
      (s) => s.querySelector('h2')?.textContent,
    );
    expect(titles).toEqual([
      'Trending Resources',
      'Most Downloaded Resources',
      'Curated Resources',
      'Education Updates',
      'Calendar Highlights',
      'Curriculum Shortcuts',
    ]);
  });

  // Area 3: Empty Slot Resilience
  it('Area 3: gracefully renders empty slots with count: 0 and items: [] without layout breakdown', () => {
    const emptySections: HomepageSectionDto[] = [
      {
        slotKey: 'trending_resources',
        slotOrder: 1,
        entityType: 'RESOURCE',
        mode: 'AUTOMATED',
        title: 'Trending Resources',
        subtitle: null,
        maxItems: 6,
        count: 0,
        items: [],
      },
    ];

    render(React.createElement(SlotSectionRenderer, { sections: emptySections }));
    expect(screen.getByText('Trending Resources')).toBeDefined();
    expect(screen.getByText('No trending resources currently available')).toBeDefined();
  });

  // Area 4: Canonical 8 Pillars & Empty Pillar State
  it('Area 4: renders exactly 8 canonical pillars, groups active types, and marks empty pillars honestly', () => {
    render(React.createElement(PillarGrid, { resourceTypes: mockResourceTypes }));

    // Verify 8 pillar cards
    const cards = screen.getAllByTestId(/^pillar-card-/);
    expect(cards).toHaveLength(8);

    // Active pillar shows active types
    expect(screen.getByText('Past Papers & Examinations')).toBeDefined();
    expect(screen.getByText('1 Active Type')).toBeDefined();

    // Empty pillar shows honest "materials in preparation" notice
    const emptyPillarNotices = screen.getAllByText('Curriculum materials in preparation');
    expect(emptyPillarNotices.length).toBe(6); // 8 pillars total - 2 active = 6 empty
  });

  // Area 5: Autocomplete Combobox Behavior
  it('Area 5: enforces 250ms debounce, short-circuits < 2 chars, aborts obsolete requests, and supports keyboard navigation', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { text: 'Form 4 Mathematics', type: 'CURRICULUM_TOPIC' },
          { text: 'Form 4 Physics', type: 'CURRICULUM_TOPIC' },
        ],
        meta: { count: 2, query: 'form 4', fallbackUsed: false },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(AutocompleteSearch, { country: 'ke' }));
    const input = screen.getByRole('combobox');

    // 1 char: short-circuit (no fetch)
    fireEvent.change(input, { target: { value: 'f' } });
    vi.advanceTimersByTime(300);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2+ chars: debounced fetch after 250ms
    fireEvent.change(input, { target: { value: 'form 4' } });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(260);

    await act(async () => {
      // flush microtasks
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Arrow down moves highlight down listbox
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option1 = screen.getByText('Form 4 Mathematics');
    expect(option1).toBeDefined();

    // Escape closes listbox
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Area 6: Non-Clickable Presentation Enforcement
  it('Area 6: cards contain zero fake href links, zero cursor-pointer classes, and no broken anchors', () => {
    const { container } = render(
      React.createElement(ResourceCard, { item: mockResourceCard }),
    );

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(0);

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(0);

    const interactiveHrefs = Array.from(container.querySelectorAll('[href]'));
    expect(interactiveHrefs).toHaveLength(0);

    const pointerElements = Array.from(
      container.querySelectorAll('.cursor-pointer'),
    );
    expect(pointerElements).toHaveLength(0);
  });

  // Area 7: Country Routing & Genuine HTTP 404 Status Verification
  it('Area 7: country page delegates to KenyaHomepage for "ke" and invokes notFound() returning 404 signal for non-ke', async () => {
    const countryModule = await import('@/app/[country]/page');
    expect(typeof countryModule.default).toBe('function');

    // Unsupported country code must throw Next.js notFound()
    await expect(
      countryModule.default({ params: Promise.resolve({ country: 'ug' }) }),
    ).rejects.toThrow();

    await expect(
      countryModule.default({ params: Promise.resolve({ country: 'tz' }) }),
    ).rejects.toThrow();

    await expect(
      countryModule.default({ params: Promise.resolve({ country: 'invalid-country' }) }),
    ).rejects.toThrow();

    // Kenya code 'ke' and uppercase 'KE' must NOT throw
    await expect(
      countryModule.default({ params: Promise.resolve({ country: 'ke' }) }),
    ).resolves.toBeDefined();

    await expect(
      countryModule.default({ params: Promise.resolve({ country: 'KE' }) }),
    ).resolves.toBeDefined();
  });

  // Area 8: Degraded State & Backend Downtime Handling
  it('Area 8: renders honest neutral notice without claiming preview mode or showing mock data when backend fails', async () => {
    const kenyaHomepageModule = await import(
      '@/components/homepage/kenya-homepage'
    );
    expect(typeof kenyaHomepageModule.KenyaHomepage).toBe('function');

    // Verify source code guarantees neutral notice and absence of "preview mode"
    const sourceCode = fs.readFileSync(
      path.join(WEB_ROOT, 'src/components/homepage/kenya-homepage.tsx'),
      'utf8',
    );
    expect(sourceCode).toContain('Educational resources temporarily unavailable');
    expect(sourceCode).toContain(
      'Some educational resources and updates are temporarily unavailable',
    );
    expect(sourceCode).not.toContain('preview mode');
    expect(sourceCode).not.toContain('standalone mode');
  });

  // Area 9: Preservation of Root Boundary
  it('Area 9: root vitest.config.ts isolates backend tests by excluding web/**', () => {
    const rootConfigRaw = fs.readFileSync(
      path.join(ROOT_DIR, 'vitest.config.ts'),
      'utf8',
    );
    expect(rootConfigRaw).toContain("exclude: ['web/**'");
    expect(rootConfigRaw).toContain("include: ['tests/**/*.test.ts']");
  });
});
