import type { QualityLabel, ResourcePillar } from '../../db/schema/resource.js';
import type { RecommendationRuleType } from '../../db/schema/recommendations.js';

export const RECOMMENDATION_SURFACES = [
  'related-resources',
  'you-may-also-need',
  'teachers-also-viewed',
  'continue-exploring',
] as const;
export type RecommendationSurface = (typeof RECOMMENDATION_SURFACES)[number];

export const RESOURCE_DETAIL_SURFACES = [
  'related-resources',
  'you-may-also-need',
  'teachers-also-viewed',
] as const;
export type ResourceDetailSurface = (typeof RESOURCE_DETAIL_SURFACES)[number];

export const DEFAULT_SURFACE_LIMITS: Record<RecommendationSurface, number> = {
  'related-resources': 6,
  'you-may-also-need': 4,
  'teachers-also-viewed': 6,
  'continue-exploring': 8,
};

export const MAX_RECOMMENDATION_LIMIT = 20;

export const SCORING_CONSTANTS = {
  TOPIC_EXACT_POINTS: 30,
  TOPIC_PARENT_CHILD_POINTS: 15,
  SUBJECT_EXACT_POINTS: 15,
  GRADE_EXACT_POINTS: 10,
  COMPLEMENTARY_PILLAR_POINTS: 5,
  METADATA_CAP: 50,
  QUALITY_VERIFIED_POINTS: 15,
  QUALITY_PREMIUM_POINTS: 5,
  QUALITY_STANDARD_POINTS: 0,
  FRESHNESS_0_TO_30_POINTS: 10,
  FRESHNESS_31_TO_90_POINTS: 6,
  FRESHNESS_91_TO_180_POINTS: 3,
  FRESHNESS_181_PLUS_POINTS: 0,
  BEHAVIOURAL_MIN_IDENTITIES: 3,
  BEHAVIOURAL_LOG_MULTIPLIER: 5,
  BEHAVIOURAL_CAP: 25,
  ALGORITHMIC_MAX: 100,
  AUTH_WINDOW_DAYS: 90,
  ANON_WINDOW_DAYS: 30,
  MAX_EXPLORE_SEEDS: 5,
} as const;

/**
 * Symmetric complementary pillar pairs among the 8 verified RESOURCE_PILLARS.
 */
const COMPLEMENTARY_PILLAR_MAP: Readonly<Record<ResourcePillar, ResourcePillar>> = {
  PAST_PAPERS: 'NOTES_REVISION',
  NOTES_REVISION: 'PAST_PAPERS',
  LESSON_PLANS: 'SCHEMES_OF_WORK',
  SCHEMES_OF_WORK: 'LESSON_PLANS',
  SCHOOL_DOCUMENTS: 'TEACHER_RESOURCES',
  TEACHER_RESOURCES: 'SCHOOL_DOCUMENTS',
  ACADEMIC_CALENDAR: 'EDUCATION_UPDATES',
  EDUCATION_UPDATES: 'ACADEMIC_CALENDAR',
};

export interface ScoringResourceContext {
  resourceId: string;
  gradeId: string | null;
  subjectId: string | null;
  topicId: string | null;
  topicActive: boolean;
  topicParentId: string | null;
  topicParentActive: boolean;
  pillar: ResourcePillar;
}

export interface ScoringCandidateInput extends ScoringResourceContext {
  resourceQualityLabel: QualityLabel | string | null | undefined;
  versionQualityLabel: QualityLabel | string | null | undefined;
  hasActiveVersionVerification: boolean;
  publishedAt: Date;
  distinctCoIdentityCount: number;
}

export interface CanonicalQualityResolution {
  effectiveTier: QualityLabel;
  qualityScore: 0 | 5 | 15;
  isVerified: boolean;
  isPremium: boolean;
  displayLabel: QualityLabel;
  displayMark: string | null;
}

export interface ActiveEditorialRuleInput {
  id: string;
  ruleType: RecommendationRuleType;
  sourceResourceId: string | null;
  sourceTopicId: string | null;
  targetResourceId: string;
  priority: number | null;
}

