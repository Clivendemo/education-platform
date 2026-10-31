import { describe, it, expect } from 'vitest';
import { CANONICAL_HOMEPAGE_SLOTS } from '../../src/db/schema/homepage.js';
import {
  HOMEPAGE_SLOT_CANDIDATE_CAP,
  HomepageCacheService,
  type HomepageSlotSkeleton,
} from '../../src/services/homepage-cache.js';

function makeSlots(
  countPerSlot: number,
  hasMore: boolean = false,
): HomepageSlotSkeleton[] {
  return CANONICAL_HOMEPAGE_SLOTS.map((spec) => {
    const ids = Array.from(
      { length: countPerSlot },
      (_, i) =>
        `00000000-0000-4000-800${spec.slotOrder}-${String(i + 1).padStart(12, '0')}`,
    );
    return {
      slotKey: spec.slotKey,
      slotOrder: spec.slotOrder,
      entityType: spec.entityType,
      mode: 'AUTOMATED',
      title: spec.defaultTitle,
      subtitle: spec.defaultSubtitle,
      maxItems: 6,
      candidateIds: ids,
      pinnedItems: [],
      survivorsCountAtBuild: Math.min(countPerSlot, HOMEPAGE_SLOT_CANDIDATE_CAP),
      hasMoreBeyondCap: hasMore,
    };
  });
}

