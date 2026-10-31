import { sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  CANONICAL_HOMEPAGE_SLOTS,
  CANONICAL_SLOT_BY_KEY,
  type HomepageConfigStatus,
  type HomepageEntityType,
  type HomepageSlotKey,
  type HomepageSlotMode,
} from '../db/schema/homepage.js';
import {
  defaultGeographyService,
  type CountryResult,
  type GeographyService,
} from './geography.service.js';
import {
  defaultAuditService,
  type AuditService,
} from './audit.service.js';
import {
  resolveCanonicalQuality,
} from './recommendations/recommendation-scoring.service.js';
import {
  defaultHomepageCacheService,
  HOMEPAGE_SLOT_CANDIDATE_FETCH_LIMIT,
  HomepageCacheService,
  type CachedPinnedCandidateMeta,
  type HomepageCountrySkeleton,
  type HomepageSlotSkeleton,
} from './homepage-cache.js';
import {
  evaluatePinWindow,
  extractPinnedItemEntityId,
  parseEvaluationTimestamp,
  type HomepageEligibilityDiagnostic,
} from './homepage-eligibility.js';

export const COUNTRY_IDENTIFIER_REGEX = /^[A-Za-z0-9-]{1,64}$/;

export class HomepageError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'HOMEPAGE_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HomepageError';
  }
}

export class HomepageDatabaseUnavailableError extends HomepageError {
  constructor(
    message: string = 'Homepage intelligence database is temporarily unavailable.',
  ) {
    super(message, 503, 'HOMEPAGE_DATABASE_UNAVAILABLE');
    this.name = 'HomepageDatabaseUnavailableError';
  }
}

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

export interface PreviewPinnedItemInput {
  position: number;
  entityId: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  pinNote?: string | null;
}

export interface PreviewSlotInput {
  slotKey: HomepageSlotKey;
  mode: HomepageSlotMode;
  sectionTitle?: string;
  sectionSubtitle?: string | null;
  maxItems?: number;
  items?: PreviewPinnedItemInput[];
}

export interface HomepagePreviewItemDiagnosticDto {
  slotKey: HomepageSlotKey;
  position: number;
  entityType: HomepageEntityType;
  entityId: string;
  included: boolean;
  entityDiagnostic: HomepageEligibilityDiagnostic;
  pinWindowDiagnostic: HomepageEligibilityDiagnostic;
  effectiveReason: HomepageEligibilityDiagnostic;
}

export interface HomepagePreviewRenderResult {
  country: HomepageCountrySummaryDto;
  source:
    | 'PUBLISHED_CONFIGURATION'
    | 'CONFIGURATION_PREVIEW'
    | 'AD_HOC_PREVIEW'
    | 'DEFAULT_FALLBACK';
  configuration: {
    id: string;
    versionNumber: number;
    status: HomepageConfigStatus;
  } | null;
  evaluatedAt: string;
  sections: HomepageSectionDto[];
  diagnostics: HomepagePreviewItemDiagnosticDto[];
}

export interface GetPublicHomepageParams {
  countryIdentifier?: string;
  evalNow?: unknown;
  bypassCache?: boolean;
}

export interface HomepageService {
  getPublicHomepage(params?: GetPublicHomepageParams): Promise<PublicHomepageResponse>;
  renderPreview(params: {
    country: CountryResult;
    source:
      | 'PUBLISHED_CONFIGURATION'
      | 'CONFIGURATION_PREVIEW'
      | 'AD_HOC_PREVIEW'
      | 'DEFAULT_FALLBACK';
    configuration: {
      id: string;
      versionNumber: number;
      status: HomepageConfigStatus;
    } | null;
    slots: PreviewSlotInput[];
    evalTime: Date;
  }): Promise<HomepagePreviewRenderResult>;
}

interface HydratedEntitiesBundle {
  resources: Map<string, Omit<HomepageResourceCardDto, 'isPinned'>>;
  updates: Map<string, Omit<HomepageUpdateCardDto, 'isPinned'>>;
  calendarEvents: Map<string, Omit<HomepageCalendarHighlightCardDto, 'isPinned'>>;
  subjects: Map<string, Omit<CurriculumShortcutCardDto, 'isPinned'>>;
}

function toIsoTimestamp(val: unknown): string {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'string') {
    const parsed = new Date(val);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
    return val;
  }
  return new Date(0).toISOString();
}

function toDateOrNull(val: unknown): Date | null {
  if (val instanceof Date && Number.isFinite(val.getTime())) {
    return val;
  }
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    if (Number.isFinite(ms)) {
      return new Date(ms);
    }
  }
  return null;
}

export class DefaultHomepageService implements HomepageService {
  constructor(
    private readonly dbInstance: AppDatabase = defaultDb,
    private readonly geographyService: GeographyService = defaultGeographyService,
    private readonly cacheService: HomepageCacheService = defaultHomepageCacheService,
    private readonly auditService: AuditService = defaultAuditService,
  ) {}

  async getPublicHomepage(
    params: GetPublicHomepageParams = {},
  ): Promise<PublicHomepageResponse> {
    const parsedEval = parseEvaluationTimestamp(params.evalNow);
    if (!parsedEval.ok) {
      throw new HomepageError(parsedEval.message, 400, parsedEval.code);
    }
    const evalTime = parsedEval.date;

    const effectiveIdentifier =
      params.countryIdentifier === undefined ? 'KE' : params.countryIdentifier;

    if (
      typeof effectiveIdentifier !== 'string' ||
      !COUNTRY_IDENTIFIER_REGEX.test(effectiveIdentifier)
    ) {
      throw new HomepageError(
        'Country identifier must be 1 to 64 alphanumeric or hyphen characters without whitespace.',
        400,
        'VALIDATION_ERROR',
      );
    }

    try {
      const country = await this.geographyService.getActiveCountryByIdentifier(
        effectiveIdentifier,
      );
      if (!country || country.status !== 'ACTIVE') {
        throw new HomepageError(
          'The requested country was not found.',
          404,
          'COUNTRY_NOT_FOUND',
        );
      }

      // 1. Lazy schedule promotion / expired-window archive reconciliation (Decision D4)
      const lazyReconciled = await this.reconcileDueSchedulesIfNeeded(
        country.id,
        evalTime,
      );

      let cacheHit = false;
      let rebuildCount = 0;
      let skeleton: HomepageCountrySkeleton;

      const buildFn = () => this.buildCountrySkeleton(country.id, evalTime);

      if (params.bypassCache === true) {
        const raw = await buildFn();
        skeleton = {
          ...raw,
          builtAtMs: evalTime.getTime(),
          expiresAtMs: evalTime.getTime(),
        };
      } else {
        const got = await this.cacheService.getOrBuild(country.id, buildFn);
        skeleton = got.skeleton;
        cacheHit = got.cacheHit;
      }

      // 2. Live PostgreSQL eligibility re-validation + sanitized card hydration on EVERY read
      let rendered = await this.hydrateAndAssembleSections(
        country.id,
        skeleton,
        evalTime,
      );

      // 3. Bounded single-shot underfill recovery (R17-03): at most 1 rebuild per request
      if (
        cacheHit &&
        params.bypassCache !== true &&
        this.cacheService.shouldTriggerUnderfillRebuild(
          country.id,
          rendered.slotLiveCounts,
          skeleton,
        )
      ) {
        skeleton = await this.cacheService.forceCoalescedRebuild(
          country.id,
          buildFn,
        );
        rebuildCount = 1;
        rendered = await this.hydrateAndAssembleSections(
          country.id,
          skeleton,
          evalTime,
        );
      }

      const countrySummary: HomepageCountrySummaryDto = {
        id: country.id,
        name: country.name,
        isoCode: country.isoCode,
        urlPrefix: country.urlPrefix,
        currencyCode: country.currencyCode,
      };

      return {
        data: {
          country: countrySummary,
          source: skeleton.source,
          configuration:
            skeleton.configurationId !== null && skeleton.versionNumber !== null
              ? {
                  id: skeleton.configurationId,
                  versionNumber: skeleton.versionNumber,
                }
              : null,
          evaluatedAt: evalTime.toISOString(),
          sections: rendered.sections,
        },
        _diagnostics: {
          cacheHit,
          rebuildCount,
          lazyReconciled,
        },
      };
    } catch (err) {
      if (err instanceof HomepageError) {
        throw err;
      }
      throw new HomepageDatabaseUnavailableError();
    }
  }

