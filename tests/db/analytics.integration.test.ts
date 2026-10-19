import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import {
  users,
  analyticsEventTypes,
  analyticsEvents,
} from '../../src/db/schemas.js';
import { DefaultAnalyticsService } from '../../src/services/analytics.service.js';

describe('Analytics Database Integration Tests', () => {
  const service = new DefaultAnalyticsService(db);
  let viewTypeId: string;
  let searchTypeId: string;
  let downloadTypeId: string;

  beforeAll(async () => {
    // Ensure core event types exist
    const types = await db.select().from(analyticsEventTypes);
    for (const t of types) {
      if (t.eventCode === 'view') viewTypeId = t.id;
      if (t.eventCode === 'search') searchTypeId = t.id;
      if (t.eventCode === 'download') downloadTypeId = t.id;
    }
    expect(viewTypeId).toBeDefined();
    expect(searchTypeId).toBeDefined();
    expect(downloadTypeId).toBeDefined();
  });

  describe('User Deletion and Actor Constraints', () => {
    it('preserves analytics events with ON DELETE SET NULL when a user is deleted', async () => {
      // 1. Create a test user
      const [testUser] = await db
        .insert(users)
        .values({
          email: `analytics_user_${Date.now()}@example.com`,
          displayName: 'Analytics Test User',
        })
        .returning();

      const userAnonHash = crypto.createHash('sha256').update('user-session-token').digest('hex');

      // 2. Insert authenticated event
      const [event] = await db
        .insert(analyticsEvents)
        .values({
          eventTypeId: viewTypeId,
          actorType: 'AUTHENTICATED',
          userId: testUser.id,
          anonymousSessionHash: userAnonHash,
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/test',
          },
        })
        .returning();

      expect(event.userId).toBe(testUser.id);

      // 3. Delete the user
      await db.delete(users).where(eq(users.id, testUser.id));

      // 4. Verify event remains valid with userId set to NULL
      const [reloadedEvent] = await db
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.id, event.id));

      expect(reloadedEvent).toBeDefined();
      expect(reloadedEvent.userId).toBeNull();
      expect(reloadedEvent.actorType).toBe('AUTHENTICATED');
      expect(reloadedEvent.anonymousSessionHash).toBe(userAnonHash);
    });

    it('allows system events with null user_id and null anonymous_session_hash', async () => {
      const [sysEvent] = await db
        .insert(analyticsEvents)
        .values({
          eventTypeId: viewTypeId,
          actorType: 'SYSTEM',
          userId: null,
          anonymousSessionHash: null,
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/system-check',
          },
        })
        .returning();

      expect(sysEvent).toBeDefined();
      expect(sysEvent.actorType).toBe('SYSTEM');
    });

    it('rejects anonymous events without anonymous_session_hash', async () => {
      await expect(
        db.insert(analyticsEvents).values({
          eventTypeId: viewTypeId,
          actorType: 'ANONYMOUS',
          userId: null,
          anonymousSessionHash: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('Idempotency and Concurrency Deduplication', () => {
    it('safely deduplicates identical idempotency keys', async () => {
      const uniqueKey = `idemp-${Date.now()}-${Math.random()}`;
      const anonHash = crypto.createHash('sha256').update('anon-key-1').digest('hex');

      const res1 = await service.recordEvent({
        eventCode: 'view',
        anonymousSessionHash: anonHash,
        idempotencyKey: uniqueKey,
        context: {
          entity_type: 'resource',
          entity_id: '123e4567-e89b-12d3-a456-426614174000',
          path: '/resources/dedup',
        },
      });

      expect(res1.status).toBe('RECORDED');
      expect(res1.eventId).toBeDefined();

      const res2 = await service.recordEvent({
        eventCode: 'view',
        anonymousSessionHash: anonHash,
        idempotencyKey: uniqueKey,
        context: {
          entity_type: 'resource',
          entity_id: '123e4567-e89b-12d3-a456-426614174000',
          path: '/resources/dedup',
        },
      });

      expect(res2.status).toBe('DEDUPLICATED');
    });

    it('handles simultaneous concurrent duplicate requests against the exact database conflict target (Promise.all)', async () => {
      const concurrentKey = `concurrent-${Date.now()}-${Math.random()}`;
      const anonHash = crypto.createHash('sha256').update('concurrent-anon').digest('hex');

      // Fire 5 simultaneous duplicate requests concurrently
      const concurrentCalls = Array.from({ length: 5 }).map(() =>
        service.recordEvent({
          eventCode: 'view',
          anonymousSessionHash: anonHash,
          idempotencyKey: concurrentKey,
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/concurrent',
          },
        }),
      );

      const results = await Promise.all(concurrentCalls);

      const recorded = results.filter((r) => r.status === 'RECORDED');
      const deduplicated = results.filter((r) => r.status === 'DEDUPLICATED');

      // Exactly 1 request successfully records into DB, 4 safely deduplicated via ON CONFLICT DO NOTHING
      expect(recorded.length).toBe(1);
      expect(deduplicated.length).toBe(4);
      expect(recorded[0].eventId).toBeDefined();

      // Verify in DB that only 1 record exists with this idempotencyKey
      const dbRows = await db
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.idempotencyKey, concurrentKey));
      expect(dbRows.length).toBe(1);
      expect(dbRows[0].id).toBe(recorded[0].eventId);
    });
  });

  describe('Acceptance Test Fixture: Exact Mathematical Metric Set (3 + 2 = 5)', () => {
    it('correctly calculates authenticatedUsers, pureAnonymousSessions, and estimatedActorCount without double counting converted sessions', async () => {
      const baseTime = Date.now() + 300_000_000_000 + Math.floor(Math.random() * 100_000_000);
      const windowStart = new Date(baseTime);
      const windowEnd = new Date(baseTime + 3600_000);
      const eventTime = new Date(baseTime + 1800_000);

      // Create 3 distinct authenticated users
      const [u1] = await db
        .insert(users)
        .values({ email: `fixture_u1_${Date.now()}@example.com`, displayName: 'U1' })
        .returning();
      const [u2] = await db
        .insert(users)
        .values({ email: `fixture_u2_${Date.now()}@example.com`, displayName: 'U2' })
        .returning();
      const [u3] = await db
        .insert(users)
        .values({ email: `fixture_u3_${Date.now()}@example.com`, displayName: 'U3' })
        .returning();

      // Hashes for sessions
      const pureAnon1 = crypto.createHash('sha256').update(`pure-anon-1-${Date.now()}`).digest('hex');
      const pureAnon2 = crypto.createHash('sha256').update(`pure-anon-2-${Date.now()}`).digest('hex');
      const convertedAnon = crypto.createHash('sha256').update(`converted-anon-${Date.now()}`).digest('hex');

      // 1. Authenticated activity for U1, U2, U3
      await db.insert(analyticsEvents).values([
        {
          eventTypeId: viewTypeId,
          actorType: 'AUTHENTICATED',
          userId: u1.id,
          anonymousSessionHash: convertedAnon, // U1 was previously on convertedAnon session
          occurredAt: eventTime,
          context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/r1' },
        },
        {
          eventTypeId: viewTypeId,
          actorType: 'AUTHENTICATED',
          userId: u2.id,
          occurredAt: eventTime,
          context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/r2' },
        },
        {
          eventTypeId: viewTypeId,
          actorType: 'AUTHENTICATED',
          userId: u3.id,
          occurredAt: eventTime,
          context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/r3' },
        },
      ]);

      // 2. Pure anonymous sessions (pureAnon1, pureAnon2)
      await db.insert(analyticsEvents).values([
        {
          eventTypeId: viewTypeId,
          actorType: 'ANONYMOUS',
          userId: null,
          anonymousSessionHash: pureAnon1,
          occurredAt: eventTime,
          context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/anon1' },
        },
        {
          eventTypeId: viewTypeId,
          actorType: 'ANONYMOUS',
          userId: null,
          anonymousSessionHash: pureAnon2,
          occurredAt: eventTime,
          context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/anon2' },
        },
      ]);

      // 3. Pre-login anonymous event for convertedAnon session (before U1 logged in)
      await db.insert(analyticsEvents).values({
        eventTypeId: viewTypeId,
        actorType: 'ANONYMOUS',
        userId: null,
        anonymousSessionHash: convertedAnon,
        occurredAt: new Date(eventTime.getTime() - 60_000),
        context: { entity_type: 'resource', entity_id: '123e4567-e89b-12d3-a456-426614174000', path: '/pre-login' },
      });

      // 4. Download event in window
      await db.insert(analyticsEvents).values({
        eventTypeId: downloadTypeId,
        actorType: 'AUTHENTICATED',
        userId: u1.id,
        occurredAt: eventTime,
        context: { resource_id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      // 5. Query metrics for window
      const metrics = await service.getOverviewMetrics({
        startDate: windowStart,
        endDate: windowEnd,
      });

      // Mathematical set assertions:
      expect(metrics.metrics.authenticatedUsers).toBe(3); // U1, U2, U3
      expect(metrics.metrics.pureAnonymousSessions).toBe(2); // pureAnon1, pureAnon2 (convertedAnon is excluded)
      expect(metrics.metrics.estimatedActorCount).toBe(5); // 3 + 2 = 5
      expect(metrics.metrics.downloadUrlIssuedCount).toBe(1);
      // Zero searches occurred in this window -> returns null
      expect(metrics.metrics.zeroResultRate).toBeNull();

      // Now insert search events to test zeroResultRate calculation
      await db.insert(analyticsEvents).values([
        {
          eventTypeId: searchTypeId,
          actorType: 'ANONYMOUS',
          anonymousSessionHash: pureAnon1,
          occurredAt: eventTime,
          context: {
            search_query_hash: crypto.createHash('sha256').update('biology').digest('hex'),
            results_count: 0,
            zero_results: true,
            filters_applied: [],
          },
        },
        {
          eventTypeId: searchTypeId,
          actorType: 'ANONYMOUS',
          anonymousSessionHash: pureAnon2,
          occurredAt: eventTime,
          context: {
            search_query_hash: crypto.createHash('sha256').update('physics').digest('hex'),
            results_count: 10,
            zero_results: false,
            filters_applied: [],
          },
        },
      ]);

      const metricsWithSearches = await service.getOverviewMetrics({
        startDate: windowStart,
        endDate: windowEnd,
      });

      // 1 zero-result out of 2 searches = 0.5 (50%)
      expect(metricsWithSearches.metrics.zeroResultRate).toBe(0.5);
    });
  });
});
