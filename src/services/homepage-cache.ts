import type {
  HomepageEntityType,
  HomepageSlotKey,
  HomepageSlotMode,
} from '../db/schema/homepage.js';

export const HOMEPAGE_SKELETON_MAX_COUNTRIES = 32;
export const HOMEPAGE_SKELETON_TTL_MS = 60_000;
export const HOMEPAGE_SLOT_CANDIDATE_CAP = 10;
export const HOMEPAGE_SLOT_CANDIDATE_FETCH_LIMIT = 11;
export const HOMEPAGE_COUNTRY_CANDIDATE_CAP = 60;
export const HOMEPAGE_EXHAUSTED_REBUILD_COOLDOWN_MS = 5_000;

export interface CachedPinnedCandidateMeta {
  entityId: string;
  startsAtMs: number | null;
  endsAtMs: number | null;
  position: number;
  isAutomatedCandidate?: boolean;
}

export interface HomepageSlotSkeleton {
  slotKey: HomepageSlotKey;
  slotOrder: 1 | 2 | 3 | 4 | 5 | 6;
  entityType: HomepageEntityType;
  mode: HomepageSlotMode;
  title: string;
  subtitle: string | null;
  maxItems: number;
  /** Strictly bounded to <= 10 candidate entity UUIDs per slot. */
  candidateIds: readonly string[];
  pinnedItems: readonly CachedPinnedCandidateMeta[];
  survivorsCountAtBuild: number;
  hasMoreBeyondCap: boolean;
}

export interface HomepageCountrySkeleton {
  countryId: string;
  source: 'PUBLISHED_CONFIGURATION' | 'DEFAULT_FALLBACK';
  configurationId: string | null;
  versionNumber: number | null;
  scheduledUntilAtMs: number | null;
  builtAtMs: number;
  expiresAtMs: number;
  slots: readonly HomepageSlotSkeleton[];
}

export interface HomepageCacheOptions {
  maxCountries?: number;
  ttlMs?: number;
  exhaustedRebuildCooldownMs?: number;
  now?: () => number;
}

export interface GetOrBuildSkeletonResult {
  skeleton: HomepageCountrySkeleton;
  cacheHit: boolean;
}

/**
 * Enforces strict candidate-skeleton invariants:
 * - Only candidate IDs + structural metadata (zero hydrated DTOs / user personalization)
 * - <= 10 candidate IDs per slot, <= 60 candidate IDs per country
 * - Max 32 countries with LRU eviction, 60s TTL
 * - Single-flight coalescing per countryId + 5,000ms exhausted-pool rebuild cooldown (R17-03)
 */
export class HomepageCacheService {
  private readonly maxCountries: number;
  private readonly ttlMs: number;
  private readonly exhaustedRebuildCooldownMs: number;
  private readonly now: () => number;

  private readonly entries = new Map<string, HomepageCountrySkeleton>();
  private readonly inflightBuilds = new Map<string, Promise<HomepageCountrySkeleton>>();
  private readonly lastExhaustedRebuildAtMs = new Map<string, number>();

