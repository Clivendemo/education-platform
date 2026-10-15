CREATE TABLE IF NOT EXISTS "content"."resource_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" varchar(64),
	"feedback_type" varchar(32) NOT NULL,
	"details" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_feedback_type" CHECK ("content"."resource_feedback"."feedback_type" IN ('HELPFUL', 'OUTDATED', 'INCORRECT', 'MISSING_INFORMATION', 'POOR_FORMATTING', 'WRONG_CLASSIFICATION', 'FILE_PROBLEM')),
	CONSTRAINT "chk_feedback_status" CHECK ("content"."resource_feedback"."status" IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')),
	CONSTRAINT "chk_feedback_exactly_one_identity" CHECK (("content"."resource_feedback"."user_id" IS NOT NULL AND "content"."resource_feedback"."session_id" IS NULL) OR ("content"."resource_feedback"."user_id" IS NULL AND "content"."resource_feedback"."session_id" IS NOT NULL)),
	CONSTRAINT "chk_feedback_details_len" CHECK ("content"."resource_feedback"."details" IS NULL OR (length(trim("content"."resource_feedback"."details")) > 0 AND length("content"."resource_feedback"."details") <= 2000)),
	CONSTRAINT "chk_feedback_reviewed" CHECK (("content"."resource_feedback"."status" = 'PENDING' AND "content"."resource_feedback"."reviewed_at" IS NULL AND "content"."resource_feedback"."reviewed_by" IS NULL) OR ("content"."resource_feedback"."status" != 'PENDING'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content"."resource_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"from_status" varchar(20) NOT NULL,
	"to_status" varchar(20) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_feedback_events_from_status" CHECK ("content"."resource_feedback_events"."from_status" IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')),
	CONSTRAINT "chk_feedback_events_to_status" CHECK ("content"."resource_feedback_events"."to_status" IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')),
	CONSTRAINT "chk_feedback_events_note_len" CHECK ("content"."resource_feedback_events"."internal_note" IS NULL OR length("content"."resource_feedback_events"."internal_note") <= 2000)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback" ADD CONSTRAINT "resource_feedback_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback" ADD CONSTRAINT "resource_feedback_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "content"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback" ADD CONSTRAINT "resource_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback" ADD CONSTRAINT "resource_feedback_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback_events" ADD CONSTRAINT "resource_feedback_events_feedback_id_resource_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "content"."resource_feedback"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content"."resource_feedback_events" ADD CONSTRAINT "resource_feedback_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_resource_id" ON "content"."resource_feedback" USING btree ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_version_id" ON "content"."resource_feedback" USING btree ("resource_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_status" ON "content"."resource_feedback" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_type" ON "content"."resource_feedback" USING btree ("feedback_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_user_id" ON "content"."resource_feedback" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_session_id" ON "content"."resource_feedback" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_feedback_created_at" ON "content"."resource_feedback" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_feedback_events_feedback_id" ON "content"."resource_feedback_events" USING btree ("feedback_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_feedback_events_created_at" ON "content"."resource_feedback_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_feedback_events_actor" ON "content"."resource_feedback_events" USING btree ("actor_user_id");
--> statement-breakpoint

-- Trigger 1: Resource & Version Publication and Parentage Check
CREATE OR REPLACE FUNCTION "content"."fn_check_feedback_version_match"()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_resource_id UUID;
    v_version_status VARCHAR(32);
    v_resource_status VARCHAR(32);
BEGIN
    SELECT resource_id, status INTO v_parent_resource_id, v_version_status
    FROM "content"."resource_versions"
    WHERE id = NEW.resource_version_id;

    IF v_parent_resource_id IS NULL OR v_parent_resource_id <> NEW.resource_id THEN
        RAISE EXCEPTION 'Resource feedback resource_version_id % does not belong to resource_id %',
            NEW.resource_version_id, NEW.resource_id
        USING ERRCODE = '23503';
    END IF;

    IF v_version_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'Feedback can only be submitted for PUBLISHED resource versions. Current version status: %',
            v_version_status
        USING ERRCODE = '23514';
    END IF;

    SELECT status INTO v_resource_status
    FROM "content"."resources"
    WHERE id = NEW.resource_id;

    IF v_resource_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'Feedback can only be submitted for PUBLISHED resources. Current resource status: %',
            v_resource_status
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_check_feedback_version_match" ON "content"."resource_feedback";
--> statement-breakpoint
CREATE TRIGGER "trg_check_feedback_version_match"
BEFORE INSERT OR UPDATE OF resource_id, resource_version_id ON "content"."resource_feedback"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_check_feedback_version_match"();
--> statement-breakpoint

-- Trigger 2: Append-Only Trigger Defense for Feedback Event Ledger
CREATE OR REPLACE FUNCTION "content"."fn_prevent_feedback_events_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mutation or deletion of resource feedback event audit records is prohibited.'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_feedback_events_update" ON "content"."resource_feedback_events";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_feedback_events_update"
BEFORE UPDATE ON "content"."resource_feedback_events"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_prevent_feedback_events_mutation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_feedback_events_delete" ON "content"."resource_feedback_events";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_feedback_events_delete"
BEFORE DELETE ON "content"."resource_feedback_events"
FOR EACH ROW
EXECUTE FUNCTION "content"."fn_prevent_feedback_events_mutation"();
