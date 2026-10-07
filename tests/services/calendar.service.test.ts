import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  calendars,
  calendarEvents,
  countries,
  users,
} from '../../src/db/schemas.js';
import { CalendarService } from '../../src/services/calendar/calendar.service.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import {
  OfficialCalendarModificationError,
  UnauthorizedCalendarAccessError,
  InvalidEventDateError,
} from '../../src/services/calendar/calendar.interface.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCalendarSchema } from '../../src/db/seeds/calendar-setup.js';

describe('Calendar Service Unit & Functional Tests', () => {
  const db = getDb();
  let storageProvider: MemoryStorageProvider;
  let calendarService: CalendarService;
  let testCountryId: string;
  let testUserId: string;
  let holidayTypeId: string;
  let examTypeId: string;
  let personalTypeId: string;
  const createdCalendarIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCalendarSchema(db));
    storageProvider = new MemoryStorageProvider();
    calendarService = new CalendarService({ db, storageProvider });

    // Country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    // User
    const [u] = await withDbRetry(async () =>
      db.select().from(users).limit(1),
    );
    testUserId = u.id;

    // Event types
    const types = await calendarService.getEventTypes();
    holidayTypeId = types.find((t) => t.slug === 'holiday')!.id;
    examTypeId = types.find((t) => t.slug === 'examination')!.id;
    personalTypeId = types.find((t) => t.slug === 'personal')!.id;
  }, 120000);

  afterAll(async () => {
    for (const calId of createdCalendarIds) {
      await withDbRetry(async () => {
        await db.delete(calendars).where(eq(calendars.id, calId));
      }).catch(() => {});
    }
    await closeDatabase();
  });

  describe('1. Anonymous Session Lifecycle & Rolling Expiry', () => {
    it('creates an anonymous calendar with 7-day rolling expiry', async () => {
      const sessionId = `test-session-${Date.now()}`;
      const cal = await calendarService.getOrCreateAnonymousCalendar(sessionId);
      createdCalendarIds.push(cal.id);

      expect(cal.calendarScope).toBe('ANONYMOUS_SESSION');
      expect(cal.sessionId).toBe(sessionId);
      expect(cal.expiresAt).toBeDefined();

      const timeDiff = cal.expiresAt!.getTime() - Date.now();
      expect(timeDiff).toBeGreaterThan(6 * 24 * 3600 * 1000);
      expect(timeDiff).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    });

    it('extends rolling expiry on subsequent access', async () => {
      const sessionId = `touch-session-${Date.now()}`;
      const cal1 = await calendarService.getOrCreateAnonymousCalendar(sessionId);
      createdCalendarIds.push(cal1.id);

      // Simulate passage of time
      await new Promise((r) => setTimeout(r, 20));
      const cal2 = await calendarService.getOrCreateAnonymousCalendar(sessionId);

      expect(cal2.id).toBe(cal1.id);
      expect(cal2.expiresAt!.getTime()).toBeGreaterThanOrEqual(cal1.expiresAt!.getTime());
    });
  });

  describe('2. Combined Calendar & Chronological Event Merging', () => {
    it('merges official events with personal events and marks read-only properties', async () => {
      // 1. Create an official calendar and events
      const [officialCal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: `Official Ministry Calendar ${Date.now()}`,
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
          eventTypeId: holidayTypeId,
          title: 'Madaraka Day Holiday',
          startDate: '2026-06-01',
          sourceType: 'OFFICIAL',
          status: 'ACTIVE',
        }),
      );

      // 2. Create anonymous session and personal event
      const sessionId = `merge-session-${Date.now()}`;
      const anonContext = { sessionId, isAuthenticated: false };

      await calendarService.createEvent(anonContext, {
        eventTypeId: personalTypeId,
        title: 'My Math Study Group',
        startDate: '2026-05-15',
        startTime: '10:00:00',
        endTime: '12:00:00',
        allDay: false,
      });

      // 3. Fetch combined calendar
      const view = await calendarService.getCombinedCalendar(anonContext, {
        countryId: testCountryId,
        academicYear: '2026',
      });
      createdCalendarIds.push(view.calendar.id);

      expect(view.officialEvents.length).toBeGreaterThanOrEqual(1);
      expect(view.personalEvents.length).toBeGreaterThanOrEqual(1);

      // Verify read-only marking
      const officialItem = view.events.find((e) => e.title === 'Madaraka Day Holiday');
      expect(officialItem).toBeDefined();
      expect(officialItem!.isReadOnly).toBe(true);
      expect(officialItem!.sourceType).toBe('OFFICIAL');

      const personalItem = view.events.find((e) => e.title === 'My Math Study Group');
      expect(personalItem).toBeDefined();
      expect(personalItem!.isReadOnly).toBe(false);
      expect(personalItem!.sourceType).toBe('USER');

      // Verify chronological order (May 15 before June 01)
      const mayIndex = view.events.findIndex((e) => e.startDate === '2026-05-15');
      const juneIndex = view.events.findIndex((e) => e.startDate === '2026-06-01');
      expect(mayIndex).toBeLessThan(juneIndex);
    });
  });

  describe('3. Ownership Gating & Protection Invariants', () => {
    it('prohibits creating an event on an OFFICIAL calendar through personal event API', async () => {
      const [officialCal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: `Protected Official Calendar ${Date.now()}`,
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(officialCal.id);

      const context = { userId: testUserId, isAuthenticated: true };

      await expect(
        calendarService.createEvent(context, {
          calendarId: officialCal.id, // Targeting official calendar!
          eventTypeId: personalTypeId,
          title: 'Illegal Event on Official Calendar',
          startDate: '2026-07-01',
        }),
      ).rejects.toThrow(OfficialCalendarModificationError);
    });

    it('prohibits updating or deleting official events', async () => {
      const [officialCal] = await withDbRetry(async () =>
        db
          .insert(calendars)
          .values({
            name: `Official Protected Events ${Date.now()}`,
            calendarScope: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdCalendarIds.push(officialCal.id);

      const [officialEv] = await withDbRetry(async () =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: officialCal.id,
            eventTypeId: examTypeId,
            title: 'KCSE Official Exam',
            startDate: '2026-11-01',
            sourceType: 'OFFICIAL',
            status: 'ACTIVE',
          })
          .returning(),
      );

      const context = { userId: testUserId, isAuthenticated: true };

      await expect(
        calendarService.updateEvent(context, officialEv.id, {
          title: 'Hacked Official Title',
        }),
      ).rejects.toThrow(OfficialCalendarModificationError);

      await expect(
        calendarService.deleteEvent(context, officialEv.id),
      ).rejects.toThrow(OfficialCalendarModificationError);
    });

    it('prohibits cross-session event access (Session B cannot update or delete Session A event)', async () => {
      const sessionA = `session-a-${Date.now()}`;
      const sessionB = `session-b-${Date.now()}`;

      const evA = await calendarService.createEvent(
        { sessionId: sessionA, isAuthenticated: false },
        {
          eventTypeId: personalTypeId,
          title: 'Session A Private Event',
          startDate: '2026-04-10',
        },
      );

      // Session B attempts update
      await expect(
        calendarService.updateEvent(
          { sessionId: sessionB, isAuthenticated: false },
          evA.id,
          { title: 'Session B Tampered Title' },
        ),
      ).rejects.toThrow(UnauthorizedCalendarAccessError);

      // Session B attempts delete
      await expect(
        calendarService.deleteEvent(
          { sessionId: sessionB, isAuthenticated: false },
          evA.id,
        ),
      ).rejects.toThrow(UnauthorizedCalendarAccessError);
    });

    it('rejects invalid event dates (end_date < start_date or time order mismatch)', async () => {
      const context = { sessionId: `date-val-${Date.now()}`, isAuthenticated: false };

      await expect(
        calendarService.createEvent(context, {
          eventTypeId: personalTypeId,
          title: 'Invalid Date Range Event',
          startDate: '2026-08-20',
          endDate: '2026-08-10', // End precedes start!
        }),
      ).rejects.toThrow(InvalidEventDateError);

      await expect(
        calendarService.createEvent(context, {
          eventTypeId: personalTypeId,
          title: 'Invalid Time Range Event',
          startDate: '2026-08-20',
          endDate: '2026-08-20',
          startTime: '15:00:00',
          endTime: '11:00:00', // End precedes start!
          allDay: false,
        }),
      ).rejects.toThrow(InvalidEventDateError);
    });
  });

  describe('4. Anonymous-to-Account Calendar Transfer', () => {
    it('atomically transfers anonymous session events to authenticated user account', async () => {
      const sessionId = `transfer-source-${Date.now()}`;
      const anonContext = { sessionId, isAuthenticated: false };

      // Add 2 events to anonymous calendar
      await calendarService.createEvent(anonContext, {
        eventTypeId: personalTypeId,
        title: 'Transfer Event 1: Study Algebra',
        startDate: '2026-03-01',
      });
      await calendarService.createEvent(anonContext, {
        eventTypeId: personalTypeId,
        title: 'Transfer Event 2: Physics Lab Prep',
        startDate: '2026-03-05',
      });

      // Transfer to user
      const transferResult = await calendarService.transferAnonymousSession(
        testUserId,
        sessionId,
      );

      expect(transferResult.eventCount).toBe(2);
      expect(transferResult.transferredCalendarId).toBeDefined();

      // Verify user calendar now has both events
      const userView = await calendarService.getCombinedCalendar({
        userId: testUserId,
        isAuthenticated: true,
      });

      const titles = userView.personalEvents.map((e) => e.title);
      expect(titles).toContain('Transfer Event 1: Study Algebra');
      expect(titles).toContain('Transfer Event 2: Physics Lab Prep');
    });
  });

  describe('5. PDF Calendar Export Flow', () => {
    it('snapshots authorized calendar view and generates printable PDF export with signed URL', async () => {
      const sessionId = `pdf-export-${Date.now()}`;
      const context = { sessionId, isAuthenticated: false };

      await calendarService.createEvent(context, {
        eventTypeId: personalTypeId,
        title: 'Chemistry Revision Session',
        startDate: '2026-09-12',
        location: 'School Library',
      });

      const exportResult = await calendarService.exportCalendar(context, {
        title: 'My Custom Term Calendar 2026',
        academicYear: '2026',
      });

      expect(exportResult.exportId).toBeDefined();
      expect(exportResult.exportType).toBe('PDF');
      expect(exportResult.status).toBe('COMPLETED');
      expect(exportResult.downloadUrl).toBeDefined();
      expect(exportResult.downloadUrl.length).toBeGreaterThan(10);
      expect(exportResult.eventCount).toBeGreaterThanOrEqual(1);

      // Verify retrieval of export
      const retrieved = await calendarService.getExport(context, exportResult.exportId);
      expect(retrieved.status).toBe('COMPLETED');
      expect(retrieved.downloadUrl).toBeDefined();
    });
  });
});