  constructor(options: HomepageCacheOptions = {}) {
    this.maxCountries = options.maxCountries ?? HOMEPAGE_SKELETON_MAX_COUNTRIES;
    this.ttlMs = options.ttlMs ?? HOMEPAGE_SKELETON_TTL_MS;
    this.exhaustedRebuildCooldownMs =
      options.exhaustedRebuildCooldownMs ?? HOMEPAGE_EXHAUSTED_REBUILD_COOLDOWN_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Normalizes a fetched candidate list (fetched with LIMIT 11) into bounded
   * <= 10 candidateIds + accurate hasMoreBeyondCap and survivorsCountAtBuild metadata.
   */
  static boundSlotCandidates(rawOrderedIds: readonly string[]): {
    candidateIds: readonly string[];
    survivorsCountAtBuild: number;
    hasMoreBeyondCap: boolean;
  } {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const id of rawOrderedIds) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }
    const hasMoreBeyondCap = deduped.length > HOMEPAGE_SLOT_CANDIDATE_CAP;
    const bounded = Object.freeze(deduped.slice(0, HOMEPAGE_SLOT_CANDIDATE_CAP));
    return {
      candidateIds: bounded,
      survivorsCountAtBuild: bounded.length,
      hasMoreBeyondCap,
    };
  }

  get(countryId: string): HomepageCountrySkeleton | null {
    const existing = this.entries.get(countryId);
    if (!existing) {
      return null;
    }

    const currentMs = this.now();
    if (
      currentMs >= existing.expiresAtMs ||
      (existing.scheduledUntilAtMs !== null && currentMs >= existing.scheduledUntilAtMs)
    ) {
      this.entries.delete(countryId);
      return null;
    }

    // Refresh LRU order
    this.entries.delete(countryId);
    this.entries.set(countryId, existing);
    return existing;
  }

  set(
    countryId: string,
    skeletonInput: Omit<HomepageCountrySkeleton, 'builtAtMs' | 'expiresAtMs'>,
  ): HomepageCountrySkeleton {
    const currentMs = this.now();
    let totalCandidateCount = 0;

    const normalizedSlots: HomepageSlotSkeleton[] = skeletonInput.slots.map((slot) => {
      const boundedIds = Object.freeze(
        slot.candidateIds.slice(0, HOMEPAGE_SLOT_CANDIDATE_CAP),
      );
      totalCandidateCount += boundedIds.length;
      return Object.freeze({
        ...slot,
        candidateIds: boundedIds,
        pinnedItems: Object.freeze([...slot.pinnedItems]),
        survivorsCountAtBuild: Math.min(slot.survivorsCountAtBuild, boundedIds.length),
        hasMoreBeyondCap:
          slot.hasMoreBeyondCap || slot.candidateIds.length > HOMEPAGE_SLOT_CANDIDATE_CAP,
      });
    });

    if (totalCandidateCount > HOMEPAGE_COUNTRY_CANDIDATE_CAP) {
      throw new Error(
        `Homepage skeleton exceeded maximum country candidate cap (${totalCandidateCount} > ${HOMEPAGE_COUNTRY_CANDIDATE_CAP}).`,
      );
    }

    const effectiveExpiry =
      skeletonInput.scheduledUntilAtMs !== null
        ? Math.min(currentMs + this.ttlMs, skeletonInput.scheduledUntilAtMs)
        : currentMs + this.ttlMs;

    const stored: HomepageCountrySkeleton = Object.freeze({
      ...skeletonInput,
      builtAtMs: currentMs,
      expiresAtMs: effectiveExpiry,
      slots: Object.freeze(normalizedSlots),
    });

    if (this.entries.has(countryId)) {
      this.entries.delete(countryId);
    } else if (this.entries.size >= this.maxCountries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
        this.lastExhaustedRebuildAtMs.delete(oldestKey);
      }
    }

    this.entries.set(countryId, stored);
    return stored;
  }

  async getOrBuild(
    countryId: string,
    builder: () => Promise<Omit<HomepageCountrySkeleton, 'builtAtMs' | 'expiresAtMs'>>,
  ): Promise<GetOrBuildSkeletonResult> {
    const cached = this.get(countryId);
    if (cached) {
      return { skeleton: cached, cacheHit: true };
    }

    const skeleton = await this.coalescedBuild(countryId, builder);
    return { skeleton, cacheHit: false };
  }

  /**
   * Determines whether a cached skeleton requires a single-shot underfill rebuild (R17-03):
   * - Never triggers on MANUAL_OVERRIDE slots (no automated backfill pool exists).
   * - Never triggers on sparse countries where liveCount === survivorsCountAtBuild && !hasMoreBeyondCap (0 rebuilds).
   * - Triggers immediately when liveCount < maxItems AND hasMoreBeyondCap === true.
   * - Triggers when liveCount < maxItems AND liveCount < survivorsCountAtBuild (cached candidate died)
   *   subject to 5,000ms per-country cooldown when hasMoreBeyondCap === false.
   */
  shouldTriggerUnderfillRebuild(
    countryId: string,
    slotLiveCounts: ReadonlyMap<HomepageSlotKey, number>,
    skeleton: HomepageCountrySkeleton,
  ): boolean {
    const currentMs = this.now();
    let needsImmediateRebuild = false;
    let needsCooldownGatedRebuild = false;

    for (const slot of skeleton.slots) {
      if (slot.mode === 'MANUAL_OVERRIDE') {
        continue;
      }

      const liveCount = slotLiveCounts.get(slot.slotKey) ?? 0;
      if (liveCount >= slot.maxItems) {
        continue;
      }

      if (slot.hasMoreBeyondCap) {
        needsImmediateRebuild = true;
        break;
      }

      // Sparse-country non-thrash rule: if all build-time survivors are still alive
      // and there were no candidates beyond the 10-ID cap, do NOT rebuild.
      if (liveCount < slot.survivorsCountAtBuild) {
        needsCooldownGatedRebuild = true;
      }
    }

    if (needsImmediateRebuild) {
      return true;
    }

    if (!needsCooldownGatedRebuild) {
      return false;
    }

    const lastExhaustedAt = this.lastExhaustedRebuildAtMs.get(countryId);
    if (
      lastExhaustedAt !== undefined &&
      currentMs - lastExhaustedAt < this.exhaustedRebuildCooldownMs
    ) {
      return false;
    }

    return true;
  }

  async forceCoalescedRebuild(
    countryId: string,
    builder: () => Promise<Omit<HomepageCountrySkeleton, 'builtAtMs' | 'expiresAtMs'>>,
  ): Promise<HomepageCountrySkeleton> {
    const rebuilt = await this.coalescedBuild(countryId, builder);
    const anyHasMore = rebuilt.slots.some(
      (s) => s.mode !== 'MANUAL_OVERRIDE' && s.hasMoreBeyondCap,
    );
    if (!anyHasMore) {
      this.lastExhaustedRebuildAtMs.set(countryId, this.now());
    } else {
      this.lastExhaustedRebuildAtMs.delete(countryId);
    }
    return rebuilt;
  }

  private async coalescedBuild(
    countryId: string,
    builder: () => Promise<Omit<HomepageCountrySkeleton, 'builtAtMs' | 'expiresAtMs'>>,
  ): Promise<HomepageCountrySkeleton> {
    const inflight = this.inflightBuilds.get(countryId);
    if (inflight) {
      return inflight;
    }

    const promise = (async () => {
      try {
        const built = await builder();
        return this.set(countryId, built);
      } finally {
        this.inflightBuilds.delete(countryId);
      }
    })();

    this.inflightBuilds.set(countryId, promise);
    return promise;
  }

  invalidateCountry(countryId: string): void {
    this.entries.delete(countryId);
    this.lastExhaustedRebuildAtMs.delete(countryId);
  }

  clearAll(): void {
    this.entries.clear();
    this.lastExhaustedRebuildAtMs.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

export const defaultHomepageCacheService = new HomepageCacheService();
