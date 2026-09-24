-- Prompt 08: Publication Workflow
-- 1. Partial unique index enforcing single published version per resource
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_single_published_version 
ON "content"."resource_versions" ("resource_id") 
WHERE "status" = 'PUBLISHED';
--> statement-breakpoint

-- 2. Check constraint ensuring published versions have published_at timestamp and non-published have null
ALTER TABLE "content"."resource_versions"
DROP CONSTRAINT IF EXISTS "chk_resource_versions_published_at";
--> statement-breakpoint

ALTER TABLE "content"."resource_versions"
ADD CONSTRAINT "chk_resource_versions_published_at"
CHECK (
  ("content"."resource_versions"."status" = 'PUBLISHED' AND "content"."resource_versions"."published_at" IS NOT NULL) OR
  ("content"."resource_versions"."status" <> 'PUBLISHED' AND "content"."resource_versions"."published_at" IS NULL)
);
--> statement-breakpoint

-- 3. Audit ledger table: content.publication_events
CREATE TABLE IF NOT EXISTS "content"."publication_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL,
  "resource_version_id" uuid,
  "event_type" varchar(32) NOT NULL,
  "from_status" varchar(32) NOT NULL,
  "to_status" varchar(32) NOT NULL,
  "actor_user_id" uuid,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_publication_events_event_type" CHECK ("content"."publication_events"."event_type" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED', 'RETURNED_TO_DRAFT')),
  CONSTRAINT "chk_publication_events_rejection_reason" CHECK (
    ("content"."publication_events"."event_type" = 'REJECTED' AND "content"."publication_events"."reason" IS NOT NULL AND length(trim("content"."publication_events"."reason")) > 0) OR
    ("content"."publication_events"."event_type" <> 'REJECTED')
  ),
  CONSTRAINT "fk_publication_events_resource" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_publication_events_version" FOREIGN KEY ("resource_version_id") REFERENCES "content"."resource_versions"("id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_publication_events_resource_id" ON "content"."publication_events" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publication_events_version_id" ON "content"."publication_events" ("resource_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publication_events_created_at" ON "content"."publication_events" ("created_at");
--> statement-breakpoint

-- 4. Engine-level defense: Append-only ledger protection preventing UPDATE or DELETE on publication_events
CREATE OR REPLACE FUNCTION "content"."fn_prevent_publication_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'content.publication_events rows are immutable audit records and cannot be updated or deleted'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_publication_event_update" ON "content"."publication_events";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_publication_event_update"
BEFORE UPDATE ON "content"."publication_events"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_prevent_publication_event_mutation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_publication_event_delete" ON "content"."publication_events";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_publication_event_delete"
BEFORE DELETE ON "content"."publication_events"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_prevent_publication_event_mutation"();
--> statement-breakpoint

-- 5. Foreign Key Integrity Trigger: ensure resource_version_id belongs to resource_id if specified
CREATE OR REPLACE FUNCTION "content"."fn_check_publication_event_version_match"()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_resource_id UUID;
BEGIN
    IF NEW.resource_version_id IS NOT NULL THEN
        SELECT resource_id INTO v_parent_resource_id
        FROM "content"."resource_versions"
        WHERE id = NEW.resource_version_id;

        IF v_parent_resource_id IS NULL OR v_parent_resource_id <> NEW.resource_id THEN
            RAISE EXCEPTION 'Publication event resource_version_id % does not belong to resource_id %',
                NEW.resource_version_id, NEW.resource_id
            USING ERRCODE = '23503';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_check_publication_event_version_match" ON "content"."publication_events";
--> statement-breakpoint
CREATE TRIGGER "trg_check_publication_event_version_match"
BEFORE INSERT ON "content"."publication_events"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_check_publication_event_version_match"();
