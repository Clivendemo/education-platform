-- Prompt 23: Education Updates Schema
-- 1. Create table content.education_update_categories
CREATE TABLE IF NOT EXISTS "content"."education_update_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "description" text,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_education_update_categories_slug" UNIQUE("slug"),
  CONSTRAINT "chk_education_update_categories_name" CHECK (length(trim("name")) > 0),
  CONSTRAINT "chk_education_update_categories_slug" CHECK (length(trim("slug")) > 0),
  CONSTRAINT "chk_education_update_categories_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_education_update_categories_status" ON "content"."education_update_categories" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_education_update_categories_slug" ON "content"."education_update_categories" ("slug");
--> statement-breakpoint

-- 2. Create table content.education_updates
CREATE TABLE IF NOT EXISTS "content"."education_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_id" uuid,
  "category_id" uuid,
  "title" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "summary" text,
  "body" text NOT NULL,
  "seo_title" varchar(255),
  "seo_description" text,
  "publication_status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
  "published_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_education_updates_slug" UNIQUE("slug"),
  CONSTRAINT "chk_education_updates_title" CHECK (length(trim("title")) > 0),
  CONSTRAINT "chk_education_updates_slug" CHECK (length(trim("slug")) > 0),
  CONSTRAINT "chk_education_updates_body" CHECK (length(trim("body")) > 0),
  CONSTRAINT "chk_education_updates_status" CHECK ("publication_status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT "chk_education_updates_published_at" CHECK (("publication_status" = 'DRAFT' AND "published_at" IS NULL) OR ("publication_status" IN ('PUBLISHED', 'ARCHIVED'))),
  CONSTRAINT "fk_education_updates_country" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_education_updates_category" FOREIGN KEY ("category_id") REFERENCES "content"."education_update_categories"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_education_updates_created_by" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_education_updates_updated_by" FOREIGN KEY ("updated_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_education_updates_status_pub" ON "content"."education_updates" ("publication_status", "published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_education_updates_country_status" ON "content"."education_updates" ("country_id", "publication_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_education_updates_category_status" ON "content"."education_updates" ("category_id", "publication_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_education_updates_slug" ON "content"."education_updates" ("slug");
--> statement-breakpoint

-- 3. Create table content.education_update_curricula
CREATE TABLE IF NOT EXISTS "content"."education_update_curricula" (
  "update_id" uuid NOT NULL,
  "curriculum_id" uuid NOT NULL,
  CONSTRAINT "pk_education_update_curricula" PRIMARY KEY("update_id", "curriculum_id"),
  CONSTRAINT "fk_education_update_curricula_update" FOREIGN KEY ("update_id") REFERENCES "content"."education_updates"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_education_update_curricula_curriculum" FOREIGN KEY ("curriculum_id") REFERENCES "taxonomy"."curricula"("id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_update_curricula_curriculum" ON "content"."education_update_curricula" ("curriculum_id");
--> statement-breakpoint

-- 4. Create table content.education_update_resources
CREATE TABLE IF NOT EXISTS "content"."education_update_resources" (
  "update_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "pk_education_update_resources" PRIMARY KEY("update_id", "resource_id"),
  CONSTRAINT "fk_education_update_resources_update" FOREIGN KEY ("update_id") REFERENCES "content"."education_updates"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_education_update_resources_resource" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_update_resources_resource" ON "content"."education_update_resources" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_update_resources_order" ON "content"."education_update_resources" ("update_id", "display_order");
