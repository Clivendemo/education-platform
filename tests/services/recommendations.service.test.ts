import { describe, it, expect } from 'vitest';
import {
  areComplementaryPillars,
  clampRecommendationLimit,
  computeBehaviouralScore,
  computeFreshnessScore,
  computeMetadataSubScore,
  computeNearestRankPercentile,
  computeTopicRelationshipWeight,
  rankCandidatesForSurface,
  rankContinueExploringColdStart,
  rankContinueExploringContextual,
  resolveCanonicalQuality,
  scoreCandidateAgainstSource,
  type ActiveEditorialRuleInput,
  type ScoringCandidateInput,
  type ScoringResourceContext,
} from '../../src/services/recommendations/recommendation-scoring.service.js';
import { RecommendationCacheService } from '../../src/services/recommendations/recommendation-cache.service.js';

describe('Prompt 30: RecommendationScoringService & Cache Unit Tests', () => {
  const EVAL_NOW = new Date('2026-10-24T12:00:00.000Z');

  const baseSource: ScoringResourceContext = {
    resourceId: '00000000-0000-4000-8000-000000000010',
    gradeId: 'grade-f3',
    subjectId: 'subj-math',
    topicId: 'topic-quad',
    topicActive: true,
    topicParentId: 'topic-alg',
    topicParentActive: true,
    pillar: 'NOTES_REVISION',
  };

  describe('Suite 1: Scoring Formula, Boundaries & Worked-Example Determinism', () => {
    it('enforces mutually exclusive topic relationship weights (30 vs 15 vs 0)', () => {
      // Exact topic match -> 30 (even if parent happens to match something else)
      expect(
        computeTopicRelationshipWeight(baseSource, {
          ...baseSource,
          resourceId: 'cand-exact',
          topicId: 'topic-quad',
          topicActive: true,
        }),
      ).toBe(30);

      // Direct parent of source -> 15
      expect(
        computeTopicRelationshipWeight(baseSource, {
          ...baseSource,
          resourceId: 'cand-parent',
          topicId: 'topic-alg',
          topicActive: true,
          topicParentId: null,
          topicParentActive: false,
        }),
      ).toBe(15);

      // Direct child of source -> 15
      expect(
        computeTopicRelationshipWeight(baseSource, {
          ...baseSource,
          resourceId: 'cand-child',
          topicId: 'topic-quad-formula',
          topicActive: true,
          topicParentId: 'topic-quad',
          topicParentActive: true,
        }),
      ).toBe(15);

      // Inactive topic -> 0
      expect(
        computeTopicRelationshipWeight(baseSource, {
          ...baseSource,
          resourceId: 'cand-inactive-topic',
          topicId: 'topic-quad',
          topicActive: false,
        }),
      ).toBe(0);

      // Unrelated topic -> 0
      expect(
        computeTopicRelationshipWeight(baseSource, {
          ...baseSource,
          resourceId: 'cand-other',
          topicId: 'topic-trig',
          topicActive: true,
          topicParentId: 'topic-geom',
          topicParentActive: true,
        }),
      ).toBe(0);
    });

    it('awards complementary pillar bonus only for the 4 verified symmetric pairs and caps S_meta at 50', () => {
      expect(areComplementaryPillars('PAST_PAPERS', 'NOTES_REVISION')).toBe(true);
      expect(areComplementaryPillars('NOTES_REVISION', 'PAST_PAPERS')).toBe(true);
      expect(areComplementaryPillars('LESSON_PLANS', 'SCHEMES_OF_WORK')).toBe(true);
      expect(areComplementaryPillars('SCHOOL_DOCUMENTS', 'TEACHER_RESOURCES')).toBe(true);
      expect(areComplementaryPillars('ACADEMIC_CALENDAR', 'EDUCATION_UPDATES')).toBe(true);
      expect(areComplementaryPillars('NOTES_REVISION', 'NOTES_REVISION')).toBe(false);
      expect(areComplementaryPillars('PAST_PAPERS', 'LESSON_PLANS')).toBe(false);

      // Raw sum = 30 (topic) + 15 (subject) + 10 (grade) + 5 (pillar) = 60 -> capped at 50
      const meta = computeMetadataSubScore(baseSource, {
        ...baseSource,
        resourceId: 'cand-max-meta',
        pillar: 'PAST_PAPERS',
      });
      expect(meta.topicWeight).toBe(30);
      expect(meta.subjectWeight).toBe(15);
      expect(meta.gradeWeight).toBe(10);
      expect(meta.pillarWeight).toBe(5);
      expect(meta.metadataScore).toBe(50);
    });

    it('computes freshness scores at exact elapsed 24-hour period boundaries', () => {
      const fromSecondsAgo = (sec: number) => new Date(EVAL_NOW.getTime() - sec * 1000);

      expect(computeFreshnessScore(fromSecondsAgo(0), EVAL_NOW)).toBe(10);
      // 30d 23h 59m 59s -> floor = 30 -> 10 points
      expect(computeFreshnessScore(fromSecondsAgo(31 * 86400 - 1), EVAL_NOW)).toBe(10);
      // Exact 31 * 86400s -> floor = 31 -> 6 points
      expect(computeFreshnessScore(fromSecondsAgo(31 * 86400), EVAL_NOW)).toBe(6);
      // 90d 23h 59m 59s -> floor = 90 -> 6 points
      expect(computeFreshnessScore(fromSecondsAgo(91 * 86400 - 1), EVAL_NOW)).toBe(6);
      // Exact 91 * 86400s -> floor = 91 -> 3 points
      expect(computeFreshnessScore(fromSecondsAgo(91 * 86400), EVAL_NOW)).toBe(3);
      // 180d 23h 59m 59s -> floor = 180 -> 3 points
      expect(computeFreshnessScore(fromSecondsAgo(181 * 86400 - 1), EVAL_NOW)).toBe(3);
      // Exact 181 * 86400s -> floor = 181 -> 0 points
      expect(computeFreshnessScore(fromSecondsAgo(181 * 86400), EVAL_NOW)).toBe(0);
    });

    it('suppresses behavioural scores below 3 distinct identities and caps logarithmic score at 25', () => {
      expect(computeBehaviouralScore(0)).toBe(0);
      expect(computeBehaviouralScore(1)).toBe(0);
      expect(computeBehaviouralScore(2)).toBe(0);
      expect(computeBehaviouralScore(3)).toBe(5);
      expect(computeBehaviouralScore(4)).toBe(6);
      expect(computeBehaviouralScore(5)).toBe(8);
      expect(computeBehaviouralScore(8)).toBe(10);
      expect(computeBehaviouralScore(10)).toBe(11);
      expect(computeBehaviouralScore(25)).toBe(16);
      expect(computeBehaviouralScore(50)).toBe(19);
      expect(computeBehaviouralScore(100)).toBe(23);
      expect(computeBehaviouralScore(149)).toBe(25);
      expect(computeBehaviouralScore(10_000)).toBe(25);
    });

    it('reproduces the exact Revision 8 4-candidate worked example (B -> A -> C, D excluded)', () => {
      const candidateA: ScoringCandidateInput = {
        resourceId: '00000000-0000-4000-8000-000000000001',
        gradeId: 'grade-f3',
        subjectId: 'subj-math',
        topicId: 'topic-quad',
        topicActive: true,
        topicParentId: 'topic-alg',
        topicParentActive: true,
        pillar: 'PAST_PAPERS',
        resourceQualityLabel: 'STANDARD',
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: true,
        publishedAt: new Date('2026-10-10T12:00:00.000Z'), // 14 elapsed 24h periods
        distinctCoIdentityCount: 8,
      };

      const candidateB: ScoringCandidateInput = {
        resourceId: '00000000-0000-4000-8000-000000000002',
        gradeId: 'grade-f3',
        subjectId: 'subj-math',
        topicId: 'topic-trig',
        topicActive: true,
        topicParentId: null,
        topicParentActive: false,
        pillar: 'NOTES_REVISION',
        resourceQualityLabel: 'VERIFIED', // stale resource label without version verification -> 0 pts
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: false,
        publishedAt: new Date('2026-04-07T12:00:00.000Z'), // 200 elapsed 24h periods
        distinctCoIdentityCount: 1,
      };

      const candidateC: ScoringCandidateInput = {
        resourceId: '00000000-0000-4000-8000-000000000003',
        gradeId: 'grade-f2',
        subjectId: 'subj-math',
        topicId: 'topic-alg',
        topicActive: true,
        topicParentId: null,
        topicParentActive: false,
        pillar: 'NOTES_REVISION',
        resourceQualityLabel: 'PREMIUM',
        versionQualityLabel: 'PREMIUM',
        hasActiveVersionVerification: false,
        publishedAt: new Date('2026-09-09T12:00:00.000Z'), // 45 elapsed 24h periods
        distinctCoIdentityCount: 4,
      };

      const candidateD: ScoringCandidateInput = {
        ...candidateA,
        resourceId: '00000000-0000-4000-8000-000000000004',
      };

      expect(scoreCandidateAgainstSource(baseSource, candidateA, EVAL_NOW).algorithmicScore).toBe(
        85,
      );
      expect(scoreCandidateAgainstSource(baseSource, candidateB, EVAL_NOW).algorithmicScore).toBe(
        25,
      );
      expect(scoreCandidateAgainstSource(baseSource, candidateC, EVAL_NOW).algorithmicScore).toBe(
        47,
      );

      const rules: ActiveEditorialRuleInput[] = [
        {
          id: 'rule-pin-b',
          ruleType: 'PIN',
          sourceResourceId: baseSource.resourceId,
          sourceTopicId: null,
          targetResourceId: candidateB.resourceId,
          priority: 1,
        },
        {
          id: 'rule-exclude-d',
          ruleType: 'EXCLUDE',
          sourceResourceId: baseSource.resourceId,
          sourceTopicId: null,
          targetResourceId: candidateD.resourceId,
          priority: null,
        },
      ];

      const ranked = rankCandidatesForSurface({
        surface: 'related-resources',
        source: baseSource,
        candidates: [candidateA, candidateB, candidateC, candidateD],
        rules,
        evalNow: EVAL_NOW,
        limit: 3,
      });

      expect(ranked.map((r) => r.resourceId)).toEqual([
        candidateB.resourceId,
        candidateA.resourceId,
        candidateC.resourceId,
      ]);
      expect(ranked[0].isPinned).toBe(true);
      expect(ranked[0].algorithmicScore).toBe(25);
      expect(ranked[1].isPinned).toBe(false);
      expect(ranked[1].algorithmicScore).toBe(85);
      expect(ranked[2].algorithmicScore).toBe(47);
    });
  });

  describe('Suite 2: Canonical Quality-Label Precedence & Disagreement', () => {
    it('treats stale resources.quality_label = VERIFIED as STANDARD (0 pts) when active version is unverified', () => {
      const q = resolveCanonicalQuality({
        resourceQualityLabel: 'VERIFIED',
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: false,
      });
      expect(q.effectiveTier).toBe('STANDARD');
      expect(q.qualityScore).toBe(0);
      expect(q.isVerified).toBe(false);
    });

    it('awards 15 pts for active governance verification while preserving isPremium indicator', () => {
      const q = resolveCanonicalQuality({
        resourceQualityLabel: 'PREMIUM',
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: true,
      });
      expect(q.effectiveTier).toBe('VERIFIED');
      expect(q.qualityScore).toBe(15);
      expect(q.isVerified).toBe(true);
      expect(q.isPremium).toBe(true);
    });

    it('awards 5 pts for PREMIUM when not verified', () => {
      const q = resolveCanonicalQuality({
        resourceQualityLabel: 'PREMIUM',
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: false,
      });
      expect(q.effectiveTier).toBe('PREMIUM');
      expect(q.qualityScore).toBe(5);
      expect(q.isVerified).toBe(false);
      expect(q.isPremium).toBe(true);
    });
  });

  describe('Suite 4 & 10: Editorial Rule Precedence, Excess Pins, Surface Filters & Clamping', () => {
    it('enforces EXCLUDE over PIN, resource PIN over topic PIN, and fills all slots when pins exceed limit', () => {
      const candidates: ScoringCandidateInput[] = Array.from({ length: 10 }, (_, idx) => ({
        resourceId: `00000000-0000-4000-8000-0000000000${String(idx + 20).padStart(2, '0')}`,
        gradeId: 'grade-f3',
        subjectId: 'subj-math',
        topicId: 'topic-quad',
        topicActive: true,
        topicParentId: null,
        topicParentActive: false,
        pillar: 'PAST_PAPERS',
        resourceQualityLabel: 'STANDARD',
        versionQualityLabel: 'STANDARD',
        hasActiveVersionVerification: idx === 9, // Algorithmic item #9 has highest algo score
        publishedAt: EVAL_NOW,
        distinctCoIdentityCount: 0,
      }));

      // Pin 8 candidates (0..7), exclude candidate 0 via topic EXCLUDE (proving EXCLUDE beats PIN),
      // give candidate 7 a resource PIN priority 5 and candidate 1 a topic PIN priority 1
      const rules: ActiveEditorialRuleInput[] = [
        {
          id: 'r-pin-0',
          ruleType: 'PIN',
          sourceResourceId: baseSource.resourceId,
          sourceTopicId: null,
          targetResourceId: candidates[0].resourceId,
          priority: 1,
        },
        {
          id: 'r-excl-0',
          ruleType: 'EXCLUDE',
          sourceResourceId: null,
          sourceTopicId: baseSource.topicId,
          targetResourceId: candidates[0].resourceId,
          priority: null,
        },
        // Candidates 1..6 get topic-level PINs (priorities 1..6)
        ...candidates.slice(1, 7).map((c, idx) => ({
          id: `r-tpin-${idx + 1}`,
          ruleType: 'PIN' as const,
          sourceResourceId: null,
          sourceTopicId: baseSource.topicId,
          targetResourceId: c.resourceId,
          priority: idx + 1,
        })),
        // Candidate 7 gets resource-level PIN priority 5 (must precede topic-level PIN priority 1!)
        {
          id: 'r-rpin-7',
          ruleType: 'PIN',
          sourceResourceId: baseSource.resourceId,
          sourceTopicId: null,
          targetResourceId: candidates[7].resourceId,
          priority: 5,
        },
      ];

      const ranked = rankCandidatesForSurface({
        surface: 'related-resources',
        source: baseSource,
        candidates,
        rules,
        evalNow: EVAL_NOW,
        limit: 6,
      });

      // Candidate 0 excluded; remaining 7 pins (7 + 1..6) compete for 6 slots -> algorithmic items 8 & 9 omitted!
      expect(ranked).toHaveLength(6);
      expect(ranked.every((r) => r.isPinned)).toBe(true);
      expect(ranked[0].resourceId).toBe(candidates[7].resourceId); // Resource PIN precedes Topic PIN
      expect(ranked[1].resourceId).toBe(candidates[1].resourceId); // Topic PIN priority 1
      expect(ranked.find((r) => r.resourceId === candidates[0].resourceId)).toBeUndefined();
      expect(ranked.find((r) => r.resourceId === candidates[9].resourceId)).toBeUndefined();
    });

    it('clamps requested limits to defaults and server-side ceiling 20', () => {
      expect(clampRecommendationLimit('related-resources', undefined)).toBe(6);
      expect(clampRecommendationLimit('you-may-also-need', undefined)).toBe(4);
      expect(clampRecommendationLimit('teachers-also-viewed', undefined)).toBe(6);
      expect(clampRecommendationLimit('continue-exploring', undefined)).toBe(8);
      expect(clampRecommendationLimit('related-resources', 999)).toBe(20);
    });

    it('computes continue-exploring contextual max-seed and cold-start rankings deterministically', () => {
      const cold = rankContinueExploringColdStart({
        candidates: [
          {
            resourceId: '00000000-0000-4000-8000-000000000092',
            resourceQualityLabel: 'STANDARD',
            versionQualityLabel: 'STANDARD',
            hasActiveVersionVerification: false,
            publishedAt: EVAL_NOW,
          },
          {
            resourceId: '00000000-0000-4000-8000-000000000091',
            resourceQualityLabel: 'STANDARD',
            versionQualityLabel: 'VERIFIED',
            hasActiveVersionVerification: true,
            publishedAt: EVAL_NOW,
          },
        ],
        evalNow: EVAL_NOW,
      });
      expect(cold[0].resourceId).toBe('00000000-0000-4000-8000-000000000091');
      expect(cold[0].algorithmicScore).toBe(25); // 15 verified + 10 fresh

      const contextual = rankContinueExploringContextual({
        seeds: [baseSource],
        candidates: [
          {
            ...baseSource,
            resourceId: '00000000-0000-4000-8000-000000000088',
            pillar: 'PAST_PAPERS',
            resourceQualityLabel: 'STANDARD',
            versionQualityLabel: 'STANDARD',
            hasActiveVersionVerification: true,
            publishedAt: EVAL_NOW,
          },
        ],
        rules: [],
        evalNow: EVAL_NOW,
      });
      expect(contextual).toHaveLength(1);
      expect(contextual[0].algorithmicScore).toBe(75); // 50 meta + 15 qual + 10 fresh
    });

    it('computes NIST nearest-rank P95 accurately', () => {
      const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
      expect(computeNearestRankPercentile(samples, 95)).toBe(95);
      expect(computeNearestRankPercentile([10, 20, 30, 40, 50], 95)).toBe(50);
    });
  });

  describe('Suite 9 (Unit): Bounded LRU Cache, Reverse Eviction Sets & 300s TTL', () => {
    it('expires entries at exact 300s TTL and evicts accurately across reverse lookup sets', () => {
      let fakeNow = 1_000_000;
      const cache = new RecommendationCacheService({
        maxEntries: 3,
        ttlMs: 300_000,
        nowFn: () => fakeNow,
      });

      cache.set(
        'rec:res:src-1:related-resources',
        [
          {
            resourceId: 'cand-1',
            isPinned: false,
            ruleScopeRank: null,
            priority: null,
            algorithmicScore: 80,
          },
        ],
        {
          countryId: 'country-ke',
          sourceResourceId: 'src-1',
          sourceTopicIds: ['topic-1', 'topic-parent-1'],
          candidateIds: ['cand-1'],
          candidateTopicIds: ['topic-2'],
        },
      );

      // Unexpired at +299,999 ms
      fakeNow = 1_299_999;
      expect(cache.get('rec:res:src-1:related-resources')).toHaveLength(1);

      // Expired at exact +300,000 ms
      fakeNow = 1_300_000;
      expect(cache.get('rec:res:src-1:related-resources')).toBeNull();

      // Re-insert and test topic parent invalidation + malformed JSON fallback
      cache.set(
        'rec:res:src-1:related-resources',
        [
          {
            resourceId: 'cand-1',
            isPinned: false,
            ruleScopeRank: null,
            priority: null,
            algorithmicScore: 80,
          },
        ],
        {
          countryId: 'country-ke',
          sourceResourceId: 'src-1',
          sourceTopicIds: ['topic-1'],
          candidateIds: ['cand-1'],
        },
      );
      cache.handleInvalidationPayload(
        JSON.stringify({
          scope: 'topic',
          op: 'UPDATE_NEW',
          country_id: 'country-ke',
          source_topic_id: 'topic-other',
          related_topic_id: 'topic-1',
        }),
      );
      expect(cache.get('rec:res:src-1:related-resources')).toBeNull();

      cache.set('rec:cold:country-ke:20', [], {
        countryId: 'country-ke',
        candidateIds: [],
      });
      cache.handleInvalidationPayload('{malformed-json');
      expect(cache.size()).toBe(0);
    });
  });
});
