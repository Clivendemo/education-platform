-- Prompt 14: RBAC / Roles & Permissions Schema
-- 1. Create table identity.roles
CREATE TABLE IF NOT EXISTS "identity"."roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(50) NOT NULL,
  "description" text,
  "role_type" varchar(32) DEFAULT 'SYSTEM' NOT NULL,
  "status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_roles_slug" UNIQUE("slug"),
  CONSTRAINT "chk_roles_status" CHECK ("identity"."roles"."status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "chk_roles_type" CHECK ("identity"."roles"."role_type" IN ('SYSTEM', 'ORGANIZATIONAL', 'CUSTOM'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_roles_status" ON "identity"."roles" ("status");
--> statement-breakpoint

-- 2. Create table identity.permissions
CREATE TABLE IF NOT EXISTS "identity"."permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "resource" varchar(50) NOT NULL,
  "action" varchar(50) NOT NULL,
  "scope_type" varchar(32) DEFAULT 'ANY' NOT NULL,
  "description" text,
  "status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
  CONSTRAINT "uq_permissions_name" UNIQUE("name"),
  CONSTRAINT "chk_permissions_status" CHECK ("identity"."permissions"."status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "chk_permissions_scope_type" CHECK ("identity"."permissions"."scope_type" IN ('GLOBAL', 'SCOPED', 'ANY'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_permissions_resource_action" ON "identity"."permissions" ("resource", "action");
--> statement-breakpoint

-- 3. Create table identity.role_permissions
CREATE TABLE IF NOT EXISTS "identity"."role_permissions" (
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pk_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT "fk_role_permissions_role_id" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_role_permissions_permission_id" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission_id" ON "identity"."role_permissions" ("permission_id");
--> statement-breakpoint

-- 4. Create table identity.user_roles
CREATE TABLE IF NOT EXISTS "identity"."user_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "scope_type" varchar(32),
  "scope_id" uuid,
  "status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "chk_user_roles_status" CHECK ("identity"."user_roles"."status" IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT "chk_user_roles_scope_type" CHECK ("identity"."user_roles"."scope_type" IS NULL OR "identity"."user_roles"."scope_type" IN ('COUNTRY', 'SCHOOL', 'RESOURCE')),
  CONSTRAINT "chk_user_roles_scope_consistency" CHECK (("identity"."user_roles"."scope_type" IS NULL AND "identity"."user_roles"."scope_id" IS NULL) OR ("identity"."user_roles"."scope_type" IS NOT NULL AND "identity"."user_roles"."scope_id" IS NOT NULL)),
  CONSTRAINT "chk_user_roles_dates" CHECK ("identity"."user_roles"."ends_at" IS NULL OR "identity"."user_roles"."starts_at" IS NULL OR "identity"."user_roles"."ends_at" > "identity"."user_roles"."starts_at"),
  CONSTRAINT "fk_user_roles_user_id" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_roles_role_id" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_roles_created_by" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_roles_active" 
ON "identity"."user_roles" (
  "user_id", 
  "role_id", 
  COALESCE("scope_type", ''), 
  COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)
) 
WHERE "status" = 'ACTIVE';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_user_roles_user_id" ON "identity"."user_roles" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_roles_role_id" ON "identity"."user_roles" ("role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_roles_scope" ON "identity"."user_roles" ("scope_type", "scope_id");
