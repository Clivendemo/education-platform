import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb, closeDatabase } from '../index.js';
import * as schemas from '../schemas.js';

export const DEFAULT_CALENDAR_EVENT_TYPES = [
  { name: 'Examination', slug: 'examination', description: 'National and institutional exams', displayOrder: 1 },
  { name: 'Holiday', slug: 'holiday', description: 'Public and school holidays', displayOrder: 2 },
  { name: 'School Opening', slug: 'school-opening', description: 'Term start and resumption dates', displayOrder: 3 },
  { name: 'Meeting', slug: 'meeting', description: 'Parent-teacher conferences and staff meetings', displayOrder: 4 },
  { name: 'Sports', slug: 'sports', description: 'Sports days and athletic competitions', displayOrder: 5 },
  { name: 'Academic', slug: 'academic', description: 'Academic symposiums and workshops', displayOrder: 6 },
  { name: 'Deadline', slug: 'deadline', description: 'Submission and registration deadlines', displayOrder: 7 },
  { name: 'Trip', slug: 'trip', description: 'Educational tours and excursions', displayOrder: 8 },
  { name: 'Training', slug: 'training', description: 'Teacher and student training sessions', displayOrder: 9 },
  { name: 'Personal', slug: 'personal', description: 'Private and personal study events', displayOrder: 10 },
  { name: 'Other', slug: 'other', description: 'General calendar events', displayOrder: 11 },
];

