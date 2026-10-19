-- Migration 0016: Analytics Architecture & Event Tracking

-- 1. Table: analytics.analytics_event_types
CREATE TABLE IF NOT EXISTS "analytics"."analytics_event_types" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(64) NOT NULL,
  "event_code" VARCHAR(32) NOT NULL,
  "description" TEXT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_analytics_event_types_status" CHECK (
    status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')
  ),
  CONSTRAINT "chk_analytics_event_types_code" CHECK (
    event_code ~ '^[a-z0-9_]{2,32}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_event_types_code" 
  ON "analytics"."analytics_event_types" ("event_code");
--> statement-breakpoint

-- 2. Seed default core platform event types
INSERT INTO "analytics"."analytics_event_types" ("name", "event_code", "description", "status")
VALUES
  ('Search Performed', 'search', 'Resource and curriculum search operations', 'ACTIVE'),
  ('Resource Viewed', 'view', 'Resource detail page visits and views', 'ACTIVE'),
  ('Resource Previewed', 'preview', 'Resource content previews before download', 'ACTIVE'),
  ('Resource Downloaded', 'download', 'Download URL generation and asset access', 'ACTIVE'),
  ('Resource Shared', 'share', 'Platform sharing actions', 'ACTIVE'),
  ('Resource Saved', 'save', 'Library bookmarking and saving actions', 'ACTIVE'),
  ('Feedback Submitted', 'feedback', 'Resource ratings and quality reports', 'ACTIVE'),
  ('Calendar Interaction', 'calendar_interaction', 'Academic calendar views and downloads', 'ACTIVE')
ON CONFLICT ("event_code") DO NOTHING;
--> statement-breakpoint

-- 3. Table: analytics.analytics_events
CREATE TABLE IF NOT EXISTS "analytics"."analytics_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type_id" UUID NOT NULL REFERENCES "analytics"."analytics_event_types"("id") ON DELETE RESTRICT,
  "actor_type" VARCHAR(20) NOT NULL DEFAULT 'ANONYMOUS',
  "user_id" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "anonymous_session_hash" VARCHAR(64) NULL,
  "idempotency_key" VARCHAR(128) NULL,
  "country_id" UUID NULL REFERENCES "platform"."countries"("id") ON DELETE SET NULL,
  "entity_type" VARCHAR(32) NULL,
  "entity_id" UUID NULL,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_analytics_events_actor_type" CHECK (
    actor_type IN ('AUTHENTICATED', 'ANONYMOUS', 'SYSTEM')
  ),
  CONSTRAINT "chk_analytics_events_actor" CHECK (
    (actor_type = 'AUTHENTICATED') OR
    (actor_type = 'ANONYMOUS' AND anonymous_session_hash IS NOT NULL) OR
    (actor_type = 'SYSTEM')
  ),
  CONSTRAINT "chk_analytics_events_context_size" CHECK (
    pg_column_size(context) <= 4096
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_events_idempotency" 
  ON "analytics"."analytics_events" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_events_window" 
  ON "analytics"."analytics_events" ("occurred_at" DESC, "event_type_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_events_country_window" 
  ON "analytics"."analytics_events" ("country_id", "occurred_at" DESC) 
  WHERE "country_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_events_actor_metrics" 
  ON "analytics"."analytics_events" ("occurred_at", "user_id", "anonymous_session_hash");
