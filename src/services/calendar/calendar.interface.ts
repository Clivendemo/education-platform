export type CalendarScope =
  | 'OFFICIAL'
  | 'SCHOOL'
  | 'USER'
  | 'ANONYMOUS_SESSION';

export type EventSourceType =
  | 'OFFICIAL'
  | 'SCHOOL'
  | 'USER'
  | 'IMPORTED'
  | 'SYSTEM';

export type CalendarStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type CalendarEventStatus = 'ACTIVE' | 'CANCELLED';

export interface CalendarOwnershipContext {
  userId?: string;
  sessionId?: string;
  isAuthenticated: boolean;
}

export interface CalendarEventItem {
  id: string;
  calendarId: string;
  eventTypeId: string;
  eventTypeName: string;
  eventTypeSlug: string;
  title: string;
  description: string | null;
  startDate: string; // ISO format: YYYY-MM-DD
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  sourceType: EventSourceType;
  sourceId: string | null;
  visibility: string;
  status: CalendarEventStatus;
  isReadOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarContainer {
  id: string;
  name: string;
  calendarScope: CalendarScope;
  academicYear: string | null;
  countryId: string | null;
  curriculumId: string | null;
  educationLevelId: string | null;
  schoolId: string | null;
  userId: string | null;
  sessionId: string | null;
  status: CalendarStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarView {
  calendar: CalendarContainer;
  officialEvents: CalendarEventItem[];
  personalEvents: CalendarEventItem[];
  events: CalendarEventItem[]; // merged timeline sorted chronologically
}

export interface CreateEventInput {
  calendarId?: string; // Optional: resolves to user/session calendar if omitted
  eventTypeId: string;
  title: string;
  description?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
}

export interface UpdateEventInput {
  eventTypeId?: string;
  title?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
  status?: CalendarEventStatus;
}

export interface CalendarFilterOptions {
  startDate?: string;
  endDate?: string;
  academicYear?: string;
  countryId?: string;
  eventTypeId?: string;
}

export interface ExportCalendarOptions {
  format?: 'PDF';
  title?: string;
  startDate?: string;
  endDate?: string;
  academicYear?: string;
  countryId?: string;
}

export interface ExportCalendarResult {
  exportId: string;
  calendarId: string;
  exportType: 'PDF';
  status: 'COMPLETED' | 'FAILED';
  downloadUrl: string;
  expiresAt: Date | null;
  eventCount: number;
}

/**
 * Domain error classes
 */
export class CalendarError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}

export class CalendarNotFoundError extends CalendarError {
  constructor(message = 'Calendar not found') {
    super(message, 'CALENDAR_NOT_FOUND', 404);
    this.name = 'CalendarNotFoundError';
  }
}

export class CalendarEventNotFoundError extends CalendarError {
  constructor(message = 'Calendar event not found') {
    super(message, 'EVENT_NOT_FOUND', 404);
    this.name = 'CalendarEventNotFoundError';
  }
}

export class UnauthorizedCalendarAccessError extends CalendarError {
  constructor(message = 'You do not have permission to access or modify this calendar') {
    super(message, 'UNAUTHORIZED_CALENDAR_ACCESS', 403);
    this.name = 'UnauthorizedCalendarAccessError';
  }
}

export class OfficialCalendarModificationError extends CalendarError {
  constructor(message = 'Official calendar events cannot be modified through personal event endpoints') {
    super(message, 'OFFICIAL_CALENDAR_MODIFICATION_PROHIBITED', 403);
    this.name = 'OfficialCalendarModificationError';
  }
}

export class ExpiredSessionError extends CalendarError {
  constructor(message = 'The anonymous calendar session has expired') {
    super(message, 'CALENDAR_SESSION_EXPIRED', 410);
    this.name = 'ExpiredSessionError';
  }
}

export class InvalidEventDateError extends CalendarError {
  constructor(message = 'Invalid calendar event date or time values') {
    super(message, 'INVALID_EVENT_DATE', 400);
    this.name = 'InvalidEventDateError';
  }
}
