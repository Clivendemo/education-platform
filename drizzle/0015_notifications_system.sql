-- Migration 0015: Notifications System Architecture

-- 1. Table: identity.notifications
CREATE TABLE IF NOT EXISTS "identity"."notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "category" VARCHAR(32) NOT NULL,
  "notification_type" VARCHAR(64) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "message" TEXT NOT NULL,
  "entity_type" VARCHAR(64) NULL,
  "entity_id" UUID NULL,
  "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  "status" VARCHAR(20) NOT NULL DEFAULT 'UNREAD',
  "deduplication_key" VARCHAR(128) NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "read_at" TIMESTAMPTZ NULL,
  "archived_at" TIMESTAMPTZ NULL,
  CONSTRAINT "chk_notifications_category" CHECK (
    category IN ('TRANSACTIONAL', 'SECURITY', 'EDITORIAL', 'CONTRIBUTOR', 'CURRICULUM_UPDATE', 'MARKETING')
  ),
  CONSTRAINT "chk_notifications_priority" CHECK (
    priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')
  ),
  CONSTRAINT "chk_notifications_status" CHECK (
    status IN ('UNREAD', 'READ', 'ARCHIVED')
  ),
  CONSTRAINT "chk_notifications_lifecycle" CHECK (
    (status = 'UNREAD' AND read_at IS NULL AND archived_at IS NULL) OR
    (status = 'READ' AND read_at IS NOT NULL AND archived_at IS NULL) OR
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT "chk_notifications_title_len" CHECK (
    length(trim(title)) > 0 AND length(title) <= 255
  ),
  CONSTRAINT "chk_notifications_msg_len" CHECK (
    length(trim(message)) > 0 AND length(message) <= 5000
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_inbox" ON "identity"."notifications" ("user_id", "status", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_user_dedup" ON "identity"."notifications" ("user_id", "deduplication_key") WHERE "deduplication_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_entity" ON "identity"."notifications" ("entity_type", "entity_id");
--> statement-breakpoint

-- 2. Table: identity.notification_deliveries
CREATE TABLE IF NOT EXISTS "identity"."notification_deliveries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL REFERENCES "identity"."notifications"("id") ON DELETE CASCADE,
  "channel" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "provider" VARCHAR(64) NULL,
  "provider_reference" VARCHAR(255) NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_retry_at" TIMESTAMPTZ NULL DEFAULT now(),
  "locked_at" TIMESTAMPTZ NULL,
  "locked_by" VARCHAR(64) NULL,
  "sent_at" TIMESTAMPTZ NULL,
  "delivered_at" TIMESTAMPTZ NULL,
  "failed_at" TIMESTAMPTZ NULL,
  "error_message" TEXT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_deliveries_channel" CHECK (
    channel IN ('IN_APP', 'EMAIL', 'SMS')
  ),
  CONSTRAINT "chk_deliveries_status" CHECK (
    status IN ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT "chk_deliveries_attempts" CHECK (
    attempt_count >= 0 AND
    max_attempts > 0 AND
    attempt_count <= max_attempts
  ),
  CONSTRAINT "chk_deliveries_invariants" CHECK (
    (
      status = 'PENDING' AND
      locked_at IS NULL AND
      locked_by IS NULL AND
      next_retry_at IS NOT NULL AND
      attempt_count < max_attempts AND
      sent_at IS NULL AND
      delivered_at IS NULL AND
      failed_at IS NULL
    ) OR
    (
      status = 'PROCESSING' AND
      locked_at IS NOT NULL AND
      locked_by IS NOT NULL AND
      next_retry_at IS NULL AND
      attempt_count >= 1 AND
      attempt_count <= max_attempts AND
      sent_at IS NULL AND
      delivered_at IS NULL AND
      failed_at IS NULL
    ) OR
    (
      status = 'SENT' AND
      channel IN ('EMAIL', 'SMS') AND
      locked_at IS NULL AND
      locked_by IS NULL AND
      next_retry_at IS NULL AND
      sent_at IS NOT NULL AND
      failed_at IS NULL AND
      attempt_count >= 1 AND
      attempt_count <= max_attempts AND
      error_message IS NULL
    ) OR
    (
      status = 'DELIVERED' AND
      channel = 'IN_APP' AND
      locked_at IS NULL AND
      locked_by IS NULL AND
      next_retry_at IS NULL AND
      delivered_at IS NOT NULL AND
      failed_at IS NULL AND
      sent_at IS NULL AND
      attempt_count = 0 AND
      error_message IS NULL
    ) OR
    (
      status = 'FAILED' AND
      locked_at IS NULL AND
      locked_by IS NULL AND
      next_retry_at IS NULL AND
      failed_at IS NOT NULL AND
      sent_at IS NULL AND
      delivered_at IS NULL AND
      attempt_count >= 1 AND
      error_message IS NOT NULL
    ) OR
    (
      status = 'SKIPPED' AND
      locked_at IS NULL AND
      locked_by IS NULL AND
      next_retry_at IS NULL AND
      sent_at IS NULL AND
      delivered_at IS NULL AND
      failed_at IS NULL AND
      attempt_count = 0 AND
      error_message IS NOT NULL
    )
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deliveries_queue" ON "identity"."notification_deliveries" ("status", "next_retry_at") WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deliveries_notification" ON "identity"."notification_deliveries" ("notification_id");
--> statement-breakpoint

-- 3. Table: identity.user_notification_preferences
CREATE TABLE IF NOT EXISTS "identity"."user_notification_preferences" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL UNIQUE REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "marketing_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_notification_preferences_user" ON "identity"."user_notification_preferences" ("user_id");
