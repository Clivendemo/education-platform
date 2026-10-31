import { describe, it, expect } from 'vitest';
import {
  evaluateCalendarEventSnapshot,
  evaluatePinWindow,
  evaluateResourceProjection,
  evaluateSubjectProjection,
  evaluateTopicAncestry,
  evaluateUpdateSnapshot,
  parseEvaluationTimestamp,
  type CalendarEventEligibilitySnapshot,
  type ResourceProjectionSnapshot,
  type SubjectProjectionSnapshot,
  type TopicAncestryNode,
  type UpdateEligibilitySnapshot,
} from '../../src/services/homepage-eligibility.js';

const COUNTRY_KE = '9341c237-f208-4651-875c-894beb2138ef';
const COUNTRY_UG = '11111111-1111-4111-8111-111111111111';
const EVAL_TIME = new Date('2026-10-29T12:00:00.000Z');

const CUR_ID = '22222222-2222-4222-8222-222222222222';
const CV_ID = '33333333-3333-4333-8333-333333333333';
const EL_ID = '44444444-4444-4444-8444-444444444444';
const G_ID = '55555555-5555-4555-8555-555555555555';
const P_ID = '66666666-6666-4666-8666-666666666666';
const SUB_ID = '77777777-7777-4777-8777-777777777777';
const TOP_ID = '88888888-8888-4888-8888-888888888888';

function makeValidResourceSnapshot(
  overrides: Partial<ResourceProjectionSnapshot> = {},
): ResourceProjectionSnapshot {
  return {
    targetCountryId: COUNTRY_KE,
    evalTime: EVAL_TIME,
    resExists: true,
    resCountryId: COUNTRY_KE,
    resStatus: 'PUBLISHED',
    countryStatus: 'ACTIVE',
    rtStatus: 'ACTIVE',
    schoolId: null,
    schoolCountryId: null,
    schoolStatus: null,
    pubVersionCount: 1,
    pubPublishedAt: new Date('2026-10-01T00:00:00.000Z'),
    availFileCount: 1,
    curriculumId: CUR_ID,
    curCountryId: COUNTRY_KE,
    curStatus: 'ACTIVE',
    curriculumVersionId: CV_ID,
    cvCountryId: COUNTRY_KE,
    cvCurriculumId: CUR_ID,
    cvStatus: 'CURRENT',
    educationLevelId: EL_ID,
    elCvId: CV_ID,
    elStatus: 'ACTIVE',
    gradeId: G_ID,
    gCvId: CV_ID,
    gElId: EL_ID,
    gStatus: 'ACTIVE',
    pathwayId: P_ID,
    pCvId: CV_ID,
    pElId: EL_ID,
    pGradeId: G_ID,
    pStatus: 'ACTIVE',
    subjectId: SUB_ID,
    sCvId: CV_ID,
    sElId: EL_ID,
    sGradeId: G_ID,
    sPathwayId: P_ID,
    sStatus: 'ACTIVE',
    topicId: TOP_ID,
    tCvId: CV_ID,
    tSubjectId: SUB_ID,
    topicAncestryDiag: 'ELIGIBLE',
    ...overrides,
  };
}

function makeValidSubjectSnapshot(
  overrides: Partial<SubjectProjectionSnapshot> = {},
): SubjectProjectionSnapshot {
  return {
    targetCountryId: COUNTRY_KE,
    evalTime: EVAL_TIME,
    subExists: true,
    countryStatus: 'ACTIVE',
    curId: CUR_ID,
    curCountryId: COUNTRY_KE,
    curStatus: 'ACTIVE',
    sCvId: CV_ID,
    cvCountryId: COUNTRY_KE,
    cvCurriculumId: CUR_ID,
    cvStatus: 'CURRENT',
    sElId: EL_ID,
    elCvId: CV_ID,
    elStatus: 'ACTIVE',
    sGradeId: G_ID,
    gCvId: CV_ID,
    gElId: EL_ID,
    gStatus: 'ACTIVE',
    sPathwayId: P_ID,
    pCvId: CV_ID,
    pElId: EL_ID,
    pGradeId: G_ID,
    pStatus: 'ACTIVE',
    sStatus: 'ACTIVE',
    ...overrides,
  };
}

