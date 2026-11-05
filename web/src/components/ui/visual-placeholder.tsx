import React from 'react';

export type ApprovedAspectRatio = '16:9' | '4:3' | '3:4' | '1:1';
export type VisualSurfaceSlot =
  | 'homepage-hero'
  | 'subject-category'
  | 'resource-card'
  | 'resource-preview';

const ASPECT_RATIO_CLASSES: Record<ApprovedAspectRatio, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
  '1:1': 'aspect-square',
};

const FILENAME_LIKE_ALT_REGEX =
  /^(?:img[_-]?\d+|dsc[_-]?\d+|photo[_-]?\d+|image[_-]?\d+|untitled|placeholder)(?:\.[a-z0-9]{2,5})?$|(?:\.(?:png|jpe?g|webp|avif|gif|svg|pdf))$/i;

const FORBIDDEN_USER_UPLOAD_PATH_REGEX =
  /(?:^|\/)(?:resource_files|uploads|user-uploads|tmp|unmoderated|s3|r2)(?:\/|$)/i;

/**
 * Enforces WCAG 2.1 AA meaningful alt-text rules for informative visual frames (AC-12).
 * Rejects empty strings, single-word placeholders, or raw camera/file names.
 */
export function validateAccessibleImageLabel(rawLabel: string): string {
  const normalized = rawLabel.trim();
  if (normalized.length < 8) {
    throw new Error(
      'Informative visual frame requires a descriptive accessible label (>= 8 characters).',
    );
  }
  if (FILENAME_LIKE_ALT_REGEX.test(normalized)) {
    throw new Error(
      `Accessible visual label "${normalized}" resembles a raw filename or placeholder token.`,
    );
  }
  return normalized;
}

/**
 * Curated vs. User-Submitted Firewall Guard (AC-12):
 * Rejects external origins and unmoderated `files.resource_files` object keys from curated UI slots.
 */
export function assertCuratedVisualSourceAllowed(candidatePath: string): string {
  const trimmed = candidatePath.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('data:')
  ) {
    throw new Error('External or data URLs are forbidden in curated platform visual slots.');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('Curated visual path must be a root-relative static asset path.');
  }
  if (FORBIDDEN_USER_UPLOAD_PATH_REGEX.test(trimmed)) {
    throw new Error(
      'Unmoderated user-submitted resource_files paths are strictly prohibited in curated visual slots.',
    );
  }
  return trimmed;
}

interface BaseVisualPlaceholderProps {
  aspectRatio: ApprovedAspectRatio;
  slot: VisualSurfaceSlot;
  captionTitle?: string;
  captionMeta?: string;
  className?: string;
}

export interface InformativeVisualPlaceholderProps extends BaseVisualPlaceholderProps {
  decorative?: false;
  label: string;
}

export interface DecorativeVisualPlaceholderProps extends BaseVisualPlaceholderProps {
  decorative: true;
  label?: never;
}

export type VisualPlaceholderProps =
  | InformativeVisualPlaceholderProps
  | DecorativeVisualPlaceholderProps;

/**
 * Phase 1 Frozen Option A Zero-Broken-Image Placeholder Primitive:
 * - Renders zero raster images (`<img>` / external URLs) while preserving exact aspect-ratio geometry.
 * - Enforces informative `role="img"` + validated `aria-label` OR leaf `aria-hidden="true"` when `decorative: true`.
 */
export function VisualPlaceholder(props: VisualPlaceholderProps) {
  const { aspectRatio, slot, captionTitle, captionMeta, className = '' } = props;
  const ratioClass = ASPECT_RATIO_CLASSES[aspectRatio];

  if (props.decorative === true) {
    return (
      <div
        aria-hidden="true"
        data-visual-slot={slot}
        data-aspect-ratio={aspectRatio}
        className={`relative w-full overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--placeholder-surface)] select-none ${ratioClass} ${className}`.trim()}
      >
        <PlaceholderVectorMotif slot={slot} />
      </div>
    );
  }

  const validatedLabel = validateAccessibleImageLabel(props.label);

  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`.trim()}>
      <div
        role="img"
        aria-label={validatedLabel}
        data-visual-slot={slot}
        data-aspect-ratio={aspectRatio}
        className={`relative w-full overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--placeholder-surface)] ${ratioClass}`}
      >
        <PlaceholderVectorMotif slot={slot} />
        <div
          aria-hidden="true"
          style={{ background: 'var(--hero-scrim)' }}
          className="pointer-events-none absolute inset-0"
        />
        {captionTitle || captionMeta ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/92 px-4 py-3 backdrop-blur-xs"
          >
            {captionTitle ? (
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {captionTitle}
              </span>
            ) : null}
            {captionMeta ? (
              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                {captionMeta}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

function PlaceholderVectorMotif({ slot }: { slot: VisualSurfaceSlot }) {
  return (
    <svg
      viewBox="0 0 640 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <defs>
        <pattern
          id={`grid-${slot}`}
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 32 0 L 0 0 0 32"
            fill="none"
            stroke="var(--placeholder-grid)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="640" height="360" fill={`url(#grid-${slot})`} />
      {/* Stylized Kenyan classroom desk & open curriculum workbook geometry */}
      <rect
        x="116"
        y="76"
        width="408"
        height="196"
        rx="14"
        fill="var(--bg-surface)"
        stroke="var(--placeholder-ink)"
        strokeWidth="2"
      />
      <line
        x1="320"
        y1="96"
        x2="320"
        y2="252"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M156 122H284M156 150H268M156 178H276M156 206H236"
        stroke="var(--placeholder-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.78"
      />
      <rect
        x="356"
        y="118"
        width="128"
        height="76"
        rx="8"
        stroke="var(--placeholder-warm)"
        strokeWidth="2.5"
      />
      <path
        d="M376 174L406 146L432 166L464 136"
        stroke="var(--placeholder-warm)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M356 218H484M356 238H444"
        stroke="var(--placeholder-ink)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
