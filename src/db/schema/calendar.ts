import { sql } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  integer,
  boolean,
  date,
  time,
  timestamp,
  jsonb,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { calendarSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { curricula, educationLevels } from './curriculum.js';
import { schools } from './schools.js';
import { users } from './identity.js';

/**
 * 32.1 calendar.calendars
 * Defines calendar containers supporting 4 scopes:
 * - OFFICIAL: Platform/country-wide public dates (no user_id or session_id)
 * - SCHOOL: Institutional academic dates (bound to school_id)
 * - USER: Persistent authenticated user dates (bound to user_id)
 * - ANONYMOUS_SESSION: Temporary, expiring dates (bound to session_id & expires_at)
 */
export const calendars = calendarSchema.table(
  'calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull(),
    calendarScope: varchar('calendar_scope', { length: 30 }).notNull(),
    countryId: uuid('country_id').references(() => countries.id),
    curriculumId: uuid('curriculum_id').references(() => curricula.id),
    educationLevelId: uuid('education_level_id').references(
      () => educationLevels.id,
    ),
    schoolId: uuid('school_id').references(() => schools.id),
    userId: uuid('user_id').references(() => users.id),
    sessionId: varchar('session_id', { length: 100 }),
    academicYear: varchar('academic_year', { length: 20 }),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    check(
      'chk_calendars_scope',
      sql`${table.calendarScope} IN ('OFFICIAL', 'SCHOOL', 'USER', 'ANONYMOUS_SESSION')`,
    ),
    check(
      'chk_calendars_official_owner',
      sql`${table.calendarScope} != 'OFFICIAL' OR (${table.userId} IS NULL AND ${table.sessionId} IS NULL)`,
    ),
    check(
      'chk_calendars_school_owner',
      sql`${table.calendarScope} != 'SCHOOL' OR ${table.schoolId} IS NOT NULL`,
    ),
    check(
      'chk_calendars_user_owner',
      sql`${table.calendarScope} != 'USER' OR ${table.userId} IS NOT NULL`,
    ),
    check(
      'chk_calendars_anonymous_owner',
      sql`${table.calendarScope} != 'ANONYMOUS_SESSION' OR (${table.sessionId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`,
    ),
    check(
      'chk_calendars_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`,
    ),
    index('idx_calendars_scope_status').on(table.calendarScope, table.status),
    index('idx_calendars_user_id').on(table.userId),
    index('idx_calendars_session').on(table.sessionId, table.expiresAt),
    index('idx_calendars_country_year').on(table.countryId, table.academicYear),
  ],
);

/**
 * 33. calendar.calendar_event_types
 * Configurable category registry for calendar events.
 */
export const calendarEventTypes = calendarSchema.table(
  'calendar_event_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_calendar_event_types_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

/**
 * 35. calendar.calendar_recurrence_rules
 * Structural definition of repeating calendar event occurrences.
 */
export const calendarRecurrenceRules = calendarSchema.table(
  'calendar_recurrence_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    frequency: varchar('frequency', { length: 20 }).notNull(),
    intervalValue: integer('interval_value').notNull().default(1),
    daysOfWeek: jsonb('days_of_week'),
    dayOfMonth: integer('day_of_month'),
    monthOfYear: integer('month_of_year'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    ruleDefinition: jsonb('rule_definition'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_calendar_recurrence_frequency',
      sql`${table.frequency} IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')`,
    ),
    check(
      'chk_calendar_recurrence_interval',
      sql`${table.intervalValue} > 0`,
    ),
    check(
      'chk_calendar_recurrence_dates',
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

/**
 * 34. calendar.calendar_events
 * Scheduled events belonging to a calendar container.
 */
export const calendarEvents = calendarSchema.table(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => calendarEventTypes.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    allDay: boolean('all_day').notNull().default(true),
    location: text('location'),
    sourceType: varchar('source_type', { length: 20 })
      .notNull()
      .default('USER'),
    sourceId: uuid('source_id'),
    visibility: varchar('visibility', { length: 20 })
      .notNull()
      .default('PUBLIC'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    recurrenceRuleId: uuid('recurrence_rule_id').references(
      () => calendarRecurrenceRules.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    check(
      'chk_calendar_events_date_order',
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'chk_calendar_events_time_order',
      sql`${table.startTime} IS NULL OR ${table.endTime} IS NULL OR ${table.endTime} >= ${table.startTime}`,
    ),
    check(
      'chk_calendar_events_source_type',
      sql`${table.sourceType} IN ('OFFICIAL', 'SCHOOL', 'USER', 'IMPORTED', 'SYSTEM')`,
    ),
    check(
      'chk_calendar_events_visibility',
      sql`${table.visibility} IN ('PUBLIC', 'PRIVATE', 'SCHOOL')`,
    ),
    check(
      'chk_calendar_events_status',
      sql`${table.status} IN ('ACTIVE', 'CANCELLED')`,
    ),
    index('idx_calendar_events_calendar_date').on(
      table.calendarId,
      table.startDate,
    ),
    index('idx_calendar_events_type').on(table.eventTypeId),
  ],
);

/**
 * 36. calendar.calendar_exports
 * Tracks exported calendar documents.
 * NOTE (Correction 1): Does NOT reference files.resource_files, uses its own storageKey lifecycle.
 */
export const calendarExports = calendarSchema.table(
  'calendar_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    exportType: varchar('export_type', { length: 20 })
      .notNull()
      .default('PDF'),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    storageKey: text('storage_key'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    errorMessage: text('error_message'),
  },
  (table) => [
    check(
      'chk_calendar_exports_type',
      sql`${table.exportType} IN ('PDF', 'ICS', 'XLSX', 'CSV')`,
    ),
    check(
      'chk_calendar_exports_status',
      sql`${table.status} IN ('PENDING', 'COMPLETED', 'FAILED')`,
    ),
    index('idx_calendar_exports_calendar').on(table.calendarId),
  ],
);

/**
 * 37. calendar.calendar_templates
 * Configurable templates for calendar layouts.
 */
export const calendarTemplates = calendarSchema.table(
  'calendar_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    templateType: varchar('template_type', { length: 50 }).notNull(),
    layoutConfig: jsonb('layout_config').notNull().default('{}'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_calendar_templates_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);