export interface ScoreBreakdown {
  topicWeight: number;
  subjectWeight: number;
  gradeWeight: number;
  pillarWeight: number;
  metadataScore: number;
  qualityScore: 0 | 5 | 15;
  freshnessScore: 0 | 3 | 6 | 10;
  behaviouralScore: number;
  algorithmicScore: number;
  effectiveQuality: QualityLabel;
}

export interface RankedCandidateResult {
  resourceId: string;
  isPinned: boolean;
  ruleScopeRank: 1 | 2 | null;
  priority: number | null;
  algorithmicScore: number;
  qualityScore: 0 | 5 | 15;
  behaviouralScore: number;
  metadataScore: number;
  freshnessScore: 0 | 3 | 6 | 10;
  publishedAt: Date;
}

export function clampRecommendationLimit(
  surface: RecommendationSurface,
  requestedLimit?: number | null,
): number {
  const fallback = DEFAULT_SURFACE_LIMITS[surface];
  if (requestedLimit === undefined || requestedLimit === null || Number.isNaN(requestedLimit)) {
    return fallback;
  }
  return Math.min(MAX_RECOMMENDATION_LIMIT, Math.max(1, Math.trunc(requestedLimit)));
}

export function areComplementaryPillars(
  pillarA: ResourcePillar | string,
  pillarB: ResourcePillar | string,
): boolean {
  if (!pillarA || !pillarB || pillarA === pillarB) {
    return false;
  }
  const expected = COMPLEMENTARY_PILLAR_MAP[pillarA as ResourcePillar];
  return expected === pillarB;
}

/**
 * Resolves canonical quality tier and score with strict version-authoritative verification precedence:
 * 1. VERIFIED (15 pts): active row in governance.resource_verifications for rv.id OR rv.quality_label = 'VERIFIED'.
 *    Stale resources.quality_label = 'VERIFIED' with rv.quality_label = 'STANDARD' and no active verification scores 0.
 * 2. PREMIUM (5 pts): not VERIFIED, and rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM'.
 * 3. STANDARD (0 pts): all other cases.
 */
export function resolveCanonicalQuality(input: {
  resourceQualityLabel: QualityLabel | string | null | undefined;
  versionQualityLabel: QualityLabel | string | null | undefined;
  hasActiveVersionVerification: boolean;
}): CanonicalQualityResolution {
  const vLabel = input.versionQualityLabel || 'STANDARD';
  const rLabel = input.resourceQualityLabel || 'STANDARD';

  const isVerified = Boolean(input.hasActiveVersionVerification) || vLabel === 'VERIFIED';
  const isPremium = vLabel === 'PREMIUM' || rLabel === 'PREMIUM';

  if (isVerified) {
    return {
      effectiveTier: 'VERIFIED',
      qualityScore: SCORING_CONSTANTS.QUALITY_VERIFIED_POINTS,
      isVerified: true,
      isPremium,
      displayLabel: isPremium ? 'PREMIUM' : 'VERIFIED',
      displayMark: '✓',
    };
  }

  if (isPremium) {
    return {
      effectiveTier: 'PREMIUM',
      qualityScore: SCORING_CONSTANTS.QUALITY_PREMIUM_POINTS,
      isVerified: false,
      isPremium: true,
      displayLabel: 'PREMIUM',
      displayMark: '⭐',
    };
  }

  return {
    effectiveTier: 'STANDARD',
    qualityScore: SCORING_CONSTANTS.QUALITY_STANDARD_POINTS,
    isVerified: false,
    isPremium: false,
    displayLabel: 'STANDARD',
    displayMark: null,
  };
}

/**
 * Mutually exclusive topic relationship weight:
 * - Exact active topic match -> 30
 * - Direct active parent/child topic match -> 15
 * - Otherwise -> 0
 */
