-- Prompt 13: Identity and Core Authentication Schema
-- 1. Create table identity.users
CREATE TABLE IF NOT EXISTS "identity"."users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "display_name" varchar(255),
  "email" varchar(255),
  "phone" varchar(50),
  "status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
  "profile_data" jsonb DEFAULT '{}'::jsonb,
  "saved_resource_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "chk_users_status" CHECK ("identity"."users"."status" IN ('ACTIVE', 'SUSPENDED', 'DISABLED', 'PENDING_VERIFICATION'))
);
--> statement-breakpoint

-- Partial unique index on active user emails (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_active_email" 
ON "identity"."users" (lower("email")) 
WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_users_status" ON "identity"."users" ("status");
--> statement-breakpoint

-- 2. Create table identity.auth_identities
CREATE TABLE IF NOT EXISTS "identity"."auth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) DEFAULT 'LOCAL_PASSWORD' NOT NULL,
  "provider_subject" varchar(255) NOT NULL,
  "email" varchar(255),
  "password_hash" text,
  "email_verified_at" timestamp with time zone,
  "status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_auth_identities_provider_subject" UNIQUE("provider", "provider_subject"),
  CONSTRAINT "chk_auth_identities_status" CHECK ("identity"."auth_identities"."status" IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  CONSTRAINT "chk_auth_identities_provider" CHECK ("identity"."auth_identities"."provider" IN ('LOCAL_PASSWORD', 'GOOGLE', 'MAGIC_LINK')),
  CONSTRAINT "fk_auth_identities_user_id" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_auth_identities_user_id" ON "identity"."auth_identities" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_identities_email" ON "identity"."auth_identities" (lower("email"));
--> statement-breakpoint

-- 3. Create table identity.user_sessions
CREATE TABLE IF NOT EXISTS "identity"."user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "device_metadata" jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT "uq_user_sessions_token_hash" UNIQUE("token_hash"),
  CONSTRAINT "fk_user_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_user_sessions_user_id" ON "identity"."user_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_sessions_token_hash" ON "identity"."user_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_sessions_active" 
ON "identity"."user_sessions" ("token_hash", "expires_at") 
WHERE "revoked_at" IS NULL;
