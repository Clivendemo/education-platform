export interface ApiSuccessEnvelope<T> {
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export interface HealthStatusDto {
  status: 'ok' | 'degraded';
  timestamp: string;
}

export interface CsrfBootstrapDto {
  csrfToken: string;
  expiresInSeconds: number;
}

export interface AuthSessionUserDto {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AnalyticsEventInput {
  eventCode: string;
  country?: string;
  entityType?: string;
  entityId?: string;
  anonymousSessionId?: string;
  context?: Record<string, unknown>;
}

export interface AnalyticsEventResponseDto {
  id?: string;
  deduplicated?: boolean;
  recorded?: boolean;
  [key: string]: unknown;
}

export interface CheckoutItemInput {
  offerId: string;
  quantity?: number;
}

export interface CheckoutOrderInput {
  items: CheckoutItemInput[];
}

export interface CheckoutOrderDto {
  id: string;
  status: string;
  currencyCode?: string;
  totalAmountMinor?: number;
  [key: string]: unknown;
}

export interface PlatformReadinessSnapshot {
  reachable: boolean;
  status: 'ok' | 'unavailable';
  checkedAtIso: string;
  countryCode: string;
}

// ============================================================================
// Phase 2: Public Homepage, Resource Types & Search Autocomplete Contracts
// ============================================================================

export type HomepageSlotKey =
  | 'trending_resources'
  | 'most_downloaded_resources'
  | 'curated_resources'
  | 'education_updates'
  | 'calendar_highlights'
  | 'curriculum_shortcuts';

export type HomepageEntityType = 'RESOURCE' | 'UPDATE' | 'CALENDAR_EVENT' | 'SUBJECT';

export type HomepageSlotMode = 'AUTOMATED' | 'CURATED_HYBRID' | 'MANUAL_OVERRIDE';

export interface HomepageCountrySummaryDto {
  id: string;
  name: string;
  isoCode: string;
  urlPrefix: string;
  currencyCode: string;
}

export interface HomepageResourceCardDto {
  id: string;
  entityType: 'RESOURCE';
  title: string;
  slug: string;
  description: string | null;
  isPinned: boolean;
  qualityLabel: string;
  quality: {
    effectiveTier: string;
    label: string;
    displayMark: string | null;
    isVerified: boolean;
    isPremium: boolean;
    verifiedAt: string | null;
  };
  resourceType: {
    id: string;
    code: string;
    name: string;
    slug: string;
    pillar: string;
  };
  curriculum: {
    id: string;
    code: string | null;
    name: string;
    slug: string;
  } | null;
  educationLevel: {
    id: string;
    code: string | null;
    name: string;
    slug: string;
  } | null;
  grade: {
    id: string;
    code: string | null;
    name: string;
    slug: string;
  } | null;
  subject: {
    id: string;
    code: string | null;
    name: string;
    slug: string;
  } | null;
  topic: {
    id: string;
    code: string | null;
    name: string;
    slug: string;
  } | null;
  publishedVersion: {
    id: string;
    versionNumber: number;
    versionLabel: string;
    publishedAt: string;
  };
}

export interface HomepageUpdateCardDto {
  id: string;
  entityType: 'UPDATE';
  title: string;
  slug: string;
  summary: string | null;
  publishedAt: string;
  isPinned: boolean;
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface HomepageCalendarHighlightCardDto {
  id: string;
  entityType: 'CALENDAR_EVENT';
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  isPinned: boolean;
  eventType: {
    id: string;
    name: string;
    slug: string;
  };
  calendar: {
    id: string;
    name: string;
    academicYear: string | null;
  };
}

export interface CurriculumShortcutCardDto {
  id: string;
  entityType: 'SUBJECT';
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  isPinned: boolean;
  publishedResourceCount: number;
  curriculum: {
    id: string;
    name: string;
    slug: string;
    code: string | null;
  };
  educationLevel: {
    id: string;
    name: string;
    slug: string;
    sequenceOrder: number;
  };
  grade: {
    id: string;
    name: string;
    slug: string;
    sequenceOrder: number;
  };
  pathway: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export type HomepageSectionItemDto =
  | HomepageResourceCardDto
  | HomepageUpdateCardDto
  | HomepageCalendarHighlightCardDto
  | CurriculumShortcutCardDto;

export interface HomepageSectionDto {
  slotKey: HomepageSlotKey;
  slotOrder: 1 | 2 | 3 | 4 | 5 | 6;
  entityType: HomepageEntityType;
  mode: HomepageSlotMode;
  title: string;
  subtitle: string | null;
  maxItems: number;
  count: number;
  items: HomepageSectionItemDto[];
}

export interface PublicHomepagePayload {
  country: HomepageCountrySummaryDto;
  source: 'PUBLISHED_CONFIGURATION' | 'DEFAULT_FALLBACK';
  configuration: {
    id: string;
    versionNumber: number;
  } | null;
  evaluatedAt: string;
  sections: HomepageSectionDto[];
}

export interface PublicHomepageResponse {
  data: PublicHomepagePayload;
  _diagnostics?: {
    cacheHit: boolean;
    rebuildCount: number;
    lazyReconciled: boolean;
  };
}

export type ResourcePillar =
  | 'PAST_PAPERS'
  | 'LESSON_PLANS'
  | 'SCHEMES_OF_WORK'
  | 'NOTES_REVISION'
  | 'SCHOOL_DOCUMENTS'
  | 'ACADEMIC_CALENDAR'
  | 'EDUCATION_UPDATES'
  | 'TEACHER_RESOURCES';

export interface ResourceTypeResult {
  id: string;
  code: string;
  name: string;
  slug: string;
  pillar: ResourcePillar;
  description?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  sequenceOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutocompleteSuggestion {
  text: string;
  type: 'RESOURCE_TITLE' | 'CURRICULUM_TOPIC';
  resourceId?: string;
  slug?: string;
  context?: {
    country?: string;
    curriculum?: string;
    grade?: string;
    subject?: string;
  };
}

export interface AutocompleteResponse {
  data: AutocompleteSuggestion[];
  meta: {
    count: number;
    query: string;
    fallbackUsed: boolean;
  };
}

