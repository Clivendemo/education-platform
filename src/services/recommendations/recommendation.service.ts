import { performance } from 'node:perf_hooks';
import { eq, and, sql, desc, count, inArray } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../../db/index.js';
import {
  countries,
  resourceRecommendationRules,
  type ResourceRecommendationRule,
  type RecommendationRuleStatus,
  type RecommendationRuleType,
  type ResourcePillar,
} from '../../db/schemas.js';
import {
  defaultGeographyService,
  type GeographyService,
  type CountryResult,
} from '../geography.service.js';
import {
  defaultAuditService,
  type AuditService,
  type ActorSnapshot,
} from '../audit.service.js';
import {
  clampRecommendationLimit,
  rankCandidatesForSurface,
  rankContinueExploringColdStart,
  rankContinueExploringContextual,
  resolveCanonicalQuality,
  SCORING_CONSTANTS,
  type ActiveEditorialRuleInput,
  type ResourceDetailSurface,
  type ScoringCandidateInput,
  type ScoringResourceContext,
} from './recommendation-scoring.service.js';
import {
  defaultRecommendationCacheService,
  RecommendationCacheService,
  type CachedRecommendationTuple,
} from './recommendation-cache.service.js';

export class RecommendationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'RECOMMENDATION_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RecommendationError';
  }
}

export interface RecommendationCardDto {
  id: string;
  title: string;
  slug: string;
  description: string | null;
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
  country: {
    id: string;
    name: string;
    isoCode: string;
    urlPrefix: string;
  };
  curriculum: {
    id: string;
    code: string;
    name: string;
  } | null;
  grade: {
    id: string;
    code: string;
    name: string;
  } | null;
  subject: {
    id: string;
    code: string;
    name: string;
  } | null;
  topic: {
    id: string;
    code: string;
    name: string;
  } | null;
  publishedVersion: {
    id: string;
    versionNumber: number;
    versionLabel: string;
    publishedAt: string;
  };
}

export interface ResourceRecommendationsResponse {
  data: RecommendationCardDto[];
  meta: {
    surface: ResourceDetailSurface;
    sourceResourceId: string;
    limit: number;
    count: number;
  };
  /** Internal non-serialized diagnostics for SQL benchmark verification */
  _diagnostics?: {
    cacheHit: boolean;
    sqlDurationMs: number;
  };
}

export interface ContinueExploringResponse {
  data: RecommendationCardDto[];
  meta: {
    surface: 'continue-exploring';
    countryId: string;
    limit: number;
    count: number;
    mode: 'contextual' | 'cold_start';
  };
  _diagnostics?: {
    cacheHit: boolean;
    sqlDurationMs: number;
  };
}

export interface RecommendationRuleDto {
  id: string;
  countryId: string;
  ruleType: RecommendationRuleType;
  status: RecommendationRuleStatus;
  sourceResourceId: string | null;
  sourceTopicId: string | null;
  targetResourceId: string;
  priority: number | null;
  reason: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deactivatedBy: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
}

export interface GetResourceRecommendationsParams {
  sourceResourceId: string;
  surface?: ResourceDetailSurface;
  limit?: number;
  country?: string;
  evalNow?: Date;
  bypassCache?: boolean;
}

export interface GetContinueExploringParams {
  country?: string;
  userCountryHint?: string | null;
  userId?: string | null;
  anonymousSessionHash?: string | null;
  limit?: number;
  evalNow?: Date;
  bypassCache?: boolean;
}

export interface AdminActorContext {
  userId: string;
  roleSlug?: string;
  email?: string | null;
  displayName?: string | null;
  requestId?: string | null;
}

export interface ListRecommendationRulesParams {
  countryId?: string;
  allowedCountryIds?: string[] | null; // null = global access
  status?: RecommendationRuleStatus;
  ruleType?: RecommendationRuleType;
  sourceResourceId?: string;
  sourceTopicId?: string;
  targetResourceId?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateRecommendationRuleParams {
  countryId: string;
  ruleType: RecommendationRuleType;
  sourceResourceId?: string | null;
  sourceTopicId?: string | null;
  targetResourceId: string;
  priority?: number | null;
  reason: string;
  actor: AdminActorContext;
}

export interface DeactivateRecommendationRuleParams {
  ruleId: string;
  reason: string;
  actor: AdminActorContext;
}

export interface ReactivateRecommendationRuleParams {
  ruleId: string;
  reason: string;
  priority?: number | null;
  actor: AdminActorContext;
}

export interface RecommendationService {
  getResourceRecommendations(
    params: GetResourceRecommendationsParams,
  ): Promise<ResourceRecommendationsResponse>;
  getContinueExploring(params: GetContinueExploringParams): Promise<ContinueExploringResponse>;
  resolveDiscoveryCountry(
    explicitCountry?: string,
    userCountryHint?: string | null,
  ): Promise<CountryResult>;
  getRuleById(ruleId: string): Promise<RecommendationRuleDto | null>;
  listRules(params: ListRecommendationRulesParams): Promise<{
    data: RecommendationRuleDto[];
    meta: { page: number; pageSize: number; total: number; hasMore: boolean };
  }>;
  createRule(params: CreateRecommendationRuleParams): Promise<RecommendationRuleDto>;
  deactivateRule(params: DeactivateRecommendationRuleParams): Promise<RecommendationRuleDto>;
  reactivateRule(params: ReactivateRecommendationRuleParams): Promise<RecommendationRuleDto>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serializeRule(row: ResourceRecommendationRule): RecommendationRuleDto {
  return {
    id: row.id,
    countryId: row.countryId,
    ruleType: row.ruleType,
    status: row.status,
    sourceResourceId: row.sourceResourceId ?? null,
    sourceTopicId: row.sourceTopicId ?? null,
    targetResourceId: row.targetResourceId,
    priority: row.priority ?? null,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deactivatedBy: row.deactivatedBy ?? null,
    deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
    deactivationReason: row.deactivationReason ?? null,
  };
}

function buildActorSnapshot(actor: AdminActorContext): ActorSnapshot {
  const emailDomain =
    actor.email && actor.email.includes('@') ? actor.email.split('@')[1] : undefined;
  return {
    actorId: actor.userId,
    actorType: 'AUTHENTICATED',
    actorRole: actor.roleSlug,
    emailDomain,
  };
}

function matchesCountryFilter(
  row: { country_id: string; country_iso_code: string; country_url_prefix: string },
  countryFilter?: string,
): boolean {
  if (!countryFilter) return true;
  const trimmed = countryFilter.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    row.country_id.toLowerCase() === trimmed ||
    row.country_iso_code.toLowerCase() === trimmed ||
    row.country_url_prefix.toLowerCase() === trimmed
  );
}

export class DefaultRecommendationService implements RecommendationService {
  constructor(
    private readonly dbInstance: AppDatabase = defaultDb,
    private readonly geographyService: GeographyService = defaultGeographyService,
    private readonly auditService: AuditService = defaultAuditService,
    private readonly cacheService: RecommendationCacheService = defaultRecommendationCacheService,
  ) {}

  async resolveDiscoveryCountry(
    explicitCountry?: string,
    userCountryHint?: string | null,
  ): Promise<CountryResult> {
    if (explicitCountry !== undefined && explicitCountry.trim().length > 0) {
      const resolved = await this.geographyService.getActiveCountryByIdentifier(explicitCountry);
      if (!resolved) {
        throw new RecommendationError(
          `Active country not found for identifier '${explicitCountry}'`,
          404,
          'COUNTRY_NOT_FOUND',
        );
      }
      return resolved;
    }

    if (userCountryHint && userCountryHint.trim().length > 0) {
      const resolved = await this.geographyService.getActiveCountryByIdentifier(userCountryHint);
      if (resolved) {
        return resolved;
      }
    }

    const defaultCountryEnv = process.env.DEFAULT_COUNTRY;
    if (defaultCountryEnv && defaultCountryEnv.trim().length > 0) {
      const resolved = await this.geographyService.getActiveCountryByIdentifier(defaultCountryEnv);
      if (resolved) {
        return resolved;
      }
    }

    const activeCountries = await this.geographyService.listActiveCountries();
    if (activeCountries.length === 1) {
      return activeCountries[0];
    }

    if (activeCountries.length === 0) {
      throw new RecommendationError(
        'No active countries are available.',
        404,
        'COUNTRY_NOT_FOUND',
      );
    }

    throw new RecommendationError(
      'Country parameter is required when multiple active countries exist.',
      400,
      'VALIDATION_ERROR',
    );
  }

