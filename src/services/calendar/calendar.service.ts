import { eq, and, gte, lte, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../../db/index.js';
import * as schemas from '../../db/schemas.js';
import {
  calendars,
  calendarEvents,
  calendarEventTypes,
  calendarExports,
} from '../../db/schema/calendar.js';
import { countries } from '../../db/schema/geography.js';
import type { StorageProvider } from '../storage/storage-provider.interface.js';
import { MemoryStorageProvider } from '../storage/memory-storage-provider.js';
import type { CalendarExportProvider } from './export/calendar-export-provider.interface.js';
import { PdfCalendarExportProvider } from './export/pdf-calendar-export-provider.js';
import {
  type CalendarOwnershipContext,
  type CalendarContainer,
  type CalendarEventItem,
  type CalendarView,
  type CreateEventInput,
  type UpdateEventInput,
  type CalendarFilterOptions,
  type ExportCalendarOptions,
  type ExportCalendarResult,
  CalendarNotFoundError,
  CalendarEventNotFoundError,
  UnauthorizedCalendarAccessError,
  OfficialCalendarModificationError,
  ExpiredSessionError,
  InvalidEventDateError,
} from './calendar.interface.js';

const ANONYMOUS_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days rolling TTL
const EXPORT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours TTL for generated export download

export interface CalendarServiceOptions {
  db?: NodePgDatabase<typeof schemas>;
  storageProvider?: StorageProvider;
  pdfExportProvider?: CalendarExportProvider;
}

export class CalendarService {
  private readonly db: NodePgDatabase<typeof schemas>;
  private readonly storageProvider: StorageProvider;
  private readonly pdfExportProvider: CalendarExportProvider;

  constructor(options: CalendarServiceOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.storageProvider = options.storageProvider ?? new MemoryStorageProvider();
    this.pdfExportProvider = options.pdfExportProvider ?? new PdfCalendarExportProvider();
  }

  /**
   * Retrieves all active calendar event types ordered by displayOrder.
   */
  async getEventTypes() {
    return this.db
      .select()
      .from(calendarEventTypes)
      .where(eq(calendarEventTypes.status, 'ACTIVE'))
      .orderBy(asc(calendarEventTypes.displayOrder), asc(calendarEventTypes.name));
  }

  /**
   * Retrieves or creates an active anonymous calendar session with a 7-day rolling TTL.
   */
  async getOrCreateAnonymousCalendar(sessionId: string): Promise<CalendarContainer> {
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + ANONYMOUS_SESSION_TTL_MS);

    // Look for existing session calendar
    const [existing] = await this.db
      .select()
      .from(calendars)
      .where(
        and(
          eq(calendars.sessionId, sessionId),
          eq(calendars.calendarScope, 'ANONYMOUS_SESSION'),
        ),
      )
      .limit(1);

    if (existing) {
      // If already expired, return fresh rolling calendar or throw if strict
      if (existing.expiresAt && existing.expiresAt <= now) {
        // Expired session: re-initialize cleanly
        const [renewed] = await this.db
          .update(calendars)
          .set({
            name: 'My Personal Calendar',
            status: 'ACTIVE',
            expiresAt: newExpiresAt,
            updatedAt: now,
          })
          .where(eq(calendars.id, existing.id))
          .returning();
        return this.mapCalendarContainer(renewed);
      }

      // Touch active session with rolling TTL
      const [updated] = await this.db
        .update(calendars)
        .set({
          expiresAt: newExpiresAt,
          updatedAt: now,
        })
        .where(eq(calendars.id, existing.id))
        .returning();
      return this.mapCalendarContainer(updated);
    }

    // Create new anonymous calendar
    const [created] = await this.db
      .insert(calendars)
      .values({
        name: 'My Personal Calendar',
        calendarScope: 'ANONYMOUS_SESSION',
        sessionId,
        status: 'ACTIVE',
        expiresAt: newExpiresAt,
      })
      .returning();

    return this.mapCalendarContainer(created);
  }

  /**
   * Retrieves or creates an authenticated user's primary personal calendar.
   */
  async getOrCreateUserCalendar(userId: string): Promise<CalendarContainer> {
    const [existing] = await this.db
      .select()
      .from(calendars)
      .where(
        and(
          eq(calendars.userId, userId),
          eq(calendars.calendarScope, 'USER'),
        ),
      )
      .limit(1);

    if (existing) {
      return this.mapCalendarContainer(existing);
    }

    const [created] = await this.db
      .insert(calendars)
      .values({
        name: 'My Personal Calendar',
        calendarScope: 'USER',
        userId,
        status: 'ACTIVE',
      })
      .returning();

    return this.mapCalendarContainer(created);
  }

  /**
   * Retrieves official calendar events, optionally filtered by country or academic year.
   */
  async getOfficialCalendar(
    countryId?: string,
    academicYear?: string,
  ): Promise<{ calendar: CalendarContainer | null; events: CalendarEventItem[] }> {
    // 1. Fetch official calendar
    const conditions = [
      eq(calendars.calendarScope, 'OFFICIAL'),
      eq(calendars.status, 'ACTIVE'),
    ];
    if (countryId) conditions.push(eq(calendars.countryId, countryId));
    if (academicYear) conditions.push(eq(calendars.academicYear, academicYear));

    const [officialCal] = await this.db
      .select()
      .from(calendars)
      .where(and(...conditions))
      .limit(1);

    if (!officialCal) {
      // Check for global official calendar if country-specific wasn't found
      const [globalCal] = await this.db
        .select()
        .from(calendars)
        .where(
          and(
            eq(calendars.calendarScope, 'OFFICIAL'),
            eq(calendars.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (!globalCal) {
        return { calendar: null, events: [] };
      }

      const events = await this.getEventsForCalendar(globalCal.id);
      return {
        calendar: this.mapCalendarContainer(globalCal),
        events,
      };
    }

    const events = await this.getEventsForCalendar(officialCal.id);
    return {
      calendar: this.mapCalendarContainer(officialCal),
      events,
    };
  }

  /**
   * Retrieves combined calendar view (Official Events + Personal Events).
   */
  async getCombinedCalendar(
    context: CalendarOwnershipContext,
    filters: CalendarFilterOptions = {},
  ): Promise<CalendarView> {
    // 1. Resolve personal calendar container
    let personalCalendar: CalendarContainer;
    if (context.isAuthenticated && context.userId) {
      personalCalendar = await this.getOrCreateUserCalendar(context.userId);
    } else if (context.sessionId) {
      personalCalendar = await this.getOrCreateAnonymousCalendar(context.sessionId);
    } else {
      // Virtual anonymous preview without session
      personalCalendar = {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Public Academic Calendar',
        calendarScope: 'OFFICIAL',
        academicYear: filters.academicYear ?? null,
        countryId: filters.countryId ?? null,
        curriculumId: null,
        educationLevelId: null,
        schoolId: null,
        userId: null,
        sessionId: null,
        status: 'ACTIVE',
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // 2. Fetch Official events
    const { calendar: officialCalContainer, events: rawOfficialEvents } =
      await this.getOfficialCalendar(filters.countryId, filters.academicYear);

    // If viewing public official preview without session, adopt official calendar container if available
    if (
      !context.isAuthenticated &&
      !context.sessionId &&
      officialCalContainer &&
      personalCalendar.id === '00000000-0000-0000-0000-000000000000'
    ) {
      personalCalendar = officialCalContainer;
    }

    // 3. Fetch Personal events (if applicable)
    let rawPersonalEvents: CalendarEventItem[] = [];
    if (personalCalendar.id !== '00000000-0000-0000-0000-000000000000') {
      rawPersonalEvents = await this.getEventsForCalendar(personalCalendar.id, filters);
    }

    // Filter official events by date if provided
    let officialEvents = rawOfficialEvents;
    if (filters.startDate) {
      officialEvents = officialEvents.filter((e) => (e.endDate || e.startDate) >= filters.startDate!);
    }
    if (filters.endDate) {
      officialEvents = officialEvents.filter((e) => e.startDate <= filters.endDate!);
    }
    if (filters.eventTypeId) {
      officialEvents = officialEvents.filter((e) => e.eventTypeId === filters.eventTypeId);
    }

    // 4. Merge timeline
    const allEvents = [...officialEvents, ...rawPersonalEvents];
    allEvents.sort((a, b) => {
      const cmpDate = a.startDate.localeCompare(b.startDate);
      if (cmpDate !== 0) return cmpDate;
      const timeA = a.startTime || '00:00:00';
      const timeB = b.startTime || '00:00:00';
      return timeA.localeCompare(timeB);
    });

    return {
      calendar: personalCalendar,
      officialEvents,
      personalEvents: rawPersonalEvents,
      events: allEvents,
    };
  }

  /**
   * Creates a personal event on the requester's calendar.
   */
  async createEvent(
    context: CalendarOwnershipContext,
    input: CreateEventInput,
  ): Promise<CalendarEventItem> {
    this.validateEventDates(input.startDate, input.endDate, input.startTime, input.endTime);

    // 1. Resolve and authorize target calendar
    const calendar = await this.resolveAndAuthorizeCalendar(context, input.calendarId);

    if (calendar.calendarScope === 'OFFICIAL') {
      throw new OfficialCalendarModificationError();
    }

    // 2. Insert event
    const [created] = await this.db
      .insert(calendarEvents)
      .values({
        calendarId: calendar.id,
        eventTypeId: input.eventTypeId,
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        startTime: input.startTime,
        endTime: input.endTime,
        allDay: input.allDay ?? true,
        location: input.location,
        sourceType: 'USER',
        status: 'ACTIVE',
        createdBy: context.userId ?? null,
      })
      .returning();

    return this.getEventById(created.id);
  }

  /**
   * Updates an existing personal event on the requester's calendar.
   */
  async updateEvent(
    context: CalendarOwnershipContext,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<CalendarEventItem> {
    const event = await this.getEventById(eventId);
    const calendar = await this.resolveAndAuthorizeCalendar(context, event.calendarId);

    if (calendar.calendarScope === 'OFFICIAL' || event.sourceType === 'OFFICIAL') {
      throw new OfficialCalendarModificationError();
    }

    const startDate = input.startDate ?? event.startDate;
    const endDate = input.endDate !== undefined ? input.endDate : event.endDate;
    const startTime = input.startTime !== undefined ? input.startTime : event.startTime;
    const endTime = input.endTime !== undefined ? input.endTime : event.endTime;

    this.validateEventDates(startDate, endDate, startTime, endTime);

    const [updated] = await this.db
      .update(calendarEvents)
      .set({
        eventTypeId: input.eventTypeId ?? event.eventTypeId,
        title: input.title ?? event.title,
        description: input.description !== undefined ? input.description : event.description,
        startDate,
        endDate,
        startTime,
        endTime,
        allDay: input.allDay !== undefined ? input.allDay : event.allDay,
        location: input.location !== undefined ? input.location : event.location,
        status: input.status ?? event.status,
        updatedAt: new Date(),
        updatedBy: context.userId ?? null,
      })
      .where(eq(calendarEvents.id, eventId))
      .returning();

    return this.getEventById(updated.id);
  }

  /**
   * Deletes a personal event from the requester's calendar.
   */
  async deleteEvent(context: CalendarOwnershipContext, eventId: string): Promise<void> {
    const event = await this.getEventById(eventId);
    const calendar = await this.resolveAndAuthorizeCalendar(context, event.calendarId);

    if (calendar.calendarScope === 'OFFICIAL' || event.sourceType === 'OFFICIAL') {
      throw new OfficialCalendarModificationError();
    }

    await this.db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
  }

  /**
   * Atomically transfers an anonymous session calendar and all its events to an authenticated user.
   */
  async transferAnonymousSession(
    userId: string,
    sessionId: string,
  ): Promise<{ transferredCalendarId: string; eventCount: number }> {
    const now = new Date();

    // 1. Locate anonymous calendar
    const [anonCal] = await this.db
      .select()
      .from(calendars)
      .where(
        and(
          eq(calendars.sessionId, sessionId),
          eq(calendars.calendarScope, 'ANONYMOUS_SESSION'),
        ),
      )
      .limit(1);

    if (!anonCal) {
      throw new CalendarNotFoundError('Anonymous calendar session not found');
    }

    if (anonCal.expiresAt && anonCal.expiresAt <= now) {
      throw new ExpiredSessionError();
    }

    // 2. Fetch target user calendar
    const userCal = await this.getOrCreateUserCalendar(userId);

    // 3. Move all events from anonymous calendar to user calendar
    const eventsToMove = await this.db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, anonCal.id));

    if (eventsToMove.length > 0) {
      await this.db
        .update(calendarEvents)
        .set({
          calendarId: userCal.id,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(calendarEvents.calendarId, anonCal.id));
    }

    // 4. Clean up / mark anonymous calendar as archived
    await this.db
      .update(calendars)
      .set({
        status: 'ARCHIVED',
        updatedAt: now,
      })
      .where(eq(calendars.id, anonCal.id));

    return {
      transferredCalendarId: userCal.id,
      eventCount: eventsToMove.length,
    };
  }

  /**
   * Generates a snapshot export of the authorized calendar view as PDF.
   */
  async exportCalendar(
    context: CalendarOwnershipContext,
    options: ExportCalendarOptions = {},
  ): Promise<ExportCalendarResult> {
    // 1. Snapshot authorized combined calendar view
    const view = await this.getCombinedCalendar(context, {
      startDate: options.startDate,
      endDate: options.endDate,
      academicYear: options.academicYear,
      countryId: options.countryId,
    });

    // Resolve country name if countryId is present
    let countryName: string | null = null;
    if (options.countryId || view.calendar.countryId) {
      const cId = options.countryId || view.calendar.countryId;
      const [c] = await this.db
        .select({ name: countries.name })
        .from(countries)
        .where(eq(countries.id, cId!))
        .limit(1);
      if (c) countryName = c.name;
    }

    // 2. Generate PDF document using provider
    const exportResult = await this.pdfExportProvider.exportCalendar({
      calendar: view.calendar,
      events: view.events,
      title: options.title,
      academicYear: options.academicYear || view.calendar.academicYear,
      countryName,
      requesterContext: context,
    });

    // 3. Save export binary to StorageProvider
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_EXPIRY_MS);
    const storageKey = `calendar-exports/${view.calendar.id}/${Date.now()}-${exportResult.filename}`;

    await this.storageProvider.putObject({
      key: storageKey,
      body: exportResult.buffer,
      contentType: exportResult.contentType,
      metadata: exportResult.metadata,
    });

    // 4. Generate signed download URL
    const downloadUrl = await this.storageProvider.getSignedDownloadUrl(storageKey, {
      expiresInSeconds: 86400, // 24 hours
      responseContentType: exportResult.contentType,
      responseContentDisposition: `attachment; filename="${exportResult.filename}"`,
    });

    // 5. Persist export record (NOTE: no files.resource_files FK per correction)
    let targetCalendarId = view.calendar.id;
    if (targetCalendarId === '00000000-0000-0000-0000-000000000000') {
      const { calendar: officialCal } = await this.getOfficialCalendar(
        options.countryId,
        options.academicYear,
      );
      if (officialCal) {
        targetCalendarId = officialCal.id;
      } else {
        const anonCal = await this.getOrCreateAnonymousCalendar(
          context.sessionId || `export-session-${Date.now()}`,
        );
        targetCalendarId = anonCal.id;
      }
    }

    const [exportRecord] = await this.db
      .insert(calendarExports)
      .values({
        calendarId: targetCalendarId,
        exportType: 'PDF',
        status: 'COMPLETED',
        storageKey,
        requestedAt: now,
        completedAt: now,
        expiresAt,
      })
      .returning();

    return {
      exportId: exportRecord.id,
      calendarId: view.calendar.id,
      exportType: 'PDF',
      status: 'COMPLETED',
      downloadUrl,
      expiresAt,
      eventCount: view.events.length,
    };
  }

  /**
   * Retrieves an export record and its download URL if authorized.
   */
  async getExport(
    context: CalendarOwnershipContext,
    exportId: string,
  ): Promise<ExportCalendarResult> {
    const [rec] = await this.db
      .select()
      .from(calendarExports)
      .where(eq(calendarExports.id, exportId))
      .limit(1);

    if (!rec) {
      throw new CalendarNotFoundError('Export not found');
    }

    // Authorize requester against export's calendar
    const calendar = await this.resolveAndAuthorizeCalendar(context, rec.calendarId);

    if (rec.expiresAt && rec.expiresAt <= new Date()) {
      throw new ExpiredSessionError('This calendar export has expired');
    }

    let downloadUrl = '';
    if (rec.storageKey) {
      downloadUrl = await this.storageProvider.getSignedDownloadUrl(rec.storageKey, {
        expiresInSeconds: 3600,
        responseContentType: 'application/pdf',
        responseContentDisposition: 'attachment; filename="calendar.pdf"',
      });
    }

    return {
      exportId: rec.id,
      calendarId: calendar.id,
      exportType: 'PDF',
      status: rec.status as any,
      downloadUrl,
      expiresAt: rec.expiresAt,
      eventCount: 0,
    };
  }

  /**
   * Internal helpers
   */
  private async resolveAndAuthorizeCalendar(
    context: CalendarOwnershipContext,
    explicitCalendarId?: string,
  ): Promise<CalendarContainer> {
    const now = new Date();

    if (explicitCalendarId) {
      const [cal] = await this.db
        .select()
        .from(calendars)
        .where(eq(calendars.id, explicitCalendarId))
        .limit(1);

      if (!cal) {
        throw new CalendarNotFoundError();
      }

      // Check ownership
      if (cal.calendarScope === 'USER') {
        if (!context.isAuthenticated || cal.userId !== context.userId) {
          throw new UnauthorizedCalendarAccessError();
        }
      } else if (cal.calendarScope === 'ANONYMOUS_SESSION') {
        if (!context.sessionId || cal.sessionId !== context.sessionId) {
          throw new UnauthorizedCalendarAccessError();
        }
        if (cal.expiresAt && cal.expiresAt <= now) {
          throw new ExpiredSessionError();
        }
      }

      return this.mapCalendarContainer(cal);
    }

    // Fallback: resolve user calendar if authenticated, or session calendar if anonymous
    if (context.isAuthenticated && context.userId) {
      return this.getOrCreateUserCalendar(context.userId);
    }

    if (context.sessionId) {
      return this.getOrCreateAnonymousCalendar(context.sessionId);
    }

    throw new UnauthorizedCalendarAccessError('Calendar context required');
  }

  private async getEventById(eventId: string): Promise<CalendarEventItem> {
    const [row] = await this.db
      .select({
        event: calendarEvents,
        eventType: calendarEventTypes,
      })
      .from(calendarEvents)
      .innerJoin(
        calendarEventTypes,
        eq(calendarEvents.eventTypeId, calendarEventTypes.id),
      )
      .where(eq(calendarEvents.id, eventId))
      .limit(1);

    if (!row) {
      throw new CalendarEventNotFoundError();
    }

    return {
      id: row.event.id,
      calendarId: row.event.calendarId,
      eventTypeId: row.event.eventTypeId,
      eventTypeName: row.eventType.name,
      eventTypeSlug: row.eventType.slug,
      title: row.event.title,
      description: row.event.description,
      startDate: row.event.startDate,
      endDate: row.event.endDate,
      startTime: row.event.startTime,
      endTime: row.event.endTime,
      allDay: row.event.allDay,
      location: row.event.location,
      sourceType: row.event.sourceType as any,
      sourceId: row.event.sourceId,
      visibility: row.event.visibility,
      status: row.event.status as any,
      isReadOnly: row.event.sourceType === 'OFFICIAL',
      createdAt: row.event.createdAt,
      updatedAt: row.event.updatedAt,
    };
  }

  private async getEventsForCalendar(
    calendarId: string,
    filters: CalendarFilterOptions = {},
  ): Promise<CalendarEventItem[]> {
    const conditions = [
      eq(calendarEvents.calendarId, calendarId),
      eq(calendarEvents.status, 'ACTIVE'),
    ];

    if (filters.startDate) {
      conditions.push(gte(calendarEvents.startDate, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(calendarEvents.startDate, filters.endDate));
    }
    if (filters.eventTypeId) {
      conditions.push(eq(calendarEvents.eventTypeId, filters.eventTypeId));
    }

    const rows = await this.db
      .select({
        event: calendarEvents,
        eventType: calendarEventTypes,
      })
      .from(calendarEvents)
      .innerJoin(
        calendarEventTypes,
        eq(calendarEvents.eventTypeId, calendarEventTypes.id),
      )
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.startDate), asc(calendarEvents.startTime));

    return rows.map((r) => ({
      id: r.event.id,
      calendarId: r.event.calendarId,
      eventTypeId: r.event.eventTypeId,
      eventTypeName: r.eventType.name,
      eventTypeSlug: r.eventType.slug,
      title: r.event.title,
      description: r.event.description,
      startDate: r.event.startDate,
      endDate: r.event.endDate,
      startTime: r.event.startTime,
      endTime: r.event.endTime,
      allDay: r.event.allDay,
      location: r.event.location,
      sourceType: r.event.sourceType as any,
      sourceId: r.event.sourceId,
      visibility: r.event.visibility,
      status: r.event.status as any,
      isReadOnly: r.event.sourceType === 'OFFICIAL',
      createdAt: r.event.createdAt,
      updatedAt: r.event.updatedAt,
    }));
  }

  private validateEventDates(
    startDate: string,
    endDate?: string | null,
    startTime?: string | null,
    endTime?: string | null,
  ) {
    if (endDate && endDate < startDate) {
      throw new InvalidEventDateError('Event end_date must be greater than or equal to start_date');
    }

    if (startDate === endDate && startTime && endTime && endTime < startTime) {
      throw new InvalidEventDateError('Event end_time cannot precede start_time for the same day');
    }
  }

  private mapCalendarContainer(row: typeof calendars.$inferSelect): CalendarContainer {
    return {
      id: row.id,
      name: row.name,
      calendarScope: row.calendarScope as any,
      academicYear: row.academicYear,
      countryId: row.countryId,
      curriculumId: row.curriculumId,
      educationLevelId: row.educationLevelId,
      schoolId: row.schoolId,
      userId: row.userId,
      sessionId: row.sessionId,
      status: row.status as any,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const defaultCalendarService = new CalendarService();