describe('Homepage Eligibility Engine & Fail-Closed Timestamp Parser', () => {
  describe('parseEvaluationTimestamp (C61)', () => {
    it('defaults omitted (undefined) input to fallback clock', () => {
      const res = parseEvaluationTimestamp(undefined, () => EVAL_TIME);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.date.toISOString()).toBe(EVAL_TIME.toISOString());
      }
    });

    it('rejects explicit null, malformed strings, date-only strings, numbers, and invalid Dates', () => {
      for (const bad of [
        null,
        '',
        '2026-10-29',
        'not-a-timestamp',
        1792200000000,
        new Date('invalid'),
        {},
      ]) {
        const res = parseEvaluationTimestamp(bad, () => EVAL_TIME);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe('INVALID_EVALUATION_TIMESTAMP');
        }
      }
    });

    it('accepts valid ISO-8601 UTC and explicit offset timestamps', () => {
      const utc = parseEvaluationTimestamp('2026-10-29T12:00:00.000Z');
      expect(utc.ok).toBe(true);
      const offset = parseEvaluationTimestamp('2026-10-29T15:00:00+03:00');
      expect(offset.ok).toBe(true);
      if (utc.ok && offset.ok) {
        expect(utc.date.getTime()).toBe(offset.date.getTime());
      }
    });
  });

  describe('evaluateTopicAncestry (C52 / C54 depth-16 boundary & priority)', () => {
    function buildChain(length: number): {
      leafId: string;
      nodes: Map<string, TopicAncestryNode>;
      ids: string[];
    } {
      const nodes = new Map<string, TopicAncestryNode>();
      const ids: string[] = [];
      for (let i = 1; i <= length; i++) {
        ids.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      }
      // ids[0] = leaf (depth 1), ids[length - 1] = root (parentId = null)
      for (let i = 0; i < length; i++) {
        nodes.set(ids[i], {
          id: ids[i],
          parentId: i + 1 < length ? ids[i + 1] : null,
          subjectId: SUB_ID,
          curriculumVersionId: CV_ID,
          status: 'ACTIVE',
        });
      }
      return { leafId: ids[0], nodes, ids };
    }

    it('accepts depth-1, depth-15, and exact depth-16 valid topic chains', () => {
      for (const len of [1, 15, 16]) {
        const { leafId, nodes } = buildChain(len);
        expect(evaluateTopicAncestry(leafId, SUB_ID, CV_ID, nodes)).toBe('ELIGIBLE');
      }
    });

    it('rejects a 17-node valid chain with TOPIC_ANCESTRY_TOO_DEEP', () => {
      const { leafId, nodes } = buildChain(17);
      expect(evaluateTopicAncestry(leafId, SUB_ID, CV_ID, nodes)).toBe(
        'TOPIC_ANCESTRY_TOO_DEEP',
      );
    });

    it('prioritizes TOPIC_ANCESTRY_CYCLE and TOPIC_ANCESTOR_MISSING at depth 16 before TOPIC_ANCESTRY_TOO_DEEP', () => {
      // Depth-16 node pointing back to leaf -> TOPIC_ANCESTRY_CYCLE
      const cycleChain = buildChain(16);
      const rootNode = cycleChain.nodes.get(cycleChain.ids[15])!;
      cycleChain.nodes.set(rootNode.id, { ...rootNode, parentId: cycleChain.leafId });
      expect(
        evaluateTopicAncestry(cycleChain.leafId, SUB_ID, CV_ID, cycleChain.nodes),
      ).toBe('TOPIC_ANCESTRY_CYCLE');

      // Depth-16 node pointing to nonexistent 17th parent -> TOPIC_ANCESTOR_MISSING
      const missingChain = buildChain(16);
      const r2 = missingChain.nodes.get(missingChain.ids[15])!;
      missingChain.nodes.set(r2.id, {
        ...r2,
        parentId: '99999999-9999-4999-8999-999999999999',
      });
      expect(
        evaluateTopicAncestry(missingChain.leafId, SUB_ID, CV_ID, missingChain.nodes),
      ).toBe('TOPIC_ANCESTOR_MISSING');
    });

    it('distinguishes leaf vs ancestor mismatch and inactive diagnostics', () => {
      const chain = buildChain(3);
      chain.nodes.set(chain.ids[0], {
        ...chain.nodes.get(chain.ids[0])!,
        status: 'INACTIVE',
      });
      expect(evaluateTopicAncestry(chain.leafId, SUB_ID, CV_ID, chain.nodes)).toBe(
        'TOPIC_INACTIVE',
      );

      const chain2 = buildChain(3);
      chain2.nodes.set(chain2.ids[2], {
        ...chain2.nodes.get(chain2.ids[2])!,
        status: 'INACTIVE',
      });
      expect(evaluateTopicAncestry(chain2.leafId, SUB_ID, CV_ID, chain2.nodes)).toBe(
        'TOPIC_ANCESTOR_INACTIVE',
      );

      const chain3 = buildChain(3);
      chain3.nodes.set(chain3.ids[1], {
        ...chain3.nodes.get(chain3.ids[1])!,
        subjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      expect(evaluateTopicAncestry(chain3.leafId, SUB_ID, CV_ID, chain3.nodes)).toBe(
        'TOPIC_ANCESTOR_MISMATCH',
      );
    });
  });

  describe('evaluateResourceProjection & evaluateSubjectProjection (C60 / C65)', () => {
    it('approves valid resource and subject projections', () => {
      expect(evaluateResourceProjection(makeValidResourceSnapshot())).toBe('ELIGIBLE');
      expect(evaluateSubjectProjection(makeValidSubjectSnapshot())).toBe('ELIGIBLE');
    });

    it('E-39a..b / E-40a..b / E-41a..b: enforces pathway education_level/grade/cv alignment and three-valued NULL status fail-closed parity', () => {
      // E-39a: Resource pathway education_level mismatch
      expect(
        evaluateResourceProjection(
          makeValidResourceSnapshot({
            pElId: 'deadbeef-dead-4ead-8ead-deadbeefdead',
          }),
        ),
      ).toBe('PATHWAY_MISMATCH');

      // E-39b: Subject pathway education_level mismatch
      expect(
        evaluateSubjectProjection(
          makeValidSubjectSnapshot({
            pElId: 'deadbeef-dead-4ead-8ead-deadbeefdead',
          }),
        ),
      ).toBe('PATHWAY_MISMATCH');

      // E-40a / E-40b: Inactive pathway
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ pStatus: 'INACTIVE' })),
      ).toBe('PATHWAY_INACTIVE');
      expect(
        evaluateSubjectProjection(makeValidSubjectSnapshot({ pStatus: 'INACTIVE' })),
      ).toBe('PATHWAY_INACTIVE');

      // E-41a / E-41b: NULL pathway status (three-valued SQL UNKNOWN trap) -> PATHWAY_INACTIVE, never ELIGIBLE
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ pStatus: null })),
      ).toBe('PATHWAY_INACTIVE');
      expect(
        evaluateSubjectProjection(makeValidSubjectSnapshot({ pStatus: null })),
      ).toBe('PATHWAY_INACTIVE');
    });

    it('rejects resource/subject pathway asymmetry and broken version/file/taxonomy states', () => {
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ sPathwayId: null })),
      ).toBe('SUBJECT_TAXONOMY_MISMATCH');
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ pubVersionCount: 0 })),
      ).toBe('NO_PUBLISHED_VERSION');
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ pubVersionCount: 2 })),
      ).toBe('MULTIPLE_PUBLISHED_VERSIONS');
      expect(
        evaluateResourceProjection(
          makeValidResourceSnapshot({
            pubPublishedAt: new Date('2026-10-30T00:00:00.000Z'),
          }),
        ),
      ).toBe('PUBLISHED_VERSION_FUTURE_DATED');
      expect(
        evaluateResourceProjection(makeValidResourceSnapshot({ availFileCount: 0 })),
      ).toBe('NO_AVAILABLE_FILE');
      expect(
        evaluateResourceProjection(
          makeValidResourceSnapshot({ gradeId: null, pathwayId: null }),
        ),
      ).toBe('TAXONOMY_PARENT_MISSING');
      expect(
        evaluateResourceProjection(
          makeValidResourceSnapshot({
            schoolId: '99999999-9999-4999-8999-999999999999',
            schoolCountryId: COUNTRY_UG,
            schoolStatus: 'ACTIVE',
          }),
        ),
      ).toBe('SCHOOL_COUNTRY_MISMATCH');
    });
  });

  describe('evaluateUpdateSnapshot, evaluateCalendarEventSnapshot & evaluatePinWindow', () => {
    it('evaluates education update eligibility rules cleanly', () => {
      const valid: UpdateEligibilitySnapshot = {
        targetCountryId: COUNTRY_KE,
        evalTime: EVAL_TIME,
        countryExists: true,
        countryStatus: 'ACTIVE',
        updateExists: true,
        updateCountryId: COUNTRY_KE,
        categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        categoryStatus: 'ACTIVE',
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date('2026-10-20T00:00:00.000Z'),
        hasCrossCountryCurriculum: false,
        hasInactiveCurriculum: false,
      };
      expect(evaluateUpdateSnapshot(valid)).toBe('ELIGIBLE');
      expect(evaluateUpdateSnapshot({ ...valid, publishedAt: null })).toBe(
        'UPDATE_PUBLISHED_AT_MISSING',
      );
      expect(
        evaluateUpdateSnapshot({
          ...valid,
          publishedAt: new Date('2026-10-29T13:00:00.000Z'),
        }),
      ).toBe('UPDATE_FUTURE_DATED');
      expect(evaluateUpdateSnapshot({ ...valid, categoryStatus: 'INACTIVE' })).toBe(
        'UPDATE_CATEGORY_INACTIVE',
      );
      expect(
        evaluateUpdateSnapshot({ ...valid, hasCrossCountryCurriculum: true }),
      ).toBe('UPDATE_CURRICULUM_COUNTRY_MISMATCH');
    });

    it('evaluates official public calendar event rules cleanly', () => {
      const valid: CalendarEventEligibilitySnapshot = {
        targetCountryId: COUNTRY_KE,
        evalTime: EVAL_TIME,
        countryExists: true,
        countryStatus: 'ACTIVE',
        eventExists: true,
        startDate: '2026-10-29',
        endDate: '2026-11-05',
        sourceType: 'OFFICIAL',
        visibility: 'PUBLIC',
        eventStatus: 'ACTIVE',
        calendarScope: 'OFFICIAL',
        calCountryId: COUNTRY_KE,
        calSchoolId: null,
        calUserId: null,
        calSessionId: null,
        calStatus: 'ACTIVE',
        calExpiresAt: null,
        eventTypeStatus: 'ACTIVE',
      };
      expect(evaluateCalendarEventSnapshot(valid)).toBe('ELIGIBLE');
      expect(
        evaluateCalendarEventSnapshot({
          ...valid,
          calSchoolId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      ).toBe('CALENDAR_OWNER_CONTAMINATED');
      expect(
        evaluateCalendarEventSnapshot({ ...valid, sourceType: 'USER' }),
      ).toBe('CALENDAR_EVENT_SOURCE_NOT_OFFICIAL');
      expect(
        evaluateCalendarEventSnapshot({
          ...valid,
          startDate: '2026-10-01',
          endDate: '2026-10-28',
        }),
      ).toBe('CALENDAR_EVENT_PAST');
    });

    it('enforces half-open [startsAt, endsAt) pin window semantics', () => {
      const start = new Date('2026-10-29T12:00:00.000Z');
      const end = new Date('2026-10-29T18:00:00.000Z');
      expect(evaluatePinWindow(start, end, start)).toBe('ELIGIBLE');
      expect(
        evaluatePinWindow(start, end, new Date(start.getTime() - 1)),
      ).toBe('PIN_WINDOW_NOT_STARTED');
      expect(evaluatePinWindow(start, end, end)).toBe('PIN_WINDOW_EXPIRED');
    });
  });
});
