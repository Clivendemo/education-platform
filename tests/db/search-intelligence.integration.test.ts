import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../../src/db/index.js';
import {
  countries,
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  subjects,
  topics,
  resourceTypes,
  resources,
  resourceVersions,
  analyticsEvents,
  analyticsEventTypes,
  users,
} from '../../src/db/schemas.js';
import { DefaultSearchService } from '../../src/services/search.service.js';
import { PostgreSQLSearchProvider } from '../../src/services/search/postgresql-search.provider.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Search Intelligence Neon Database Integration Tests', () => {
  let kenyaId: string;
  let tanzaniaId: string;
  let resourceTypeId: string;
  let curriculumId: string;
  let curriculumVersionId: string;
  let educationLevelId: string;
  let gradeId: string;
  let subjectId: string;
  let topicId: string;
  let searchEventTypeId: string;

  let testUserId1: string;
  let testUserId2: string;

  const createdResourceIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdUserIds: string[] = [];

  const searchService = new DefaultSearchService(new PostgreSQLSearchProvider(db), db);

  beforeAll(async () => {
    // 1. Resolve or create Kenya
    const existingKenya = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1),
    );
    if (existingKenya.length > 0) {
      kenyaId = existingKenya[0].id;
    } else {
      const [inserted] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: 'Kenya',
            isoCode: 'KE',
            urlPrefix: 'ke',
          })
          .returning(),
      );
      kenyaId = inserted.id;
    }

    // 2. Resolve or create Tanzania (for boundary isolation testing)
    const existingTanzania = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.isoCode, 'TZ')).limit(1),
    );
    if (existingTanzania.length > 0) {
      tanzaniaId = existingTanzania[0].id;
    } else {
      const [inserted] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: 'Tanzania',
            isoCode: 'TZ',
            urlPrefix: 'tz',
          })
          .returning(),
      );
      tanzaniaId = inserted.id;
    }

    // 3. Resource Type
    const existingType = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    if (existingType.length > 0) {
      resourceTypeId = existingType[0].id;
    } else {
      const [newType] = await withDbRetry(async () =>
        db
          .insert(resourceTypes)
          .values({
            code: 'INTEL_PAST_PAPER',
            name: 'Past Paper',
            slug: 'intel-past-paper',
            pillar: 'PAST_PAPERS',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      resourceTypeId = newType.id;
    }

    // 4. Curriculum Hierarchy in Kenya
    const existingCurriculum = await withDbRetry(async () =>
      db.select().from(curricula).where(eq(curricula.countryId, kenyaId)).limit(1),
    );
    if (existingCurriculum.length > 0) {
      curriculumId = existingCurriculum[0].id;
    } else {
      const [c] = await withDbRetry(async () =>
        db
          .insert(curricula)
          .values({
            countryId: kenyaId,
            code: 'INTEL_CBC',
            name: 'Intelligence CBC',
            slug: 'intel-cbc',
            status: 'ACTIVE',
          })
          .returning(),
      );
      curriculumId = c.id;
    }

    const existingVersion = await withDbRetry(async () =>
      db.select().from(curriculumVersions).where(eq(curriculumVersions.curriculumId, curriculumId)).limit(1),
    );
    if (existingVersion.length > 0) {
      curriculumVersionId = existingVersion[0].id;
    } else {
      const [v] = await withDbRetry(async () =>
        db
          .insert(curriculumVersions)
          .values({
            countryId: kenyaId,
            curriculumId,
            versionName: '2026 Edition',
            slug: 'intel-2026-edition',
            status: 'ACTIVE',
          })
          .returning(),
      );
      curriculumVersionId = v.id;
    }

    const existingLevel = await withDbRetry(async () =>
      db.select().from(educationLevels).where(eq(educationLevels.curriculumVersionId, curriculumVersionId)).limit(1),
    );
    if (existingLevel.length > 0) {
      educationLevelId = existingLevel[0].id;
    } else {
      const [lvl] = await withDbRetry(async () =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId,
            code: 'INTEL_SEC',
            name: 'Secondary',
            slug: 'intel-sec',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      educationLevelId = lvl.id;
    }

    const existingGrade = await withDbRetry(async () =>
      db.select().from(grades).where(eq(grades.curriculumVersionId, curriculumVersionId)).limit(1),
    );
    if (existingGrade.length > 0) {
      gradeId = existingGrade[0].id;
    } else {
      const [g] = await withDbRetry(async () =>
        db
          .insert(grades)
          .values({
            curriculumVersionId,
            educationLevelId,
            code: 'INTEL_G10',
            name: 'Grade 10',
            slug: 'intel-g10',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      gradeId = g.id;
    }

    const existingSubject = await withDbRetry(async () =>
      db.select().from(subjects).where(eq(subjects.gradeId, gradeId)).limit(1),
    );
    if (existingSubject.length > 0) {
      subjectId = existingSubject[0].id;
    } else {
      const [s] = await withDbRetry(async () =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId,
            educationLevelId,
            gradeId,
            code: 'INTEL_CHEM',
            name: 'Chemistry',
            slug: 'intel-chem',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      subjectId = s.id;
    }

    const existingTopic = await withDbRetry(async () =>
      db.select().from(topics).where(eq(topics.subjectId, subjectId)).limit(1),
    );
    if (existingTopic.length > 0) {
      topicId = existingTopic[0].id;
    } else {
      const [top] = await withDbRetry(async () =>
        db
          .insert(topics)
          .values({
            curriculumVersionId,
            subjectId,
            code: 'INTEL_ORGANIC',
            name: 'Organic Chemistry',
            slug: 'intel-organic',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      topicId = top.id;
    }

    // 5. Analytics event type for search
    const eventTypeRows = await withDbRetry(async () =>
      db
        .select()
        .from(analyticsEventTypes)
        .where(inArray(analyticsEventTypes.eventCode, ['search', 'RESOURCE_SEARCH']))
        .limit(1),
    );
    if (eventTypeRows.length > 0) {
      searchEventTypeId = eventTypeRows[0].id;
    } else {
      const [et] = await withDbRetry(async () =>
        db
          .insert(analyticsEventTypes)
          .values({
            eventCode: 'search',
            name: 'Resource Search',
            status: 'ACTIVE',
          })
          .returning(),
      );
      searchEventTypeId = et.id;
    }

    // 6. Test users
    const [u1] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `intel-user1-${Date.now()}@test.ke`,
          displayName: 'Test Searcher 1',
          status: 'ACTIVE',
        })
        .returning(),
    );
    testUserId1 = u1.id;
    createdUserIds.push(u1.id);

    const [u2] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `intel-user2-${Date.now()}@test.ke`,
          displayName: 'Test Searcher 2',
          status: 'ACTIVE',
        })
        .returning(),
    );
    testUserId2 = u2.id;
    createdUserIds.push(u2.id);
  });

  afterAll(async () => {
    // Clean up created resources and telemetry
    if (createdEventIds.length > 0) {
      await withDbRetry(async () =>
        db.delete(analyticsEvents).where(inArray(analyticsEvents.id, createdEventIds)),
      );
    }
    if (createdResourceIds.length > 0) {
      await withDbRetry(async () =>
        db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, createdResourceIds)),
      );
      await withDbRetry(async () =>
        db.delete(resources).where(inArray(resources.id, createdResourceIds)),
      );
    }
    if (createdUserIds.length > 0) {
      await withDbRetry(async () =>
        db.delete(users).where(inArray(users.id, createdUserIds)),
      );
    }
  });

  describe('Contextual Autocomplete & Published Invariants', () => {
    it('isolates published resources and ranks contextual Grade+Subject matches', async () => {
      const timestamp = Date.now();
      const uniqueKeyword = `chemtest${timestamp}`;

      // 1. Published resource in Kenya with Grade & Subject
      const [resPublished] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId,
            curriculumId,
            curriculumVersionId,
            educationLevelId,
            gradeId,
            subjectId,
            topicId,
            title: `${uniqueKeyword} Organic Acids Notes`,
            slug: `${uniqueKeyword}-organic-acids-notes`,
            status: 'PUBLISHED',
          })
          .returning(),
      );
      createdResourceIds.push(resPublished.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: resPublished.id,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: `${uniqueKeyword} Organic Acids Notes`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        }),
      );

      // 2. Draft resource in Kenya (should be isolated/hidden)
      const [resDraft] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId,
            curriculumId,
            curriculumVersionId,
            educationLevelId,
            gradeId,
            subjectId,
            topicId,
            title: `${uniqueKeyword} Draft Hydrocarbons`,
            slug: `${uniqueKeyword}-draft-hydrocarbons`,
            status: 'DRAFT',
          })
          .returning(),
      );
      createdResourceIds.push(resDraft.id);

      // 3. Published resource in Tanzania (should not bleed into Kenya autocomplete)
      const [resTanzania] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: tanzaniaId,
            resourceTypeId,
            title: `${uniqueKeyword} Tanzania Chemistry Syllabus`,
            slug: `${uniqueKeyword}-tz-chemistry-syllabus`,
            status: 'PUBLISHED',
          })
          .returning(),
      );
      createdResourceIds.push(resTanzania.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: resTanzania.id,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: `${uniqueKeyword} Tanzania Chemistry Syllabus`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        }),
      );

      // Execute autocomplete in Kenya
      const resultKenya = await searchService.getAutocompleteSuggestions({
        q: uniqueKeyword,
        country: 'KE',
      });

      expect(resultKenya.suggestions.length).toBeGreaterThanOrEqual(1);
      const titles = resultKenya.suggestions.map((s) => s.text);
      expect(titles).toContain(`${uniqueKeyword} Organic Acids Notes`);
      expect(titles).not.toContain(`${uniqueKeyword} Draft Hydrocarbons`);
      expect(titles).not.toContain(`${uniqueKeyword} Tanzania Chemistry Syllabus`);
      expect(resultKenya.fallbackUsed).toBe(false);
    });

    it('uses country-bound fallback when context yields no matches', async () => {
      const timestamp = Date.now();
      const uniqueKeyword = `fallbacktest${timestamp}`;

      // Create published resource without grade/subject constraint
      const [resGeneral] = await withDbRetry(async () =>
        db
          .insert(resources)
          .values({
            countryId: kenyaId,
            resourceTypeId,
            title: `${uniqueKeyword} General Science Summary`,
            slug: `${uniqueKeyword}-general-science-summary`,
            status: 'PUBLISHED',
          })
          .returning(),
      );
      createdResourceIds.push(resGeneral.id);

      await withDbRetry(async () =>
        db.insert(resourceVersions).values({
          resourceId: resGeneral.id,
          versionNumber: 1,
          versionLabel: 'v1.0.0',
          title: `${uniqueKeyword} General Science Summary`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        }),
      );

      // Query with gradeId that has no matching resource with this prefix
      const res = await searchService.getAutocompleteSuggestions({
        q: uniqueKeyword,
        country: 'KE',
        grade: gradeId,
      });

      expect(res.fallbackUsed).toBe(true);
      expect(res.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(res.suggestions[0].text).toBe(`${uniqueKeyword} General Science Summary`);
    });
  });

  describe('Search Demand Telemetry Aggregation & Privacy Rules', () => {
    it('suppresses queries with fewer than 3 distinct search identities', async () => {
      const timestamp = Date.now();
      const isolatedQuery = `rare query ${timestamp}`;

      // Seed 5 searches from a single authenticated user (1 distinct identity)
      for (let i = 0; i < 5; i++) {
        const [event] = await withDbRetry(async () =>
          db
            .insert(analyticsEvents)
            .values({
              eventTypeId: searchEventTypeId,
              actorType: 'AUTHENTICATED',
              userId: testUserId1,
              countryId: kenyaId,
              context: {
                normalized_query: isolatedQuery,
                results_count: 0,
                zero_results: true,
              },
            })
            .returning(),
        );
        createdEventIds.push(event.id);
      }

      // Query search demand
      const demand = await searchService.getSearchDemand({
        window: '7d',
        type: 'all',
        minCount: 3,
      });

      const queries = demand.data.map((d) => d.query);
      expect(queries).not.toContain(isolatedQuery);
    });

    it('aggregates and surfaces queries with >= 3 qualifying search identities', async () => {
      const timestamp = Date.now();
      const popularQuery = `popular demand ${timestamp}`;
      const validAnonHash = crypto.createHash('sha256').update(`anon-${timestamp}`).digest('hex');

      // Identity 1: Authenticated User 1
      const [e1] = await withDbRetry(async () =>
        db
          .insert(analyticsEvents)
          .values({
            eventTypeId: searchEventTypeId,
            actorType: 'AUTHENTICATED',
            userId: testUserId1,
            countryId: kenyaId,
            context: {
              normalized_query: popularQuery,
              results_count: 0,
              zero_results: true,
            },
          })
          .returning(),
      );
      createdEventIds.push(e1.id);

      // Identity 2: Authenticated User 2
      const [e2] = await withDbRetry(async () =>
        db
          .insert(analyticsEvents)
          .values({
            eventTypeId: searchEventTypeId,
            actorType: 'AUTHENTICATED',
            userId: testUserId2,
            countryId: kenyaId,
            context: {
              normalized_query: popularQuery,
              results_count: 0,
              zero_results: true,
            },
          })
          .returning(),
      );
      createdEventIds.push(e2.id);

      // Identity 3: Anonymous valid 64-char session
      const [e3] = await withDbRetry(async () =>
        db
          .insert(analyticsEvents)
          .values({
            eventTypeId: searchEventTypeId,
            actorType: 'ANONYMOUS',
            anonymousSessionHash: validAnonHash,
            countryId: kenyaId,
            context: {
              normalized_query: popularQuery,
              results_count: 0,
              zero_results: true,
            },
          })
          .returning(),
      );
      createdEventIds.push(e3.id);

      // Identity 4 (disqualified): SYSTEM actor (should NOT contribute)
      const [eSys] = await withDbRetry(async () =>
        db
          .insert(analyticsEvents)
          .values({
            eventTypeId: searchEventTypeId,
            actorType: 'SYSTEM',
            countryId: kenyaId,
            context: {
              normalized_query: popularQuery,
              results_count: 0,
              zero_results: true,
            },
          })
          .returning(),
      );
      createdEventIds.push(eSys.id);

      const demand = await searchService.getSearchDemand({
        window: '7d',
        type: 'all',
        minCount: 3,
      });

      const matched = demand.data.find((d) => d.query === popularQuery);
      expect(matched).toBeDefined();
      expect(matched?.distinctSearchIdentities).toBe(3); // Exactly 3 (System was excluded)
      expect(matched?.zeroResultCount).toBeGreaterThanOrEqual(3);
      expect(matched?.zeroResultRate).toBe(1);
    });

    it('collects diagnostic EXPLAIN query plan metrics', async () => {
      const explainRes = await db.execute<{ 'QUERY PLAN': unknown }>(sql`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT
          context->>'normalized_query' AS normalized_query,
          COUNT(*)::int AS search_volume,
          COUNT(DISTINCT CASE 
            WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
              THEN 'u:' || ae.user_id::text
            WHEN ae.actor_type = 'ANONYMOUS' 
                 AND ae.anonymous_session_hash IS NOT NULL 
                 AND length(trim(ae.anonymous_session_hash)) = 64 
                 AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
              THEN 's:' || ae.anonymous_session_hash
            ELSE NULL
          END)::int AS distinct_search_identities
        FROM analytics.analytics_events ae
        JOIN analytics.analytics_event_types aet ON ae.event_type_id = aet.id
        WHERE aet.event_code IN ('search', 'RESOURCE_SEARCH')
          AND ae.actor_type IN ('AUTHENTICATED', 'ANONYMOUS')
          AND ae.occurred_at >= NOW() - INTERVAL '30 days'
          AND (ae.context->>'normalized_query') IS NOT NULL
        GROUP BY context->>'normalized_query'
        HAVING COUNT(DISTINCT CASE 
          WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
            THEN 'u:' || ae.user_id::text
          WHEN ae.actor_type = 'ANONYMOUS' 
               AND ae.anonymous_session_hash IS NOT NULL 
               AND length(trim(ae.anonymous_session_hash)) = 64 
               AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
            THEN 's:' || ae.anonymous_session_hash
          ELSE NULL
        END) >= 3
        LIMIT 20;
      `);

      expect(explainRes.rows.length).toBeGreaterThan(0);
      expect(explainRes.rows[0]['QUERY PLAN']).toBeDefined();
    });
  });
});
