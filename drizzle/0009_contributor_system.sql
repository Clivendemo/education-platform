-- Prompt 21: Contributor System Schema
-- 1. Create table community.contributors
CREATE TABLE IF NOT EXISTS "community"."contributors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" varchar(100) NOT NULL,
  "bio" text,
  "profile_slug" varchar(100) NOT NULL,
  "verification_status" varchar(30) DEFAULT 'UNVERIFIED' NOT NULL,
  "status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "suspended_at" timestamp with time zone,
  "suspended_by" uuid,
  CONSTRAINT "uq_contributors_user_id" UNIQUE("user_id"),
  CONSTRAINT "uq_contributors_profile_slug" UNIQUE("profile_slug"),
  CONSTRAINT "chk_contributors_status" CHECK ("status" IN ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE')),
  CONSTRAINT "chk_contributors_verification" CHECK ("verification_status" IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')),
  CONSTRAINT "chk_contributors_display_name" CHECK (length(trim("display_name")) > 0 AND length("display_name") <= 100),
  CONSTRAINT "chk_contributors_slug" CHECK (length(trim("profile_slug")) > 0 AND "profile_slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT "chk_contributors_suspension" CHECK (("status" = 'SUSPENDED' AND "suspended_at" IS NOT NULL) OR ("status" != 'SUSPENDED')),
  CONSTRAINT "fk_contributors_user_id" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributors_suspended_by" FOREIGN KEY ("suspended_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_contributors_status" ON "community"."contributors" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contributors_verification" ON "community"."contributors" ("verification_status");
--> statement-breakpoint

-- 2. Create table community.contributor_applications
CREATE TABLE IF NOT EXISTS "community"."contributor_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "application_text" text NOT NULL,
  "status" varchar(30) DEFAULT 'SUBMITTED' NOT NULL,
  "review_notes" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid,
  CONSTRAINT "chk_contributor_app_status" CHECK ("status" IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  CONSTRAINT "chk_contributor_app_text" CHECK (length(trim("application_text")) > 0),
  CONSTRAINT "chk_contributor_app_review" CHECK (
    ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL)
    OR ("status" IN ('SUBMITTED', 'UNDER_REVIEW'))
  ),
  CONSTRAINT "chk_contributor_app_rejection_notes" CHECK (
    ("status" = 'REJECTED' AND "review_notes" IS NOT NULL AND length(trim("review_notes")) > 0)
    OR ("status" != 'REJECTED')
  ),
  CONSTRAINT "fk_contributor_applications_user_id" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_applications_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_contributor_active_application"
ON "community"."contributor_applications" ("user_id")
WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_contributor_apps_user_id" ON "community"."contributor_applications" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contributor_apps_status" ON "community"."contributor_applications" ("status");
--> statement-breakpoint

-- 3. Add contributor_id to content.resources
ALTER TABLE "content"."resources"
ADD COLUMN IF NOT EXISTS "contributor_id" uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_resources_contributor_id'
  ) THEN
    ALTER TABLE "content"."resources"
    ADD CONSTRAINT "fk_resources_contributor_id"
    FOREIGN KEY ("contributor_id") REFERENCES "community"."contributors"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_resources_contributor_id" ON "content"."resources" ("contributor_id");
--> statement-breakpoint

-- 4. Create table community.contributor_submissions
CREATE TABLE IF NOT EXISTS "community"."contributor_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contributor_id" uuid NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "proposed_price_minor" bigint,
  "proposed_currency_code" varchar(3),
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "resource_id" uuid,
  "submitted_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_contributor_subs_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'PROCESSING', 'REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED')),
  CONSTRAINT "chk_contributor_subs_title" CHECK (length(trim("title")) > 0),
  CONSTRAINT "chk_contributor_subs_pricing" CHECK (
    ("proposed_price_minor" IS NULL AND "proposed_currency_code" IS NULL)
    OR ("proposed_price_minor" >= 0 AND "proposed_currency_code" = 'KES')
  ),
  CONSTRAINT "fk_contributor_submissions_contributor_id" FOREIGN KEY ("contributor_id") REFERENCES "community"."contributors"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_submissions_resource_id" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_contributor_submissions_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_contributor_subs_contributor_id" ON "community"."contributor_submissions" ("contributor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contributor_subs_status" ON "community"."contributor_submissions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contributor_subs_resource_id" ON "community"."contributor_submissions" ("resource_id");