export function computeTopicRelationshipWeight(
  source: ScoringResourceContext,
  candidate: ScoringResourceContext,
): 0 | 15 | 30 {
  if (
    !source.topicId ||
    !source.topicActive ||
    !candidate.topicId ||
    !candidate.topicActive
  ) {
    return 0;
  }

  if (candidate.topicId === source.topicId) {
    return SCORING_CONSTANTS.TOPIC_EXACT_POINTS;
  }

  const candidateIsParentOfSource =
    Boolean(source.topicParentId) &&
    source.topicParentActive &&
    candidate.topicId === source.topicParentId;

  const candidateIsChildOfSource =
    Boolean(candidate.topicParentId) &&
    candidate.topicParentActive &&
    candidate.topicParentId === source.topicId;

  if (candidateIsParentOfSource || candidateIsChildOfSource) {
    return SCORING_CONSTANTS.TOPIC_PARENT_CHILD_POINTS;
  }

  return 0;
}

export function computeMetadataSubScore(
  source: ScoringResourceContext,
  candidate: ScoringResourceContext,
): {
  topicWeight: 0 | 15 | 30;
  subjectWeight: 0 | 15;
  gradeWeight: 0 | 10;
  pillarWeight: 0 | 5;
  metadataScore: number;
} {
  const topicWeight = computeTopicRelationshipWeight(source, candidate);
  const subjectWeight: 0 | 15 =
    source.subjectId && candidate.subjectId && source.subjectId === candidate.subjectId
      ? SCORING_CONSTANTS.SUBJECT_EXACT_POINTS
      : 0;
  const gradeWeight: 0 | 10 =
    source.gradeId && candidate.gradeId && source.gradeId === candidate.gradeId
      ? SCORING_CONSTANTS.GRADE_EXACT_POINTS
      : 0;
  const pillarWeight: 0 | 5 = areComplementaryPillars(source.pillar, candidate.pillar)
    ? SCORING_CONSTANTS.COMPLEMENTARY_PILLAR_POINTS
    : 0;

  const metadataScore = Math.min(
    SCORING_CONSTANTS.METADATA_CAP,
    topicWeight + subjectWeight + gradeWeight + pillarWeight,
  );

  return {
    topicWeight,
    subjectWeight,
    gradeWeight,
    pillarWeight,
    metadataScore,
  };
}

/**
 * Freshness score using elapsed 24-hour periods relative to UTC evalNow:
 * elapsed_24h_periods = floor(max(0, (evalNow - publishedAt) / 1000) / 86400)
 */
export function computeFreshnessScore(publishedAt: Date, evalNow: Date): 0 | 3 | 6 | 10 {
  const elapsedMs = Math.max(0, evalNow.getTime() - publishedAt.getTime());
  const elapsedSeconds = elapsedMs / 1000;
  const elapsed24hPeriods = Math.floor(elapsedSeconds / 86400);

  if (elapsed24hPeriods <= 30) {
    return SCORING_CONSTANTS.FRESHNESS_0_TO_30_POINTS;
  }
  if (elapsed24hPeriods <= 90) {
    return SCORING_CONSTANTS.FRESHNESS_31_TO_90_POINTS;
  }
  if (elapsed24hPeriods <= 180) {
    return SCORING_CONSTANTS.FRESHNESS_91_TO_180_POINTS;
  }
  return SCORING_CONSTANTS.FRESHNESS_181_PLUS_POINTS;
}

/**
 * Behavioural co-occurrence score with combined 3-identity privacy suppression threshold:
 * - N_co < 3 -> 0
 * - N_co >= 3 -> min(25, floor(5 * ln(N_co)))
 */
export function computeBehaviouralScore(distinctCoIdentityCount: number): number {
  if (
    !Number.isFinite(distinctCoIdentityCount) ||
    distinctCoIdentityCount < SCORING_CONSTANTS.BEHAVIOURAL_MIN_IDENTITIES
  ) {
    return 0;
  }
  const scaled = Math.floor(
    SCORING_CONSTANTS.BEHAVIOURAL_LOG_MULTIPLIER * Math.log(distinctCoIdentityCount),
  );
  return Math.min(SCORING_CONSTANTS.BEHAVIOURAL_CAP, Math.max(0, scaled));
}