export async function setupCalendarSchema(db: NodePgDatabase<typeof schemas>): Promise<void> {
  // 1. Ensure schema exists
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "calendar"`);

  // 2. Create calendar.calendars table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendars" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(150) NOT NULL,
      "calendar_scope" VARCHAR(30) NOT NULL,
      "country_id" UUID REFERENCES "platform"."countries"("id"),
      "curriculum_id" UUID REFERENCES "taxonomy"."curricula"("id"),
      "education_level_id" UUID REFERENCES "taxonomy"."education_levels"("id"),
      "school_id" UUID REFERENCES "platform"."schools"("id"),
      "user_id" UUID REFERENCES "identity"."users"("id"),
      "session_id" VARCHAR(100),
      "academic_year" VARCHAR(20),
      "description" TEXT,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "expires_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "created_by" UUID,
      "updated_by" UUID,
      CONSTRAINT "chk_calendars_scope" CHECK ("calendar_scope" IN ('OFFICIAL', 'SCHOOL', 'USER', 'ANONYMOUS_SESSION')),
      CONSTRAINT "chk_calendars_official_owner" CHECK ("calendar_scope" != 'OFFICIAL' OR ("user_id" IS NULL AND "session_id" IS NULL)),
      CONSTRAINT "chk_calendars_school_owner" CHECK ("calendar_scope" != 'SCHOOL' OR "school_id" IS NOT NULL),
      CONSTRAINT "chk_calendars_user_owner" CHECK ("calendar_scope" != 'USER' OR "user_id" IS NOT NULL),
      CONSTRAINT "chk_calendars_anonymous_owner" CHECK ("calendar_scope" != 'ANONYMOUS_SESSION' OR ("session_id" IS NOT NULL AND "expires_at" IS NOT NULL)),
      CONSTRAINT "chk_calendars_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendars_scope_status" ON "calendar"."calendars" ("calendar_scope", "status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendars_user_id" ON "calendar"."calendars" ("user_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendars_session" ON "calendar"."calendars" ("session_id", "expires_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendars_country_year" ON "calendar"."calendars" ("country_id", "academic_year")`);

  // 3. Create calendar.calendar_event_types
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendar_event_types" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(100) NOT NULL,
      "slug" VARCHAR(100) NOT NULL UNIQUE,
      "description" TEXT,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "display_order" INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_calendar_event_types_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
    )
  `);

  // 4. Create calendar.calendar_recurrence_rules
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendar_recurrence_rules" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "frequency" VARCHAR(20) NOT NULL,
      "interval_value" INTEGER NOT NULL DEFAULT 1,
      "days_of_week" JSONB,
      "day_of_month" INTEGER,
      "month_of_year" INTEGER,
      "start_date" DATE NOT NULL,
      "end_date" DATE,
      "rule_definition" JSONB,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_calendar_recurrence_frequency" CHECK ("frequency" IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
      CONSTRAINT "chk_calendar_recurrence_interval" CHECK ("interval_value" > 0),
      CONSTRAINT "chk_calendar_recurrence_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
    )
  `);

  // 5. Create calendar.calendar_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendar_events" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "calendar_id" UUID NOT NULL REFERENCES "calendar"."calendars"("id") ON DELETE CASCADE,
      "event_type_id" UUID NOT NULL REFERENCES "calendar"."calendar_event_types"("id"),
      "title" VARCHAR(200) NOT NULL,
      "description" TEXT,
      "start_date" DATE NOT NULL,
      "end_date" DATE,
      "start_time" TIME,
      "end_time" TIME,
      "all_day" BOOLEAN NOT NULL DEFAULT true,
      "location" TEXT,
      "source_type" VARCHAR(20) NOT NULL DEFAULT 'USER',
      "source_id" UUID,
      "visibility" VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "recurrence_rule_id" UUID REFERENCES "calendar"."calendar_recurrence_rules"("id"),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "created_by" UUID,
      "updated_by" UUID,
      CONSTRAINT "chk_calendar_events_date_order" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
      CONSTRAINT "chk_calendar_events_time_order" CHECK ("start_time" IS NULL OR "end_time" IS NULL OR "end_time" >= "start_time"),
      CONSTRAINT "chk_calendar_events_source_type" CHECK ("source_type" IN ('OFFICIAL', 'SCHOOL', 'USER', 'IMPORTED', 'SYSTEM')),
      CONSTRAINT "chk_calendar_events_visibility" CHECK ("visibility" IN ('PUBLIC', 'PRIVATE', 'SCHOOL')),
      CONSTRAINT "chk_calendar_events_status" CHECK ("status" IN ('ACTIVE', 'CANCELLED'))
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendar_events_calendar_date" ON "calendar"."calendar_events" ("calendar_id", "start_date")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendar_events_type" ON "calendar"."calendar_events" ("event_type_id")`);

  // 6. Create calendar.calendar_exports
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendar_exports" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "calendar_id" UUID NOT NULL REFERENCES "calendar"."calendars"("id") ON DELETE CASCADE,
      "export_type" VARCHAR(20) NOT NULL DEFAULT 'PDF',
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      "storage_key" TEXT,
      "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "completed_at" TIMESTAMPTZ,
      "expires_at" TIMESTAMPTZ,
      "error_message" TEXT,
      CONSTRAINT "chk_calendar_exports_type" CHECK ("export_type" IN ('PDF', 'ICS', 'XLSX', 'CSV')),
      CONSTRAINT "chk_calendar_exports_status" CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED'))
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_calendar_exports_calendar" ON "calendar"."calendar_exports" ("calendar_id")`);

  // 7. Create calendar.calendar_templates
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "calendar"."calendar_templates" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(100) NOT NULL,
      "description" TEXT,
      "template_type" VARCHAR(50) NOT NULL,
      "layout_config" JSONB NOT NULL DEFAULT '{}',
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_calendar_templates_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
    )
  `);

  // 8. Seed default event types
  for (const item of DEFAULT_CALENDAR_EVENT_TYPES) {
    await db.execute(sql`
      INSERT INTO "calendar"."calendar_event_types" ("id", "name", "slug", "description", "status", "display_order")
      VALUES (gen_random_uuid(), ${item.name}, ${item.slug}, ${item.description}, 'ACTIVE', ${item.displayOrder})
      ON CONFLICT ("slug") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "display_order" = EXCLUDED."display_order"
    `);
  }
}

// Allow direct execution via tsx
if (process.argv[1]?.endsWith('calendar-setup.ts')) {
  const db = getDb();
  setupCalendarSchema(db)
    .then(async () => {
      console.log('Calendar schema and default event types initialized successfully.');
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Error setting up calendar schema:', err);
      await closeDatabase();
      process.exit(1);
    });
}
