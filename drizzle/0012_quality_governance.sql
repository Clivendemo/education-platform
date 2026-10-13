-- ============================================================================
-- PROMPT 24: QUALITY GOVERNANCE MIGRATION
-- Schema: governance
-- Tables:
--   1. governance.quality_check_types
--   2. governance.resource_quality_checks
--   3. governance.resource_verifications
-- ============================================================================

-- 1. Create governance.quality_check_types table
CREATE TABLE IF NOT EXISTS "governance"."quality_check_types" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "country_id" UUID REFERENCES "platform"."countries"("id") ON DELETE RESTRICT,
    "required_for_verification" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_quality_check_types_code" CHECK (length(trim("code")) > 0 AND "code" ~ '^[A-Z0-9_]+$'),
    CONSTRAINT "chk_quality_check_types_name" CHECK (length(trim("name")) > 0),
    CONSTRAINT "chk_quality_check_types_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_quality_check_types_status" ON "governance"."quality_check_types" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quality_check_types_country" ON "governance"."quality_check_types" ("country_id");
--> statement-breakpoint

-- Code uniqueness: unique for global, unique per country for country-specific
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quality_check_types_global_code"
ON "governance"."quality_check_types" ("code")
WHERE "country_id" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_quality_check_types_country_code"
ON "governance"."quality_check_types" ("country_id", "code")
WHERE "country_id" IS NOT NULL;
--> statement-breakpoint

-- 2. Create governance.resource_quality_checks table
CREATE TABLE IF NOT EXISTS "governance"."resource_quality_checks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
    "resource_version_id" UUID NOT NULL REFERENCES "content"."resource_versions"("id") ON DELETE RESTRICT,
    "check_type_id" UUID NOT NULL REFERENCES "governance"."quality_check_types"("id") ON DELETE RESTRICT,
    "status" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "checked_by" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_resource_quality_checks_status" CHECK ("status" IN ('PASSED', 'FAILED', 'FLAGGED'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_res_quality_checks_version_type_date"
ON "governance"."resource_quality_checks" ("resource_version_id", "check_type_id", "checked_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_quality_checks_resource_id"
ON "governance"."resource_quality_checks" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_quality_checks_checked_by"
ON "governance"."resource_quality_checks" ("checked_by");
--> statement-breakpoint

-- 3. Create governance.resource_verifications table
CREATE TABLE IF NOT EXISTS "governance"."resource_verifications" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
    "resource_version_id" UUID NOT NULL REFERENCES "content"."resource_versions"("id") ON DELETE RESTRICT,
    "verification_status" VARCHAR(20) NOT NULL,
    "reason" TEXT,
    "verified_by" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
    "verified_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "revoked_by" UUID REFERENCES "identity"."users"("id") ON DELETE SET NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_res_verifications_status" CHECK ("verification_status" IN ('VERIFIED', 'REVOKED')),
    CONSTRAINT "chk_res_verifications_revocation" CHECK (
        ("verification_status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND "reason" IS NOT NULL AND length(trim("reason")) > 0)
        OR ("verification_status" = 'VERIFIED' AND "revoked_at" IS NULL)
    )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_res_verifications_resource_id"
ON "governance"."resource_verifications" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_verifications_version_id"
ON "governance"."resource_verifications" ("resource_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_res_verifications_status"
ON "governance"."resource_verifications" ("verification_status");
--> statement-breakpoint

-- Partial unique index: at most one active verification per resource version
CREATE UNIQUE INDEX IF NOT EXISTS "uq_single_active_resource_verification"
ON "governance"."resource_verifications" ("resource_id", "resource_version_id")
WHERE "verification_status" = 'VERIFIED';
--> statement-breakpoint

-- 4. Foreign Key Integrity Trigger: ensure quality check resource_version_id belongs to resource_id
CREATE OR REPLACE FUNCTION "governance"."fn_check_quality_check_version_match"()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_resource_id UUID;
BEGIN
    SELECT resource_id INTO v_parent_resource_id
    FROM "content"."resource_versions"
    WHERE id = NEW.resource_version_id;

    IF v_parent_resource_id IS NULL OR v_parent_resource_id <> NEW.resource_id THEN
        RAISE EXCEPTION 'Quality check resource_version_id % does not belong to resource_id %',
            NEW.resource_version_id, NEW.resource_id
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_check_quality_check_version_match" ON "governance"."resource_quality_checks";
--> statement-breakpoint
CREATE TRIGGER "trg_check_quality_check_version_match"
BEFORE INSERT ON "governance"."resource_quality_checks"
FOR EACH ROW
EXECUTE FUNCTION "governance"."fn_check_quality_check_version_match"();
--> statement-breakpoint

-- 5. Foreign Key Integrity Trigger: ensure resource_verification resource_version_id belongs to resource_id
CREATE OR REPLACE FUNCTION "governance"."fn_check_verification_version_match"()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_resource_id UUID;
BEGIN
    SELECT resource_id INTO v_parent_resource_id
    FROM "content"."resource_versions"
    WHERE id = NEW.resource_version_id;

    IF v_parent_resource_id IS NULL OR v_parent_resource_id <> NEW.resource_id THEN
        RAISE EXCEPTION 'Resource verification resource_version_id % does not belong to resource_id %',
            NEW.resource_version_id, NEW.resource_id
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_check_verification_version_match" ON "governance"."resource_verifications";
--> statement-breakpoint
CREATE TRIGGER "trg_check_verification_version_match"
BEFORE INSERT ON "governance"."resource_verifications"
FOR EACH ROW
EXECUTE FUNCTION "governance"."fn_check_verification_version_match"();
--> statement-breakpoint

-- 6. Append-Only Trigger Defense for Quality Evaluations (Technical Correction B)
CREATE OR REPLACE FUNCTION "governance"."fn_prevent_quality_check_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mutation or deletion of resource quality check audit records is prohibited.'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_quality_checks_update" ON "governance"."resource_quality_checks";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_quality_checks_update"
BEFORE UPDATE ON "governance"."resource_quality_checks"
FOR EACH ROW
EXECUTE FUNCTION "governance"."fn_prevent_quality_check_mutation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_quality_checks_delete" ON "governance"."resource_quality_checks";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_quality_checks_delete"
BEFORE DELETE ON "governance"."resource_quality_checks"
FOR EACH ROW
EXECUTE FUNCTION "governance"."fn_prevent_quality_check_mutation"();