export function scoreCandidateAgainstSource(
  source: ScoringResourceContext,
  candidate: ScoringCandidateInput,
  evalNow: Date,
): ScoreBreakdown {
  const meta = computeMetadataSubScore(source, candidate);
  const quality = resolveCanonicalQuality({
    resourceQualityLabel: candidate.resourceQualityLabel,
    versionQualityLabel: candidate.versionQualityLabel,
    hasActiveVersionVerification: candidate.hasActiveVersionVerification,
  });
  const freshnessScore = computeFreshnessScore(candidate.publishedAt, evalNow);
  const behaviouralScore = computeBehaviouralScore(candidate.distinctCoIdentityCount);
  const algorithmicScore =
    meta.metadataScore + quality.qualityScore + freshnessScore + behaviouralScore;

  return {
    topicWeight: meta.topicWeight,
    subjectWeight: meta.subjectWeight,
    gradeWeight: meta.gradeWeight,
    pillarWeight: meta.pillarWeight,
    metadataScore: meta.metadataScore,
    qualityScore: quality.qualityScore,
    freshnessScore,
    behaviouralScore,
    algorithmicScore,
    effectiveQuality: quality.effectiveTier,
  };
}

export function compareUuidAsc(a: string, b: string): number {
  const normA = a.toLowerCase();
  const normB = b.toLowerCase();
  if (normA < normB) return -1;
  if (normA > normB) return 1;
  return 0;
}

function compareAlgorithmicTieBreak(a: RankedCandidateResult, b: RankedCandidateResult): number {
  if (b.algorithmicScore !== a.algorithmicScore) {
    return b.algorithmicScore - a.algorithmicScore;
  }
  if (b.qualityScore !== a.qualityScore) {
    return b.qualityScore - a.qualityScore;
  }
  const pubDiff = b.publishedAt.getTime() - a.publishedAt.getTime();
  if (pubDiff !== 0) {
    return pubDiff;
  }
  return compareUuidAsc(a.resourceId, b.resourceId);
}

function resolveCandidateRuleEffect(
  source: ScoringResourceContext,
  candidateId: string,
  rules: ActiveEditorialRuleInput[],
): {
  excluded: boolean;
  isPinned: boolean;
  ruleScopeRank: 1 | 2 | null;
  priority: number | null;
} {
  let excluded = false;
  let resourcePinPriority: number | null = null;
  let topicPinPriority: number | null = null;

  for (const rule of rules) {
    if (rule.targetResourceId !== candidateId) continue;

    const matchesSourceResource =
      Boolean(rule.sourceResourceId) && rule.sourceResourceId === source.resourceId;
    const matchesSourceTopic =
      Boolean(rule.sourceTopicId) &&
      Boolean(source.topicId) &&
      source.topicActive &&
      rule.sourceTopicId === source.topicId;

    if (!matchesSourceResource && !matchesSourceTopic) {
      continue;
    }

    if (rule.ruleType === 'EXCLUDE') {
      excluded = true;
      break;
    }

    if (rule.ruleType === 'PIN' && rule.priority !== null) {
      if (matchesSourceResource) {
        if (resourcePinPriority === null || rule.priority < resourcePinPriority) {
          resourcePinPriority = rule.priority;
        }
      } else if (matchesSourceTopic) {
        if (topicPinPriority === null || rule.priority < topicPinPriority) {
          topicPinPriority = rule.priority;
        }
      }
    }
  }

  if (excluded) {
    return { excluded: true, isPinned: false, ruleScopeRank: null, priority: null };
  }

  if (resourcePinPriority !== null) {
    return {
      excluded: false,
      isPinned: true,
      ruleScopeRank: 1,
      priority: resourcePinPriority,
    };
  }

  if (topicPinPriority !== null) {
    return {
      excluded: false,
      isPinned: true,
      ruleScopeRank: 2,
      priority: topicPinPriority,
    };
  }

  return { excluded: false, isPinned: false, ruleScopeRank: null, priority: null };
}

/**
 * Ranks candidates for resource-detail surfaces (`related-resources`, `you-may-also-need`, `teachers-also-viewed`).
 */