  async getResourceRecommendations(
    params: GetResourceRecommendationsParams,
  ): Promise<ResourceRecommendationsResponse> {
    const surface: ResourceDetailSurface = params.surface ?? 'related-resources';
    const effectiveLimit = clampRecommendationLimit(surface, params.limit);
    const evalNow = params.evalNow ?? new Date();
    const bypassCache = Boolean(params.bypassCache);

    if (!UUID_REGEX.test(params.sourceResourceId)) {
      throw new RecommendationError(
        'Resource ID must be a valid UUID',
        400,
        'VALIDATION_ERROR',
      );
    }

    const cacheLookupKey = `rec:res:${params.sourceResourceId}:${surface}`;

    // 1. Fast Cached Path: single SQL round-trip verifying BOTH source & candidate Active Publication Gates
    if (!bypassCache) {
      const cachedTuples = this.cacheService.get(
        cacheLookupKey,
      ) as CachedRecommendationTuple<RecommendationCardDto>[] | null;
      if (cachedTuples !== null) {
        const hasAllCards = cachedTuples.every((t) => Boolean(t.card));
        const sqlStart = performance.now();

        if (hasAllCards) {
          const activeVersionByResId = await this.verifyLivePublicationGate(
            params.sourceResourceId,
            cachedTuples.map((t) => t.resourceId),
            params.country,
            evalNow,
          );
          const sqlDurationMs = performance.now() - sqlStart;

          const survivingCards: RecommendationCardDto[] = [];
          for (const tuple of cachedTuples) {
            const liveVersionId = activeVersionByResId.get(tuple.resourceId);
            if (liveVersionId && tuple.card && tuple.card.publishedVersion.id === liveVersionId) {
              survivingCards.push(tuple.card);
            }
          }

          if (
            survivingCards.length === cachedTuples.length ||
            survivingCards.length >= effectiveLimit
          ) {
            const orderedCards = survivingCards.slice(0, effectiveLimit);
            return {
              data: orderedCards,
              meta: {
                surface,
                sourceResourceId: params.sourceResourceId,
                limit: effectiveLimit,
                count: orderedCards.length,
              },
              _diagnostics: {
                cacheHit: true,
                sqlDurationMs,
              },
            };
          }
          // Fall through synchronously to uncached scoring dataset to backfill ineligible cached entries
        } else {
          const gated = await this.verifySourceAndHydrateCardsSingleQuery(
            params.sourceResourceId,
            cachedTuples.map((t) => t.resourceId),
            params.country,
            evalNow,
          );
          const sqlDurationMs = performance.now() - sqlStart;

          const cardById = new Map(gated.cards.map((c) => [c.id, c]));
          const survivingCards: RecommendationCardDto[] = [];
          for (const tuple of cachedTuples) {
            const card = cardById.get(tuple.resourceId);
            if (card) {
              survivingCards.push(card);
            }
          }

          if (
            survivingCards.length === cachedTuples.length ||
            survivingCards.length >= effectiveLimit
          ) {
            const orderedCards = survivingCards.slice(0, effectiveLimit);
            return {
              data: orderedCards,
              meta: {
                surface,
                sourceResourceId: params.sourceResourceId,
                limit: effectiveLimit,
                count: orderedCards.length,
              },
              _diagnostics: {
                cacheHit: true,
                sqlDurationMs,
              },
            };
          }
          // Fall through synchronously to uncached scoring dataset to backfill ineligible cached entries
        }
      }
    }

    // 2. Uncached Path: single consolidated candidate + rules + co-occurrence + Top-20 hydration SQL query
    const sqlStart = performance.now();
    const evaluationData = await this.fetchResourceScoringDataset(
      params.sourceResourceId,
      surface,
      evalNow,
      params.country,
    );
    const scoringSqlDurationMs = performance.now() - sqlStart;

    // Score & rank up to MAX_RECOMMENDATION_LIMIT (20) so all limits <= 20 share the ranked cache entry
    const top20Ranked = rankCandidatesForSurface({
      surface,
      source: evaluationData.source,
      candidates: evaluationData.candidates,
      rules: evaluationData.rules,
      evalNow,
      limit: SCORING_CONSTANTS.MAX_EXPLORE_SEEDS ? 20 : 20,
    });

    if (!bypassCache) {
      const tuplesToCache: CachedRecommendationTuple<RecommendationCardDto>[] = top20Ranked.map(
        (r) => ({
          resourceId: r.resourceId,
          isPinned: r.isPinned,
          ruleScopeRank: r.ruleScopeRank,
          priority: r.priority,
          algorithmicScore: r.algorithmicScore,
          card: evaluationData.cardByResourceId.get(r.resourceId),
        }),
      );

      const sourceTopics: string[] = [];
      if (evaluationData.source.topicId) sourceTopics.push(evaluationData.source.topicId);
      if (evaluationData.source.topicParentId) {
        sourceTopics.push(evaluationData.source.topicParentId);
      }

      const candidateTopicIds: string[] = [];
      const top20Set = new Set(top20Ranked.map((r) => r.resourceId));
      for (const c of evaluationData.candidates) {
        if (top20Set.has(c.resourceId)) {
          if (c.topicId) candidateTopicIds.push(c.topicId);
          if (c.topicParentId) candidateTopicIds.push(c.topicParentId);
        }
      }

      this.cacheService.set(cacheLookupKey, tuplesToCache, {
        countryId: evaluationData.countryId,
        sourceResourceId: params.sourceResourceId,
        sourceTopicIds: sourceTopics,
        candidateIds: top20Ranked.map((r) => r.resourceId),
        candidateTopicIds,
      });
    }

    const selectedWinners = top20Ranked.slice(0, effectiveLimit);
    if (selectedWinners.length === 0) {
      return {
        data: [],
        meta: {
          surface,
          sourceResourceId: params.sourceResourceId,
          limit: effectiveLimit,
          count: 0,
        },
        _diagnostics: {
          cacheHit: false,
          sqlDurationMs: scoringSqlDurationMs,
        },
      };
    }

    const orderedCards = selectedWinners
      .map((w) => evaluationData.cardByResourceId.get(w.resourceId))
      .filter((c): c is RecommendationCardDto => Boolean(c));

    return {
      data: orderedCards,
      meta: {
        surface,
        sourceResourceId: params.sourceResourceId,
        limit: effectiveLimit,
        count: orderedCards.length,
      },
      _diagnostics: {
        cacheHit: false,
        sqlDurationMs: scoringSqlDurationMs,
      },
    };
  }

  async getContinueExploring(
    params: GetContinueExploringParams,
  ): Promise<ContinueExploringResponse> {
    const effectiveLimit = clampRecommendationLimit('continue-exploring', params.limit);
    const evalNow = params.evalNow ?? new Date();
    const bypassCache = Boolean(params.bypassCache);

    const country = await this.resolveDiscoveryCountry(params.country, params.userCountryHint);
    const countryId = country.id;

    // Extract up to 5 contextual seeds if authenticated user or valid anonymous session hash is present
    const seedIds = await this.extractExploreSeedIds({
      countryId,
      userId: params.userId ?? null,
      anonymousSessionHash: params.anonymousSessionHash ?? null,
      evalNow,
    });

    if (seedIds.length > 0) {
      const sqlStart = performance.now();
      const contextualDataset = await this.fetchContinueExploringContextualDataset(
        countryId,
        seedIds,
        evalNow,
      );
      const sqlDurationMs = performance.now() - sqlStart;

      if (contextualDataset.seeds.length > 0) {
        const rankedContextual = rankContinueExploringContextual({
          seeds: contextualDataset.seeds,
          candidates: contextualDataset.candidates,
          rules: contextualDataset.rules,
          evalNow,
          limit: effectiveLimit,
        });

        if (rankedContextual.length > 0) {
          const cards = await this.hydrateCardsByIds(
            countryId,
            rankedContextual.map((r) => r.resourceId),
            evalNow,
          );
          const cardMap = new Map(cards.map((c) => [c.id, c]));
          const ordered = rankedContextual
            .map((r) => cardMap.get(r.resourceId))
            .filter((c): c is RecommendationCardDto => Boolean(c));

          return {
            data: ordered,
            meta: {
              surface: 'continue-exploring',
              countryId,
              limit: effectiveLimit,
              count: ordered.length,
              mode: 'contextual',
            },
            _diagnostics: {
              cacheHit: false,
              sqlDurationMs,
            },
          };
        }
      }
    }

    // Cold-start mode (cacheable under rec:cold:{countryId}:20)
    const coldCacheKey = RecommendationCacheService.buildColdStartKey(countryId, 20);
    if (!bypassCache) {
      const cachedCold = this.cacheService.get(coldCacheKey);
      if (cachedCold !== null) {
        const sqlStart = performance.now();
        const cards = await this.hydrateCardsByIds(
          countryId,
          cachedCold.map((c) => c.resourceId),
          evalNow,
        );
        const sqlDurationMs = performance.now() - sqlStart;
        const cardMap = new Map(cards.map((c) => [c.id, c]));
        const survivingCards: RecommendationCardDto[] = [];
        for (const tuple of cachedCold) {
          const card = cardMap.get(tuple.resourceId);
          if (card) {
            survivingCards.push(card);
          }
        }

        if (
          survivingCards.length === cachedCold.length ||
          survivingCards.length >= effectiveLimit
        ) {
          const ordered = survivingCards.slice(0, effectiveLimit);
          return {
            data: ordered,
            meta: {
              surface: 'continue-exploring',
              countryId,
              limit: effectiveLimit,
              count: ordered.length,
              mode: 'cold_start',
            },
            _diagnostics: {
              cacheHit: true,
              sqlDurationMs,
            },
          };
        }
        // Fall through synchronously to recompute cold-start candidates when cached items dropped below effectiveLimit
      }
    }

    const sqlStart = performance.now();
    const coldCandidates = await this.fetchColdStartCandidates(countryId, evalNow);
    const sqlDurationMs = performance.now() - sqlStart;

    const top20Cold = rankContinueExploringColdStart({
      candidates: coldCandidates,
      evalNow,
      limit: 20,
    });

    if (!bypassCache) {
      this.cacheService.set(
        coldCacheKey,
        top20Cold.map((r) => ({
          resourceId: r.resourceId,
          isPinned: false,
          ruleScopeRank: null,
          priority: null,
          algorithmicScore: r.algorithmicScore,
        })),
        {
          countryId,
          candidateIds: top20Cold.map((r) => r.resourceId),
        },
      );
    }

    const winners = top20Cold.slice(0, effectiveLimit);
    const cards =
      winners.length > 0
        ? await this.hydrateCardsByIds(
            countryId,
            winners.map((w) => w.resourceId),
            evalNow,
          )
        : [];
    const cardMap = new Map(cards.map((c) => [c.id, c]));
    const ordered = winners
      .map((w) => cardMap.get(w.resourceId))
      .filter((c): c is RecommendationCardDto => Boolean(c));

    return {
      data: ordered,
      meta: {
        surface: 'continue-exploring',
        countryId,
        limit: effectiveLimit,
        count: ordered.length,
        mode: 'cold_start',
      },
      _diagnostics: {
        cacheHit: false,
        sqlDurationMs,
      },
    };
  }