  async renderPreview(params: {
    country: CountryResult;
    source:
      | 'PUBLISHED_CONFIGURATION'
      | 'CONFIGURATION_PREVIEW'
      | 'AD_HOC_PREVIEW'
      | 'DEFAULT_FALLBACK';
    configuration: {
      id: string;
      versionNumber: number;
      status: HomepageConfigStatus;
    } | null;
    slots: PreviewSlotInput[];
    evalTime: Date;
  }): Promise<HomepagePreviewRenderResult> {
    try {
      const { country, source, configuration, evalTime } = params;
      const slotInputByKey = new Map<HomepageSlotKey, PreviewSlotInput>();
      for (const s of params.slots) {
        slotInputByKey.set(s.slotKey, s);
      }

      const slotSkeletons: HomepageSlotSkeleton[] = [];
      const diagnostics: HomepagePreviewItemDiagnosticDto[] = [];

      for (const spec of CANONICAL_HOMEPAGE_SLOTS) {
        const override = slotInputByKey.get(spec.slotKey);
        const mode: HomepageSlotMode = override?.mode ?? 'AUTOMATED';
        const title = override?.sectionTitle?.trim() || spec.defaultTitle;
        const subtitle =
          override?.sectionSubtitle === undefined
            ? spec.defaultSubtitle
            : override.sectionSubtitle;
        const maxItems = Math.min(
          6,
          Math.max(1, Math.trunc(override?.maxItems ?? spec.defaultMaxItems)),
        );

        const rawPinned = [...(override?.items ?? [])].sort(
          (a, b) => a.position - b.position,
        );

        const autoIds =
          mode === 'MANUAL_OVERRIDE'
            ? []
            : await this.fetchAutomatedCandidatesForSlot(
                country.id,
                spec.slotKey,
                evalTime,
              );
        const autoSet = new Set(autoIds);

        // Evaluate exact live diagnostics for all pinned items in preview
        for (const pin of rawPinned) {
          const entityDiag = await this.evaluateSingleEntityDiagnostic(
            country.id,
            spec.entityType,
            pin.entityId,
            evalTime,
          );
          const pinDiag = evaluatePinWindow(
            pin.startsAt ?? null,
            pin.endsAt ?? null,
            evalTime,
          );
          const effectiveReason =
            entityDiag !== 'ELIGIBLE'
              ? entityDiag
              : pinDiag !== 'ELIGIBLE'
                ? pinDiag
                : 'ELIGIBLE';

          diagnostics.push({
            slotKey: spec.slotKey,
            position: pin.position,
            entityType: spec.entityType,
            entityId: pin.entityId,
            included: effectiveReason === 'ELIGIBLE' && mode !== 'AUTOMATED',
            entityDiagnostic: entityDiag,
            pinWindowDiagnostic: pinDiag,
            effectiveReason,
          });
        }

        const pinnedMeta: CachedPinnedCandidateMeta[] =
          mode === 'AUTOMATED'
            ? []
            : rawPinned.map((p) => ({
                entityId: p.entityId,
                startsAtMs: p.startsAt ? p.startsAt.getTime() : null,
                endsAtMs: p.endsAt ? p.endsAt.getTime() : null,
                position: p.position,
                isAutomatedCandidate: autoSet.has(p.entityId),
              }));

        const combinedRawIds =
          mode === 'MANUAL_OVERRIDE'
            ? pinnedMeta.map((p) => p.entityId)
            : mode === 'CURATED_HYBRID'
              ? [...pinnedMeta.map((p) => p.entityId), ...autoIds]
              : autoIds;

        const bounded = HomepageCacheService.boundSlotCandidates(combinedRawIds);

        slotSkeletons.push({
          slotKey: spec.slotKey,
          slotOrder: spec.slotOrder,
          entityType: spec.entityType,
          mode,
          title,
          subtitle,
          maxItems,
          candidateIds: bounded.candidateIds,
          pinnedItems: pinnedMeta,
          survivorsCountAtBuild: bounded.survivorsCountAtBuild,
          hasMoreBeyondCap:
            mode === 'MANUAL_OVERRIDE' ? false : bounded.hasMoreBeyondCap,
        });
      }

      const transientSkeleton: HomepageCountrySkeleton = {
        countryId: country.id,
        source:
          source === 'DEFAULT_FALLBACK'
            ? 'DEFAULT_FALLBACK'
            : 'PUBLISHED_CONFIGURATION',
        configurationId: configuration?.id ?? null,
        versionNumber: configuration?.versionNumber ?? null,
        scheduledUntilAtMs: null,
        builtAtMs: evalTime.getTime(),
        expiresAtMs: evalTime.getTime(),
        slots: slotSkeletons,
      };

      const hydrated = await this.hydrateAndAssembleSections(
        country.id,
        transientSkeleton,
        evalTime,
      );

      return {
        country: {
          id: country.id,
          name: country.name,
          isoCode: country.isoCode,
          urlPrefix: country.urlPrefix,
          currencyCode: country.currencyCode,
        },
        source,
        configuration,
        evaluatedAt: evalTime.toISOString(),
        sections: hydrated.sections,
        diagnostics,
      };
    } catch (err) {
      if (err instanceof HomepageError) {
        throw err;
      }
      throw new HomepageDatabaseUnavailableError();
    }
  }

  private async evaluateSingleEntityDiagnostic(
    countryId: string,
    entityType: HomepageEntityType,
    entityId: string,
    evalTime: Date,
  ): Promise<HomepageEligibilityDiagnostic> {
    const res = await this.dbInstance.execute(sql`
      SELECT "content"."fn_evaluate_homepage_entity_eligibility"(
        ${countryId}::uuid,
        ${entityType}::"content"."homepage_entity_type",
        ${entityId}::uuid,
        ${evalTime.toISOString()}::timestamptz
      ) AS diag
    `);
    const diag = res.rows[0]?.diag;
    return (typeof diag === 'string'
      ? diag
      : 'ENTITY_NOT_FOUND') as HomepageEligibilityDiagnostic;
  }

