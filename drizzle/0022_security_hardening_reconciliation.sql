-- Migration 0022: Wave 1 Security Hardening & Schema Reconciliation (WP8 + WP1 + WP6)
-- Converges commerce, calendar, and file-processing quarantine/scanning schemas idempotently.

-- 1. Ensure commerce & calendar base schemas/tables exist for environments upgrading from 0021
CREATE SCHEMA IF NOT EXISTS "commerce";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "calendar";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."products" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(200) NOT NULL,
  "product_type" VARCHAR(50) NOT NULL,
  "resource_id" UUID REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
  "bundle_id" UUID,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_products_type" CHECK ("product_type" IN ('RESOURCE', 'BUNDLE')),
  CONSTRAINT "chk_products_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT "chk_products_resource_ref" CHECK ("product_type" != 'RESOURCE' OR "resource_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_status" ON "commerce"."products" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_resource_id" ON "commerce"."products" ("resource_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."offers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL REFERENCES "commerce"."products"("id") ON DELETE RESTRICT,
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "price_minor" BIGINT NOT NULL,
  "commercial_status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "starts_at" TIMESTAMPTZ,
  "ends_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_offers_currency" CHECK ("currency_code" = 'KES'),
  CONSTRAINT "chk_offers_price" CHECK ("price_minor" >= 0),
  CONSTRAINT "chk_offers_status" CHECK ("commercial_status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "chk_offers_dates" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" >= "starts_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_offers_product_status" ON "commerce"."offers" ("product_id", "commercial_status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "total_minor" BIGINT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_orders_status" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED')),
  CONSTRAINT "chk_orders_currency" CHECK ("currency_code" = 'KES'),
  CONSTRAINT "chk_orders_total" CHECK ("total_minor" >= 0)
);
--> statement-breakpoint

-- W1-AC-02: Drop constraint-backed unique object BEFORE standalone index, then create user-scoped partial unique index
ALTER TABLE "commerce"."orders" DROP CONSTRAINT IF EXISTS "uq_orders_idempotency_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "commerce"."uq_orders_idempotency_key";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_user_idempotency_key"
  ON "commerce"."orders" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_user_status" ON "commerce"."orders" ("user_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."order_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL REFERENCES "commerce"."orders"("id") ON DELETE CASCADE,
  "product_id" UUID NOT NULL REFERENCES "commerce"."products"("id") ON DELETE RESTRICT,
  "offer_id" UUID NOT NULL REFERENCES "commerce"."offers"("id") ON DELETE RESTRICT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price_minor" BIGINT NOT NULL,
  "total_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_order_items_qty" CHECK ("quantity" > 0),
  CONSTRAINT "chk_order_items_unit_price" CHECK ("unit_price_minor" >= 0),
  CONSTRAINT "chk_order_items_total" CHECK ("total_minor" = ("quantity" * "unit_price_minor"))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON "commerce"."order_items" ("order_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."payments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
  "provider_code" VARCHAR(50) NOT NULL,
  "provider_reference" VARCHAR(100),
  "provider_merchant_request_id" VARCHAR(100),
  "provider_transaction_id" VARCHAR(100),
  "initiated_phone_hash" VARCHAR(64),
  "callback_receipt_candidate" VARCHAR(100),
  "verified_receipt_number" VARCHAR(100),
  "receipt_verification_source" VARCHAR(40),
  "amount_minor" BIGINT NOT NULL,
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "callback_received_at" TIMESTAMPTZ,
  "verified_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "failed_at" TIMESTAMPTZ,
  "failure_reason" TEXT,
  "verification_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_verification_at" TIMESTAMPTZ,
  "verification_locked_at" TIMESTAMPTZ,
  "verification_locked_by" VARCHAR(100),
  "provider_payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_payments_currency" CHECK ("currency_code" = 'KES'),
  CONSTRAINT "chk_payments_amount" CHECK ("amount_minor" >= 0)
);
--> statement-breakpoint

-- W1-AC-04: Converge canonical commerce.payments columns & constraints on existing databases
ALTER TABLE "commerce"."payments" ALTER COLUMN "status" TYPE VARCHAR(30);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "provider_merchant_request_id" VARCHAR(100);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "initiated_phone_hash" VARCHAR(64);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "callback_receipt_candidate" VARCHAR(100);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "verified_receipt_number" VARCHAR(100);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "receipt_verification_source" VARCHAR(40);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "callback_received_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "verification_attempts" INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "next_verification_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "verification_locked_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "verification_locked_by" VARCHAR(100);
--> statement-breakpoint

ALTER TABLE "commerce"."payments" DROP CONSTRAINT IF EXISTS "chk_payments_status";
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "chk_payments_status" CHECK (
  "status" IN (
    'PENDING',
    'PROCESSING',
    'RECONCILIATION_REQUIRED',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  )
);
--> statement-breakpoint

ALTER TABLE "commerce"."payments" DROP CONSTRAINT IF EXISTS "chk_payments_verified_receipt_provenance";
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "chk_payments_verified_receipt_provenance" CHECK (
  (
    "verified_receipt_number" IS NULL
    AND "receipt_verification_source" IS NULL
  )
  OR
  (
    "verified_receipt_number" IS NOT NULL
    AND length(btrim("verified_receipt_number")) > 0
    AND "receipt_verification_source" IS NOT NULL
    AND "receipt_verification_source" IN (
      'PROVIDER_VERIFIED_RECEIPT',
      'ADMIN_RECONCILED_RECEIPT'
    )
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_provider_ref"
  ON "commerce"."payments" ("provider_code", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_verified_receipt"
  ON "commerce"."payments" ("provider_code", "verified_receipt_number")
  WHERE "verified_receipt_number" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_order_id" ON "commerce"."payments" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_reconciliation_due"
  ON "commerce"."payments" ("provider_code", "status", "next_verification_at")
  WHERE "provider_code" = 'MPESA'
    AND "status" IN ('PENDING', 'PROCESSING')
    AND "next_verification_at" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "commerce"."entitlements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "resource_id" UUID NOT NULL REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
  "source_order_id" UUID REFERENCES "commerce"."orders"("id") ON DELETE SET NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "starts_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ends_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "revoked_by" UUID REFERENCES "identity"."users"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_entitlements_status" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  CONSTRAINT "chk_entitlements_dates" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_resource_active_entitlement"
  ON "commerce"."entitlements" ("user_id", "resource_id")
  WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entitlements_user_status" ON "commerce"."entitlements" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entitlements_resource_id" ON "commerce"."entitlements" ("resource_id");
--> statement-breakpoint

-- 2. Converge calendar structural tables idempotently
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendars_scope_status" ON "calendar"."calendars" ("calendar_scope", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendars_user_id" ON "calendar"."calendars" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendars_session" ON "calendar"."calendars" ("session_id", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendars_country_year" ON "calendar"."calendars" ("country_id", "academic_year");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar"."calendar_event_types" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "slug" VARCHAR(100) NOT NULL UNIQUE,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_calendar_event_types_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint

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
);
--> statement-breakpoint

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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendar_events_calendar_date" ON "calendar"."calendar_events" ("calendar_id", "start_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendar_events_type" ON "calendar"."calendar_events" ("event_type_id");
--> statement-breakpoint

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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendar_exports_calendar" ON "calendar"."calendar_exports" ("calendar_id");
--> statement-breakpoint

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
);
--> statement-breakpoint

-- 3. W1-AC-09: File Quarantine, Malware Scanning & Recoverable Promotion Schema
ALTER TABLE "files"."resource_files" ADD COLUMN IF NOT EXISTS "malware_scan_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING';
--> statement-breakpoint
ALTER TABLE "files"."resource_files" ADD COLUMN IF NOT EXISTS "malware_scan_signature" VARCHAR(255);
--> statement-breakpoint
ALTER TABLE "files"."resource_files" ADD COLUMN IF NOT EXISTS "scanned_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "files"."resource_files" DROP CONSTRAINT IF EXISTS "chk_resource_files_scan_status";
--> statement-breakpoint
ALTER TABLE "files"."resource_files" ADD CONSTRAINT "chk_resource_files_scan_status" CHECK (
  "malware_scan_status" IN ('PENDING', 'CLEAN', 'INFECTED', 'SCAN_ERROR')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "files"."file_processing_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "file_id" UUID NOT NULL REFERENCES "files"."resource_files"("id") ON DELETE CASCADE,
  "staged_object_key" VARCHAR(512) NOT NULL,
  "target_object_key" VARCHAR(512) NOT NULL,
  "expected_sha256" VARCHAR(64) NOT NULL,
  "expected_size_bytes" BIGINT NOT NULL,
  "clean_verified_sha256" VARCHAR(64),
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "fencing_token" BIGINT NOT NULL DEFAULT 0,
  "locked_by" VARCHAR(100),
  "lease_expires_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_file_processing_jobs_file_id" UNIQUE ("file_id"),
  CONSTRAINT "chk_file_processing_jobs_status" CHECK (
    "status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'QUARANTINED', 'FAILED')
  ),
  CONSTRAINT "chk_file_processing_jobs_size" CHECK ("expected_size_bytes" > 0),
  CONSTRAINT "chk_file_processing_jobs_attempts" CHECK ("attempt_count" >= 0 AND "max_attempts" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_processing_jobs_claim"
  ON "files"."file_processing_jobs" ("status", "next_run_at", "lease_expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "files"."file_processing_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" UUID NOT NULL REFERENCES "files"."file_processing_jobs"("id") ON DELETE CASCADE,
  "file_id" UUID NOT NULL REFERENCES "files"."resource_files"("id") ON DELETE CASCADE,
  "event_type" VARCHAR(40) NOT NULL,
  "fencing_token" BIGINT NOT NULL DEFAULT 0,
  "worker_id" VARCHAR(100),
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_processing_history_file_id"
  ON "files"."file_processing_history" ("file_id", "created_at" DESC);
