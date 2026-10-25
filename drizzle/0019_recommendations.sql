-- ============================================================================
-- Migration 0019: Hybrid Recommendations, Editorial Rules & Cache Invalidation
-- Milestone: Prompt 30
-- ============================================================================

-- 1. Create controlled enums in content schema
DO $$ BEGIN
    CREATE TYPE "content"."recommendation_rule_type" AS ENUM ('PIN', 'EXCLUDE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    CREATE TYPE "content"."recommendation_rule_status" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- 2. Editorial recommendation rules table (soft-deactivated, never hard-deleted)
CREATE TABLE IF NOT EXISTS "content"."resource_recommendation_rules" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "country_id" UUID NOT NULL,
    "rule_type" "content"."recommendation_rule_type" NOT NULL,
    "status" "content"."recommendation_rule_status" NOT NULL DEFAULT 'ACTIVE',
    "source_resource_id" UUID,
    "source_topic_id" UUID,
    "target_resource_id" UUID NOT NULL,
    "priority" INTEGER,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deactivated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,
    "deactivation_reason" TEXT,

    CONSTRAINT "fk_rec_rules_country"
        FOREIGN KEY ("country_id")
        REFERENCES "platform"."countries"("id") ON DELETE RESTRICT,

    -- Enforces target_resource_id belongs to country_id via existing uq_resources_id_country
    CONSTRAINT "fk_rec_rules_target_resource_country"
        FOREIGN KEY ("target_resource_id", "country_id")
        REFERENCES "content"."resources"("id", "country_id") ON DELETE RESTRICT,

    -- Enforces source_resource_id (when non-null) belongs to country_id via uq_resources_id_country
    CONSTRAINT "fk_rec_rules_source_resource_country"
        FOREIGN KEY ("source_resource_id", "country_id")
        REFERENCES "content"."resources"("id", "country_id") ON DELETE RESTRICT,

    -- Enforces source_topic_id references verified taxonomy.topics table
    CONSTRAINT "fk_rec_rules_source_topic"
        FOREIGN KEY ("source_topic_id")
        REFERENCES "taxonomy"."topics"("id") ON DELETE RESTRICT,

    -- Verified identity.users foreign keys
    CONSTRAINT "fk_rec_rules_created_by"
        FOREIGN KEY ("created_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_rec_rules_deactivated_by"
        FOREIGN KEY ("deactivated_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    -- Exactly one scope: source_resource_id XOR source_topic_id
    CONSTRAINT "chk_rec_rules_scope_xor"
        CHECK (
            ("source_resource_id" IS NOT NULL AND "source_topic_id" IS NULL) OR
            ("source_resource_id" IS NULL AND "source_topic_id" IS NOT NULL)
        ),

    -- Priority required (1..10) for PIN and forbidden (NULL) for EXCLUDE
    CONSTRAINT "chk_rec_rules_priority"
        CHECK (
            ("rule_type" = 'PIN' AND "priority" BETWEEN 1 AND 10) OR
            ("rule_type" = 'EXCLUDE' AND "priority" IS NULL)
        ),

    -- Prevent self-recommendation
    CONSTRAINT "chk_rec_rules_no_self_target"
        CHECK ("source_resource_id" IS DISTINCT FROM "target_resource_id"),

    -- Mandatory non-empty creation reason
    CONSTRAINT "chk_rec_rules_reason_not_empty"
        CHECK (length(trim("reason")) >= 3),

    -- Deactivation state consistency
    CONSTRAINT "chk_rec_rules_deactivation_state"
        CHECK (
            ("status" = 'ACTIVE' AND "deactivated_at" IS NULL AND "deactivated_by" IS NULL AND "deactivation_reason" IS NULL) OR
            ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL AND "deactivated_by" IS NOT NULL AND "deactivation_reason" IS NOT NULL AND length(trim("deactivation_reason")) >= 3)
        )
);
--> statement-breakpoint

-- 3. Database-level country consistency & permanent hard-delete prevention trigger
CREATE OR REPLACE FUNCTION "content"."fn_validate_rec_rule_governance"()
RETURNS TRIGGER AS $$
DECLARE
    v_topic_country_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of content.resource_recommendation_rules is permanently disallowed; deactivate rules via status = INACTIVE'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_topic_id IS NOT NULL THEN
        SELECT cv.country_id INTO v_topic_country_id
        FROM "taxonomy"."topics" t
        INNER JOIN "taxonomy"."curriculum_versions" cv ON cv.id = t.curriculum_version_id
        WHERE t.id = NEW.source_topic_id;

        IF v_topic_country_id IS NULL OR v_topic_country_id <> NEW.country_id THEN
            RAISE EXCEPTION 'Recommendation rule source_topic_id % does not belong to country_id %',
                NEW.source_topic_id, NEW.country_id
            USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_validate_rec_rule_ins_upd" ON "content"."resource_recommendation_rules";
--> statement-breakpoint
CREATE TRIGGER "trg_validate_rec_rule_ins_upd"
BEFORE INSERT OR UPDATE ON "content"."resource_recommendation_rules"
FOR EACH ROW EXECUTE FUNCTION "content"."fn_validate_rec_rule_governance"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_prevent_rec_rule_delete" ON "content"."resource_recommendation_rules";
--> statement-breakpoint
CREATE TRIGGER "trg_prevent_rec_rule_delete"
BEFORE DELETE ON "content"."resource_recommendation_rules"
FOR EACH ROW EXECUTE FUNCTION "content"."fn_validate_rec_rule_governance"();
--> statement-breakpoint

-- 4. Partial unique indexes preventing duplicate or conflicting ACTIVE rules on the same (source, target)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_rec_rules_active_source_resource_target"
    ON "content"."resource_recommendation_rules" ("source_resource_id", "target_resource_id")
    WHERE "status" = 'ACTIVE' AND "source_resource_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_rec_rules_active_source_topic_target"
    ON "content"."resource_recommendation_rules" ("source_topic_id", "target_resource_id")
    WHERE "status" = 'ACTIVE' AND "source_topic_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rec_rules_active_res_lookup"
    ON "content"."resource_recommendation_rules" ("country_id", "source_resource_id", "rule_type", "priority")
    WHERE "status" = 'ACTIVE' AND "source_resource_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rec_rules_active_topic_lookup"
    ON "content"."resource_recommendation_rules" ("country_id", "source_topic_id", "rule_type", "priority")
    WHERE "status" = 'ACTIVE' AND "source_topic_id" IS NOT NULL;
--> statement-breakpoint

-- 5. Covering partial indexes for behavioural co-occurrence on analytics.analytics_events
CREATE INDEX IF NOT EXISTS "idx_analytics_events_resource_cooccurrence"
    ON "analytics"."analytics_events" (
        "entity_id",
        "event_type_id",
        "occurred_at" DESC,
        "actor_type",
        "user_id",
        "anonymous_session_hash"
    )
    INCLUDE ("country_id")
    WHERE "entity_type" = 'resource'
      AND "actor_type" IN ('AUTHENTICATED', 'ANONYMOUS');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_analytics_events_auth_actor_resources"
    ON "analytics"."analytics_events" (
        "user_id",
        "event_type_id",
        "occurred_at" DESC,
        "entity_id"
    )
    INCLUDE ("country_id")
    WHERE "entity_type" = 'resource'
      AND "actor_type" = 'AUTHENTICATED'
      AND "user_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_analytics_events_anon_actor_resources"
    ON "analytics"."analytics_events" (
        "anonymous_session_hash",
        "event_type_id",
        "occurred_at" DESC,
        "entity_id"
    )
    INCLUDE ("country_id")
    WHERE "entity_type" = 'resource'
      AND "actor_type" = 'ANONYMOUS'
      AND "anonymous_session_hash" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_resources_country_published_scoring"
    ON "content"."resources" ("country_id", "id")
    INCLUDE ("resource_type_id", "curriculum_id", "grade_id", "subject_id", "topic_id", "quality_label")
    WHERE "status" = 'PUBLISHED';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_resource_versions_published_scoring"
    ON "content"."resource_versions" ("resource_id")
    INCLUDE ("id", "quality_label", "published_at")
    WHERE "status" = 'PUBLISHED'
      AND "published_at" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_resource_verifications_active_version"
    ON "governance"."resource_verifications" ("resource_version_id", "resource_id")
    INCLUDE ("id", "verified_at")
    WHERE "verification_status" = 'VERIFIED';
--> statement-breakpoint

-- 6. Cross-instance cache invalidation trigger function covering all 7 relevant tables
CREATE OR REPLACE FUNCTION "content"."notify_recommendation_invalidation"()
RETURNS TRIGGER AS $$
DECLARE
    v_old_country UUID;
    v_new_country UUID;
    v_old_topic UUID;
    v_new_topic UUID;
BEGIN
    -- Table 1: content.resource_recommendation_rules
    IF TG_TABLE_SCHEMA = 'content' AND TG_TABLE_NAME = 'resource_recommendation_rules' THEN
        IF TG_OP = 'INSERT' THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'rule', 'op', 'INSERT',
                'country_id', NEW.country_id,
                'source_resource_id', NEW.source_resource_id,
                'source_topic_id', NEW.source_topic_id,
                'target_resource_id', NEW.target_resource_id
            )::text);
        ELSIF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'rule', 'op', 'DELETE',
                'country_id', OLD.country_id,
                'source_resource_id', OLD.source_resource_id,
                'source_topic_id', OLD.source_topic_id,
                'target_resource_id', OLD.target_resource_id
            )::text);
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.country_id IS DISTINCT FROM NEW.country_id) OR
               (OLD.source_resource_id IS DISTINCT FROM NEW.source_resource_id) OR
               (OLD.source_topic_id IS DISTINCT FROM NEW.source_topic_id) OR
               (OLD.target_resource_id IS DISTINCT FROM NEW.target_resource_id) OR
               (OLD.rule_type IS DISTINCT FROM NEW.rule_type) OR
               (OLD.status IS DISTINCT FROM NEW.status) OR
               (OLD.priority IS DISTINCT FROM NEW.priority) THEN
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'rule', 'op', 'UPDATE_OLD',
                    'country_id', OLD.country_id,
                    'source_resource_id', OLD.source_resource_id,
                    'source_topic_id', OLD.source_topic_id,
                    'target_resource_id', OLD.target_resource_id
                )::text);
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'rule', 'op', 'UPDATE_NEW',
                    'country_id', NEW.country_id,
                    'source_resource_id', NEW.source_resource_id,
                    'source_topic_id', NEW.source_topic_id,
                    'target_resource_id', NEW.target_resource_id
                )::text);
            END IF;
        END IF;

    -- Table 2: content.resources
    ELSIF TG_TABLE_SCHEMA = 'content' AND TG_TABLE_NAME = 'resources' THEN
        IF TG_OP = 'INSERT' THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'resource', 'op', 'INSERT',
                'country_id', NEW.country_id,
                'source_resource_id', NEW.id,
                'source_topic_id', NEW.topic_id,
                'target_resource_id', NEW.id
            )::text);
        ELSIF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'resource', 'op', 'DELETE',
                'country_id', OLD.country_id,
                'source_resource_id', OLD.id,
                'source_topic_id', OLD.topic_id,
                'target_resource_id', OLD.id
            )::text);
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.status IS DISTINCT FROM NEW.status) OR
               (OLD.country_id IS DISTINCT FROM NEW.country_id) OR
               (OLD.resource_type_id IS DISTINCT FROM NEW.resource_type_id) OR
               (OLD.curriculum_id IS DISTINCT FROM NEW.curriculum_id) OR
               (OLD.curriculum_version_id IS DISTINCT FROM NEW.curriculum_version_id) OR
               (OLD.education_level_id IS DISTINCT FROM NEW.education_level_id) OR
               (OLD.grade_id IS DISTINCT FROM NEW.grade_id) OR
               (OLD.pathway_id IS DISTINCT FROM NEW.pathway_id) OR
               (OLD.subject_id IS DISTINCT FROM NEW.subject_id) OR
               (OLD.topic_id IS DISTINCT FROM NEW.topic_id) OR
               (OLD.quality_label IS DISTINCT FROM NEW.quality_label) OR
               (OLD.title IS DISTINCT FROM NEW.title) OR
               (OLD.slug IS DISTINCT FROM NEW.slug) OR
               (OLD.description IS DISTINCT FROM NEW.description) THEN
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'resource', 'op', 'UPDATE_OLD',
                    'country_id', OLD.country_id,
                    'source_resource_id', OLD.id,
                    'source_topic_id', OLD.topic_id,
                    'target_resource_id', OLD.id
                )::text);
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'resource', 'op', 'UPDATE_NEW',
                    'country_id', NEW.country_id,
                    'source_resource_id', NEW.id,
                    'source_topic_id', NEW.topic_id,
                    'target_resource_id', NEW.id
                )::text);
            END IF;
        END IF;

    -- Table 3: content.resource_versions
    ELSIF TG_TABLE_SCHEMA = 'content' AND TG_TABLE_NAME = 'resource_versions' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT country_id, topic_id INTO v_new_country, v_new_topic
            FROM "content"."resources" WHERE id = NEW.resource_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'version', 'op', 'INSERT',
                'country_id', v_new_country,
                'source_resource_id', NEW.resource_id,
                'source_topic_id', v_new_topic,
                'target_resource_id', NEW.resource_id
            )::text);
        ELSIF TG_OP = 'DELETE' THEN
            SELECT country_id, topic_id INTO v_old_country, v_old_topic
            FROM "content"."resources" WHERE id = OLD.resource_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'version', 'op', 'DELETE',
                'country_id', v_old_country,
                'source_resource_id', OLD.resource_id,
                'source_topic_id', v_old_topic,
                'target_resource_id', OLD.resource_id
            )::text);
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.resource_id IS DISTINCT FROM NEW.resource_id) OR
               (OLD.status IS DISTINCT FROM NEW.status) OR
               (OLD.published_at IS DISTINCT FROM NEW.published_at) OR
               (OLD.quality_label IS DISTINCT FROM NEW.quality_label) OR
               (OLD.version_number IS DISTINCT FROM NEW.version_number) OR
               (OLD.version_label IS DISTINCT FROM NEW.version_label) OR
               (OLD.title IS DISTINCT FROM NEW.title) OR
               (OLD.description IS DISTINCT FROM NEW.description) THEN
                SELECT country_id, topic_id INTO v_old_country, v_old_topic
                FROM "content"."resources" WHERE id = OLD.resource_id;
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'version', 'op', 'UPDATE_OLD',
                    'country_id', v_old_country,
                    'source_resource_id', OLD.resource_id,
                    'source_topic_id', v_old_topic,
                    'target_resource_id', OLD.resource_id
                )::text);

                IF OLD.resource_id IS DISTINCT FROM NEW.resource_id THEN
                    SELECT country_id, topic_id INTO v_new_country, v_new_topic
                    FROM "content"."resources" WHERE id = NEW.resource_id;
                    PERFORM pg_notify('rec_invalid', json_build_object(
                        'scope', 'version', 'op', 'UPDATE_NEW',
                        'country_id', v_new_country,
                        'source_resource_id', NEW.resource_id,
                        'source_topic_id', v_new_topic,
                        'target_resource_id', NEW.resource_id
                    )::text);
                END IF;
            END IF;
        END IF;

    -- Table 4: governance.resource_verifications (affects VERIFIED = 15 pts quality score)
    ELSIF TG_TABLE_SCHEMA = 'governance' AND TG_TABLE_NAME = 'resource_verifications' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT country_id, topic_id INTO v_new_country, v_new_topic
            FROM "content"."resources" WHERE id = NEW.resource_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'verification', 'op', 'INSERT',
                'country_id', v_new_country,
                'source_resource_id', NEW.resource_id,
                'source_topic_id', v_new_topic,
                'target_resource_id', NEW.resource_id
            )::text);
        ELSIF TG_OP = 'DELETE' THEN
            SELECT country_id, topic_id INTO v_old_country, v_old_topic
            FROM "content"."resources" WHERE id = OLD.resource_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'verification', 'op', 'DELETE',
                'country_id', v_old_country,
                'source_resource_id', OLD.resource_id,
                'source_topic_id', v_old_topic,
                'target_resource_id', OLD.resource_id
            )::text);
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.verification_status IS DISTINCT FROM NEW.verification_status) OR
               (OLD.resource_id IS DISTINCT FROM NEW.resource_id) OR
               (OLD.resource_version_id IS DISTINCT FROM NEW.resource_version_id) THEN
                SELECT country_id, topic_id INTO v_old_country, v_old_topic
                FROM "content"."resources" WHERE id = OLD.resource_id;
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'verification', 'op', 'UPDATE_OLD',
                    'country_id', v_old_country,
                    'source_resource_id', OLD.resource_id,
                    'source_topic_id', v_old_topic,
                    'target_resource_id', OLD.resource_id
                )::text);
                IF OLD.resource_id IS DISTINCT FROM NEW.resource_id THEN
                    SELECT country_id, topic_id INTO v_new_country, v_new_topic
                    FROM "content"."resources" WHERE id = NEW.resource_id;
                    PERFORM pg_notify('rec_invalid', json_build_object(
                        'scope', 'verification', 'op', 'UPDATE_NEW',
                        'country_id', v_new_country,
                        'source_resource_id', NEW.resource_id,
                        'source_topic_id', v_new_topic,
                        'target_resource_id', NEW.resource_id
                    )::text);
                END IF;
            END IF;
        END IF;

    -- Table 5: taxonomy.topics (affects exact/parent/child topic weights and topic rules)
    ELSIF TG_TABLE_SCHEMA = 'taxonomy' AND TG_TABLE_NAME = 'topics' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT country_id INTO v_new_country
            FROM "taxonomy"."curriculum_versions" WHERE id = NEW.curriculum_version_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'topic', 'op', 'INSERT',
                'country_id', v_new_country,
                'source_topic_id', NEW.id,
                'related_topic_id', NEW.parent_id
            )::text);
        ELSIF TG_OP = 'DELETE' THEN
            SELECT country_id INTO v_old_country
            FROM "taxonomy"."curriculum_versions" WHERE id = OLD.curriculum_version_id;
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'topic', 'op', 'DELETE',
                'country_id', v_old_country,
                'source_topic_id', OLD.id,
                'related_topic_id', OLD.parent_id
            )::text);
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.parent_id IS DISTINCT FROM NEW.parent_id) OR
               (OLD.status IS DISTINCT FROM NEW.status) OR
               (OLD.subject_id IS DISTINCT FROM NEW.subject_id) OR
               (OLD.curriculum_version_id IS DISTINCT FROM NEW.curriculum_version_id) THEN
                SELECT country_id INTO v_old_country
                FROM "taxonomy"."curriculum_versions" WHERE id = OLD.curriculum_version_id;
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'topic', 'op', 'UPDATE_OLD',
                    'country_id', v_old_country,
                    'source_topic_id', OLD.id,
                    'related_topic_id', OLD.parent_id
                )::text);
                SELECT country_id INTO v_new_country
                FROM "taxonomy"."curriculum_versions" WHERE id = NEW.curriculum_version_id;
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'topic', 'op', 'UPDATE_NEW',
                    'country_id', v_new_country,
                    'source_topic_id', NEW.id,
                    'related_topic_id', NEW.parent_id
                )::text);
            END IF;
        END IF;

    -- Table 6: platform.countries (country status activation/deactivation)
    ELSIF TG_TABLE_SCHEMA = 'platform' AND TG_TABLE_NAME = 'countries' THEN
        IF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'country', 'op', 'DELETE', 'country_id', OLD.id
            )::text);
        ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'country', 'op', 'UPDATE', 'country_id', NEW.id
            )::text);
        END IF;

    -- Table 7: content.resource_types (pillar or status change)
    ELSIF TG_TABLE_SCHEMA = 'content' AND TG_TABLE_NAME = 'resource_types' THEN
        IF TG_OP = 'DELETE' OR
           (TG_OP = 'UPDATE' AND ((OLD.status IS DISTINCT FROM NEW.status) OR (OLD.pillar IS DISTINCT FROM NEW.pillar))) THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'global_type', 'op', TG_OP
            )::text);
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_rec_rules_invalidation" ON "content"."resource_recommendation_rules";
--> statement-breakpoint
CREATE TRIGGER "trg_rec_rules_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "content"."resource_recommendation_rules"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_resources_invalidation" ON "content"."resources";
--> statement-breakpoint
CREATE TRIGGER "trg_resources_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "content"."resources"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_resource_versions_invalidation" ON "content"."resource_versions";
--> statement-breakpoint
CREATE TRIGGER "trg_resource_versions_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "content"."resource_versions"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_resource_verifications_invalidation" ON "governance"."resource_verifications";
--> statement-breakpoint
CREATE TRIGGER "trg_resource_verifications_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "governance"."resource_verifications"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_topics_invalidation" ON "taxonomy"."topics";
--> statement-breakpoint
CREATE TRIGGER "trg_topics_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "taxonomy"."topics"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_countries_invalidation" ON "platform"."countries";
--> statement-breakpoint
CREATE TRIGGER "trg_countries_invalidation"
AFTER UPDATE OR DELETE ON "platform"."countries"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_resource_types_invalidation" ON "content"."resource_types";
--> statement-breakpoint
CREATE TRIGGER "trg_resource_types_invalidation"
AFTER UPDATE OR DELETE ON "content"."resource_types"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
--> statement-breakpoint