export function rankCandidatesForSurface(params: {
  surface: ResourceDetailSurface;
  source: ScoringResourceContext;
  candidates: ScoringCandidateInput[];
  rules: ActiveEditorialRuleInput[];
  evalNow: Date;
  limit?: number | null;
}): RankedCandidateResult[] {
  const effectiveLimit = clampRecommendationLimit(params.surface, params.limit);
  const pinnedGroup: RankedCandidateResult[] = [];
  const algorithmicGroup: RankedCandidateResult[] = [];

  for (const candidate of params.candidates) {
    if (candidate.resourceId === params.source.resourceId) {
      continue;
    }

    const ruleEffect = resolveCandidateRuleEffect(
      params.source,
      candidate.resourceId,
      params.rules,
    );
    if (ruleEffect.excluded) {
      continue;
    }

    const breakdown = scoreCandidateAgainstSource(params.source, candidate, params.evalNow);

    if (params.surface === 'you-may-also-need') {
      if (candidate.pillar === params.source.pillar || breakdown.metadataScore <= 0) {
        continue;
      }
      algorithmicGroup.push({
        resourceId: candidate.resourceId,
        isPinned: false,
        ruleScopeRank: null,
        priority: null,
        algorithmicScore: breakdown.algorithmicScore,
        qualityScore: breakdown.qualityScore,
        behaviouralScore: breakdown.behaviouralScore,
        metadataScore: breakdown.metadataScore,
        freshnessScore: breakdown.freshnessScore,
        publishedAt: candidate.publishedAt,
      });
      continue;
    }

    if (params.surface === 'teachers-also-viewed') {
      if (candidate.distinctCoIdentityCount < SCORING_CONSTANTS.BEHAVIOURAL_MIN_IDENTITIES) {
        continue;
      }
      algorithmicGroup.push({
        resourceId: candidate.resourceId,
        isPinned: false,
        ruleScopeRank: null,
        priority: null,
        algorithmicScore: breakdown.algorithmicScore,
        qualityScore: breakdown.qualityScore,
        behaviouralScore: breakdown.behaviouralScore,
        metadataScore: breakdown.metadataScore,
        freshnessScore: breakdown.freshnessScore,
        publishedAt: candidate.publishedAt,
      });
      continue;
    }

    // Surface: related-resources (two-tier Group 1 PIN + Group 2 Algorithmic)
    const entry: RankedCandidateResult = {
      resourceId: candidate.resourceId,
      isPinned: ruleEffect.isPinned,
      ruleScopeRank: ruleEffect.ruleScopeRank,
      priority: ruleEffect.priority,
      algorithmicScore: breakdown.algorithmicScore,
      qualityScore: breakdown.qualityScore,
      behaviouralScore: breakdown.behaviouralScore,
      metadataScore: breakdown.metadataScore,
      freshnessScore: breakdown.freshnessScore,
      publishedAt: candidate.publishedAt,
    };

    if (entry.isPinned) {
      pinnedGroup.push(entry);
    } else {
      algorithmicGroup.push(entry);
    }
  }

  if (params.surface === 'teachers-also-viewed') {
    algorithmicGroup.sort((a, b) => {
      if (b.behaviouralScore !== a.behaviouralScore) {
        return b.behaviouralScore - a.behaviouralScore;
      }
      return compareAlgorithmicTieBreak(a, b);
    });
    return algorithmicGroup.slice(0, effectiveLimit);
  }

  if (params.surface === 'you-may-also-need') {
    algorithmicGroup.sort(compareAlgorithmicTieBreak);
    return algorithmicGroup.slice(0, effectiveLimit);
  }

  pinnedGroup.sort((a, b) => {
    const scopeDiff = (a.ruleScopeRank ?? 99) - (b.ruleScopeRank ?? 99);
    if (scopeDiff !== 0) return scopeDiff;
    const prioDiff = (a.priority ?? 99) - (b.priority ?? 99);
    if (prioDiff !== 0) return prioDiff;
    return compareAlgorithmicTieBreak(a, b);
  });

  algorithmicGroup.sort(compareAlgorithmicTieBreak);

  const takenPins = pinnedGroup.slice(0, effectiveLimit);
  if (takenPins.length >= effectiveLimit) {
    return takenPins;
  }

  const remainingSlots = effectiveLimit - takenPins.length;
  return [...takenPins, ...algorithmicGroup.slice(0, remainingSlots)];
}

/**
 * Ranks contextual multi-seed `continue-exploring` candidates:
 * S_explore(R_cand) = max_{seed in seeds} S_algo(R_cand | seed)
 */
