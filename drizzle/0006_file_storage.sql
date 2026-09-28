-- Prompt 09: File Storage Architecture (Cloudflare R2 + Neon PostgreSQL metadata)
-- 1. Create table files.resource_files
CREATE TABLE IF NOT EXISTS "files"."resource_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_version_id" uuid NOT NULL,
  "storage_provider" varchar(32) DEFAULT 'CLOUDFLARE_R2' NOT NULL,
  "storage_bucket" varchar(128) NOT NULL,
  "object_key" varchar(512) NOT NULL,
  "original_filename" varchar(255) NOT NULL,
  "file_extension" varchar(20) NOT NULL,
  "file_type" varchar(32) DEFAULT 'MAIN_DOCUMENT' NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "storage_metadata" jsonb DEFAULT '{}'::jsonb,
  "status" varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "sequence_order" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_resource_files_status" CHECK ("files"."resource_files"."status" IN ('PENDING', 'AVAILABLE', 'QUARANTINED', 'ARCHIVED', 'FAILED')),
  CONSTRAINT "chk_resource_files_storage_provider" CHECK ("files"."resource_files"."storage_provider" IN ('CLOUDFLARE_R2', 'AWS_S3', 'MEMORY')),
  CONSTRAINT "chk_resource_files_file_size_bytes" CHECK ("files"."resource_files"."file_size_bytes" > 0),
  CONSTRAINT "chk_resource_files_sequence_order" CHECK ("files"."resource_files"."sequence_order" > 0),
  CONSTRAINT "chk_resource_files_sha256" CHECK (length(trim("files"."resource_files"."checksum_sha256")) = 64),
  CONSTRAINT "chk_resource_files_filename" CHECK (length(trim("files"."resource_files"."original_filename")) > 0),
  CONSTRAINT "chk_resource_files_file_extension" CHECK (length(trim("files"."resource_files"."file_extension")) > 0),
  CONSTRAINT "chk_resource_files_object_key" CHECK (length(trim("files"."resource_files"."object_key")) > 0),
  CONSTRAINT "chk_resource_files_storage_bucket" CHECK (length(trim("files"."resource_files"."storage_bucket")) > 0),
  CONSTRAINT "chk_resource_files_file_type" CHECK ("files"."resource_files"."file_type" IN ('MAIN_DOCUMENT', 'MARKING_SCHEME', 'SUPPLEMENTARY', 'CURRICULUM_GUIDE', 'ACTIVITY_SHEET', 'AUDIO_RESOURCE', 'OTHER')),
  CONSTRAINT "uq_resource_files_bucket_key" UNIQUE ("storage_bucket", "object_key"),
  CONSTRAINT "uq_resource_files_version_seq" UNIQUE ("resource_version_id", "sequence_order"),
  CONSTRAINT "uq_resource_files_version_checksum" UNIQUE ("resource_version_id", "checksum_sha256"),
  CONSTRAINT "fk_resource_files_version" FOREIGN KEY ("resource_version_id") REFERENCES "content"."resource_versions"("id") ON DELETE RESTRICT
);
--> statement-breakpoint

-- 2. Partial unique index enforcing single primary file per resource version
CREATE UNIQUE INDEX IF NOT EXISTS "uq_resource_files_primary_version"
ON "files"."resource_files" ("resource_version_id")
WHERE "is_primary" = true;
--> statement-breakpoint

-- 3. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS "idx_resource_files_version_id" ON "files"."resource_files" ("resource_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_files_checksum" ON "files"."resource_files" ("checksum_sha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_files_status" ON "files"."resource_files" ("status");
--> statement-breakpoint

-- 4. Publication Invariant: Engine-level triggers protecting files of PUBLISHED resource versions
-- Invariant: A file record cannot be modified, deleted, moved out of, or moved into a PUBLISHED resource version.

-- 4a. INSERT trigger: Disallow attaching new files directly into an already PUBLISHED version
CREATE OR REPLACE FUNCTION "files"."fn_prevent_published_resource_file_insert"()
RETURNS TRIGGER AS $$
DECLARE
    v_version_status VARCHAR;
BEGIN
    SELECT status INTO v_version_status
    FROM "content"."resource_versions"
    WHERE id = NEW.resource_version_id;

    IF v_version_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Cannot attach file to a PUBLISHED resource version'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_published_resource_file_insert" ON "files"."resource_files";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_published_resource_file_insert"
BEFORE INSERT ON "files"."resource_files"
FOR EACH ROW
EXECUTE FUNCTION "files"."fn_prevent_published_resource_file_insert"();
--> statement-breakpoint

-- 4b. DELETE trigger: Disallow deleting files belonging to a PUBLISHED version
CREATE OR REPLACE FUNCTION "files"."fn_prevent_published_resource_file_delete"()
RETURNS TRIGGER AS $$
DECLARE
    v_version_status VARCHAR;
BEGIN
    SELECT status INTO v_version_status
    FROM "content"."resource_versions"
    WHERE id = OLD.resource_version_id;

    IF v_version_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Cannot delete file belonging to a PUBLISHED resource version'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_published_resource_file_delete" ON "files"."resource_files";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_published_resource_file_delete"
BEFORE DELETE ON "files"."resource_files"
FOR EACH ROW
EXECUTE FUNCTION "files"."fn_prevent_published_resource_file_delete"();
--> statement-breakpoint

-- 4c. UPDATE trigger: Disallow modifying, moving out of, or moving into a PUBLISHED version
CREATE OR REPLACE FUNCTION "files"."fn_prevent_published_resource_file_update"()
RETURNS TRIGGER AS $$
DECLARE
    v_old_version_status VARCHAR;
    v_new_version_status VARCHAR;
BEGIN
    -- Check 1: Protect existing file belonging to PUBLISHED version from being modified or moved out
    SELECT status INTO v_old_version_status
    FROM "content"."resource_versions"
    WHERE id = OLD.resource_version_id;

    IF v_old_version_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Cannot modify or move file belonging to a PUBLISHED resource version'
        USING ERRCODE = '23514';
    END IF;

    -- Check 2: Protect PUBLISHED version from having any file moved into it
    SELECT status INTO v_new_version_status
    FROM "content"."resource_versions"
    WHERE id = NEW.resource_version_id;

    IF v_new_version_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Cannot move file into a PUBLISHED resource version'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_published_resource_file_update" ON "files"."resource_files";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_published_resource_file_update"
BEFORE UPDATE ON "files"."resource_files"
FOR EACH ROW
EXECUTE FUNCTION "files"."fn_prevent_published_resource_file_update"();
