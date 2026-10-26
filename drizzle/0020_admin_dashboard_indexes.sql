-- Migration 0020: Prompt 31 — Admin Dashboard Additive Query-Aligned Indexes
-- Strictly additive B-tree and partial review-queue indexes. Zero table/column/constraint mutations.

-- 1. content.resources general administrative sort & single-status indexes
CREATE INDEX IF NOT EXISTS "idx_resources_updated_at_id_desc"
  ON "content"."resources" ("updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_created_at_id_desc"
  ON "content"."resources" ("created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_country_updated_desc"
  ON "content"."resources" ("country_id", "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_country_created_desc"
  ON "content"."resources" ("country_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_status_updated_desc"
  ON "content"."resources" ("status", "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_country_status_updated_desc"
  ON "content"."resources" ("country_id", "status", "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_lower_title_id_asc"
  ON "content"."resources" ((lower("title")) ASC, "id" ASC);
--> statement-breakpoint

-- 2. content.resources partial review-queue indexes (WHERE status IN ('IN_REVIEW', 'APPROVED'))
CREATE INDEX IF NOT EXISTS "idx_resources_review_queue_updated_desc"
  ON "content"."resources" ("updated_at" DESC, "id" DESC)
  WHERE "status" IN ('IN_REVIEW', 'APPROVED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_review_queue_created_desc"
  ON "content"."resources" ("created_at" DESC, "id" DESC)
  WHERE "status" IN ('IN_REVIEW', 'APPROVED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_country_review_queue_updated_desc"
  ON "content"."resources" ("country_id", "updated_at" DESC, "id" DESC)
  WHERE "status" IN ('IN_REVIEW', 'APPROVED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resources_country_review_queue_created_desc"
  ON "content"."resources" ("country_id", "created_at" DESC, "id" DESC)
  WHERE "status" IN ('IN_REVIEW', 'APPROVED');
--> statement-breakpoint

-- 3. content.publication_events administrative stream indexes
CREATE INDEX IF NOT EXISTS "idx_pub_events_created_id_desc"
  ON "content"."publication_events" ("created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pub_events_type_created_id_desc"
  ON "content"."publication_events" ("event_type", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pub_events_resource_created_id_desc"
  ON "content"."publication_events" ("resource_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint

-- 4. files.resource_files administrative oversight indexes
CREATE INDEX IF NOT EXISTS "idx_res_files_created_id_desc"
  ON "files"."resource_files" ("created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_files_updated_id_desc"
  ON "files"."resource_files" ("updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_files_size_id_desc"
  ON "files"."resource_files" ("file_size_bytes" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_files_status_created_id_desc"
  ON "files"."resource_files" ("status", "created_at" DESC, "id" DESC);
