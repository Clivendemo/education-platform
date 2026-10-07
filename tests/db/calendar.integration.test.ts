import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  calendars,
  calendarEvents,
  calendarEventTypes,
  calendarRecurrenceRules,
  calendarExports,
  countries,
  schools,
  users,
} from '../../src/db/schemas.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCalendarSchema } from '../../src/db/seeds/calendar-setup.js';

describe('Calendar Database Integration Tests', () => {
  const db = getDb();
  let testCountryId: string;
  let testSchoolId: string;
  let testUserId: string;
  let examEventTypeId: string;
  const createdCalendarIds: string[] = [];
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    // 1. Ensure calendar schema and event types are setup
    await withDbRetry(() => setupCalendarSchema(db));

    // 2. Resolve or create country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    if (!c) {
      const [newCountry] = await withDbRetry(async () =>
        db
          .insert(countries)
          .values({
            name: `CalendarTest Country ${Date.now()}`,
            isoCode: `C${Date.now().toString().slice(-2)}`,
            urlPrefix: `c${Date.now().toString().slice(-4)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testCountryId = newCountry.id;
    } else {
      testCountryId = c.id;
    }

    // 3. Resolve or create school
    const [s] = await withDbRetry(async () =>
      db.select().from(schools).where(eq(schools.countryId, testCountryId)).limit(1),
    );
    if (!s) {
      const [newSchool] = await withDbRetry(async () =>
        db
          .insert(schools)
          .values({
            countryId: testCountryId,
            name: `CalendarTest School ${Date.now()}`,
            schoolType: 'SECONDARY',
            status: 'ACTIVE',
          })
          .returning(),
      );
      testSchoolId = newSchool.id;
    } else {
      testSchoolId = s.id;
    }

    // 4. Resolve or create user
    const [u] = await withDbRetry(async () =>
      db.select().from(users).limit(1),
    );
    if (!u) {
      const [newUser] = await withDbRetry(async () =>
        db
          .insert(users)
          .values({
            email: `cal-db-test-${Date.now()}@example.com`,
            displayName: 'Calendar DB Test User',
          })
          .returning(),
      );
      testUserId = newUser.id;
    } else {
      testUserId = u.id;
    }

    // 5. Resolve event type
    const [evtType] = await withDbRetry(async () =>
      db.select().from(calendarEventTypes).where(eq(calendarEventTypes.slug, 'examination')).limit(1),
    );
    examEventTypeId = evtType.id;
  }, 120000);

  afterAll(async () => {
    // Cleanup created test calendars
    for (const calId of createdCalendarIds) {
      await withDbRetry(async () => {
        await db.delete(calendars).where(eq(calendars.id, calId));
      }).catch(() => {});
    }
    for (const ruleId of createdRuleIds) {
      await withDbRetry(async () => {
        await db.delete(calendarRecurrenceRules).where(eq(calendarRecurrenceRules.id, ruleId));
      }).catch(() => {});
    }
    await closeDatabase();
  });

  describe('1. Calendar Scopes & Structural Ownership Constraints', () => {
    it('creates an OFFICIAL calendar with country awareness and no user or session ownership', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'National Official Academic Calendar 2026',
            calendarScope: 'OFFICIAL',
            countryId: testCountryId,
            academicYear: '2026',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      expect(cal.id).toBeDefined();
      expect(cal.calendarScope).toBe('OFFICIAL');
      expect(cal.userId).toBeNull();
      expect(cal.sessionId).toBeNull();
    });

    it('rejects an OFFICIAL calendar that attempts to associate with a user or session (chk_calendars_official_owner)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(calendars).values({
            name: 'Illegal Official User Calendar',
            calendarScope: 'OFFICIAL',
            userId: testUserId, // Prohibited!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('creates a SCHOOL calendar bound to a school entity', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'High School Term Dates 2026',
            calendarScope: 'SCHOOL',
            schoolId: testSchoolId,
            academicYear: '2026',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      expect(cal.calendarScope).toBe('SCHOOL');
      expect(cal.schoolId).toBe(testSchoolId);
    });

    it('rejects a SCHOOL calendar missing schoolId (chk_calendars_school_owner)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(calendars).values({
            name: 'Invalid School Calendar',
            calendarScope: 'SCHOOL',
            schoolId: null, // Prohibited!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('creates a USER calendar bound to an authenticated user', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'My Personal Study Calendar',
            calendarScope: 'USER',
            userId: testUserId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      expect(cal.calendarScope).toBe('USER');
      expect(cal.userId).toBe(testUserId);
      expect(cal.sessionId).toBeNull();
    });

    it('rejects a USER calendar missing userId (chk_calendars_user_owner)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(calendars).values({
            name: 'Invalid User Calendar',
            calendarScope: 'USER',
            userId: null, // Prohibited!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('creates an ANONYMOUS_SESSION calendar with explicit session_id and expires_at', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Anonymous Personal Calendar',
            calendarScope: 'ANONYMOUS_SESSION',
            sessionId: 'anon-session-abc-123',
            expiresAt,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      expect(cal.calendarScope).toBe('ANONYMOUS_SESSION');
      expect(cal.sessionId).toBe('anon-session-abc-123');
      expect(cal.expiresAt).toBeDefined();
    });

    it('rejects an ANONYMOUS_SESSION calendar missing sessionId or expiresAt (chk_calendars_anonymous_owner)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(calendars).values({
            name: 'Invalid Anonymous Calendar',
            calendarScope: 'ANONYMOUS_SESSION',
            sessionId: 'anon-no-expiry',
            expiresAt: null, // Prohibited!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects an invalid calendar scope value (chk_calendars_scope)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(calendars).values({
            name: 'Invalid Scope Calendar',
            calendarScope: 'UNSUPPORTED_SCOPE' as any,
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('2. Calendar Events Integrity & Chronological Constraints', () => {
    it('creates a valid calendar event with date and time ordering', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Event Test Calendar',
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      const [ev] = await withDbRetry(async () =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: cal.id,
            eventTypeId: examEventTypeId,
            title: 'KCSE National Examination 2026',
            startDate: '2026-11-02',
            endDate: '2026-11-20',
            startTime: '08:00:00',
            endTime: '12:00:00',
            allDay: false,
            sourceType: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );

      expect(ev.id).toBeDefined();
      expect(ev.title).toBe('KCSE National Examination 2026');
      expect(ev.startDate).toBe('2026-11-02');
      expect(ev.endDate).toBe('2026-11-20');
      expect(ev.sourceType).toBe('OFFICIAL');
    });

    it('rejects an event where end_date precedes start_date (chk_calendar_events_date_order)', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Date Order Test Calendar',
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      await expect(
        withDbRetry(async () =>
          db.insert(calendarEvents).values({
            calendarId: cal.id,
            eventTypeId: examEventTypeId,
            title: 'Impossible Backwards Event',
            startDate: '2026-11-20',
            endDate: '2026-11-02', // Invalid: end < start!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects an event where end_time precedes start_time on same day (chk_calendar_events_time_order)', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Time Order Test Calendar',
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      await expect(
        withDbRetry(async () =>
          db.insert(calendarEvents).values({
            calendarId: cal.id,
            eventTypeId: examEventTypeId,
            title: 'Impossible Backwards Time Event',
            startDate: '2026-05-10',
            endDate: '2026-05-10',
            startTime: '14:00:00',
            endTime: '09:00:00', // Invalid: end < start!
            allDay: false,
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('supports structural recurrence rules without duplicate event cloning', async () => {
      const [rule] = await withDbRetry(async () =>
        db
          .insert(calendarRecurrenceRules)
          .values({
            frequency: 'WEEKLY',
            intervalValue: 1,
            daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
            startDate: '2026-01-05',
            endDate: '2026-04-03',
          })
          .returning(),
      );
      createdRuleIds.push(rule.id);

      expect(rule.frequency).toBe('WEEKLY');
      expect(rule.intervalValue).toBe(1);

      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Recurrence Test Calendar',
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(cal.id);

      const [ev] = await withDbRetry(async () =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: cal.id,
            eventTypeId: examEventTypeId,
            title: 'Weekly Revision Session',
            startDate: '2026-01-05',
            recurrenceRuleId: rule.id,
            status: 'ACTIVE',
          })
          .returning(),
      );

      expect(ev.recurrenceRuleId).toBe(rule.id);
    });

    it('enforces cascade deletion: deleting calendar cascades to its events and exports', async () => {
      const [cal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: 'Cascade Test Calendar',
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );

      const [ev] = await withDbRetry(async () =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: cal.id,
            eventTypeId: examEventTypeId,
            title: 'Cascade Event',
            startDate: '2026-08-01',
            status: 'ACTIVE',
          })
          .returning(),
      );

      const [exp] = await withDbRetry(async () =>
        db
          .insert(calendarExports)
          .values({
            calendarId: cal.id,
            exportType: 'PDF',
            status: 'COMPLETED',
            storageKey: 'test/cascade.pdf',
          })
          .returning(),
      );

      // Delete parent calendar
      await withDbRetry(async () => {
        await db.delete(calendars).where(eq(calendars.id, cal.id));
      });

      // Events and exports should be cascade-deleted
      const [remainingEv] = await withDbRetry(async () =>
        db.select().from(calendarEvents).where(eq(calendarEvents.id, ev.id)),
      );
      const [remainingExp] = await withDbRetry(async () =>
        db.select().from(calendarExports).where(eq(calendarExports.id, exp.id)),
      );

      expect(remainingEv).toBeUndefined();
      expect(remainingExp).toBeUndefined();
    });
  });
});