-- 7. Compiled STABLE server-side candidate scoring & Top-20 hydration function (eliminates per-call multi-CTE planner overhead)
CREATE OR REPLACE FUNCTION "content"."fn_get_resource_scoring_dataset"(
    p_source_resource_id uuid,
    p_surface text,
    p_eval_now timestamptz
)
RETURNS TABLE (
    resource_id uuid,
    country_id uuid,
    country_name varchar,
    country_iso_code varchar,
    country_url_prefix varchar,
    grade_id uuid,
    subject_id uuid,
    topic_id uuid,
    topic_active boolean,
    topic_parent_id uuid,
    topic_parent_active boolean,
    pillar text,
    candidate_items json,
    rule_items json
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_country_id uuid;
    v_country_name varchar;
    v_country_iso varchar;
    v_country_prefix varchar;
    v_grade_id uuid;
    v_subject_id uuid;
    v_topic_id uuid;
    v_topic_active boolean;
    v_topic_parent_id uuid;
    v_topic_parent_active boolean;
    v_pillar text;
    v_comp_pillar text;
    v_event_type_ids uuid[];
    v_auth_users uuid[];
    v_anon_sessions varchar[];
    v_src_identity_total int;
    v_cut_31d timestamptz := p_eval_now - INTERVAL '744 hours';
    v_cut_91d timestamptz := p_eval_now - INTERVAL '2184 hours';
    v_cut_181d timestamptz := p_eval_now - INTERVAL '4344 hours';
    v_win_90d timestamptz := p_eval_now - INTERVAL '90 days';
    v_win_30d timestamptz := p_eval_now - INTERVAL '30 days';
    v_top_res_ids uuid[];
    v_top_ver_ids uuid[];
    v_top_ncos int[];
    v_candidate_items json;
    v_rule_items json;
BEGIN
    -- 1. Active Publication Gate & metadata lookup on source resource
    SELECT
        r.country_id,
        c.name,
        c.iso_code,
        c.url_prefix,
        r.grade_id,
        r.subject_id,
        r.topic_id,
        (t.id IS NOT NULL AND t.status = 'ACTIVE'),
        t.parent_id,
        (tp.id IS NOT NULL AND tp.status = 'ACTIVE'),
        rt.pillar::text
    INTO
        v_country_id,
        v_country_name,
        v_country_iso,
        v_country_prefix,
        v_grade_id,
        v_subject_id,
        v_topic_id,
        v_topic_active,
        v_topic_parent_id,
        v_topic_parent_active,
        v_pillar
    FROM content.resources r
    INNER JOIN content.resource_versions rv
        ON rv.resource_id = r.id
       AND rv.status = 'PUBLISHED'
       AND rv.published_at IS NOT NULL
    INNER JOIN platform.countries c
        ON c.id = r.country_id
       AND c.status = 'ACTIVE'
    INNER JOIN content.resource_types rt
        ON rt.id = r.resource_type_id
       AND rt.status = 'ACTIVE'
    LEFT JOIN taxonomy.topics t
        ON t.id = r.topic_id
    LEFT JOIN taxonomy.topics tp
        ON tp.id = t.parent_id
    WHERE r.id = p_source_resource_id
      AND r.status = 'PUBLISHED'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_comp_pillar := CASE v_pillar
        WHEN 'PAST_PAPERS' THEN 'NOTES_REVISION'
        WHEN 'NOTES_REVISION' THEN 'PAST_PAPERS'
        WHEN 'LESSON_PLANS' THEN 'SCHEMES_OF_WORK'
        WHEN 'SCHEMES_OF_WORK' THEN 'LESSON_PLANS'
        WHEN 'SCHOOL_DOCUMENTS' THEN 'TEACHER_RESOURCES'
        WHEN 'TEACHER_RESOURCES' THEN 'SCHOOL_DOCUMENTS'
        WHEN 'ACADEMIC_CALENDAR' THEN 'EDUCATION_UPDATES'
        WHEN 'EDUCATION_UPDATES' THEN 'ACADEMIC_CALENDAR'
        ELSE NULL
    END;

    -- 2. Active editorial rules applicable to source resource or active source topic
    SELECT json_agg(
        json_build_object(
            'id', rr.id,
            'ruleType', rr.rule_type,
            'sourceResourceId', rr.source_resource_id,
            'sourceTopicId', rr.source_topic_id,
            'targetResourceId', rr.target_resource_id,
            'priority', rr.priority
        )
    )
    INTO v_rule_items
    FROM content.resource_recommendation_rules rr
    WHERE rr.country_id = v_country_id
      AND rr.status = 'ACTIVE'
      AND (
          rr.source_resource_id = p_source_resource_id
          OR (v_topic_active AND v_topic_id IS NOT NULL AND rr.source_topic_id = v_topic_id)
      );

    -- 3. Qualifying source behavioural identities (90d AUTHENTICATED + 30d ANONYMOUS view/download)
    SELECT ARRAY(
        SELECT et.id
        FROM analytics.analytics_event_types et
        WHERE et.event_code IN ('view', 'download')
          AND et.status = 'ACTIVE'
    ) INTO v_event_type_ids;

    IF coalesce(cardinality(v_event_type_ids), 0) > 0 THEN
        SELECT ARRAY(
            SELECT DISTINCT e.user_id
            FROM analytics.analytics_events e
            WHERE e.entity_type = 'resource'
              AND e.entity_id = p_source_resource_id
              AND e.event_type_id = ANY(v_event_type_ids)
              AND e.actor_type = 'AUTHENTICATED'
              AND e.user_id IS NOT NULL
              AND (e.country_id IS NULL OR e.country_id = v_country_id)
              AND e.occurred_at >= v_win_90d
              AND e.occurred_at <= p_eval_now
        ) INTO v_auth_users;

        SELECT ARRAY(
            SELECT DISTINCT e.anonymous_session_hash
            FROM analytics.analytics_events e
            WHERE e.entity_type = 'resource'
              AND e.entity_id = p_source_resource_id
              AND e.event_type_id = ANY(v_event_type_ids)
              AND e.actor_type = 'ANONYMOUS'
              AND e.anonymous_session_hash IS NOT NULL
              AND e.anonymous_session_hash ~ '^[a-f0-9]{64}$'
              AND (e.country_id IS NULL OR e.country_id = v_country_id)
              AND e.occurred_at >= v_win_30d
              AND e.occurred_at <= p_eval_now
        ) INTO v_anon_sessions;
    END IF;

    v_src_identity_total := coalesce(cardinality(v_auth_users), 0) + coalesce(cardinality(v_anon_sessions), 0);

    -- 4. Score & select Top-20 candidates
    IF v_src_identity_total < 3 THEN
        -- Fast path: fewer than 3 source identities exist, so N_co < 3 and S_behav = 0 for all candidates
        IF p_surface = 'teachers-also-viewed' THEN
            v_top_res_ids := ARRAY[]::uuid[];
            v_top_ver_ids := ARRAY[]::uuid[];
            v_top_ncos := ARRAY[]::int[];
        ELSE
            WITH rule_summary AS (
                SELECT
                    rr.target_resource_id,
                    BOOL_OR(rr.rule_type = 'EXCLUDE') AS is_excluded,
                    MIN(rr.priority) FILTER (WHERE rr.rule_type = 'PIN' AND rr.source_resource_id IS NOT NULL) AS res_pin_prio,
                    MIN(rr.priority) FILTER (WHERE rr.rule_type = 'PIN' AND rr.source_topic_id IS NOT NULL) AS top_pin_prio
                FROM content.resource_recommendation_rules rr
                WHERE rr.country_id = v_country_id
                  AND rr.status = 'ACTIVE'
                  AND (
                      rr.source_resource_id = p_source_resource_id
                      OR (v_topic_active AND v_topic_id IS NOT NULL AND rr.source_topic_id = v_topic_id)
                  )
                GROUP BY rr.target_resource_id
            ),
            scored AS (
                SELECT
                    r.id AS res_id,
                    rv.id AS ver_id,
                    rv.published_at,
                    rt.pillar::text AS cand_pillar,
                    rs.res_pin_prio,
                    rs.top_pin_prio,
                    LEAST(
                        50,
                        (
                            CASE
                                WHEN v_topic_id IS NOT NULL AND v_topic_active AND r.topic_id IS NOT NULL AND t.id IS NOT NULL AND t.status = 'ACTIVE' THEN
                                    CASE
                                        WHEN r.topic_id = v_topic_id THEN 30
                                        WHEN (v_topic_parent_id IS NOT NULL AND v_topic_parent_active AND r.topic_id = v_topic_parent_id)
                                          OR (t.parent_id IS NOT NULL AND t.parent_id = v_topic_id) THEN 15
                                        ELSE 0
                                    END
                                ELSE 0
                            END
                        ) +
                        (CASE WHEN v_subject_id IS NOT NULL AND r.subject_id = v_subject_id THEN 15 ELSE 0 END) +
                        (CASE WHEN v_grade_id IS NOT NULL AND r.grade_id = v_grade_id THEN 10 ELSE 0 END) +
                        (CASE WHEN v_comp_pillar IS NOT NULL AND rt.pillar::text = v_comp_pillar THEN 5 ELSE 0 END)
                    ) AS s_meta,
                    (
                        CASE
                            WHEN gv.id IS NOT NULL OR rv.quality_label = 'VERIFIED' THEN 15
                            WHEN rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM' THEN 5
                            ELSE 0
                        END
                    ) AS s_qual,
                    (
                        CASE
                            WHEN rv.published_at > v_cut_31d THEN 10
                            WHEN rv.published_at > v_cut_91d THEN 6
                            WHEN rv.published_at > v_cut_181d THEN 3
                            ELSE 0
                        END
                    ) AS s_fresh
                FROM content.resources r
                INNER JOIN content.resource_versions rv
                    ON rv.resource_id = r.id
                   AND rv.status = 'PUBLISHED'
                   AND rv.published_at IS NOT NULL
                INNER JOIN content.resource_types rt
                    ON rt.id = r.resource_type_id
                   AND rt.status = 'ACTIVE'
                LEFT JOIN governance.resource_verifications gv
                    ON gv.resource_id = r.id
                   AND gv.resource_version_id = rv.id
                   AND gv.verification_status = 'VERIFIED'
                LEFT JOIN taxonomy.topics t
                    ON t.id = r.topic_id
                LEFT JOIN rule_summary rs
                    ON rs.target_resource_id = r.id
                WHERE r.country_id = v_country_id
                  AND r.id <> p_source_resource_id
                  AND r.status = 'PUBLISHED'
                  AND COALESCE(rs.is_excluded, false) = false
            ),
            top_20 AS (
                SELECT sc.res_id, sc.ver_id
                FROM scored sc
                WHERE (
                    p_surface = 'related-resources'
                    OR (p_surface = 'you-may-also-need' AND sc.cand_pillar <> v_pillar AND sc.s_meta > 0)
                )
                ORDER BY
                    CASE
                        WHEN p_surface = 'related-resources' AND sc.res_pin_prio IS NOT NULL THEN 1
                        WHEN p_surface = 'related-resources' AND sc.top_pin_prio IS NOT NULL THEN 2
                        ELSE 3
                    END ASC,
                    CASE
                        WHEN p_surface = 'related-resources' THEN COALESCE(sc.res_pin_prio, sc.top_pin_prio, 99)
                        ELSE 99
                    END ASC,
                    (sc.s_meta + sc.s_qual + sc.s_fresh) DESC,
                    sc.s_qual DESC,
                    sc.published_at DESC,
                    sc.res_id ASC
                LIMIT 20
            )
            SELECT
                COALESCE(array_agg(t20.res_id), ARRAY[]::uuid[]),
                COALESCE(array_agg(t20.ver_id), ARRAY[]::uuid[]),
                COALESCE(array_agg(0), ARRAY[]::int[])
            INTO v_top_res_ids, v_top_ver_ids, v_top_ncos
            FROM top_20 t20;
        END IF;
    ELSE
        -- Behavioural co-occurrence active path (v_src_identity_total >= 3)
        WITH auth_co AS (
            SELECT
                e.entity_id AS candidate_id,
                COUNT(DISTINCT e.user_id)::int AS cnt
            FROM analytics.analytics_events e
            WHERE coalesce(cardinality(v_auth_users), 0) > 0
              AND e.user_id = ANY(v_auth_users)
              AND e.entity_type = 'resource'
              AND e.actor_type = 'AUTHENTICATED'
              AND e.event_type_id = ANY(v_event_type_ids)
              AND e.entity_id <> p_source_resource_id
              AND (e.country_id IS NULL OR e.country_id = v_country_id)
              AND e.occurred_at >= v_win_90d
              AND e.occurred_at <= p_eval_now
            GROUP BY e.entity_id
        ),
        anon_co AS (
            SELECT
                e.entity_id AS candidate_id,
                COUNT(DISTINCT e.anonymous_session_hash)::int AS cnt
            FROM analytics.analytics_events e
            WHERE coalesce(cardinality(v_anon_sessions), 0) > 0
              AND e.anonymous_session_hash = ANY(v_anon_sessions)
              AND e.entity_type = 'resource'
              AND e.actor_type = 'ANONYMOUS'
              AND e.event_type_id = ANY(v_event_type_ids)
              AND e.entity_id <> p_source_resource_id
              AND (e.country_id IS NULL OR e.country_id = v_country_id)
              AND e.occurred_at >= v_win_30d
              AND e.occurred_at <= p_eval_now
            GROUP BY e.entity_id
        ),
        co_counts AS (
            SELECT
                COALESCE(ac.candidate_id, anc.candidate_id) AS candidate_id,
                (COALESCE(ac.cnt, 0) + COALESCE(anc.cnt, 0))::int AS n_co
            FROM auth_co ac
            FULL OUTER JOIN anon_co anc ON anc.candidate_id = ac.candidate_id
        ),
        rule_summary AS (
            SELECT
                rr.target_resource_id,
                BOOL_OR(rr.rule_type = 'EXCLUDE') AS is_excluded,
                MIN(rr.priority) FILTER (WHERE rr.rule_type = 'PIN' AND rr.source_resource_id IS NOT NULL) AS res_pin_prio,
                MIN(rr.priority) FILTER (WHERE rr.rule_type = 'PIN' AND rr.source_topic_id IS NOT NULL) AS top_pin_prio
            FROM content.resource_recommendation_rules rr
            WHERE rr.country_id = v_country_id
              AND rr.status = 'ACTIVE'
              AND (
                  rr.source_resource_id = p_source_resource_id
                  OR (v_topic_active AND v_topic_id IS NOT NULL AND rr.source_topic_id = v_topic_id)
              )
            GROUP BY rr.target_resource_id
        ),
        scored AS (
            SELECT
                r.id AS res_id,
                rv.id AS ver_id,
                rv.published_at,
                rt.pillar::text AS cand_pillar,
                COALESCE(cc.n_co, 0) AS n_co,
                rs.res_pin_prio,
                rs.top_pin_prio,
                LEAST(
                    50,
                    (
                        CASE
                            WHEN v_topic_id IS NOT NULL AND v_topic_active AND r.topic_id IS NOT NULL AND t.id IS NOT NULL AND t.status = 'ACTIVE' THEN
                                CASE
                                    WHEN r.topic_id = v_topic_id THEN 30
                                    WHEN (v_topic_parent_id IS NOT NULL AND v_topic_parent_active AND r.topic_id = v_topic_parent_id)
                                      OR (t.parent_id IS NOT NULL AND t.parent_id = v_topic_id) THEN 15
                                    ELSE 0
                                END
                            ELSE 0
                        END
                    ) +
                    (CASE WHEN v_subject_id IS NOT NULL AND r.subject_id = v_subject_id THEN 15 ELSE 0 END) +
                    (CASE WHEN v_grade_id IS NOT NULL AND r.grade_id = v_grade_id THEN 10 ELSE 0 END) +
                    (CASE WHEN v_comp_pillar IS NOT NULL AND rt.pillar::text = v_comp_pillar THEN 5 ELSE 0 END)
                ) AS s_meta,
                (
                    CASE
                        WHEN gv.id IS NOT NULL OR rv.quality_label = 'VERIFIED' THEN 15
                        WHEN rv.quality_label = 'PREMIUM' OR r.quality_label = 'PREMIUM' THEN 5
                        ELSE 0
                    END
                ) AS s_qual,
                (
                    CASE
                        WHEN rv.published_at > v_cut_31d THEN 10
                        WHEN rv.published_at > v_cut_91d THEN 6
                        WHEN rv.published_at > v_cut_181d THEN 3
                        ELSE 0
                    END
                ) AS s_fresh,
                (
                    CASE
                        WHEN COALESCE(cc.n_co, 0) < 3 THEN 0
                        ELSE LEAST(25, GREATEST(0, FLOOR(5.0 * LN(COALESCE(cc.n_co, 0)::double precision))::int))
                    END
                ) AS s_behav
            FROM content.resources r
            INNER JOIN content.resource_versions rv
                ON rv.resource_id = r.id
               AND rv.status = 'PUBLISHED'
               AND rv.published_at IS NOT NULL
            INNER JOIN content.resource_types rt
                ON rt.id = r.resource_type_id
               AND rt.status = 'ACTIVE'
            LEFT JOIN governance.resource_verifications gv
                ON gv.resource_id = r.id
               AND gv.resource_version_id = rv.id
               AND gv.verification_status = 'VERIFIED'
            LEFT JOIN taxonomy.topics t
                ON t.id = r.topic_id
            LEFT JOIN co_counts cc
                ON cc.candidate_id = r.id
            LEFT JOIN rule_summary rs
                ON rs.target_resource_id = r.id
            WHERE r.country_id = v_country_id
              AND r.id <> p_source_resource_id
              AND r.status = 'PUBLISHED'
              AND COALESCE(rs.is_excluded, false) = false
        ),
        top_20 AS (
            SELECT sc.res_id, sc.ver_id, sc.n_co
            FROM scored sc
            WHERE (
                p_surface = 'related-resources'
                OR (p_surface = 'you-may-also-need' AND sc.cand_pillar <> v_pillar AND sc.s_meta > 0)
                OR (p_surface = 'teachers-also-viewed' AND sc.n_co >= 3)
            )
            ORDER BY
                CASE
                    WHEN p_surface = 'related-resources' AND sc.res_pin_prio IS NOT NULL THEN 1
                    WHEN p_surface = 'related-resources' AND sc.top_pin_prio IS NOT NULL THEN 2
                    ELSE 3
                END ASC,
                CASE
                    WHEN p_surface = 'related-resources' THEN COALESCE(sc.res_pin_prio, sc.top_pin_prio, 99)
                    ELSE 99
                END ASC,
                CASE
                    WHEN p_surface = 'teachers-also-viewed' THEN sc.s_behav
                    ELSE 0
                END DESC,
                (sc.s_meta + sc.s_qual + sc.s_fresh + sc.s_behav) DESC,
                sc.s_qual DESC,
                sc.published_at DESC,
                sc.res_id ASC
            LIMIT 20
        )
        SELECT
            COALESCE(array_agg(t20.res_id), ARRAY[]::uuid[]),
            COALESCE(array_agg(t20.ver_id), ARRAY[]::uuid[]),
            COALESCE(array_agg(t20.n_co), ARRAY[]::int[])
        INTO v_top_res_ids, v_top_ver_ids, v_top_ncos
        FROM top_20 t20;
    END IF;

    -- 5. Hydrate ONLY the <= 20 selected winners in an independent tiny query plan
    IF coalesce(cardinality(v_top_res_ids), 0) > 0 THEN
        SELECT json_agg(
            json_build_object(
                'resourceId', r2.id,
                'displayTitle', COALESCE(NULLIF(trim(rv2.title), ''), r2.title),
                'slug', r2.slug,
                'displayDescription', COALESCE(NULLIF(trim(rv2.description), ''), r2.description),
                'versionId', rv2.id,
                'versionNumber', rv2.version_number,
                'versionLabel', rv2.version_label,
                'typeId', rt2.id,
                'typeCode', rt2.code,
                'typeName', rt2.name,
                'typeSlug', rt2.slug,
                'curriculumId', cur.id,
                'curriculumCode', cur.code,
                'curriculumName', cur.name,
                'gradeId', r2.grade_id,
                'gradeCode', g.code,
                'gradeName', g.name,
                'subjectId', r2.subject_id,
                'subjectCode', sub.code,
                'subjectName', sub.name,
                'topicId', r2.topic_id,
                'topicCode', top2.code,
                'topicName', top2.name,
                'topicActive', (t_raw.id IS NOT NULL AND t_raw.status = 'ACTIVE'),
                'topicParentId', t_raw.parent_id,
                'topicParentActive', (tp2.id IS NOT NULL AND tp2.status = 'ACTIVE'),
                'pillar', rt2.pillar,
                'resourceQualityLabel', r2.quality_label,
                'versionQualityLabel', rv2.quality_label,
                'hasActiveVersionVerification', (gv2.id IS NOT NULL),
                'verificationId', gv2.id,
                'verifiedAt', gv2.verified_at,
                'publishedAt', rv2.published_at,
                'distinctCoIdentityCount', u.n_co
            )
            ORDER BY u.ord ASC
        )
        INTO v_candidate_items
        FROM unnest(v_top_res_ids, v_top_ver_ids, v_top_ncos) WITH ORDINALITY AS u(res_id, ver_id, n_co, ord)
        INNER JOIN content.resources r2
            ON r2.id = u.res_id
        INNER JOIN content.resource_versions rv2
            ON rv2.id = u.ver_id
        INNER JOIN content.resource_types rt2
            ON rt2.id = r2.resource_type_id
        LEFT JOIN governance.resource_verifications gv2
            ON gv2.resource_id = r2.id
           AND gv2.resource_version_id = rv2.id
           AND gv2.verification_status = 'VERIFIED'
        LEFT JOIN taxonomy.curricula cur
            ON cur.id = r2.curriculum_id
        LEFT JOIN taxonomy.grades g
            ON g.id = r2.grade_id
        LEFT JOIN taxonomy.subjects sub
            ON sub.id = r2.subject_id
        LEFT JOIN taxonomy.topics t_raw
            ON t_raw.id = r2.topic_id
        LEFT JOIN taxonomy.topics top2
            ON top2.id = r2.topic_id
           AND top2.status = 'ACTIVE'
        LEFT JOIN taxonomy.topics tp2
            ON tp2.id = t_raw.parent_id
           AND tp2.status = 'ACTIVE';
    END IF;

    RETURN QUERY SELECT
        p_source_resource_id,
        v_country_id,
        v_country_name,
        v_country_iso,
        v_country_prefix,
        v_grade_id,
        v_subject_id,
        v_topic_id,
        v_topic_active,
        v_topic_parent_id,
        v_topic_parent_active,
        v_pillar,
        v_candidate_items,
        v_rule_items;
END;
$$;