  async getRuleById(ruleId: string): Promise<RecommendationRuleDto | null> {
    if (!UUID_REGEX.test(ruleId)) {
      return null;
    }
    const [row] = await this.dbInstance
      .select()
      .from(resourceRecommendationRules)
      .where(eq(resourceRecommendationRules.id, ruleId))
      .limit(1);

    return row ? serializeRule(row) : null;
  }

  async listRules(params: ListRecommendationRulesParams): Promise<{
    data: RecommendationRuleDto[];
    meta: { page: number; pageSize: number; total: number; hasMore: boolean };
  }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    if (params.allowedCountryIds && params.allowedCountryIds.length === 0) {
      return {
        data: [],
        meta: { page, pageSize, total: 0, hasMore: false },
      };
    }

    const conditions = [];
    if (params.countryId) {
      conditions.push(eq(resourceRecommendationRules.countryId, params.countryId));
    }
    if (params.allowedCountryIds && params.allowedCountryIds.length > 0) {
      conditions.push(inArray(resourceRecommendationRules.countryId, params.allowedCountryIds));
    }
    if (params.status) {
      conditions.push(eq(resourceRecommendationRules.status, params.status));
    }
    if (params.ruleType) {
      conditions.push(eq(resourceRecommendationRules.ruleType, params.ruleType));
    }
    if (params.sourceResourceId) {
      conditions.push(eq(resourceRecommendationRules.sourceResourceId, params.sourceResourceId));
    }
    if (params.sourceTopicId) {
      conditions.push(eq(resourceRecommendationRules.sourceTopicId, params.sourceTopicId));
    }
    if (params.targetResourceId) {
      conditions.push(eq(resourceRecommendationRules.targetResourceId, params.targetResourceId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.dbInstance
      .select({ total: count() })
      .from(resourceRecommendationRules)
      .where(whereClause);

    const total = Number(totalRow?.total ?? 0);

    const rows = await this.dbInstance
      .select()
      .from(resourceRecommendationRules)
      .where(whereClause)
      .orderBy(
        desc(resourceRecommendationRules.createdAt),
        desc(resourceRecommendationRules.id),
      )
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map(serializeRule),
      meta: {
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      },
    };
  }

  async createRule(params: CreateRecommendationRuleParams): Promise<RecommendationRuleDto> {
    const trimmedReason = params.reason?.trim() ?? '';
    if (trimmedReason.length < 3) {
      throw new RecommendationError(
        'Editorial rule reason must be at least 3 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const hasSourceResource = Boolean(params.sourceResourceId);
    const hasSourceTopic = Boolean(params.sourceTopicId);
    if ((hasSourceResource && hasSourceTopic) || (!hasSourceResource && !hasSourceTopic)) {
      throw new RecommendationError(
        'Exactly one of sourceResourceId or sourceTopicId must be provided.',
        400,
        'VALIDATION_ERROR',
      );
    }

    if (params.sourceResourceId && params.sourceResourceId === params.targetResourceId) {
      throw new RecommendationError(
        'A resource cannot target itself in a recommendation rule.',
        400,
        'SELF_TARGET_DISALLOWED',
      );
    }

    if (params.ruleType === 'PIN') {
      if (
        params.priority === undefined ||
        params.priority === null ||
        !Number.isInteger(params.priority) ||
        params.priority < 1 ||
        params.priority > 10
      ) {
        throw new RecommendationError(
          'PIN rules require an integer priority between 1 and 10.',
          400,
          'VALIDATION_ERROR',
        );
      }
    } else if (params.priority !== undefined && params.priority !== null) {
      throw new RecommendationError(
        'EXCLUDE rules must not specify a priority.',
        400,
        'VALIDATION_ERROR',
      );
    }

    // Verify country exists
    const [countryRow] = await this.dbInstance
      .select({ id: countries.id })
      .from(countries)
      .where(eq(countries.id, params.countryId))
      .limit(1);

    if (!countryRow) {
      throw new RecommendationError(
        'Specified countryId does not exist.',
        404,
        'COUNTRY_NOT_FOUND',
      );
    }

    // Verify target resource exists and belongs to countryId
    const targetResResult = await this.dbInstance.execute(sql`
      SELECT id, country_id
      FROM content.resources
      WHERE id = ${params.targetResourceId}::uuid
      LIMIT 1
    `);
    const targetRes = targetResResult.rows[0] as { id: string; country_id: string } | undefined;
    if (!targetRes) {
      throw new RecommendationError(
        'Target resource does not exist.',
        404,
        'TARGET_RESOURCE_NOT_FOUND',
      );
    }
    if (targetRes.country_id !== params.countryId) {
      throw new RecommendationError(
        'Target resource belongs to a different country than rule countryId.',
        422,
        'COUNTRY_MISMATCH',
      );
    }

    // Verify source resource or source topic belongs to countryId
    if (params.sourceResourceId) {
      const srcResResult = await this.dbInstance.execute(sql`
        SELECT id, country_id
        FROM content.resources
        WHERE id = ${params.sourceResourceId}::uuid
        LIMIT 1
      `);
      const srcRes = srcResResult.rows[0] as { id: string; country_id: string } | undefined;
      if (!srcRes) {
        throw new RecommendationError(
          'Source resource does not exist.',
          404,
          'SOURCE_RESOURCE_NOT_FOUND',
        );
      }
      if (srcRes.country_id !== params.countryId) {
        throw new RecommendationError(
          'Source resource belongs to a different country than rule countryId.',
          422,
          'COUNTRY_MISMATCH',
        );
      }
    } else if (params.sourceTopicId) {
      const topicResResult = await this.dbInstance.execute(sql`
        SELECT t.id, cv.country_id
        FROM taxonomy.topics t
        INNER JOIN taxonomy.curriculum_versions cv ON cv.id = t.curriculum_version_id
        WHERE t.id = ${params.sourceTopicId}::uuid
        LIMIT 1
      `);
      const topicRow = topicResResult.rows[0] as { id: string; country_id: string } | undefined;
      if (!topicRow) {
        throw new RecommendationError(
          'Source topic does not exist.',
          404,
          'SOURCE_TOPIC_NOT_FOUND',
        );
      }
      if (topicRow.country_id !== params.countryId) {
        throw new RecommendationError(
          'Source topic belongs to a different country than rule countryId.',
          422,
          'COUNTRY_MISMATCH',
        );
      }
    }

    try {
      const createdDto = await this.dbInstance.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(resourceRecommendationRules)
          .values({
            countryId: params.countryId,
            ruleType: params.ruleType,
            status: 'ACTIVE',
            sourceResourceId: params.sourceResourceId ?? null,
            sourceTopicId: params.sourceTopicId ?? null,
            targetResourceId: params.targetResourceId,
            priority: params.ruleType === 'PIN' ? (params.priority ?? 1) : null,
            reason: trimmedReason,
            createdBy: params.actor.userId,
          })
          .returning();

        const dto = serializeRule(inserted);

        await this.auditService.logEvent(
          {
            action: 'recommendation.rule.create',
            entityType: 'resource_recommendation_rule',
            entityId: inserted.id,
            actorType: 'AUTHENTICATED',
            actorUserId: params.actor.userId,
            actorSnapshot: buildActorSnapshot(params.actor),
            outcome: 'SUCCESS',
            requestId: params.actor.requestId ?? null,
            countryId: inserted.countryId,
            beforeState: null,
            afterState: dto as unknown as Record<string, unknown>,
            context: { reason: trimmedReason },
          },
          tx,
        );

        return dto;
      });

      this.cacheService.handleInvalidationEvent({
        scope: 'rule',
        op: 'INSERT',
        country_id: createdDto.countryId,
        source_resource_id: createdDto.sourceResourceId,
        source_topic_id: createdDto.sourceTopicId,
        target_resource_id: createdDto.targetResourceId,
      });

      return createdDto;
    } catch (err: any) {
      if (err instanceof RecommendationError) {
        throw err;
      }
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === '23505') {
        throw new RecommendationError(
          'An active editorial rule already exists for this source and target resource.',
          409,
          'ACTIVE_RULE_CONFLICT',
        );
      }
      if (pgCode === '23503') {
        throw new RecommendationError(
          'Cross-country or invalid resource/topic reference in editorial rule.',
          422,
          'COUNTRY_MISMATCH',
        );
      }
      throw err;
    }
  }

