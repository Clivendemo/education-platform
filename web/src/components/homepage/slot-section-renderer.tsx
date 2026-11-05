import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard } from '@/components/ui/surface-card';
import type {
  CurriculumShortcutCardDto,
  HomepageCalendarHighlightCardDto,
  HomepageResourceCardDto,
  HomepageSectionDto,
  HomepageUpdateCardDto,
} from '@/lib/api/types';

export interface SlotSectionRendererProps {
  sections: HomepageSectionDto[];
}

function formatDateDisplay(rawDate: string): string {
  try {
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return rawDate;
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return rawDate;
  }
}

export function ResourceCard({ item }: { item: HomepageResourceCardDto }) {
  const metaLine = [
    item.curriculum?.name,
    item.grade?.name,
    item.subject?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SurfaceCard
      as="article"
      padding="md"
      data-testid={`resource-card-${item.id}`}
      className="flex flex-col justify-between gap-4 select-none"
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-secondary)]">
            {item.resourceType.name}
          </span>
          <div className="flex items-center gap-1.5">
            {item.quality.isVerified ? (
              <span className="rounded-md bg-[var(--status-ok-bg)] border border-[var(--status-ok-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-ok-text)]">
                Verified
              </span>
            ) : item.quality.isPremium ? (
              <span className="rounded-md bg-[var(--status-info-bg)] border border-[var(--status-info-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-info-text)]">
                Premium
              </span>
            ) : null}
            <span className="font-mono-tabular rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
              {item.publishedVersion.versionLabel}
            </span>
          </div>
        </div>

        <h3 className="text-base font-semibold text-[var(--text-primary)] line-clamp-2">
          {item.title}
        </h3>

        {metaLine ? (
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            {metaLine}
          </p>
        ) : null}

        {item.description ? (
          <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-hairline)] pt-3 text-xs text-[var(--text-muted)]">
        <span className="font-mono-tabular">
          {formatDateDisplay(item.publishedVersion.publishedAt)}
        </span>
        <span className="rounded-md bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          Catalogue details in Phase 3
        </span>
      </div>
    </SurfaceCard>
  );
}

export function UpdateCard({ item }: { item: HomepageUpdateCardDto }) {
  const categoryLabel = item.category?.name || 'Education Update';

  return (
    <SurfaceCard
      as="article"
      padding="md"
      data-testid={`update-card-${item.id}`}
      className="flex flex-col justify-between gap-4 select-none"
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-secondary)]">
            {categoryLabel}
          </span>
          <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
            {formatDateDisplay(item.publishedAt)}
          </span>
        </div>

        <h3 className="text-base font-semibold text-[var(--text-primary)] line-clamp-2">
          {item.title}
        </h3>

        {item.summary ? (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
            {item.summary}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3 text-right">
        <span className="rounded-md bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          Circular text in Phase 3
        </span>
      </div>
    </SurfaceCard>
  );
}

export function CalendarCard({
  item,
}: {
  item: HomepageCalendarHighlightCardDto;
}) {
  const timeInfo = item.allDay
    ? 'All Day'
    : [item.startTime, item.endTime].filter(Boolean).join(' - ');

  return (
    <SurfaceCard
      as="article"
      padding="md"
      data-testid={`calendar-card-${item.id}`}
      className="flex flex-col justify-between gap-4 select-none"
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-secondary)]">
            {item.eventType.name}
          </span>
          <span className="font-mono-tabular text-xs font-semibold text-[var(--text-primary)]">
            {formatDateDisplay(item.startDate)}
          </span>
        </div>

        <h3 className="text-base font-semibold text-[var(--text-primary)] line-clamp-2">
          {item.title}
        </h3>

        {item.description ? (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-hairline)] pt-3 text-xs text-[var(--text-muted)]">
        <span>{timeInfo || item.calendar.name}</span>
        {item.location ? <span>{item.location}</span> : null}
      </div>
    </SurfaceCard>
  );
}

export function CurriculumShortcutCard({
  item,
}: {
  item: CurriculumShortcutCardDto;
}) {
  return (
    <SurfaceCard
      as="article"
      padding="md"
      data-testid={`shortcut-card-${item.id}`}
      className="flex flex-col justify-between gap-4 select-none"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-secondary)]">
            {item.curriculum.name}
          </span>
          <span className="font-mono-tabular text-xs font-semibold text-[var(--text-primary)]">
            {item.publishedResourceCount} Published
          </span>
        </div>

        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {item.name}
        </h3>

        <p className="text-xs text-[var(--text-secondary)]">
          {item.educationLevel.name} · {item.grade.name}
        </p>

        {item.description ? (
          <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3 text-right">
        <span className="rounded-md bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          Browse Subject in Phase 3
        </span>
      </div>
    </SurfaceCard>
  );
}

export function SlotSectionRenderer({ sections }: SlotSectionRendererProps) {
  // Enforce numerical slotOrder sequence (1..6)
  const orderedSections = [...sections].sort(
    (a, b) => a.slotOrder - b.slotOrder,
  );

  return (
    <div className="space-y-16">
      {orderedSections.map((section) => {
        const hasItems = section.count > 0 && section.items.length > 0;
        const sectionId =
          section.slotKey === 'trending_resources'
            ? 'trending'
            : section.slotKey === 'education_updates'
              ? 'updates'
              : section.slotKey === 'calendar_highlights'
                ? 'calendar'
                : `slot-${section.slotKey}`;

        return (
          <section
            key={section.slotKey}
            id={sectionId}
            aria-labelledby={`heading-${section.slotKey}`}
            data-testid={`slot-section-${section.slotKey}`}
            className="space-y-6"
          >
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div className="max-w-2xl space-y-1">
                <div className="flex items-center gap-2">
                  <h2
                    id={`heading-${section.slotKey}`}
                    className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl"
                  >
                    {section.title}
                  </h2>
                  <span className="font-mono-tabular rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                    {section.count}
                  </span>
                </div>
                {section.subtitle ? (
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {section.subtitle}
                  </p>
                ) : null}
              </div>
            </div>

            {!hasItems ? (
              <EmptyState
                title={`No ${section.title.toLowerCase()} currently available`}
                description="Materials for this section are being reviewed and catalogued. They will appear automatically as they are verified."
              />
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => {
                  switch (section.entityType) {
                    case 'RESOURCE':
                      return (
                        <ResourceCard
                          key={item.id}
                          item={item as HomepageResourceCardDto}
                        />
                      );
                    case 'UPDATE':
                      return (
                        <UpdateCard
                          key={item.id}
                          item={item as HomepageUpdateCardDto}
                        />
                      );
                    case 'CALENDAR_EVENT':
                      return (
                        <CalendarCard
                          key={item.id}
                          item={item as HomepageCalendarHighlightCardDto}
                        />
                      );
                    case 'SUBJECT':
                      return (
                        <CurriculumShortcutCard
                          key={item.id}
                          item={item as CurriculumShortcutCardDto}
                        />
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