export function rankContinueExploringContextual(params: {
  seeds: ScoringResourceContext[];
  candidates: Array<
    Omit<ScoringCandidateInput, 'distinctCoIdentityCount'> & {
      coOccurrenceBySeedId?: ReadonlyMap<string, number>;
    }
  >;
  rules: ActiveEditorialRuleInput[];
  evalNow: Date;
  limit?: number | null;
}): RankedCandidateResult[] {
  const effectiveLimit = clampRecommendationLimit('continue-exploring', params.limit);
  const seedIds = new Set(params.seeds.map((s) => s.resourceId));
  const ranked: RankedCandidateResult[] = [];

  for (const candidate of params.candidates) {
    if (seedIds.has(candidate.resourceId)) {
      continue;
    }

    let excludedByAnySeed = false;
    let bestScore = -1;
    let bestBreakdown: ScoreBreakdown | null = null;

    for (const seed of params.seeds) {
      const ruleEffect = resolveCandidateRuleEffect(seed, candidate.resourceId, params.rules);
      if (ruleEffect.excluded) {
        excludedByAnySeed = true;
        break;
      }

      const nCo = candidate.coOccurrenceBySeedId?.get(seed.resourceId) ?? 0;
      const breakdown = scoreCandidateAgainstSource(
        seed,
        { ...candidate, distinctCoIdentityCount: nCo },
        params.evalNow,
      );

      if (breakdown.algorithmicScore > bestScore) {
        bestScore = breakdown.algorithmicScore;
        bestBreakdown = breakdown;
      }
    }

    if (excludedByAnySeed || !bestBreakdown) {
      continue;
    }

    ranked.push({
      resourceId: candidate.resourceId,
      isPinned: false,
      ruleScopeRank: null,
      priority: null,
      algorithmicScore: bestBreakdown.algorithmicScore,
      qualityScore: bestBreakdown.qualityScore,
      behaviouralScore: bestBreakdown.behaviouralScore,
      metadataScore: bestBreakdown.metadataScore,
      freshnessScore: bestBreakdown.freshnessScore,
      publishedAt: candidate.publishedAt,
    });
  }

  ranked.sort(compareAlgorithmicTieBreak);
  return ranked.slice(0, effectiveLimit);
}

/**
 * Ranks cold-start `continue-exploring` candidates by S_cold = S_qual + S_fresh (0..25).
 */
export function rankContinueExploringColdStart(params: {
  candidates: Array<{
    resourceId: string;
    resourceQualityLabel: QualityLabel | string | null | undefined;
    versionQualityLabel: QualityLabel | string | null | undefined;
    hasActiveVersionVerification: boolean;
    publishedAt: Date;
  }>;
  evalNow: Date;
  limit?: number | null;
}): RankedCandidateResult[] {
  const effectiveLimit = clampRecommendationLimit('continue-exploring', params.limit);
  const ranked: RankedCandidateResult[] = params.candidates.map((candidate) => {
    const quality = resolveCanonicalQuality({
      resourceQualityLabel: candidate.resourceQualityLabel,
      versionQualityLabel: candidate.versionQualityLabel,
      hasActiveVersionVerification: candidate.hasActiveVersionVerification,
    });
    const freshnessScore = computeFreshnessScore(candidate.publishedAt, params.evalNow);
    const coldScore = quality.qualityScore + freshnessScore;

    return {
      resourceId: candidate.resourceId,
      isPinned: false,
      ruleScopeRank: null,
      priority: null,
      algorithmicScore: coldScore,
      qualityScore: quality.qualityScore,
      behaviouralScore: 0,
      metadataScore: 0,
      freshnessScore,
      publishedAt: candidate.publishedAt,
    };
  });

  ranked.sort(compareAlgorithmicTieBreak);
  return ranked.slice(0, effectiveLimit);
}

/**
 * NIST / ISO Nearest-Rank percentile calculation:
 * rankIndex = ceil((percentile / 100) * N) - 1
 */
export function computeNearestRankPercentile(samples: number[], percentile: number = 95): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rankIndex = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[rankIndex];
}
