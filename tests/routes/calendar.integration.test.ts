import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, closeDatabase } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';
import {
  calendars,
  calendarEvents,
  calendarEventTypes,
  countries,
  users,
} from '../../src/db/schemas.js';
import { defaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { CALENDAR_SESSION_COOKIE_NAME } from '../../src/routes/api/v1/calendar.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCalendarSchema } from '../../src/db/seeds/calendar-setup.js';

describe('Calendar HTTP Route Integration Tests', () => {
  const db = getDb();
  let app: FastifyInstance;
  let testCountryId: string;
  let testUserToken: string;
  let testUserId: string;
  let examEventTypeId: string;
  let personalEventTypeId: string;
  const createdCalendarIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCalendarSchema(db));
    app = buildApp();
    await app.ready();

    // 1. Resolve country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    // 2. Resolve event types
    const types = await withDbRetry(async () =>
      db.select().from(calendarEventTypes).where(eq(calendarEventTypes.status, 'ACTIVE')),
    );
    examEventTypeId = types.find((t) => t.slug === 'examination')!.id;
    personalEventTypeId = types.find((t) => t.slug === 'personal')!.id;

    // 3. Register test user for authenticated flows
    const testEmail = `cal-route-test-${Date.now()}@example.com`;
    const regResult = await withDbRetry(async () =>
      defaultAuthService.register({
        email: testEmail,
        password: 'Password123!',
        displayName: 'Calendar Route Tester',
      }),
    );
    testUserToken = regResult.sessionToken;
    testUserId = regResult.user.id;

    // 4. Seed an official calendar with official events
    const [officialCal] = await withDbRetry(async () =>
      db
        .insert(calendars)
        .values({
          name: `Ministry of Education 2026 Academic Calendar`,
          calendarScope: 'OFFICIAL',
          countryId: testCountryId,
          academicYear: '2026',
          status: 'ACTIVE',
        })
        .returning(),
    );
    createdCalendarIds.push(officialCal.id);

    await withDbRetry(async () =>
      db.insert(calendarEvents).values({
        calendarId: officialCal.id,
        eventTypeId: examEventTypeId,
        title: 'Kenya National Exams 2026',
        startDate: '2026-11-03',
        endDate: '2026-11-20',
        allDay: true,
        sourceType: 'OFFICIAL',
        status: 'ACTIVE',
      }),
    );
  }, 120000);

  afterAll(async () => {
    for (const calId of createdCalendarIds) {
      await withDbRetry(async () => {
        await db.delete(calendars).where(eq(calendars.id, calId));
      }).catch(() => {});
    }
    if (testUserId) {
      await withDbRetry(async () => {
        await db.delete(users).where(eq(users.id, testUserId));
      }).catch(() => {});
    }
    await app.close();
    await closeDatabase();
  });

  describe('1. Public & Official Calendar Endpoints', () => {
    it('GET /api/v1/calendar returns combined calendar preview without requiring credentials', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar?academicYear=2026',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toBeDefined();
      expect(json.data.events).toBeInstanceOf(Array);
      expect(json.data.officialEvents.length).toBeGreaterThanOrEqual(1);

      const officialItem = json.data.officialEvents.find(
        (e: any) => e.title === 'Kenya National Exams 2026',
      );
      expect(officialItem).toBeDefined();
      expect(officialItem.isReadOnly).toBe(true);
      expect(officialItem.sourceType).toBe('OFFICIAL');
    });

    it('GET /api/v1/calendar/official returns official platform calendar events', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/official?countryId=${testCountryId}&academicYear=2026`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.calendar).toBeDefined();
      expect(json.data.events.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/calendar/event-types returns active event types list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/event-types',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.some((t: any) => t.slug === 'examination')).toBe(true);
      expect(json.data.some((t: any) => t.slug === 'holiday')).toBe(true);
    });
  });

  describe('2. Anonymous Calendar Construction & Session Management', () => {
    let sessionCookie: string;
    let createdEventId: string;

    it('POST /api/v1/calendar/session initializes an anonymous session and sets HttpOnly cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/session',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.calendar).toBeDefined();
      expect(json.data.calendar.calendarScope).toBe('ANONYMOUS_SESSION');
      expect(json.data.sessionId).toBeDefined();

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toContain(CALENDAR_SESSION_COOKIE_NAME);

      sessionCookie = `${CALENDAR_SESSION_COOKIE_NAME}=${json.data.sessionId}`;
      createdCalendarIds.push(json.data.calendar.id);
    });

    it('POST /api/v1/calendar/session/events adds a personal event to anonymous calendar', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/session/events',
        headers: { cookie: sessionCookie },
        payload: {
          eventTypeId: personalEventTypeId,
          title: 'Revision Session: Calculus',
          startDate: '2026-05-18',
          startTime: '09:00:00',
          endTime: '11:00:00',
          allDay: false,
          location: 'Home Study Room',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.id).toBeDefined();
      expect(json.data.title).toBe('Revision Session: Calculus');
      expect(json.data.sourceType).toBe('USER');
      expect(json.data.isReadOnly).toBe(false);

      createdEventId = json.data.id;
    });

    it('GET /api/v1/calendar/session retrieves anonymous calendar and personal events', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/session',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.personalEvents.some((e: any) => e.id === createdEventId)).toBe(true);
    });

    it('GET /api/v1/calendar preview combines anonymous events with official dates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar?academicYear=2026',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.personalEvents.some((e: any) => e.id === createdEventId)).toBe(true);
      expect(json.data.officialEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /api/v1/calendar/session/events/:id updates anonymous event', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/calendar/session/events/${createdEventId}`,
        headers: { cookie: sessionCookie },
        payload: {
          title: 'Advanced Calculus & Algebra Revision',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.title).toBe('Advanced Calculus & Algebra Revision');
    });

    it('rejects cross-session update attempt (Session B cannot update Session A event)', async () => {
      const otherSessionCookie = `${CALENDAR_SESSION_COOKIE_NAME}=another-random-session-xyz`;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/calendar/session/events/${createdEventId}`,
        headers: { cookie: otherSessionCookie },
        payload: {
          title: 'Unauthorized Intrusion Title',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('UNAUTHORIZED_CALENDAR_ACCESS');
    });

    it('DELETE /api/v1/calendar/session/events/:id removes anonymous event', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/calendar/session/events/${createdEventId}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.success).toBe(true);

      // Verify deletion
      const checkRes = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/session',
        headers: { cookie: sessionCookie },
      });
      expect(checkRes.json().data.personalEvents.some((e: any) => e.id === createdEventId)).toBe(false);
    });
  });

  describe('3. Authenticated User Calendar & Anonymous-to-Account Transfer', () => {
    const getAuthCookie = () => `${SESSION_COOKIE_NAME}=${testUserToken}`;
    let anonSessionCookie: string;
    let anonEventId: string;

    it('allows anonymous building then atomic transfer to authenticated account', async () => {
      // 1. Build an event anonymously
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/session',
      });
      const anonSessionId = sessionRes.json().data.sessionId;
      anonSessionCookie = `${CALENDAR_SESSION_COOKIE_NAME}=${anonSessionId}`;

      const eventRes = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/session/events',
        headers: { cookie: anonSessionCookie },
        payload: {
          eventTypeId: personalEventTypeId,
          title: 'Anonymous Pre-Login Study Session',
          startDate: '2026-06-25',
        },
      });
      anonEventId = eventRes.json().data.id;

      // 2. Transfer into authenticated account
      const transferRes = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/session/transfer',
        headers: {
          cookie: `${getAuthCookie()}; ${anonSessionCookie}`,
        },
      });

      expect(transferRes.statusCode).toBe(200);
      expect(transferRes.json().data.eventCount).toBeGreaterThanOrEqual(1);

      // 3. Verify event now appears in authenticated user's calendar
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/calendar',
        headers: { cookie: getAuthCookie() },
      });

      expect(meRes.statusCode).toBe(200);
      const userEvents = meRes.json().data.personalEvents;
      expect(userEvents.some((e: any) => e.id === anonEventId)).toBe(true);
    });

    it('supports direct authenticated user event CRUD via /me/calendar/events', async () => {
      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/calendar/events',
        headers: { cookie: getAuthCookie() },
        payload: {
          eventTypeId: personalEventTypeId,
          title: 'Biology Practical Lab Session',
          startDate: '2026-07-02',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const createdId = createRes.json().data.id;

      // Update
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/me/calendar/events/${createdId}`,
        headers: { cookie: getAuthCookie() },
        payload: {
          title: 'Advanced Biology Practical Lab Session',
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().data.title).toBe('Advanced Biology Practical Lab Session');

      // Delete
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/calendar/events/${createdId}`,
        headers: { cookie: getAuthCookie() },
      });
      expect(deleteRes.statusCode).toBe(200);
    });
  });

  describe('4. Calendar PDF Export Endpoints', () => {
    it('POST /api/v1/calendar/export generates PDF calendar export with download URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/export',
        payload: {
          format: 'PDF',
          title: 'My 2026 Term Schedule',
          academicYear: '2026',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.exportId).toBeDefined();
      expect(json.data.exportType).toBe('PDF');
      expect(json.data.status).toBe('COMPLETED');
      expect(json.data.downloadUrl).toBeDefined();
      expect(json.data.downloadUrl).toContain('http');

      // GET export status
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export/${json.data.exportId}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().data.status).toBe('COMPLETED');
    });
  });
});
