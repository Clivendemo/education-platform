-- Migration 0017: Audit & Data Retention Architecture

-- 1. Table: governance.audit_logs
CREATE TABLE IF NOT EXISTS "governance"."audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" VARCHAR(64) NOT NULL UNIQUE,
  "action" VARCHAR(64) NOT NULL,
  "entity_type" VARCHAR(64) NOT NULL,
  "entity_id" UUID NULL,
  "actor_type" VARCHAR(20) NOT NULL CHECK (actor_type IN ('AUTHENTICATED', 'ANONYMOUS', 'SYSTEM')),
  "actor_user_id" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "actor_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "outcome" VARCHAR(20) NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  "request_id" VARCHAR(64) NULL,
  "country_id" UUID NULL REFERENCES "platform"."countries"("id") ON DELETE SET NULL,
  "before_state" JSONB NULL,
  "after_state" JSONB NULL,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_audit_logs_context_bytes" CHECK (octet_length(context::text) <= 4096),
  CONSTRAINT "chk_audit_logs_actor_snapshot_bytes" CHECK (octet_length(actor_snapshot::text) <= 2048)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_occurred_action" ON "governance"."audit_logs" ("occurred_at" DESC, "action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity" ON "governance"."audit_logs" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_actor" ON "governance"."audit_logs" ("actor_user_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_request_id" ON "governance"."audit_logs" ("request_id") WHERE request_id IS NOT NULL;
--> statement-breakpoint

-- 2. Table: governance.retention_policies
CREATE TABLE IF NOT EXISTS "governance"."retention_policies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "policy_code" VARCHAR(64) NOT NULL UNIQUE,
  "name" VARCHAR(128) NOT NULL,
  "description" TEXT NULL,
  "data_category" VARCHAR(64) NOT NULL,
  "target_identifier" VARCHAR(64) NOT NULL,
  "reference_point" VARCHAR(64) NOT NULL,
  "retention_duration_days" INTEGER NOT NULL CHECK (retention_duration_days > 0),
  "disposition" VARCHAR(20) NOT NULL CHECK (disposition IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')),
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED')),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  "legal_basis" TEXT NULL,
  "created_by" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "updated_by" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_retention_audit_duration" CHECK (data_category != 'AUDIT_LOGS' OR retention_duration_days >= 2555)
);
--> statement-breakpoint

-- 3. Table: governance.retention_policy_versions
CREATE TABLE IF NOT EXISTS "governance"."retention_policy_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "policy_id" UUID NOT NULL REFERENCES "governance"."retention_policies"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "change_reason" TEXT NOT NULL,
  "changed_by" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "uq_retention_policy_version" UNIQUE ("policy_id", "version")
);
--> statement-breakpoint

-- 4. Table: governance.data_retention_actions
CREATE TABLE IF NOT EXISTS "governance"."data_retention_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "execution_id" VARCHAR(64) NOT NULL UNIQUE,
  "policy_id" UUID NOT NULL REFERENCES "governance"."retention_policies"("id") ON DELETE RESTRICT,
  "policy_version" INTEGER NOT NULL,
  "data_category" VARCHAR(64) NOT NULL,
  "action" VARCHAR(20) NOT NULL CHECK (action IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')),
  "is_dry_run" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  "evaluated_count" BIGINT NOT NULL DEFAULT 0,
  "affected_count" BIGINT NOT NULL DEFAULT 0,
  "skipped_count" BIGINT NOT NULL DEFAULT 0,
  "failed_count" BIGINT NOT NULL DEFAULT 0,
  "batch_count" INTEGER NOT NULL DEFAULT 0,
  "cutoff_time" TIMESTAMPTZ NOT NULL,
  "fence_token" INTEGER NOT NULL DEFAULT 1,
  "worker_id" VARCHAR(64) NULL,
  "lease_expires_at" TIMESTAMPTZ NULL,
  "resumed_from_execution_id" UUID NULL REFERENCES "governance"."data_retention_actions"("id") ON DELETE RESTRICT,
  "last_cursor_id" UUID NULL,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ NULL,
  "executed_by" UUID NULL REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "error_message" VARCHAR(1024) NULL,
  "diagnostic_data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "chk_retention_actions_diagnostic_bytes" CHECK (octet_length(diagnostic_data::text) <= 8192)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_retention_actions_policy_created" ON "governance"."data_retention_actions" ("policy_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_retention_actions_lease" ON "governance"."data_retention_actions" ("status", "lease_expires_at") WHERE status = 'RUNNING';
--> statement-breakpoint

-- 5. Immutability Triggers
CREATE OR REPLACE FUNCTION governance.prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Allow PostgreSQL foreign key cascaded NULLification of actor_user_id / country_id when referenced rows are deleted
    IF ((OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL) OR
        (OLD.country_id IS NOT NULL AND NEW.country_id IS NULL)) AND
       (NEW.id = OLD.id AND
        NEW.event_id = OLD.event_id AND
        NEW.action = OLD.action AND
        NEW.entity_type = OLD.entity_type AND
        (NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id) AND
        NEW.actor_type = OLD.actor_type AND
        NEW.actor_snapshot = OLD.actor_snapshot AND
        NEW.outcome = OLD.outcome AND
        (NEW.request_id IS NOT DISTINCT FROM OLD.request_id) AND
        (NEW.before_state IS NOT DISTINCT FROM OLD.before_state) AND
        (NEW.after_state IS NOT DISTINCT FROM OLD.after_state) AND
        NEW.context = OLD.context AND
        NEW.occurred_at = OLD.occurred_at AND
        NEW.created_at = OLD.created_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'governance.audit_logs is append-only: UPDATE and DELETE operations are forbidden.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'governance.audit_logs is append-only: UPDATE and DELETE operations are forbidden.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON governance.audit_logs;
--> statement-breakpoint
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON governance.audit_logs
FOR EACH ROW EXECUTE FUNCTION governance.prevent_audit_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION governance.prevent_policy_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'governance.retention_policy_versions is append-only: UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_retention_policy_versions_immutable ON governance.retention_policy_versions;
--> statement-breakpoint
CREATE TRIGGER trg_retention_policy_versions_immutable
BEFORE UPDATE OR DELETE ON governance.retention_policy_versions
FOR EACH ROW EXECUTE FUNCTION governance.prevent_policy_version_mutation();