describe('HomepageCacheService (Candidate Caps, 32-Country LRU & R17-03 Underfill Recovery)', () => {
  it('bounds slot candidates to <= 10 IDs and sets hasMoreBeyondCap accurately', () => {
    const raw12 = Array.from(
      { length: 12 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    const bounded = HomepageCacheService.boundSlotCandidates(raw12);
    expect(bounded.candidateIds).toHaveLength(10);
    expect(bounded.survivorsCountAtBuild).toBe(10);
    expect(bounded.hasMoreBeyondCap).toBe(true);

    const raw4 = raw12.slice(0, 4);
    const sparse = HomepageCacheService.boundSlotCandidates(raw4);
    expect(sparse.candidateIds).toHaveLength(4);
    expect(sparse.survivorsCountAtBuild).toBe(4);
    expect(sparse.hasMoreBeyondCap).toBe(false);
  });

  it('enforces 32-country LRU eviction and 60s / scheduledUntilAtMs TTL expiry', () => {
    let clockMs = 1_000_000;
    const cache = new HomepageCacheService({
      maxCountries: 32,
      ttlMs: 60_000,
      now: () => clockMs,
    });

    for (let i = 1; i <= 33; i++) {
      const cid = `country-${i}`;
      cache.set(cid, {
        countryId: cid,
        source: 'DEFAULT_FALLBACK',
        configurationId: null,
        versionNumber: null,
        scheduledUntilAtMs: null,
        slots: makeSlots(6),
      });
      if (i === 16) {
        // Touch country-1 so country-2 becomes LRU victim when 33rd is inserted
        expect(cache.get('country-1')).not.toBeNull();
      }
    }

    expect(cache.size()).toBe(32);
    expect(cache.get('country-1')).not.toBeNull();
    expect(cache.get('country-2')).toBeNull();

    // Clamp expiry to scheduledUntilAtMs when earlier than 60s TTL
    cache.set('country-sched', {
      countryId: 'country-sched',
      source: 'PUBLISHED_CONFIGURATION',
      configurationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      versionNumber: 1,
      scheduledUntilAtMs: clockMs + 5_000,
      slots: makeSlots(4),
    });
    expect(cache.get('country-sched')).not.toBeNull();
    clockMs += 5_000;
    expect(cache.get('country-sched')).toBeNull();
  });

  it('coalesces concurrent getOrBuild calls for the same country into a single build execution', async () => {
    const cache = new HomepageCacheService();
    let buildInvocations = 0;

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        cache.getOrBuild('country-ke', async () => {
          buildInvocations += 1;
          await new Promise((r) => setTimeout(r, 15));
          return {
            countryId: 'country-ke',
            source: 'DEFAULT_FALLBACK',
            configurationId: null,
            versionNumber: null,
            scheduledUntilAtMs: null,
            slots: makeSlots(6),
          };
        }),
      ),
    );

    expect(buildInvocations).toBe(1);
    expect(results.every((r) => r.skeleton.countryId === 'country-ke')).toBe(true);
  });

  it('R17-03: never triggers rebuild on sparse countries (0 rebuilds across repeated reads), triggers immediately when hasMoreBeyondCap=true, and enforces 5,000ms exhausted-pool cooldown', async () => {
    let clockMs = 2_000_000;
    const cache = new HomepageCacheService({
      exhaustedRebuildCooldownMs: 5_000,
      now: () => clockMs,
    });

    // 1. Sparse country with only 3 items per slot and hasMoreBeyondCap = false -> 0 rebuilds
    const sparseSkeleton = cache.set('sparse-country', {
      countryId: 'sparse-country',
      source: 'DEFAULT_FALLBACK',
      configurationId: null,
      versionNumber: null,
      scheduledUntilAtMs: null,
      slots: makeSlots(3, false),
    });
    const sparseLiveCounts = new Map(
      CANONICAL_HOMEPAGE_SLOTS.map((s) => [s.slotKey, 3] as const),
    );

    for (let i = 0; i < 10; i++) {
      expect(
        cache.shouldTriggerUnderfillRebuild(
          'sparse-country',
          sparseLiveCounts,
          sparseSkeleton,
        ),
      ).toBe(false);
      clockMs += 1_000;
    }

    // 2. Rich country where 5 of 10 cached candidates died (liveCount = 5 < maxItems = 6) and hasMoreBeyondCap = true -> immediate rebuild
    const richSkeleton = cache.set('rich-country', {
      countryId: 'rich-country',
      source: 'DEFAULT_FALLBACK',
      configurationId: null,
      versionNumber: null,
      scheduledUntilAtMs: null,
      slots: makeSlots(10, true),
    });
    const underfilledCounts = new Map(
      CANONICAL_HOMEPAGE_SLOTS.map((s) => [s.slotKey, 5] as const),
    );
    expect(
      cache.shouldTriggerUnderfillRebuild(
        'rich-country',
        underfilledCounts,
        richSkeleton,
      ),
    ).toBe(true);

    // 3. Exhausted pool: 4 survivors at build, 1 dies (liveCount = 3 < 4), rebuild still finds <= 10 (hasMoreBeyondCap = false) -> 5,000ms cooldown blocks rapid thrashing
    const smallSkeleton = cache.set('small-country', {
      countryId: 'small-country',
      source: 'DEFAULT_FALLBACK',
      configurationId: null,
      versionNumber: null,
      scheduledUntilAtMs: null,
      slots: makeSlots(4, false),
    });
    const degradedCounts = new Map(
      CANONICAL_HOMEPAGE_SLOTS.map((s) => [s.slotKey, 3] as const),
    );
    expect(
      cache.shouldTriggerUnderfillRebuild(
        'small-country',
        degradedCounts,
        smallSkeleton,
      ),
    ).toBe(true);

    const rebuiltSkeleton = await cache.forceCoalescedRebuild(
      'small-country',
      async () => ({
        countryId: 'small-country',
        source: 'DEFAULT_FALLBACK',
        configurationId: null,
        versionNumber: null,
        scheduledUntilAtMs: null,
        slots: makeSlots(4, false),
      }),
    );

    // Even if another cached survivor dies 1,000ms later, cooldown prevents rebuild thrashing
    clockMs += 1_000;
    expect(
      cache.shouldTriggerUnderfillRebuild(
        'small-country',
        new Map(CANONICAL_HOMEPAGE_SLOTS.map((s) => [s.slotKey, 2] as const)),
        rebuiltSkeleton,
      ),
    ).toBe(false);

    // After 5,000ms cooldown elapses, rebuild is permitted again
    clockMs += 4_500;
    expect(
      cache.shouldTriggerUnderfillRebuild(
        'small-country',
        new Map(CANONICAL_HOMEPAGE_SLOTS.map((s) => [s.slotKey, 2] as const)),
        rebuiltSkeleton,
      ),
    ).toBe(true);
  });
});