  async deactivateRule(
    params: DeactivateRecommendationRuleParams,
  ): Promise<RecommendationRuleDto> {
    const trimmedReason = params.reason?.trim() ?? '';
    if (trimmedReason.length < 3) {
      throw new RecommendationError(
        'Deactivation reason must be at least 3 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const [existing] = await this.dbInstance
      .select()
      .from(resourceRecommendationRules)
      .where(eq(resourceRecommendationRules.id, params.ruleId))
      .limit(1);

    if (!existing) {
      throw new RecommendationError(
        'Recommendation rule not found.',
        404,
        'RULE_NOT_FOUND',
      );
    }

    if (existing.status === 'INACTIVE') {
      throw new RecommendationError(
        'Recommendation rule is already inactive.',
        409,
        'RULE_ALREADY_INACTIVE',
      );
    }

    const beforeDto = serializeRule(existing);
    const now = new Date();

    const updatedDto = await this.dbInstance.transaction(async (tx) => {
      const [updated] = await tx
        .update(resourceRecommendationRules)
        .set({
          status: 'INACTIVE',
          deactivatedBy: params.actor.userId,
          deactivatedAt: now,
          deactivationReason: trimmedReason,
          updatedAt: now,
        })
        .where(
          and(
            eq(resourceRecommendationRules.id, params.ruleId),
            eq(resourceRecommendationRules.status, 'ACTIVE'),
          ),
        )
        .returning();

      if (!updated) {
        throw new RecommendationError(
          'Recommendation rule is already inactive.',
          409,
          'RULE_ALREADY_INACTIVE',
        );
      }

      const dto = serializeRule(updated);

      await this.auditService.logEvent(
        {
          action: 'recommendation.rule.deactivate',
          entityType: 'resource_recommendation_rule',
          entityId: updated.id,
          actorType: 'AUTHENTICATED',
          actorUserId: params.actor.userId,
          actorSnapshot: buildActorSnapshot(params.actor),
          outcome: 'SUCCESS',
          requestId: params.actor.requestId ?? null,
          countryId: updated.countryId,
          beforeState: beforeDto as unknown as Record<string, unknown>,
          afterState: dto as unknown as Record<string, unknown>,
          context: { reason: trimmedReason },
        },
        tx,
      );

      return dto;
    });

    this.cacheService.handleInvalidationEvent({
      scope: 'rule',
      op: 'UPDATE_NEW',
      country_id: updatedDto.countryId,
      source_resource_id: updatedDto.sourceResourceId,
      source_topic_id: updatedDto.sourceTopicId,
      target_resource_id: updatedDto.targetResourceId,
    });

    return updatedDto;
  }

  async reactivateRule(
    params: ReactivateRecommendationRuleParams,
  ): Promise<RecommendationRuleDto> {
    const trimmedReason = params.reason?.trim() ?? '';
    if (trimmedReason.length < 3) {
      throw new RecommendationError(
        'Reactivation reason must be at least 3 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const [existing] = await this.dbInstance
      .select()
      .from(resourceRecommendationRules)
      .where(eq(resourceRecommendationRules.id, params.ruleId))
      .limit(1);

    if (!existing) {
      throw new RecommendationError(
        'Recommendation rule not found.',
        404,
        'RULE_NOT_FOUND',
      );
    }

    if (existing.status === 'ACTIVE') {
      throw new RecommendationError(
        'Recommendation rule is already active.',
        409,
        'RULE_ALREADY_ACTIVE',
      );
    }

    let nextPriority = existing.priority;
    if (params.priority !== undefined && params.priority !== null) {
      if (existing.ruleType === 'EXCLUDE') {
        throw new RecommendationError(
          'EXCLUDE rules must not specify a priority.',
          400,
          'VALIDATION_ERROR',
        );
      }
      if (!Number.isInteger(params.priority) || params.priority < 1 || params.priority > 10) {
        throw new RecommendationError(
          'PIN priority must be an integer between 1 and 10.',
          400,
          'VALIDATION_ERROR',
        );
      }
      nextPriority = params.priority;
    }

    const beforeDto = serializeRule(existing);
    const now = new Date();

    try {
      const updatedDto = await this.dbInstance.transaction(async (tx) => {
        const [updated] = await tx
          .update(resourceRecommendationRules)
          .set({
            status: 'ACTIVE',
            priority: existing.ruleType === 'PIN' ? (nextPriority ?? 1) : null,
            deactivatedBy: null,
            deactivatedAt: null,
            deactivationReason: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(resourceRecommendationRules.id, params.ruleId),
              eq(resourceRecommendationRules.status, 'INACTIVE'),
            ),
          )
          .returning();

        if (!updated) {
          throw new RecommendationError(
            'Recommendation rule is already active.',
            409,
            'RULE_ALREADY_ACTIVE',
          );
        }

        const dto = serializeRule(updated);

        await this.auditService.logEvent(
          {
            action: 'recommendation.rule.reactivate',
            entityType: 'resource_recommendation_rule',
            entityId: updated.id,
            actorType: 'AUTHENTICATED',
            actorUserId: params.actor.userId,
            actorSnapshot: buildActorSnapshot(params.actor),
            outcome: 'SUCCESS',
            requestId: params.actor.requestId ?? null,
            countryId: updated.countryId,
            beforeState: beforeDto as unknown as Record<string, unknown>,
            afterState: dto as unknown as Record<string, unknown>,
            context: { reason: trimmedReason },
          },
          tx,
        );

        return dto;
      });

      this.cacheService.handleInvalidationEvent({
        scope: 'rule',
        op: 'UPDATE_NEW',
        country_id: updatedDto.countryId,
        source_resource_id: updatedDto.sourceResourceId,
        source_topic_id: updatedDto.sourceTopicId,
        target_resource_id: updatedDto.targetResourceId,
      });

      return updatedDto;
    } catch (err: any) {
      if (err instanceof RecommendationError) {
        throw err;
      }
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === '23505') {
        throw new RecommendationError(
          'Cannot reactivate rule because another active rule already exists for this source and target.',
          409,
          'ACTIVE_RULE_CONFLICT',
        );
      }
      throw err;
    }
  }

  private buildLivePublicationGateQuerySql(
    sourceResourceId: string,
    candidateIds: string[],
    evalNow: Date = new Date(),
  ) {
    const evalIso = evalNow.toISOString();
    const allIds = [sourceResourceId, ...candidateIds];
    const idsArraySql = sql`ARRAY[${sql.join(
      allIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]::uuid[]`;

    return sql`
      SELECT
        r.id AS resource_id,
        rv.id AS version_id,
        r.country_id,
        c.iso_code AS country_iso_code,
        c.url_prefix AS country_url_prefix
      FROM content.resources r
      INNER JOIN content.resource_versions rv
        ON rv.resource_id = r.id
       AND rv.status = 'PUBLISHED'
       AND rv.published_at IS NOT NULL
       AND rv.published_at <= ${evalIso}::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM files.resource_files rf
         WHERE rf.resource_version_id = rv.id
           AND (
             rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
             OR rf.object_key LIKE 'quarantine/%'
           )
       )
      INNER JOIN platform.countries c
        ON c.id = r.country_id
       AND c.status = 'ACTIVE'
      INNER JOIN content.resource_types rt
        ON rt.id = r.resource_type_id
       AND rt.status = 'ACTIVE'
      WHERE r.id = ANY(${idsArraySql})
        AND r.status = 'PUBLISHED'
    `;
  }

  /**
   * Benchmark helper executing EXPLAIN (ANALYZE, FORMAT JSON) on the exact production
   * cached Active Publication Gate SQL query to measure PostgreSQL server-side Execution Time (ms).
   */
  async explainLivePublicationGateQuery(
    sourceResourceId: string,
    candidateIds: string[],
  ): Promise<number> {
    const querySql = this.buildLivePublicationGateQuerySql(sourceResourceId, candidateIds);
    const res = await this.dbInstance.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${querySql}`);
    const planRoot = (res.rows[0] as any)?.['QUERY PLAN'];
    const parsed = typeof planRoot === 'string' ? JSON.parse(planRoot) : planRoot;
    return Number(parsed?.[0]?.['Execution Time'] ?? 0);
  }

  /**
   * Lean single-round-trip Active Publication Gate check for cached tuples (returns active version IDs).
   * Enforces r.status = 'PUBLISHED', rv.status = 'PUBLISHED', rv.published_at <= evalNow,
   * clean resource_files, c.status = 'ACTIVE', rt.status = 'ACTIVE', and same-country isolation on every cached read.
   */
  private async verifyLivePublicationGate(
    sourceResourceId: string,
    candidateIds: string[],
    optionalCountryFilter?: string,
    evalNow: Date = new Date(),
  ): Promise<Map<string, string>> {
    const result = await this.dbInstance.execute(
      this.buildLivePublicationGateQuerySql(sourceResourceId, candidateIds, evalNow),
    );

    let sourceRow: any = null;
    for (const row of result.rows as any[]) {
      if (row.resource_id === sourceResourceId) {
        sourceRow = row;
        break;
      }
    }

    if (!sourceRow) {
      throw new RecommendationError(
        'Published resource not found.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    if (
      !matchesCountryFilter(
        {
          country_id: sourceRow.country_id,
          country_iso_code: sourceRow.country_iso_code,
          country_url_prefix: sourceRow.country_url_prefix,
        },
        optionalCountryFilter,
      )
    ) {
      throw new RecommendationError(
        'Published resource not found in specified country.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    const activeVersionByResId = new Map<string, string>();
    for (const row of result.rows as any[]) {
      if (row.resource_id !== sourceResourceId && row.country_id === sourceRow.country_id) {
        activeVersionByResId.set(row.resource_id, row.version_id);
      }
    }

    return activeVersionByResId;
  }

  /**
   * Single-query Active Publication Gate verification + card hydration for cached responses (1 DB round-trip).
   */
  private async verifySourceAndHydrateCardsSingleQuery(
    sourceResourceId: string,
    candidateIds: string[],
    optionalCountryFilter?: string,
    evalNow: Date = new Date(),
  ): Promise<{ countryId: string; cards: RecommendationCardDto[] }> {
    const evalIso = evalNow.toISOString();
    const candidateArraySql =
      candidateIds.length > 0
        ? sql`ARRAY[${sql.join(
            candidateIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[]`
        : sql`ARRAY[]::uuid[]`;

    const result = await this.dbInstance.execute(sql`
      WITH source_gate AS (
        SELECT
          r.id AS source_id,
          r.country_id,
          c.name AS country_name,
          c.iso_code AS country_iso_code,
          c.url_prefix AS country_url_prefix
        FROM content.resources r
        INNER JOIN content.resource_versions rv
          ON rv.resource_id = r.id
         AND rv.status = 'PUBLISHED'
         AND rv.published_at IS NOT NULL
         AND rv.published_at <= ${evalIso}::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM files.resource_files rf
           WHERE rf.resource_version_id = rv.id
             AND (
               rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
               OR rf.object_key LIKE 'quarantine/%'
             )
         )
        INNER JOIN platform.countries c
          ON c.id = r.country_id
         AND c.status = 'ACTIVE'
        INNER JOIN content.resource_types rt
          ON rt.id = r.resource_type_id
         AND rt.status = 'ACTIVE'
        WHERE r.id = ${sourceResourceId}::uuid
          AND r.status = 'PUBLISHED'
      ),
      gated_candidates AS (
        SELECT
          r.id AS resource_id,
          COALESCE(NULLIF(trim(rv.title), ''), r.title) AS display_title,
          r.slug,
          COALESCE(NULLIF(trim(rv.description), ''), r.description) AS display_description,
          r.quality_label AS resource_quality_label,
          rv.quality_label AS version_quality_label,
          rv.id AS version_id,
          rv.version_number,
          rv.version_label,
          rv.published_at,
          rt.id AS type_id,
          rt.code AS type_code,
          rt.name AS type_name,
          rt.slug AS type_slug,
          rt.pillar AS type_pillar,
          sg.country_id AS country_id,
          sg.country_name AS country_name,
          sg.country_iso_code AS country_iso_code,
          sg.country_url_prefix AS country_url_prefix,
          cur.id AS curriculum_id,
          cur.code AS curriculum_code,
          cur.name AS curriculum_name,
          g.id AS grade_id,
          g.code AS grade_code,
          g.name AS grade_name,
          sub.id AS subject_id,
          sub.code AS subject_code,
          sub.name AS subject_name,
          top.id AS topic_id,
          top.code AS topic_code,
          top.name AS topic_name,
          gv.id AS verification_id,
          gv.verified_at
        FROM source_gate sg
        INNER JOIN content.resources r
          ON r.country_id = sg.country_id
         AND r.id = ANY(${candidateArraySql})
         AND r.status = 'PUBLISHED'
        INNER JOIN content.resource_versions rv
          ON rv.resource_id = r.id
         AND rv.status = 'PUBLISHED'
         AND rv.published_at IS NOT NULL
         AND rv.published_at <= ${evalIso}::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM files.resource_files rf
           WHERE rf.resource_version_id = rv.id
             AND (
               rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
               OR rf.object_key LIKE 'quarantine/%'
             )
         )
        INNER JOIN content.resource_types rt
          ON rt.id = r.resource_type_id
         AND rt.status = 'ACTIVE'
        LEFT JOIN governance.resource_verifications gv
          ON gv.resource_id = r.id
         AND gv.resource_version_id = rv.id
         AND gv.verification_status = 'VERIFIED'
        LEFT JOIN taxonomy.curricula cur
          ON cur.id = r.curriculum_id
        LEFT JOIN taxonomy.grades g
          ON g.id = r.grade_id
        LEFT JOIN taxonomy.subjects sub
          ON sub.id = r.subject_id
        LEFT JOIN taxonomy.topics top
          ON top.id = r.topic_id
         AND top.status = 'ACTIVE'
      )
      SELECT
        sg.source_id,
        sg.country_id AS sg_country_id,
        sg.country_iso_code AS sg_country_iso_code,
        sg.country_url_prefix AS sg_country_url_prefix,
        gc.*
      FROM source_gate sg
      LEFT JOIN gated_candidates gc ON true
    `);

    if (result.rows.length === 0) {
      throw new RecommendationError(
        'Published resource not found.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    const firstRow = result.rows[0] as any;
    if (
      !matchesCountryFilter(
        {
          country_id: firstRow.sg_country_id,
          country_iso_code: firstRow.sg_country_iso_code,
          country_url_prefix: firstRow.sg_country_url_prefix,
        },
        optionalCountryFilter,
      )
    ) {
      throw new RecommendationError(
        'Published resource not found in specified country.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    const cards: RecommendationCardDto[] = [];
    for (const row of result.rows as any[]) {
      if (!row.resource_id) continue;
      cards.push(this.mapRowToCardDto(row));
    }

    return {
      countryId: firstRow.sg_country_id,
      cards,
    };
  }

  /**
   * Single consolidated PostgreSQL query retrieving source metadata, eligible country candidates,
   * active editorial rules, and partitioned 90d/30d distinct co-occurrence counts.
   */
  /**
   * Benchmark helper executing EXPLAIN (ANALYZE, FORMAT JSON) on the exact production
   * candidate & scoring SQL query to measure true PostgreSQL server-side Execution Time (ms).
   */
  async explainResourceScoringQuery(
    sourceResourceId: string,
    evalNow: Date = new Date(),
    surface: ResourceDetailSurface = 'related-resources',
  ): Promise<number> {
    const evalIso = evalNow.toISOString();
    const querySql = this.buildResourceScoringQuerySql(sourceResourceId, surface, evalIso);
    const res = await this.dbInstance.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${querySql}`);
    const planRoot = (res.rows[0] as any)?.['QUERY PLAN'];
    const parsed = typeof planRoot === 'string' ? JSON.parse(planRoot) : planRoot;
    const execMs = Number(parsed?.[0]?.['Execution Time'] ?? 0);
    return execMs;
  }

  private buildResourceScoringQuerySql(
    sourceResourceId: string,
    surface: ResourceDetailSurface,
    evalIso: string,
  ) {
    return sql`
      SELECT *
      FROM content.fn_get_resource_scoring_dataset(
        ${sourceResourceId}::uuid,
        ${surface}::text,
        ${evalIso}::timestamptz
      )
    `;
  }

  private async fetchResourceScoringDataset(
    sourceResourceId: string,
    surface: ResourceDetailSurface,
    evalNow: Date,
    optionalCountryFilter?: string,
  ): Promise<{
    countryId: string;
    source: ScoringResourceContext;
    candidates: ScoringCandidateInput[];
    rules: ActiveEditorialRuleInput[];
    cardByResourceId: Map<string, RecommendationCardDto>;
  }> {
    const evalIso = evalNow.toISOString();
    const result = await this.dbInstance.execute(
      this.buildResourceScoringQuerySql(sourceResourceId, surface, evalIso),
    );

    if (result.rows.length === 0) {
      throw new RecommendationError(
        'Published resource not found.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    const row = result.rows[0] as any;
    if (
      !matchesCountryFilter(
        {
          country_id: row.country_id,
          country_iso_code: row.country_iso_code,
          country_url_prefix: row.country_url_prefix,
        },
        optionalCountryFilter,
      )
    ) {
      throw new RecommendationError(
        'Published resource not found in specified country.',
        404,
        'RESOURCE_NOT_FOUND',
      );
    }

    const source: ScoringResourceContext = {
      resourceId: row.resource_id,
      gradeId: row.grade_id ?? null,
      subjectId: row.subject_id ?? null,
      topicId: row.topic_id ?? null,
      topicActive: Boolean(row.topic_active),
      topicParentId: row.topic_parent_id ?? null,
      topicParentActive: Boolean(row.topic_parent_active),
      pillar: row.pillar as ResourcePillar,
    };

    const rawCandidates: any[] = Array.isArray(row.candidate_items) ? row.candidate_items : [];
    const candidates: ScoringCandidateInput[] = [];
    const cardByResourceId = new Map<string, RecommendationCardDto>();

    for (const c of rawCandidates) {
      candidates.push({
        resourceId: c.resourceId,
        gradeId: c.gradeId ?? null,
        subjectId: c.subjectId ?? null,
        topicId: c.topicId ?? null,
        topicActive: Boolean(c.topicActive),
        topicParentId: c.topicParentId ?? null,
        topicParentActive: Boolean(c.topicParentActive),
        pillar: c.pillar as ResourcePillar,
        resourceQualityLabel: c.resourceQualityLabel,
        versionQualityLabel: c.versionQualityLabel,
        hasActiveVersionVerification: Boolean(c.hasActiveVersionVerification),
        publishedAt: new Date(c.publishedAt),
        distinctCoIdentityCount: Number(c.distinctCoIdentityCount ?? 0),
      });

      cardByResourceId.set(
        c.resourceId,
        this.mapRowToCardDto({
          resource_id: c.resourceId,
          display_title: c.displayTitle,
          slug: c.slug,
          display_description: c.displayDescription,
          resource_quality_label: c.resourceQualityLabel,
          version_quality_label: c.versionQualityLabel,
          version_id: c.versionId,
          version_number: c.versionNumber,
          version_label: c.versionLabel,
          published_at: c.publishedAt,
          type_id: c.typeId,
          type_code: c.typeCode,
          type_name: c.typeName,
          type_slug: c.typeSlug,
          type_pillar: c.pillar,
          country_id: row.country_id,
          country_name: row.country_name,
          country_iso_code: row.country_iso_code,
          country_url_prefix: row.country_url_prefix,
          curriculum_id: c.curriculumId,
          curriculum_code: c.curriculumCode,
          curriculum_name: c.curriculumName,
          grade_id: c.gradeId,
          grade_code: c.gradeCode,
          grade_name: c.gradeName,
          subject_id: c.subjectId,
          subject_code: c.subjectCode,
          subject_name: c.subjectName,
          topic_id: c.topicActive ? c.topicId : null,
          topic_code: c.topicCode,
          topic_name: c.topicName,
          verification_id: c.verificationId,
          verified_at: c.verifiedAt,
        }),
      );
    }

    const rawRules: any[] = Array.isArray(row.rule_items) ? row.rule_items : [];
    const rules: ActiveEditorialRuleInput[] = rawRules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType as RecommendationRuleType,
      sourceResourceId: r.sourceResourceId ?? null,
      sourceTopicId: r.sourceTopicId ?? null,
      targetResourceId: r.targetResourceId,
      priority: r.priority !== null && r.priority !== undefined ? Number(r.priority) : null,
    }));

    return {
      countryId: row.country_id,
      source,
      candidates,
      rules,
      cardByResourceId,
    };
  }

  private async extractExploreSeedIds(params: {
    countryId: string;
    userId: string | null;
    anonymousSessionHash: string | null;
    evalNow: Date;
  }): Promise<string[]> {
    const evalIso = params.evalNow.toISOString();

    if (params.userId && UUID_REGEX.test(params.userId)) {
      const result = await this.dbInstance.execute(sql`
        WITH saved_seeds AS (
          SELECT
            r.id AS resource_id,
            (${evalIso}::timestamptz + (ord.idx * INTERVAL '1 millisecond')) AS sort_ts
          FROM identity.users u
          CROSS JOIN LATERAL unnest(u.saved_resource_version_ids) WITH ORDINALITY AS ord(version_id, idx)
          INNER JOIN content.resource_versions rv
            ON rv.id = ord.version_id
          INNER JOIN content.resources r
            ON r.id = rv.resource_id
           AND r.country_id = ${params.countryId}::uuid
           AND r.status = 'PUBLISHED'
          INNER JOIN platform.countries c
            ON c.id = r.country_id
           AND c.status = 'ACTIVE'
          INNER JOIN content.resource_types rt
            ON rt.id = r.resource_type_id
           AND rt.status = 'ACTIVE'
          INNER JOIN content.resource_versions active_rv
            ON active_rv.resource_id = r.id
           AND active_rv.status = 'PUBLISHED'
           AND active_rv.published_at IS NOT NULL
           AND active_rv.published_at <= ${evalIso}::timestamptz
           AND NOT EXISTS (
             SELECT 1
             FROM files.resource_files rf
             WHERE rf.resource_version_id = active_rv.id
               AND (
                 rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
                 OR rf.object_key LIKE 'quarantine/%'
               )
           )
          WHERE u.id = ${params.userId}::uuid
            AND u.status = 'ACTIVE'
            AND u.deleted_at IS NULL
        ),
        event_seeds AS (
          SELECT
            r.id AS resource_id,
            MAX(e.occurred_at) AS sort_ts
          FROM analytics.analytics_events e
          INNER JOIN analytics.analytics_event_types et
            ON et.id = e.event_type_id
           AND et.event_code IN ('view', 'download', 'save')
           AND et.status = 'ACTIVE'
          INNER JOIN content.resources r
            ON r.id = e.entity_id
           AND r.country_id = ${params.countryId}::uuid
           AND r.status = 'PUBLISHED'
          INNER JOIN platform.countries c
            ON c.id = r.country_id
           AND c.status = 'ACTIVE'
          INNER JOIN content.resource_types rt
            ON rt.id = r.resource_type_id
           AND rt.status = 'ACTIVE'
          INNER JOIN content.resource_versions active_rv
            ON active_rv.resource_id = r.id
           AND active_rv.status = 'PUBLISHED'
           AND active_rv.published_at IS NOT NULL
           AND active_rv.published_at <= ${evalIso}::timestamptz
           AND NOT EXISTS (
             SELECT 1
             FROM files.resource_files rf
             WHERE rf.resource_version_id = active_rv.id
               AND (
                 rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
                 OR rf.object_key LIKE 'quarantine/%'
               )
           )
          WHERE e.actor_type = 'AUTHENTICATED'
            AND e.user_id = ${params.userId}::uuid
            AND e.entity_type = 'resource'
            AND (e.country_id IS NULL OR e.country_id = ${params.countryId}::uuid)
            AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '90 days')
            AND e.occurred_at <= ${evalIso}::timestamptz
          GROUP BY r.id
        ),
        combined AS (
          SELECT resource_id, MAX(sort_ts) AS last_seen_at
          FROM (
            SELECT * FROM saved_seeds
            UNION ALL
            SELECT * FROM event_seeds
          ) all_seeds
          GROUP BY resource_id
        )
        SELECT resource_id
        FROM combined
        ORDER BY last_seen_at DESC, resource_id ASC
        LIMIT ${SCORING_CONSTANTS.MAX_EXPLORE_SEEDS}
      `);

      return (result.rows as any[]).map((r) => String(r.resource_id));
    }

    if (params.anonymousSessionHash && /^[a-f0-9]{64}$/.test(params.anonymousSessionHash)) {
      const result = await this.dbInstance.execute(sql`
        SELECT
          r.id AS resource_id,
          MAX(e.occurred_at) AS last_seen_at
        FROM analytics.analytics_events e
        INNER JOIN analytics.analytics_event_types et
          ON et.id = e.event_type_id
         AND et.event_code IN ('view', 'download')
         AND et.status = 'ACTIVE'
        INNER JOIN content.resources r
          ON r.id = e.entity_id
         AND r.country_id = ${params.countryId}::uuid
         AND r.status = 'PUBLISHED'
        INNER JOIN platform.countries c
          ON c.id = r.country_id
         AND c.status = 'ACTIVE'
        INNER JOIN content.resource_types rt
          ON rt.id = r.resource_type_id
         AND rt.status = 'ACTIVE'
        INNER JOIN content.resource_versions active_rv
          ON active_rv.resource_id = r.id
         AND active_rv.status = 'PUBLISHED'
         AND active_rv.published_at IS NOT NULL
         AND active_rv.published_at <= ${evalIso}::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM files.resource_files rf
           WHERE rf.resource_version_id = active_rv.id
             AND (
               rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
               OR rf.object_key LIKE 'quarantine/%'
             )
         )
        WHERE e.actor_type = 'ANONYMOUS'
          AND e.anonymous_session_hash = ${params.anonymousSessionHash}
          AND e.entity_type = 'resource'
          AND (e.country_id IS NULL OR e.country_id = ${params.countryId}::uuid)
          AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '30 days')
          AND e.occurred_at <= ${evalIso}::timestamptz
        GROUP BY r.id
        ORDER BY last_seen_at DESC, r.id ASC
        LIMIT ${SCORING_CONSTANTS.MAX_EXPLORE_SEEDS}
      `);

      return (result.rows as any[]).map((r) => String(r.resource_id));
    }

    return [];
  }

  private async fetchContinueExploringContextualDataset(
    countryId: string,
    seedIds: string[],
    evalNow: Date,
  ): Promise<{
    seeds: ScoringResourceContext[];
    candidates: Array<
      Omit<ScoringCandidateInput, 'distinctCoIdentityCount'> & {
        coOccurrenceBySeedId: Map<string, number>;
      }
    >;
    rules: ActiveEditorialRuleInput[];
  }> {
    const evalIso = evalNow.toISOString();
    const seedArraySql = sql`ARRAY[${sql.join(
      seedIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]::uuid[]`;

    const allResourcesResult = await this.dbInstance.execute(sql`
      SELECT
        r.id AS resource_id,
        r.grade_id,
        r.subject_id,
        r.topic_id,
        (t.id IS NOT NULL AND t.status = 'ACTIVE') AS topic_active,
        t.parent_id AS topic_parent_id,
        (tp.id IS NOT NULL AND tp.status = 'ACTIVE') AS topic_parent_active,
        rt.pillar,
        r.quality_label AS resource_quality_label,
        rv.quality_label AS version_quality_label,
        (gv.id IS NOT NULL) AS has_active_verification,
        rv.published_at
      FROM content.resources r
      INNER JOIN content.resource_versions rv
        ON rv.resource_id = r.id
       AND rv.status = 'PUBLISHED'
       AND rv.published_at IS NOT NULL
       AND rv.published_at <= ${evalIso}::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM files.resource_files rf
         WHERE rf.resource_version_id = rv.id
           AND (
             rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
             OR rf.object_key LIKE 'quarantine/%'
           )
       )
      INNER JOIN platform.countries c
        ON c.id = r.country_id
       AND c.status = 'ACTIVE'
      INNER JOIN content.resource_types rt
        ON rt.id = r.resource_type_id
       AND rt.status = 'ACTIVE'
      LEFT JOIN governance.resource_verifications gv
        ON gv.resource_id = r.id
       AND gv.resource_version_id = rv.id
       AND gv.verification_status = 'VERIFIED'
      LEFT JOIN taxonomy.topics t
        ON t.id = r.topic_id
      LEFT JOIN taxonomy.topics tp
        ON tp.id = t.parent_id
      WHERE r.country_id = ${countryId}::uuid
        AND r.status = 'PUBLISHED'
    `);

    const seedSet = new Set(seedIds);
    const seeds: ScoringResourceContext[] = [];
    const seedTopicIds = new Set<string>();
    const rawCandidates: Array<
      Omit<ScoringCandidateInput, 'distinctCoIdentityCount'> & {
        coOccurrenceBySeedId: Map<string, number>;
      }
    > = [];

    for (const row of allResourcesResult.rows as any[]) {
      const ctx: ScoringResourceContext = {
        resourceId: row.resource_id,
        gradeId: row.grade_id ?? null,
        subjectId: row.subject_id ?? null,
        topicId: row.topic_id ?? null,
        topicActive: Boolean(row.topic_active),
        topicParentId: row.topic_parent_id ?? null,
        topicParentActive: Boolean(row.topic_parent_active),
        pillar: row.pillar as ResourcePillar,
      };

      if (seedSet.has(row.resource_id)) {
        seeds.push(ctx);
        if (ctx.topicActive && ctx.topicId) {
          seedTopicIds.add(ctx.topicId);
        }
      } else {
        rawCandidates.push({
          ...ctx,
          resourceQualityLabel: row.resource_quality_label,
          versionQualityLabel: row.version_quality_label,
          hasActiveVersionVerification: Boolean(row.has_active_verification),
          publishedAt: new Date(row.published_at),
          coOccurrenceBySeedId: new Map(),
        });
      }
    }

    if (seeds.length === 0 || rawCandidates.length === 0) {
      return { seeds, candidates: rawCandidates, rules: [] };
    }

    // Fetch active EXCLUDE/PIN rules relevant to the seeds
    const topicArraySql =
      seedTopicIds.size > 0
        ? sql`ARRAY[${sql.join(
            Array.from(seedTopicIds).map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[]`
        : sql`ARRAY[]::uuid[]`;

    const [rulesRes, coRes] = await Promise.all([
      this.dbInstance.execute(sql`
        SELECT
          id,
          rule_type,
          source_resource_id,
          source_topic_id,
          target_resource_id,
          priority
        FROM content.resource_recommendation_rules
        WHERE country_id = ${countryId}::uuid
          AND status = 'ACTIVE'
          AND (
            source_resource_id = ANY(${seedArraySql})
            OR source_topic_id = ANY(${topicArraySql})
          )
      `),
      this.dbInstance.execute(sql`
        WITH eligible_event_types AS (
          SELECT id
          FROM analytics.analytics_event_types
          WHERE event_code IN ('view', 'download')
            AND status = 'ACTIVE'
        ),
        seed_auth AS (
          SELECT DISTINCT e.entity_id AS seed_id, e.user_id
          FROM analytics.analytics_events e
          INNER JOIN eligible_event_types et ON et.id = e.event_type_id
          WHERE e.entity_type = 'resource'
            AND e.entity_id = ANY(${seedArraySql})
            AND e.actor_type = 'AUTHENTICATED'
            AND e.user_id IS NOT NULL
            AND (e.country_id IS NULL OR e.country_id = ${countryId}::uuid)
            AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '90 days')
            AND e.occurred_at <= ${evalIso}::timestamptz
        ),
        seed_anon AS (
          SELECT DISTINCT e.entity_id AS seed_id, e.anonymous_session_hash
          FROM analytics.analytics_events e
          INNER JOIN eligible_event_types et ON et.id = e.event_type_id
          WHERE e.entity_type = 'resource'
            AND e.entity_id = ANY(${seedArraySql})
            AND e.actor_type = 'ANONYMOUS'
            AND e.anonymous_session_hash IS NOT NULL
            AND e.anonymous_session_hash ~ '^[a-f0-9]{64}$'
            AND (e.country_id IS NULL OR e.country_id = ${countryId}::uuid)
            AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '30 days')
            AND e.occurred_at <= ${evalIso}::timestamptz
        ),
        pairs AS (
          SELECT
            sa.seed_id,
            e.entity_id AS candidate_id,
            ('u:' || e.user_id::text) AS ident
          FROM seed_auth sa
          INNER JOIN analytics.analytics_events e
            ON e.user_id = sa.user_id
           AND e.entity_type = 'resource'
           AND e.actor_type = 'AUTHENTICATED'
           AND NOT (e.entity_id = ANY(${seedArraySql}))
           AND (e.country_id IS NULL OR e.country_id = ${countryId}::uuid)
           AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '90 days')
           AND e.occurred_at <= ${evalIso}::timestamptz
          INNER JOIN eligible_event_types et ON et.id = e.event_type_id
          UNION ALL
          SELECT
            sn.seed_id,
            e.entity_id AS candidate_id,
            ('s:' || e.anonymous_session_hash) AS ident
          FROM seed_anon sn
          INNER JOIN analytics.analytics_events e
            ON e.anonymous_session_hash = sn.anonymous_session_hash
           AND e.entity_type = 'resource'
           AND e.actor_type = 'ANONYMOUS'
           AND NOT (e.entity_id = ANY(${seedArraySql}))
           AND (e.country_id IS NULL OR e.country_id = ${countryId}::uuid)
           AND e.occurred_at >= (${evalIso}::timestamptz - INTERVAL '30 days')
           AND e.occurred_at <= ${evalIso}::timestamptz
          INNER JOIN eligible_event_types et ON et.id = e.event_type_id
        )
        SELECT
          seed_id,
          candidate_id,
          COUNT(DISTINCT ident)::int AS n_co
        FROM pairs
        GROUP BY seed_id, candidate_id
      `),
    ]);

    const candMap = new Map(rawCandidates.map((c) => [c.resourceId, c]));
    for (const row of coRes.rows as any[]) {
      const target = candMap.get(row.candidate_id);
      if (target) {
        target.coOccurrenceBySeedId.set(row.seed_id, Number(row.n_co));
      }
    }

    const rules: ActiveEditorialRuleInput[] = (rulesRes.rows as any[]).map((r) => ({
      id: r.id,
      ruleType: r.rule_type as RecommendationRuleType,
      sourceResourceId: r.source_resource_id ?? null,
      sourceTopicId: r.source_topic_id ?? null,
      targetResourceId: r.target_resource_id,
      priority: r.priority !== null && r.priority !== undefined ? Number(r.priority) : null,
    }));

    return { seeds, candidates: rawCandidates, rules };
  }

  private async fetchColdStartCandidates(
    countryId: string,
    evalNow: Date = new Date(),
  ): Promise<
    Array<{
      resourceId: string;
      resourceQualityLabel: string;
      versionQualityLabel: string;
      hasActiveVersionVerification: boolean;
      publishedAt: Date;
    }>
  > {
    const evalIso = evalNow.toISOString();
    const result = await this.dbInstance.execute(sql`
      SELECT
        r.id AS resource_id,
        r.quality_label AS resource_quality_label,
        rv.quality_label AS version_quality_label,
        (gv.id IS NOT NULL) AS has_active_verification,
        rv.published_at
      FROM content.resources r
      INNER JOIN content.resource_versions rv
        ON rv.resource_id = r.id
       AND rv.status = 'PUBLISHED'
       AND rv.published_at IS NOT NULL
       AND rv.published_at <= ${evalIso}::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM files.resource_files rf
         WHERE rf.resource_version_id = rv.id
           AND (
             rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
             OR rf.object_key LIKE 'quarantine/%'
           )
       )
      INNER JOIN platform.countries c
        ON c.id = r.country_id
       AND c.status = 'ACTIVE'
      INNER JOIN content.resource_types rt
        ON rt.id = r.resource_type_id
       AND rt.status = 'ACTIVE'
      LEFT JOIN governance.resource_verifications gv
        ON gv.resource_id = r.id
       AND gv.resource_version_id = rv.id
       AND gv.verification_status = 'VERIFIED'
      WHERE r.country_id = ${countryId}::uuid
        AND r.status = 'PUBLISHED'
    `);

    return (result.rows as any[]).map((r) => ({
      resourceId: r.resource_id,
      resourceQualityLabel: r.resource_quality_label,
      versionQualityLabel: r.version_quality_label,
      hasActiveVersionVerification: Boolean(r.has_active_verification),
      publishedAt: new Date(r.published_at),
    }));
  }

  /**
   * Executes the canonical Section 4.2 Active Publication Gate hydration query for candidate IDs.
   */
  private async hydrateCardsByIds(
    countryId: string,
    candidateIds: string[],
    evalNow: Date = new Date(),
  ): Promise<RecommendationCardDto[]> {
    if (candidateIds.length === 0) return [];
    const evalIso = evalNow.toISOString();

    const candidateArraySql = sql`ARRAY[${sql.join(
      candidateIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]::uuid[]`;

    const result = await this.dbInstance.execute(sql`
      SELECT
        r.id AS resource_id,
        COALESCE(NULLIF(trim(rv.title), ''), r.title) AS display_title,
        r.slug,
        COALESCE(NULLIF(trim(rv.description), ''), r.description) AS display_description,
        r.quality_label AS resource_quality_label,
        rv.quality_label AS version_quality_label,
        rv.id AS version_id,
        rv.version_number,
        rv.version_label,
        rv.published_at,
        rt.id AS type_id,
        rt.code AS type_code,
        rt.name AS type_name,
        rt.slug AS type_slug,
        rt.pillar AS type_pillar,
        c.id AS country_id,
        c.name AS country_name,
        c.iso_code AS country_iso_code,
        c.url_prefix AS country_url_prefix,
        cur.id AS curriculum_id,
        cur.code AS curriculum_code,
        cur.name AS curriculum_name,
        g.id AS grade_id,
        g.code AS grade_code,
        g.name AS grade_name,
        sub.id AS subject_id,
        sub.code AS subject_code,
        sub.name AS subject_name,
        top.id AS topic_id,
        top.code AS topic_code,
        top.name AS topic_name,
        gv.id AS verification_id,
        gv.verified_at
      FROM content.resources r
      INNER JOIN content.resource_versions rv
        ON rv.resource_id = r.id
       AND rv.status = 'PUBLISHED'
       AND rv.published_at IS NOT NULL
       AND rv.published_at <= ${evalIso}::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM files.resource_files rf
         WHERE rf.resource_version_id = rv.id
           AND (
             rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
             OR rf.object_key LIKE 'quarantine/%'
           )
       )
      INNER JOIN platform.countries c
        ON c.id = r.country_id
       AND c.status = 'ACTIVE'
      INNER JOIN content.resource_types rt
        ON rt.id = r.resource_type_id
       AND rt.status = 'ACTIVE'
      LEFT JOIN governance.resource_verifications gv
        ON gv.resource_id = r.id
       AND gv.resource_version_id = rv.id
       AND gv.verification_status = 'VERIFIED'
      LEFT JOIN taxonomy.curricula cur
        ON cur.id = r.curriculum_id
      LEFT JOIN taxonomy.grades g
        ON g.id = r.grade_id
      LEFT JOIN taxonomy.subjects sub
        ON sub.id = r.subject_id
      LEFT JOIN taxonomy.topics top
        ON top.id = r.topic_id
       AND top.status = 'ACTIVE'
      WHERE r.status = 'PUBLISHED'
        AND r.country_id = ${countryId}::uuid
        AND r.id = ANY(${candidateArraySql})
    `);

    return (result.rows as any[]).map((row) => this.mapRowToCardDto(row));
  }

  private mapRowToCardDto(row: any): RecommendationCardDto {
    const hasActiveVerification = Boolean(row.verification_id);
    const resolvedQuality = resolveCanonicalQuality({
      resourceQualityLabel: row.resource_quality_label,
      versionQualityLabel: row.version_quality_label,
      hasActiveVersionVerification: hasActiveVerification,
    });

    const publishedAtIso =
      row.published_at instanceof Date
        ? row.published_at.toISOString()
        : new Date(row.published_at).toISOString();

    const verifiedAtIso = row.verified_at
      ? row.verified_at instanceof Date
        ? row.verified_at.toISOString()
        : new Date(row.verified_at).toISOString()
      : null;

    return {
      id: row.resource_id,
      title: row.display_title,
      slug: row.slug,
      description: row.display_description ?? null,
      qualityLabel: resolvedQuality.displayLabel,
      quality: {
        effectiveTier: resolvedQuality.effectiveTier,
        label: resolvedQuality.isVerified ? 'VERIFIED' : resolvedQuality.displayLabel,
        displayMark: resolvedQuality.displayMark,
        isVerified: resolvedQuality.isVerified,
        isPremium: resolvedQuality.isPremium,
        verifiedAt: verifiedAtIso,
      },
      resourceType: {
        id: row.type_id,
        code: row.type_code,
        name: row.type_name,
        slug: row.type_slug,
        pillar: row.type_pillar,
      },
      country: {
        id: row.country_id,
        name: row.country_name,
        isoCode: row.country_iso_code,
        urlPrefix: row.country_url_prefix,
      },
      curriculum: row.curriculum_id
        ? {
            id: row.curriculum_id,
            code: row.curriculum_code,
            name: row.curriculum_name,
          }
        : null,
      grade: row.grade_id
        ? {
            id: row.grade_id,
            code: row.grade_code,
            name: row.grade_name,
          }
        : null,
      subject: row.subject_id
        ? {
            id: row.subject_id,
            code: row.subject_code,
            name: row.subject_name,
          }
        : null,
      topic: row.topic_id
        ? {
            id: row.topic_id,
            code: row.topic_code,
            name: row.topic_name,
          }
        : null,
      publishedVersion: {
        id: row.version_id,
        versionNumber: Number(row.version_number),
        versionLabel: row.version_label,
        publishedAt: publishedAtIso,
      },
    };
  }
}

export const defaultRecommendationService = new DefaultRecommendationService();