  /**
   * Lazy schedule promotion and expired-window archival under per-country transaction advisory lock (Decision D4).
   */
  private async reconcileDueSchedulesIfNeeded(
    countryId: string,
    evalTime: Date,
  ): Promise<boolean> {
    const evalIso = evalTime.toISOString();

    const probe = await this.dbInstance.execute(sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM "content"."homepage_configurations" c
          WHERE c.country_id = ${countryId}::uuid
            AND c.status = 'SCHEDULED'
            AND c.scheduled_start_at <= ${evalIso}::timestamptz
            AND (c.scheduled_until_at IS NULL OR c.scheduled_until_at > ${evalIso}::timestamptz)
        ) AS has_due_scheduled,
        EXISTS (
          SELECT 1
          FROM "content"."homepage_configurations" c
          WHERE c.country_id = ${countryId}::uuid
            AND c.status = 'PUBLISHED'
            AND c.scheduled_until_at IS NOT NULL
            AND c.scheduled_until_at <= ${evalIso}::timestamptz
        ) AS has_expired_published
    `);

    const probeRow = probe.rows[0] as
      | { has_due_scheduled?: boolean; has_expired_published?: boolean }
      | undefined;

    if (!probeRow?.has_due_scheduled && !probeRow?.has_expired_published) {
      return false;
    }

    const mutated = await this.dbInstance.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext('homepage_cfg_country'),
          hashtext(${countryId}::text)
        )
      `);

      const currentPubRes = await tx.execute(sql`
        SELECT id, version_number, scheduled_until_at, updated_by
        FROM "content"."homepage_configurations"
        WHERE country_id = ${countryId}::uuid
          AND status = 'PUBLISHED'
        FOR UPDATE
      `);
      const currentPublished = currentPubRes.rows[0] as
        | {
            id: string;
            version_number: number;
            scheduled_until_at: string | Date | null;
            updated_by: string;
          }
        | undefined;

      const dueCandidatesRes = await tx.execute(sql`
        SELECT id, version_number, updated_by
        FROM "content"."homepage_configurations"
        WHERE country_id = ${countryId}::uuid
          AND status = 'SCHEDULED'
          AND scheduled_start_at <= ${evalIso}::timestamptz
          AND (scheduled_until_at IS NULL OR scheduled_until_at > ${evalIso}::timestamptz)
        ORDER BY scheduled_start_at DESC, version_number DESC
        FOR UPDATE
      `);

      let winnerDue: {
        id: string;
        version_number: number;
        updated_by: string;
      } | null = null;

      for (const rawRow of dueCandidatesRes.rows) {
        const candidate = rawRow as {
          id: string;
          version_number: number;
          updated_by: string;
        };
        const valid = await this.isConfigurationValidForLivePublish(
          tx,
          candidate.id,
          countryId,
          evalTime,
        );
        if (valid) {
          winnerDue = candidate;
          break;
        }
      }

      if (winnerDue) {
        if (currentPublished) {
          await tx.execute(sql`
            UPDATE "content"."homepage_configurations"
            SET
              status = 'SUPERSEDED',
              superseded_at = ${evalIso}::timestamptz,
              superseded_by_configuration_id = ${winnerDue.id}::uuid,
              updated_by = ${winnerDue.updated_by}::uuid,
              updated_at = ${evalIso}::timestamptz
            WHERE id = ${currentPublished.id}::uuid
          `);
        }

        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'PUBLISHED',
            published_at = ${evalIso}::timestamptz,
            published_by = ${winnerDue.updated_by}::uuid,
            updated_at = ${evalIso}::timestamptz
          WHERE id = ${winnerDue.id}::uuid
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.configuration.schedule_activate',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: winnerDue.id,
            actorType: 'SYSTEM',
            actorUserId: null,
            actorSnapshot: { actorType: 'SYSTEM' },
            outcome: 'SUCCESS',
            countryId,
            occurredAt: evalTime,
            afterState: {
              configurationId: winnerDue.id,
              versionNumber: Number(winnerDue.version_number),
              status: 'PUBLISHED',
              supersededConfigurationId: currentPublished?.id ?? null,
            },
          },
          tx,
        );

        return true;
      }

      // Decision D4: Active PUBLISHED configuration expired with no due replacement -> ARCHIVED + DEFAULT_FALLBACK
      const pubUntil = toDateOrNull(currentPublished?.scheduled_until_at);
      if (
        currentPublished &&
        pubUntil !== null &&
        pubUntil.getTime() <= evalTime.getTime()
      ) {
        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'ARCHIVED',
            archived_at = ${evalIso}::timestamptz,
            archived_by = NULL,
            updated_by = ${currentPublished.updated_by}::uuid,
            updated_at = ${evalIso}::timestamptz
          WHERE id = ${currentPublished.id}::uuid
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.configuration.expire_archive',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: currentPublished.id,
            actorType: 'SYSTEM',
            actorUserId: null,
            actorSnapshot: { actorType: 'SYSTEM' },
            outcome: 'SUCCESS',
            countryId,
            occurredAt: evalTime,
            beforeState: {
              configurationId: currentPublished.id,
              status: 'PUBLISHED',
            },
            afterState: {
              configurationId: currentPublished.id,
              status: 'ARCHIVED',
              fallbackMode: 'DEFAULT_FALLBACK',
            },
          },
          tx,
        );

        return true;
      }

      return false;
    });

    if (mutated) {
      this.cacheService.invalidateCountry(countryId);
    }

    return mutated;
  }

  private async isConfigurationValidForLivePublish(
    executor: Pick<AppDatabase, 'execute'>,
    configurationId: string,
    countryId: string,
    evalTime: Date,
  ): Promise<boolean> {
    const evalIso = evalTime.toISOString();
    const checkRes = await executor.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM "content"."homepage_configuration_slots" s
          WHERE s.configuration_id = ${configurationId}::uuid
        ) = 6 AS has_six_slots,
        NOT EXISTS (
          SELECT 1
          FROM "content"."homepage_configuration_slots" s
          WHERE s.configuration_id = ${configurationId}::uuid
            AND s.mode = 'MANUAL_OVERRIDE'
            AND NOT EXISTS (
              SELECT 1
              FROM "content"."homepage_configuration_items" i
              WHERE i.slot_id = s.id
            )
        ) AS manual_slots_populated,
        NOT EXISTS (
          SELECT 1
          FROM "content"."homepage_configuration_items" i
          WHERE i.configuration_id = ${configurationId}::uuid
            AND (
              "content"."fn_is_homepage_entity_eligible"(
                ${countryId}::uuid,
                i.entity_type,
                COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
                ${evalIso}::timestamptz
              ) IS NOT TRUE
              OR (i.ends_at IS NOT NULL AND (i.ends_at > ${evalIso}::timestamptz) IS NOT TRUE)
            )
        ) AS all_items_eligible
    `);

    const row = checkRes.rows[0] as
      | {
          has_six_slots?: boolean;
          manual_slots_populated?: boolean;
          all_items_eligible?: boolean;
        }
      | undefined;

    return Boolean(
      row?.has_six_slots &&
        row?.manual_slots_populated &&
        row?.all_items_eligible,
    );
  }

  private async buildCountrySkeleton(
    countryId: string,
    evalTime: Date,
  ): Promise<Omit<HomepageCountrySkeleton, 'builtAtMs' | 'expiresAtMs'>> {
    const activePubRes = await this.dbInstance.execute(sql`
      SELECT id, version_number, scheduled_until_at
      FROM "content"."homepage_configurations"
      WHERE country_id = ${countryId}::uuid
        AND status = 'PUBLISHED'
      LIMIT 1
    `);

    const activePub = activePubRes.rows[0] as
      | {
          id: string;
          version_number: number;
          scheduled_until_at: string | Date | null;
        }
      | undefined;

    if (!activePub) {
      // Deterministic DEFAULT_FALLBACK: 6 canonical AUTOMATED slots with max_items = 6
      const fallbackSlots: HomepageSlotSkeleton[] = [];
      for (const spec of CANONICAL_HOMEPAGE_SLOTS) {
        const rawIds = await this.fetchAutomatedCandidatesForSlot(
          countryId,
          spec.slotKey,
          evalTime,
        );
        const bounded = HomepageCacheService.boundSlotCandidates(rawIds);
        fallbackSlots.push({
          slotKey: spec.slotKey,
          slotOrder: spec.slotOrder,
          entityType: spec.entityType,
          mode: 'AUTOMATED',
          title: spec.defaultTitle,
          subtitle: spec.defaultSubtitle,
          maxItems: spec.defaultMaxItems,
          candidateIds: bounded.candidateIds,
          pinnedItems: [],
          survivorsCountAtBuild: bounded.survivorsCountAtBuild,
          hasMoreBeyondCap: bounded.hasMoreBeyondCap,
        });
      }

      return {
        countryId,
        source: 'DEFAULT_FALLBACK',
        configurationId: null,
        versionNumber: null,
        scheduledUntilAtMs: null,
        slots: fallbackSlots,
      };
    }

    const slotsRes = await this.dbInstance.execute(sql`
      SELECT
        id,
        slot_key,
        slot_order,
        entity_type,
        mode,
        section_title,
        section_subtitle,
        max_items
      FROM "content"."homepage_configuration_slots"
      WHERE configuration_id = ${activePub.id}::uuid
      ORDER BY slot_order ASC
    `);

    const itemsRes = await this.dbInstance.execute(sql`
      SELECT
        slot_id,
        entity_type,
        position,
        resource_id,
        update_id,
        calendar_event_id,
        subject_id,
        starts_at,
        ends_at
      FROM "content"."homepage_configuration_items"
      WHERE configuration_id = ${activePub.id}::uuid
      ORDER BY slot_id, position ASC
    `);

    const itemsBySlotId = new Map<
      string,
      Array<{
        entityType: HomepageEntityType;
        position: number;
        entityId: string;
        startsAt: Date | null;
        endsAt: Date | null;
      }>
    >();

    for (const raw of itemsRes.rows) {
      const row = raw as {
        slot_id: string;
        entity_type: HomepageEntityType;
        position: number;
        resource_id: string | null;
        update_id: string | null;
        calendar_event_id: string | null;
        subject_id: string | null;
        starts_at: string | Date | null;
        ends_at: string | Date | null;
      };
      const entityId = extractPinnedItemEntityId({
        entityType: row.entity_type,
        resourceId: row.resource_id,
        updateId: row.update_id,
        calendarEventId: row.calendar_event_id,
        subjectId: row.subject_id,
      });
      if (!entityId) continue;

      const list = itemsBySlotId.get(row.slot_id) ?? [];
      list.push({
        entityType: row.entity_type,
        position: Number(row.position),
        entityId,
        startsAt: toDateOrNull(row.starts_at),
        endsAt: toDateOrNull(row.ends_at),
      });
      itemsBySlotId.set(row.slot_id, list);
    }

    const slotByKey = new Map<
      HomepageSlotKey,
      {
        id: string;
        slotKey: HomepageSlotKey;
        slotOrder: 1 | 2 | 3 | 4 | 5 | 6;
        entityType: HomepageEntityType;
        mode: HomepageSlotMode;
        sectionTitle: string;
        sectionSubtitle: string | null;
        maxItems: number;
      }
    >();

    for (const raw of slotsRes.rows) {
      const row = raw as {
        id: string;
        slot_key: HomepageSlotKey;
        slot_order: number;
        entity_type: HomepageEntityType;
        mode: HomepageSlotMode;
        section_title: string;
        section_subtitle: string | null;
        max_items: number;
      };
      slotByKey.set(row.slot_key, {
        id: row.id,
        slotKey: row.slot_key,
        slotOrder: Number(row.slot_order) as 1 | 2 | 3 | 4 | 5 | 6,
        entityType: row.entity_type,
        mode: row.mode,
        sectionTitle: row.section_title,
        sectionSubtitle: row.section_subtitle,
        maxItems: Number(row.max_items),
      });
    }

    const builtSlots: HomepageSlotSkeleton[] = [];
    for (const spec of CANONICAL_HOMEPAGE_SLOTS) {
      const configured = slotByKey.get(spec.slotKey);
      const mode: HomepageSlotMode = configured?.mode ?? 'AUTOMATED';
      const title = configured?.sectionTitle ?? spec.defaultTitle;
      const subtitle =
        configured !== undefined ? configured.sectionSubtitle : spec.defaultSubtitle;
      const maxItems = configured?.maxItems ?? spec.defaultMaxItems;
      const rawPinned = configured ? itemsBySlotId.get(configured.id) ?? [] : [];

      const autoIds =
        mode === 'MANUAL_OVERRIDE'
          ? []
          : await this.fetchAutomatedCandidatesForSlot(
              countryId,
              spec.slotKey,
              evalTime,
            );
      const autoSet = new Set(autoIds);

      const pinnedMeta: CachedPinnedCandidateMeta[] =
        mode === 'AUTOMATED'
          ? []
          : rawPinned.map((p) => ({
              entityId: p.entityId,
              startsAtMs: p.startsAt ? p.startsAt.getTime() : null,
              endsAtMs: p.endsAt ? p.endsAt.getTime() : null,
              position: p.position,
              isAutomatedCandidate: autoSet.has(p.entityId),
            }));

      const combinedIds =
        mode === 'MANUAL_OVERRIDE'
          ? pinnedMeta.map((p) => p.entityId)
          : mode === 'CURATED_HYBRID'
            ? [...pinnedMeta.map((p) => p.entityId), ...autoIds]
            : autoIds;

      const bounded = HomepageCacheService.boundSlotCandidates(combinedIds);

      // Count active build-time survivors accurately so inactive future-window pins
      // never cause spurious underfill rebuild loops in sparse countries (R17-03).
      let buildActiveSurvivors = 0;
      if (mode === 'AUTOMATED') {
        buildActiveSurvivors = bounded.survivorsCountAtBuild;
      } else if (mode === 'MANUAL_OVERRIDE') {
        buildActiveSurvivors = pinnedMeta.filter(
          (p) =>
            evaluatePinWindow(
              p.startsAtMs !== null ? new Date(p.startsAtMs) : null,
              p.endsAtMs !== null ? new Date(p.endsAtMs) : null,
              evalTime,
            ) === 'ELIGIBLE',
        ).length;
      } else {
        const boundedSet = new Set(bounded.candidateIds);
        const activePinSet = new Set<string>();
        for (const p of pinnedMeta) {
          if (
            boundedSet.has(p.entityId) &&
            evaluatePinWindow(
              p.startsAtMs !== null ? new Date(p.startsAtMs) : null,
              p.endsAtMs !== null ? new Date(p.endsAtMs) : null,
              evalTime,
            ) === 'ELIGIBLE'
          ) {
            activePinSet.add(p.entityId);
          }
        }
        const pinnedIdMap = new Map(pinnedMeta.map((p) => [p.entityId, p]));
        let count = activePinSet.size;
        for (const cid of bounded.candidateIds) {
          if (activePinSet.has(cid)) continue;
          const pinEntry = pinnedIdMap.get(cid);
          if (pinEntry && !pinEntry.isAutomatedCandidate) continue;
          count += 1;
        }
        buildActiveSurvivors = count;
      }

      builtSlots.push({
        slotKey: spec.slotKey,
        slotOrder: spec.slotOrder,
        entityType: spec.entityType,
        mode,
        title,
        subtitle,
        maxItems,
        candidateIds: bounded.candidateIds,
        pinnedItems: pinnedMeta,
        survivorsCountAtBuild: buildActiveSurvivors,
        hasMoreBeyondCap:
          mode === 'MANUAL_OVERRIDE' ? false : bounded.hasMoreBeyondCap,
      });
    }

    const untilDate = toDateOrNull(activePub.scheduled_until_at);

    return {
      countryId,
      source: 'PUBLISHED_CONFIGURATION',
      configurationId: activePub.id,
      versionNumber: Number(activePub.version_number),
      scheduledUntilAtMs: untilDate ? untilDate.getTime() : null,
      slots: builtSlots,
    };
  }

  /**
   * Fetches up to LIMIT 11 live-eligible automated candidate IDs per canonical slot.
   */
  private async fetchAutomatedCandidatesForSlot(
    countryId: string,
    slotKey: HomepageSlotKey,
    evalTime: Date,
  ): Promise<string[]> {
    const evalIso = evalTime.toISOString();
    const fetchLimit = HOMEPAGE_SLOT_CANDIDATE_FETCH_LIMIT;

    switch (slotKey) {
      case 'trending_resources': {
        const res = await this.dbInstance.execute(sql`
          SELECT r.id
          FROM "content"."resources" r
          JOIN "content"."resource_versions" rv
            ON rv.resource_id = r.id
           AND rv.status = 'PUBLISHED'
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              SUM(
                CASE aet.event_code
                  WHEN 'download' THEN 3
                  WHEN 'save' THEN 2
                  WHEN 'share' THEN 2
                  WHEN 'preview' THEN 1
                  WHEN 'view' THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS engagement_score_30d
            FROM "analytics"."analytics_events" ae
            JOIN "analytics"."analytics_event_types" aet
              ON aet.id = ae.event_type_id
             AND aet.status = 'ACTIVE'
            WHERE ae.entity_type = 'RESOURCE'
              AND ae.entity_id = r.id
              AND ae.occurred_at > (${evalIso}::timestamptz - interval '30 days')
              AND ae.occurred_at <= ${evalIso}::timestamptz
          ) tel ON TRUE
          LEFT JOIN LATERAL (
            SELECT EXISTS (
              SELECT 1
              FROM "governance"."resource_verifications" ver
              WHERE ver.resource_version_id = rv.id
                AND ver.verification_status = 'VERIFIED'
            ) AS has_active_ver
          ) gv ON TRUE
          WHERE r.country_id = ${countryId}::uuid
            AND r.status = 'PUBLISHED'
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'RESOURCE',
              r.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY
            COALESCE(tel.engagement_score_30d, 0) DESC,
            CASE
              WHEN gv.has_active_ver OR rv.quality_label = 'VERIFIED' THEN 15
              WHEN rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM' THEN 5
              ELSE 0
            END DESC,
            rv.published_at DESC,
            r.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }

      case 'most_downloaded_resources': {
        const res = await this.dbInstance.execute(sql`
          SELECT r.id
          FROM "content"."resources" r
          JOIN "content"."resource_versions" rv
            ON rv.resource_id = r.id
           AND rv.status = 'PUBLISHED'
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS total_downloads,
              COUNT(*) FILTER (
                WHERE ae.occurred_at > (${evalIso}::timestamptz - interval '30 days')
              )::int AS downloads_30d
            FROM "analytics"."analytics_events" ae
            JOIN "analytics"."analytics_event_types" aet
              ON aet.id = ae.event_type_id
             AND aet.event_code = 'download'
             AND aet.status = 'ACTIVE'
            WHERE ae.entity_type = 'RESOURCE'
              AND ae.entity_id = r.id
              AND ae.occurred_at <= ${evalIso}::timestamptz
          ) dl ON TRUE
          LEFT JOIN LATERAL (
            SELECT EXISTS (
              SELECT 1
              FROM "governance"."resource_verifications" ver
              WHERE ver.resource_version_id = rv.id
                AND ver.verification_status = 'VERIFIED'
            ) AS has_active_ver
          ) gv ON TRUE
          WHERE r.country_id = ${countryId}::uuid
            AND r.status = 'PUBLISHED'
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'RESOURCE',
              r.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY
            COALESCE(dl.total_downloads, 0) DESC,
            COALESCE(dl.downloads_30d, 0) DESC,
            CASE
              WHEN gv.has_active_ver OR rv.quality_label = 'VERIFIED' THEN 15
              WHEN rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM' THEN 5
              ELSE 0
            END DESC,
            rv.published_at DESC,
            r.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }

      case 'curated_resources': {
        const res = await this.dbInstance.execute(sql`
          SELECT r.id
          FROM "content"."resources" r
          JOIN "content"."resource_versions" rv
            ON rv.resource_id = r.id
           AND rv.status = 'PUBLISHED'
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) > 0 AS has_active_ver,
              MAX(ver.verified_at) AS latest_verified_at
            FROM "governance"."resource_verifications" ver
            WHERE ver.resource_version_id = rv.id
              AND ver.verification_status = 'VERIFIED'
          ) gv ON TRUE
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) > 0 AS has_rec_pin,
              MIN(rr.priority) AS best_pin_priority
            FROM "content"."resource_recommendation_rules" rr
            WHERE rr.country_id = ${countryId}::uuid
              AND rr.target_resource_id = r.id
              AND rr.rule_type = 'PIN'
              AND rr.status = 'ACTIVE'
          ) rp ON TRUE
          WHERE r.country_id = ${countryId}::uuid
            AND r.status = 'PUBLISHED'
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'RESOURCE',
              r.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY
            (COALESCE(gv.has_active_ver, FALSE) OR rv.quality_label = 'VERIFIED') DESC,
            COALESCE(rp.has_rec_pin, FALSE) DESC,
            rp.best_pin_priority ASC NULLS LAST,
            CASE
              WHEN COALESCE(gv.has_active_ver, FALSE) OR rv.quality_label = 'VERIFIED' THEN 15
              WHEN rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM' THEN 5
              ELSE 0
            END DESC,
            gv.latest_verified_at DESC NULLS LAST,
            rv.published_at DESC,
            r.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }

      case 'education_updates': {
        const res = await this.dbInstance.execute(sql`
          SELECT u.id
          FROM "content"."education_updates" u
          WHERE u.country_id = ${countryId}::uuid
            AND u.publication_status = 'PUBLISHED'
            AND u.published_at IS NOT NULL
            AND u.published_at <= ${evalIso}::timestamptz
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'UPDATE',
              u.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY u.published_at DESC, u.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }

      case 'calendar_highlights': {
        const res = await this.dbInstance.execute(sql`
          SELECT ce.id
          FROM "calendar"."calendar_events" ce
          JOIN "calendar"."calendars" cal ON cal.id = ce.calendar_id
          JOIN "calendar"."calendar_event_types" cet ON cet.id = ce.event_type_id
          WHERE cal.country_id = ${countryId}::uuid
            AND cal.calendar_scope = 'OFFICIAL'
            AND cal.status = 'ACTIVE'
            AND ce.visibility = 'PUBLIC'
            AND ce.status = 'ACTIVE'
            AND ce.source_type = 'OFFICIAL'
            AND COALESCE(ce.end_date, ce.start_date) >= (${evalIso}::timestamptz AT TIME ZONE 'UTC')::date
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'CALENDAR_EVENT',
              ce.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY
            ce.start_date ASC,
            cet.display_order ASC,
            COALESCE(ce.end_date, ce.start_date) ASC,
            ce.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }

      case 'curriculum_shortcuts': {
        const res = await this.dbInstance.execute(sql`
          SELECT s.id
          FROM "taxonomy"."subjects" s
          JOIN "taxonomy"."curriculum_versions" cv ON cv.id = s.curriculum_version_id
          JOIN "taxonomy"."curricula" cur ON cur.id = cv.curriculum_id
          JOIN "taxonomy"."education_levels" el ON el.id = s.education_level_id
          JOIN "taxonomy"."grades" g ON g.id = s.grade_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS pub_res_count
            FROM "content"."resources" r
            WHERE r.subject_id = s.id
              AND r.country_id = ${countryId}::uuid
              AND r.status = 'PUBLISHED'
              AND "content"."fn_is_homepage_entity_eligible"(
                ${countryId}::uuid,
                'RESOURCE',
                r.id,
                ${evalIso}::timestamptz
              ) IS TRUE
          ) rc ON TRUE
          WHERE cv.country_id = ${countryId}::uuid
            AND cv.status = 'CURRENT'
            AND cur.status = 'ACTIVE'
            AND el.status = 'ACTIVE'
            AND g.status = 'ACTIVE'
            AND s.status = 'ACTIVE'
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'SUBJECT',
              s.id,
              ${evalIso}::timestamptz
            ) IS TRUE
          ORDER BY
            (COALESCE(rc.pub_res_count, 0) > 0) DESC,
            COALESCE(rc.pub_res_count, 0) DESC,
            el.sequence_order ASC,
            g.sequence_order ASC,
            s.sequence_order ASC,
            s.id ASC
          LIMIT ${fetchLimit}
        `);
        return res.rows.map((row) => String(row.id));
      }
    }
  }

  private async hydrateAndAssembleSections(
    countryId: string,
    skeleton: HomepageCountrySkeleton,
    evalTime: Date,
  ): Promise<{
    sections: HomepageSectionDto[];
    slotLiveCounts: Map<HomepageSlotKey, number>;
  }> {
    const resourceIds = new Set<string>();
    const updateIds = new Set<string>();
    const calendarEventIds = new Set<string>();
    const subjectIds = new Set<string>();

    for (const slot of skeleton.slots) {
      const targetSet =
        slot.entityType === 'RESOURCE'
          ? resourceIds
          : slot.entityType === 'UPDATE'
            ? updateIds
            : slot.entityType === 'CALENDAR_EVENT'
              ? calendarEventIds
              : subjectIds;

      for (const cid of slot.candidateIds) {
        targetSet.add(cid);
      }
      for (const pin of slot.pinnedItems) {
        targetSet.add(pin.entityId);
      }
    }

    const bundle = await this.batchHydrateEligibleEntities(
      countryId,
      {
        resourceIds: Array.from(resourceIds),
        updateIds: Array.from(updateIds),
        calendarEventIds: Array.from(calendarEventIds),
        subjectIds: Array.from(subjectIds),
      },
      evalTime,
    );

    const sections: HomepageSectionDto[] = [];
    const slotLiveCounts = new Map<HomepageSlotKey, number>();

    for (const slot of skeleton.slots) {
      const spec = CANONICAL_SLOT_BY_KEY[slot.slotKey];
      const selected: HomepageSectionItemDto[] = [];
      const usedIds = new Set<string>();

      const getHydratedItem = (
        entityId: string,
        isPinned: boolean,
      ): HomepageSectionItemDto | null => {
        switch (slot.entityType) {
          case 'RESOURCE': {
            const base = bundle.resources.get(entityId);
            return base ? { ...base, isPinned } : null;
          }
          case 'UPDATE': {
            const base = bundle.updates.get(entityId);
            return base ? { ...base, isPinned } : null;
          }
          case 'CALENDAR_EVENT': {
            const base = bundle.calendarEvents.get(entityId);
            return base ? { ...base, isPinned } : null;
          }
          case 'SUBJECT': {
            const base = bundle.subjects.get(entityId);
            return base ? { ...base, isPinned } : null;
          }
        }
      };

      // Step 1: Evaluate active-window pinned items in position ASC order
      const pinnedById = new Map<string, CachedPinnedCandidateMeta>();
      if (slot.mode !== 'AUTOMATED') {
        const sortedPins = [...slot.pinnedItems].sort(
          (a, b) => a.position - b.position,
        );
        for (const pin of sortedPins) {
          pinnedById.set(pin.entityId, pin);
          const pinStatus = evaluatePinWindow(
            pin.startsAtMs !== null ? new Date(pin.startsAtMs) : null,
            pin.endsAtMs !== null ? new Date(pin.endsAtMs) : null,
            evalTime,
          );
          if (pinStatus !== 'ELIGIBLE') {
            continue;
          }
          if (usedIds.has(pin.entityId)) {
            continue;
          }
          const dto = getHydratedItem(pin.entityId, true);
          if (dto) {
            selected.push(dto);
            usedIds.add(pin.entityId);
          }
        }
      }

      // Step 2: Automated backfill for AUTOMATED and CURATED_HYBRID
      const allLiveSurvivors: HomepageSectionItemDto[] = [...selected];
      if (slot.mode !== 'MANUAL_OVERRIDE') {
        for (const cid of slot.candidateIds) {
          if (usedIds.has(cid)) {
            continue;
          }
          const pinEntry = pinnedById.get(cid);
          if (pinEntry && !pinEntry.isAutomatedCandidate) {
            // Do not backfill a pinned-only item whose pin window is inactive
            continue;
          }
          const dto = getHydratedItem(cid, false);
          if (dto) {
            allLiveSurvivors.push(dto);
            usedIds.add(cid);
          }
        }
      }

      slotLiveCounts.set(slot.slotKey, allLiveSurvivors.length);
      const cappedItems = allLiveSurvivors.slice(0, slot.maxItems);

      sections.push({
        slotKey: slot.slotKey,
        slotOrder: spec.slotOrder,
        entityType: spec.entityType,
        mode: slot.mode,
        title: slot.title,
        subtitle: slot.subtitle,
        maxItems: slot.maxItems,
        count: cappedItems.length,
        items: cappedItems,
      });
    }

    sections.sort((a, b) => a.slotOrder - b.slotOrder);

    return { sections, slotLiveCounts };
  }

  /**
   * Executes live PostgreSQL fn_is_homepage_entity_eligible filtering + sanitized metadata hydration.
   * Zero storageBucket, objectKey, storageMetadata, checksums, or presigned URLs are projected.
   */
  private async batchHydrateEligibleEntities(
    countryId: string,
    ids: {
      resourceIds: string[];
      updateIds: string[];
      calendarEventIds: string[];
      subjectIds: string[];
    },
    evalTime: Date,
  ): Promise<HydratedEntitiesBundle> {
    const evalIso = evalTime.toISOString();
    const resourcesMap = new Map<string, Omit<HomepageResourceCardDto, 'isPinned'>>();
    const updatesMap = new Map<string, Omit<HomepageUpdateCardDto, 'isPinned'>>();
    const calendarMap = new Map<
      string,
      Omit<HomepageCalendarHighlightCardDto, 'isPinned'>
    >();
    const subjectsMap = new Map<string, Omit<CurriculumShortcutCardDto, 'isPinned'>>();

    if (ids.resourceIds.length > 0) {
      const idArraySql = sql.join(
        ids.resourceIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const res = await this.dbInstance.execute(sql`
        SELECT
          r.id,
          r.title,
          r.slug,
          r.description,
          r.quality_label AS resource_quality_label,
          rt.id AS rt_id,
          rt.code AS rt_code,
          rt.name AS rt_name,
          rt.slug AS rt_slug,
          rt.pillar AS rt_pillar,
          cur.id AS cur_id,
          cur.code AS cur_code,
          cur.name AS cur_name,
          cur.slug AS cur_slug,
          el.id AS el_id,
          el.code AS el_code,
          el.name AS el_name,
          el.slug AS el_slug,
          g.id AS g_id,
          g.code AS g_code,
          g.name AS g_name,
          g.slug AS g_slug,
          s.id AS s_id,
          s.code AS s_code,
          s.name AS s_name,
          s.slug AS s_slug,
          t.id AS t_id,
          t.code AS t_code,
          t.name AS t_name,
          t.slug AS t_slug,
          rv.id AS rv_id,
          rv.version_number AS rv_version_number,
          rv.version_label AS rv_version_label,
          rv.quality_label AS rv_quality_label,
          rv.published_at AS rv_published_at,
          gv.has_active_ver,
          gv.verified_at
        FROM "content"."resources" r
        JOIN "content"."resource_types" rt ON rt.id = r.resource_type_id
        JOIN "content"."resource_versions" rv
          ON rv.resource_id = r.id
         AND rv.status = 'PUBLISHED'
        LEFT JOIN "taxonomy"."curricula" cur ON cur.id = r.curriculum_id
        LEFT JOIN "taxonomy"."education_levels" el ON el.id = r.education_level_id
        LEFT JOIN "taxonomy"."grades" g ON g.id = r.grade_id
        LEFT JOIN "taxonomy"."subjects" s ON s.id = r.subject_id
        LEFT JOIN "taxonomy"."topics" t ON t.id = r.topic_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) > 0 AS has_active_ver,
            MAX(ver.verified_at) AS verified_at
          FROM "governance"."resource_verifications" ver
          WHERE ver.resource_version_id = rv.id
            AND ver.verification_status = 'VERIFIED'
        ) gv ON TRUE
        WHERE r.id IN (${idArraySql})
          AND "content"."fn_is_homepage_entity_eligible"(
            ${countryId}::uuid,
            'RESOURCE',
            r.id,
            ${evalIso}::timestamptz
          ) IS TRUE
      `);

      for (const raw of res.rows) {
        const row = raw as Record<string, any>;
        const quality = resolveCanonicalQuality({
          resourceQualityLabel: row.resource_quality_label,
          versionQualityLabel: row.rv_quality_label,
          hasActiveVersionVerification: Boolean(row.has_active_ver),
        });

        resourcesMap.set(String(row.id), {
          id: String(row.id),
          entityType: 'RESOURCE',
          title: String(row.title),
          slug: String(row.slug),
          description: row.description !== null ? String(row.description) : null,
          qualityLabel: quality.displayLabel,
          quality: {
            effectiveTier: quality.effectiveTier,
            label: quality.displayLabel,
            displayMark: quality.displayMark,
            isVerified: quality.isVerified,
            isPremium: quality.isPremium,
            verifiedAt:
              row.verified_at !== null && row.verified_at !== undefined
                ? toIsoTimestamp(row.verified_at)
                : null,
          },
          resourceType: {
            id: String(row.rt_id),
            code: String(row.rt_code),
            name: String(row.rt_name),
            slug: String(row.rt_slug),
            pillar: String(row.rt_pillar),
          },
          curriculum: row.cur_id
            ? {
                id: String(row.cur_id),
                code: row.cur_code !== null ? String(row.cur_code) : null,
                name: String(row.cur_name),
                slug: String(row.cur_slug),
              }
            : null,
          educationLevel: row.el_id
            ? {
                id: String(row.el_id),
                code: row.el_code !== null ? String(row.el_code) : null,
                name: String(row.el_name),
                slug: String(row.el_slug),
              }
            : null,
          grade: row.g_id
            ? {
                id: String(row.g_id),
                code: row.g_code !== null ? String(row.g_code) : null,
                name: String(row.g_name),
                slug: String(row.g_slug),
              }
            : null,
          subject: row.s_id
            ? {
                id: String(row.s_id),
                code: row.s_code !== null ? String(row.s_code) : null,
                name: String(row.s_name),
                slug: String(row.s_slug),
              }
            : null,
          topic: row.t_id
            ? {
                id: String(row.t_id),
                code: row.t_code !== null ? String(row.t_code) : null,
                name: String(row.t_name),
                slug: String(row.t_slug),
              }
            : null,
          publishedVersion: {
            id: String(row.rv_id),
            versionNumber: Number(row.rv_version_number),
            versionLabel: String(row.rv_version_label),
            publishedAt: toIsoTimestamp(row.rv_published_at),
          },
        });
      }
    }

    if (ids.updateIds.length > 0) {
      const idArraySql = sql.join(
        ids.updateIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const res = await this.dbInstance.execute(sql`
        SELECT
          u.id,
          u.title,
          u.slug,
          u.summary,
          u.published_at,
          cat.id AS cat_id,
          cat.name AS cat_name,
          cat.slug AS cat_slug
        FROM "content"."education_updates" u
        LEFT JOIN "content"."education_update_categories" cat ON cat.id = u.category_id
        WHERE u.id IN (${idArraySql})
          AND "content"."fn_is_homepage_entity_eligible"(
            ${countryId}::uuid,
            'UPDATE',
            u.id,
            ${evalIso}::timestamptz
          ) IS TRUE
      `);

      for (const raw of res.rows) {
        const row = raw as Record<string, any>;
        updatesMap.set(String(row.id), {
          id: String(row.id),
          entityType: 'UPDATE',
          title: String(row.title),
          slug: String(row.slug),
          summary: row.summary !== null ? String(row.summary) : null,
          publishedAt: toIsoTimestamp(row.published_at),
          category: row.cat_id
            ? {
                id: String(row.cat_id),
                name: String(row.cat_name),
                slug: String(row.cat_slug),
              }
            : null,
        });
      }
    }

    if (ids.calendarEventIds.length > 0) {
      const idArraySql = sql.join(
        ids.calendarEventIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const res = await this.dbInstance.execute(sql`
        SELECT
          ce.id,
          ce.title,
          ce.description,
          ce.start_date::text AS start_date,
          ce.end_date::text AS end_date,
          ce.start_time::text AS start_time,
          ce.end_time::text AS end_time,
          ce.all_day,
          ce.location,
          cet.id AS cet_id,
          cet.name AS cet_name,
          cet.slug AS cet_slug,
          cal.id AS cal_id,
          cal.name AS cal_name,
          cal.academic_year AS cal_academic_year
        FROM "calendar"."calendar_events" ce
        JOIN "calendar"."calendars" cal ON cal.id = ce.calendar_id
        JOIN "calendar"."calendar_event_types" cet ON cet.id = ce.event_type_id
        WHERE ce.id IN (${idArraySql})
          AND "content"."fn_is_homepage_entity_eligible"(
            ${countryId}::uuid,
            'CALENDAR_EVENT',
            ce.id,
            ${evalIso}::timestamptz
          ) IS TRUE
      `);

      for (const raw of res.rows) {
        const row = raw as Record<string, any>;
        calendarMap.set(String(row.id), {
          id: String(row.id),
          entityType: 'CALENDAR_EVENT',
          title: String(row.title),
          description: row.description !== null ? String(row.description) : null,
          startDate: String(row.start_date),
          endDate: row.end_date !== null ? String(row.end_date) : null,
          startTime: row.start_time !== null ? String(row.start_time) : null,
          endTime: row.end_time !== null ? String(row.end_time) : null,
          allDay: Boolean(row.all_day),
          location: row.location !== null ? String(row.location) : null,
          eventType: {
            id: String(row.cet_id),
            name: String(row.cet_name),
            slug: String(row.cet_slug),
          },
          calendar: {
            id: String(row.cal_id),
            name: String(row.cal_name),
            academicYear:
              row.cal_academic_year !== null ? String(row.cal_academic_year) : null,
          },
        });
      }
    }

    if (ids.subjectIds.length > 0) {
      const idArraySql = sql.join(
        ids.subjectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const res = await this.dbInstance.execute(sql`
        SELECT
          s.id,
          s.name,
          s.slug,
          s.code,
          s.description,
          cur.id AS cur_id,
          cur.name AS cur_name,
          cur.slug AS cur_slug,
          cur.code AS cur_code,
          el.id AS el_id,
          el.name AS el_name,
          el.slug AS el_slug,
          el.sequence_order AS el_seq,
          g.id AS g_id,
          g.name AS g_name,
          g.slug AS g_slug,
          g.sequence_order AS g_seq,
          p.id AS p_id,
          p.name AS p_name,
          p.slug AS p_slug,
          COALESCE(rc.pub_res_count, 0)::int AS published_resource_count
        FROM "taxonomy"."subjects" s
        JOIN "taxonomy"."curriculum_versions" cv ON cv.id = s.curriculum_version_id
        JOIN "taxonomy"."curricula" cur ON cur.id = cv.curriculum_id
        JOIN "taxonomy"."education_levels" el ON el.id = s.education_level_id
        JOIN "taxonomy"."grades" g ON g.id = s.grade_id
        LEFT JOIN "taxonomy"."pathways" p ON p.id = s.pathway_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS pub_res_count
          FROM "content"."resources" r
          WHERE r.subject_id = s.id
            AND r.country_id = ${countryId}::uuid
            AND r.status = 'PUBLISHED'
            AND "content"."fn_is_homepage_entity_eligible"(
              ${countryId}::uuid,
              'RESOURCE',
              r.id,
              ${evalIso}::timestamptz
            ) IS TRUE
        ) rc ON TRUE
        WHERE s.id IN (${idArraySql})
          AND "content"."fn_is_homepage_entity_eligible"(
            ${countryId}::uuid,
            'SUBJECT',
            s.id,
            ${evalIso}::timestamptz
          ) IS TRUE
      `);

      for (const raw of res.rows) {
        const row = raw as Record<string, any>;
        subjectsMap.set(String(row.id), {
          id: String(row.id),
          entityType: 'SUBJECT',
          name: String(row.name),
          slug: String(row.slug),
          code: row.code !== null ? String(row.code) : null,
          description: row.description !== null ? String(row.description) : null,
          publishedResourceCount: Number(row.published_resource_count ?? 0),
          curriculum: {
            id: String(row.cur_id),
            name: String(row.cur_name),
            slug: String(row.cur_slug),
            code: row.cur_code !== null ? String(row.cur_code) : null,
          },
          educationLevel: {
            id: String(row.el_id),
            name: String(row.el_name),
            slug: String(row.el_slug),
            sequenceOrder: Number(row.el_seq),
          },
          grade: {
            id: String(row.g_id),
            name: String(row.g_name),
            slug: String(row.g_slug),
            sequenceOrder: Number(row.g_seq),
          },
          pathway: row.p_id
            ? {
                id: String(row.p_id),
                name: String(row.p_name),
                slug: String(row.p_slug),
              }
            : null,
        });
      }
    }

    return {
      resources: resourcesMap,
      updates: updatesMap,
      calendarEvents: calendarMap,
      subjects: subjectsMap,
    };
  }
}

export const defaultHomepageService = new DefaultHomepageService();
