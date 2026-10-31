-- ============================================================================
-- Migration 0021: Homepage Intelligence, Editorial Scheduling, Atomic Rollback
--                 & Live SQL Eligibility Gate
-- Milestone: Prompt 32
-- ============================================================================

-- 1. Enable btree_gist in public schema for UUID equality + tstzrange overlap
--    exclusion constraint on SCHEDULED homepage windows.
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";
--> statement-breakpoint

-- 2. Controlled enums in content schema
DO $$ BEGIN
    CREATE TYPE "content"."homepage_config_status" AS ENUM (
        'DRAFT',
        'SCHEDULED',
        'PUBLISHED',
        'SUPERSEDED',
        'ROLLED_BACK',
        'ARCHIVED',
        'DISCARDED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    CREATE TYPE "content"."homepage_slot_key" AS ENUM (
        'trending_resources',
        'most_downloaded_resources',
        'curated_resources',
        'education_updates',
        'calendar_highlights',
        'curriculum_shortcuts'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    CREATE TYPE "content"."homepage_slot_mode" AS ENUM (
        'AUTOMATED',
        'CURATED_HYBRID',
        'MANUAL_OVERRIDE'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    CREATE TYPE "content"."homepage_entity_type" AS ENUM (
        'RESOURCE',
        'UPDATE',
        'CALENDAR_EVENT',
        'SUBJECT'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- 3. Pure IMMUTABLE SQL projection classifiers (C65 / C60 / C64)
--    Explicitly handles NULL columns via IS NOT TRUE / IS DISTINCT FROM so
--    three-valued SQL UNKNOWN never falls through to ELIGIBLE.
CREATE OR REPLACE FUNCTION "content"."fn_diag_homepage_resource_projection"(
    p_target_country_id UUID,
    p_eval_time TIMESTAMPTZ,
    p_res_exists BOOLEAN,
    p_res_country_id UUID,
    p_res_status TEXT,
    p_country_status TEXT,
    p_rt_status TEXT,
    p_school_id UUID,
    p_school_country_id UUID,
    p_school_status TEXT,
    p_pub_version_count INTEGER,
    p_pub_published_at TIMESTAMPTZ,
    p_avail_file_count INTEGER,
    p_curriculum_id UUID,
    p_cur_country_id UUID,
    p_cur_status TEXT,
    p_curriculum_version_id UUID,
    p_cv_country_id UUID,
    p_cv_curriculum_id UUID,
    p_cv_status TEXT,
    p_education_level_id UUID,
    p_el_cv_id UUID,
    p_el_status TEXT,
    p_grade_id UUID,
    p_g_cv_id UUID,
    p_g_el_id UUID,
    p_g_status TEXT,
    p_pathway_id UUID,
    p_p_cv_id UUID,
    p_p_el_id UUID,
    p_p_grade_id UUID,
    p_p_status TEXT,
    p_subject_id UUID,
    p_s_cv_id UUID,
    p_s_el_id UUID,
    p_s_grade_id UUID,
    p_s_pathway_id UUID,
    p_s_status TEXT,
    p_topic_id UUID,
    p_t_cv_id UUID,
    p_t_subject_id UUID,
    p_topic_ancestry_diag TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN p_target_country_id IS NULL OR p_eval_time IS NULL OR NOT isfinite(p_eval_time)
            THEN 'INVALID_EVALUATION_INPUT'
        WHEN p_res_exists IS NOT TRUE
            THEN 'ENTITY_NOT_FOUND'
        WHEN (p_res_country_id = p_target_country_id) IS NOT TRUE
            THEN 'COUNTRY_MISMATCH'
        WHEN (p_country_status = 'ACTIVE') IS NOT TRUE
            THEN 'COUNTRY_INACTIVE'
        WHEN (p_res_status = 'PUBLISHED') IS NOT TRUE
            THEN 'RESOURCE_NOT_PUBLISHED'
        WHEN (p_rt_status = 'ACTIVE') IS NOT TRUE
            THEN 'RESOURCE_TYPE_INACTIVE'
        WHEN p_school_id IS NOT NULL AND (p_school_country_id = p_target_country_id) IS NOT TRUE
            THEN 'SCHOOL_COUNTRY_MISMATCH'
        WHEN p_school_id IS NOT NULL AND (p_school_status = 'ACTIVE') IS NOT TRUE
            THEN 'SCHOOL_INACTIVE'
        WHEN COALESCE(p_pub_version_count, 0) = 0
            THEN 'NO_PUBLISHED_VERSION'
        WHEN p_pub_version_count > 1
            THEN 'MULTIPLE_PUBLISHED_VERSIONS'
        WHEN p_pub_published_at IS NULL OR NOT isfinite(p_pub_published_at) OR (p_pub_published_at <= p_eval_time) IS NOT TRUE
            THEN 'PUBLISHED_VERSION_FUTURE_DATED'
        WHEN COALESCE(p_avail_file_count, 0) < 1
            THEN 'NO_AVAILABLE_FILE'
        WHEN (p_topic_id IS NOT NULL AND p_subject_id IS NULL)
          OR (p_subject_id IS NOT NULL AND p_grade_id IS NULL)
          OR (p_pathway_id IS NOT NULL AND p_grade_id IS NULL)
          OR (p_grade_id IS NOT NULL AND p_education_level_id IS NULL)
          OR (p_education_level_id IS NOT NULL AND p_curriculum_version_id IS NULL)
          OR (p_curriculum_version_id IS NOT NULL AND p_curriculum_id IS NULL)
            THEN 'TAXONOMY_PARENT_MISSING'
        WHEN p_curriculum_id IS NOT NULL AND (p_cur_country_id = p_target_country_id) IS NOT TRUE
            THEN 'CURRICULUM_COUNTRY_MISMATCH'
        WHEN p_curriculum_id IS NOT NULL AND (p_cur_status = 'ACTIVE') IS NOT TRUE
            THEN 'CURRICULUM_INACTIVE'
        WHEN p_curriculum_version_id IS NOT NULL AND (
            (p_cv_country_id = p_target_country_id) IS NOT TRUE
            OR (p_cv_curriculum_id = p_curriculum_id) IS NOT TRUE
        )
            THEN 'CURRICULUM_VERSION_MISMATCH'
        WHEN p_curriculum_version_id IS NOT NULL AND (p_cv_status = 'CURRENT') IS NOT TRUE
            THEN 'CURRICULUM_VERSION_NOT_CURRENT'
        WHEN p_education_level_id IS NOT NULL AND (p_el_cv_id = p_curriculum_version_id) IS NOT TRUE
            THEN 'EDUCATION_LEVEL_MISMATCH'
        WHEN p_education_level_id IS NOT NULL AND (p_el_status = 'ACTIVE') IS NOT TRUE
            THEN 'EDUCATION_LEVEL_INACTIVE'
        WHEN p_grade_id IS NOT NULL AND (
            (p_g_cv_id = p_curriculum_version_id) IS NOT TRUE
            OR (p_g_el_id = p_education_level_id) IS NOT TRUE
        )
            THEN 'GRADE_MISMATCH'
        WHEN p_grade_id IS NOT NULL AND (p_g_status = 'ACTIVE') IS NOT TRUE
            THEN 'GRADE_INACTIVE'
        WHEN p_pathway_id IS NOT NULL AND (
            (p_p_cv_id = p_curriculum_version_id) IS NOT TRUE
            OR (p_p_el_id = p_education_level_id) IS NOT TRUE
            OR (p_p_grade_id = p_grade_id) IS NOT TRUE
        )
            THEN 'PATHWAY_MISMATCH'
        WHEN p_pathway_id IS NOT NULL AND (p_p_status = 'ACTIVE') IS NOT TRUE
            THEN 'PATHWAY_INACTIVE'
        WHEN p_subject_id IS NOT NULL AND (
            (p_s_cv_id = p_curriculum_version_id) IS NOT TRUE
            OR (p_s_el_id = p_education_level_id) IS NOT TRUE
            OR (p_s_grade_id = p_grade_id) IS NOT TRUE
            OR (p_s_pathway_id IS DISTINCT FROM p_pathway_id)
        )
            THEN 'SUBJECT_TAXONOMY_MISMATCH'
        WHEN p_subject_id IS NOT NULL AND (p_s_status = 'ACTIVE') IS NOT TRUE
            THEN 'SUBJECT_INACTIVE'
        WHEN p_topic_id IS NOT NULL AND (
            (p_t_cv_id = p_curriculum_version_id) IS NOT TRUE
            OR (p_t_subject_id = p_subject_id) IS NOT TRUE
        )
            THEN 'TOPIC_TAXONOMY_MISMATCH'
        WHEN p_topic_id IS NOT NULL AND (p_topic_ancestry_diag = 'ELIGIBLE') IS NOT TRUE
            THEN COALESCE(p_topic_ancestry_diag, 'TOPIC_ANCESTOR_MISSING')
        ELSE 'ELIGIBLE'
    END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "content"."fn_diag_homepage_subject_projection"(
    p_target_country_id UUID,
    p_eval_time TIMESTAMPTZ,
    p_sub_exists BOOLEAN,
    p_country_status TEXT,
    p_cur_id UUID,
    p_cur_country_id UUID,
    p_cur_status TEXT,
    p_s_cv_id UUID,
    p_cv_country_id UUID,
    p_cv_curriculum_id UUID,
    p_cv_status TEXT,
    p_s_el_id UUID,
    p_el_cv_id UUID,
    p_el_status TEXT,
    p_s_grade_id UUID,
    p_g_cv_id UUID,
    p_g_el_id UUID,
    p_g_status TEXT,
    p_s_pathway_id UUID,
    p_p_cv_id UUID,
    p_p_el_id UUID,
    p_p_grade_id UUID,
    p_p_status TEXT,
    p_s_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN p_target_country_id IS NULL OR p_eval_time IS NULL OR NOT isfinite(p_eval_time)
            THEN 'INVALID_EVALUATION_INPUT'
        WHEN p_sub_exists IS NOT TRUE
            THEN 'ENTITY_NOT_FOUND'
        WHEN (p_cv_country_id = p_target_country_id) IS NOT TRUE
            THEN 'COUNTRY_MISMATCH'
        WHEN (p_country_status = 'ACTIVE') IS NOT TRUE
            THEN 'COUNTRY_INACTIVE'
        WHEN (p_cur_country_id = p_target_country_id) IS NOT TRUE
            THEN 'CURRICULUM_COUNTRY_MISMATCH'
        WHEN (p_cur_status = 'ACTIVE') IS NOT TRUE
            THEN 'CURRICULUM_INACTIVE'
        WHEN (p_cv_curriculum_id = p_cur_id) IS NOT TRUE
            THEN 'CURRICULUM_VERSION_MISMATCH'
        WHEN (p_cv_status = 'CURRENT') IS NOT TRUE
            THEN 'CURRICULUM_VERSION_NOT_CURRENT'
        WHEN (p_el_cv_id = p_s_cv_id) IS NOT TRUE
            THEN 'EDUCATION_LEVEL_MISMATCH'
        WHEN (p_el_status = 'ACTIVE') IS NOT TRUE
            THEN 'EDUCATION_LEVEL_INACTIVE'
        WHEN (p_g_cv_id = p_s_cv_id) IS NOT TRUE OR (p_g_el_id = p_s_el_id) IS NOT TRUE
            THEN 'GRADE_MISMATCH'
        WHEN (p_g_status = 'ACTIVE') IS NOT TRUE
            THEN 'GRADE_INACTIVE'
        WHEN p_s_pathway_id IS NOT NULL AND (
            (p_p_cv_id = p_s_cv_id) IS NOT TRUE
            OR (p_p_el_id = p_s_el_id) IS NOT TRUE
            OR (p_p_grade_id = p_s_grade_id) IS NOT TRUE
        )
            THEN 'PATHWAY_MISMATCH'
        WHEN p_s_pathway_id IS NOT NULL AND (p_p_status = 'ACTIVE') IS NOT TRUE
            THEN 'PATHWAY_INACTIVE'
        WHEN (p_s_status = 'ACTIVE') IS NOT TRUE
            THEN 'SUBJECT_INACTIVE'
        ELSE 'ELIGIBLE'
    END;
$$;
--> statement-breakpoint

-- 4. Deterministic Topic Ancestry Diagnostic Helper (depth 1..16 inclusive)
CREATE OR REPLACE FUNCTION "content"."fn_diag_homepage_topic_ancestry"(
    p_leaf_topic_id UUID,
    p_expected_subject_id UUID,
    p_expected_cv_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_curr_id UUID := p_leaf_topic_id;
    v_depth INTEGER := 1;
    v_visited UUID[] := ARRAY[]::UUID[];
    v_node RECORD;
BEGIN
    IF p_leaf_topic_id IS NULL THEN
        RETURN 'ELIGIBLE';
    END IF;

    LOOP
        SELECT t.id, t.parent_id, t.subject_id, t.curriculum_version_id, t.status
        INTO v_node
        FROM "taxonomy"."topics" t
        WHERE t.id = v_curr_id;

        IF NOT FOUND THEN
            IF v_depth = 1 THEN
                RETURN 'TOPIC_ANCESTOR_MISSING';
            END IF;
            RETURN 'TOPIC_ANCESTOR_MISSING';
        END IF;

        IF (v_node.subject_id = p_expected_subject_id) IS NOT TRUE
           OR (v_node.curriculum_version_id = p_expected_cv_id) IS NOT TRUE THEN
            IF v_depth = 1 THEN
                RETURN 'TOPIC_TAXONOMY_MISMATCH';
            END IF;
            RETURN 'TOPIC_ANCESTOR_MISMATCH';
        END IF;

        IF (v_node.status = 'ACTIVE') IS NOT TRUE THEN
            IF v_depth = 1 THEN
                RETURN 'TOPIC_INACTIVE';
            END IF;
            RETURN 'TOPIC_ANCESTOR_INACTIVE';
        END IF;

        IF v_node.parent_id IS NULL THEN
            RETURN 'ELIGIBLE';
        END IF;

        v_visited := array_append(v_visited, v_node.id);

        IF v_node.parent_id = ANY(v_visited) THEN
            RETURN 'TOPIC_ANCESTRY_CYCLE';
        END IF;

        -- Verify parent existence before depth-16 overflow so missing parent at depth 16
        -- deterministically reports TOPIC_ANCESTOR_MISSING rather than TOPIC_ANCESTRY_TOO_DEEP.
        PERFORM 1 FROM "taxonomy"."topics" p WHERE p.id = v_node.parent_id;
        IF NOT FOUND THEN
            RETURN 'TOPIC_ANCESTOR_MISSING';
        END IF;

        IF v_depth >= 16 THEN
            RETURN 'TOPIC_ANCESTRY_TOO_DEEP';
        END IF;

        v_curr_id := v_node.parent_id;
        v_depth := v_depth + 1;
    END LOOP;
END;
$$;
--> statement-breakpoint

-- 5. Authoritative Live PostgreSQL Entity Eligibility Evaluator
CREATE OR REPLACE FUNCTION "content"."fn_evaluate_homepage_entity_eligibility"(
    p_target_country_id UUID,
    p_entity_type "content"."homepage_entity_type",
    p_entity_id UUID,
    p_eval_time TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_country_status TEXT;
    v_diag TEXT;
    v_u RECORD;
    v_ce RECORD;
BEGIN
    IF p_target_country_id IS NULL
       OR p_entity_type IS NULL
       OR p_entity_id IS NULL
       OR p_eval_time IS NULL
       OR NOT isfinite(p_eval_time) THEN
        RETURN 'INVALID_EVALUATION_INPUT';
    END IF;

    SELECT c.status INTO v_country_status
    FROM "platform"."countries" c
    WHERE c.id = p_target_country_id;

    IF NOT FOUND THEN
        RETURN 'COUNTRY_NOT_FOUND';
    END IF;

    IF p_entity_type = 'RESOURCE' THEN
        SELECT "content"."fn_diag_homepage_resource_projection"(
            p_target_country_id,
            p_eval_time,
            (r.id IS NOT NULL),
            r.country_id,
            r.status,
            v_country_status,
            rt.status,
            r.school_id,
            sch.country_id,
            sch.status,
            COALESCE(pv.pub_count, 0),
            pv.published_at,
            COALESCE(af.avail_count, 0),
            r.curriculum_id,
            cur.country_id,
            cur.status,
            r.curriculum_version_id,
            cv.country_id,
            cv.curriculum_id,
            cv.status,
            r.education_level_id,
            el.curriculum_version_id,
            el.status,
            r.grade_id,
            g.curriculum_version_id,
            g.education_level_id,
            g.status,
            r.pathway_id,
            p.curriculum_version_id,
            p.education_level_id,
            p.grade_id,
            p.status,
            r.subject_id,
            s.curriculum_version_id,
            s.education_level_id,
            s.grade_id,
            s.pathway_id,
            s.status,
            r.topic_id,
            t.curriculum_version_id,
            t.subject_id,
            CASE
                WHEN r.topic_id IS NOT NULL THEN
                    "content"."fn_diag_homepage_topic_ancestry"(r.topic_id, r.subject_id, r.curriculum_version_id)
                ELSE 'ELIGIBLE'
            END
        )
        INTO v_diag
        FROM (SELECT 1) AS anchor
        LEFT JOIN "content"."resources" r ON r.id = p_entity_id
        LEFT JOIN "content"."resource_types" rt ON rt.id = r.resource_type_id
        LEFT JOIN "platform"."schools" sch ON sch.id = r.school_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*)::int AS pub_count,
                MAX(rv.published_at) AS published_at,
                (ARRAY_AGG(rv.id ORDER BY rv.version_number DESC))[1] AS pub_version_id
            FROM "content"."resource_versions" rv
            WHERE rv.resource_id = r.id
              AND rv.status = 'PUBLISHED'
        ) pv ON r.id IS NOT NULL
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS avail_count
            FROM "files"."resource_files" rf
            WHERE pv.pub_count = 1
              AND rf.resource_version_id = pv.pub_version_id
              AND rf.status = 'AVAILABLE'
        ) af ON r.id IS NOT NULL
        LEFT JOIN "taxonomy"."curricula" cur ON cur.id = r.curriculum_id
        LEFT JOIN "taxonomy"."curriculum_versions" cv ON cv.id = r.curriculum_version_id
        LEFT JOIN "taxonomy"."education_levels" el ON el.id = r.education_level_id
        LEFT JOIN "taxonomy"."grades" g ON g.id = r.grade_id
        LEFT JOIN "taxonomy"."pathways" p ON p.id = r.pathway_id
        LEFT JOIN "taxonomy"."subjects" s ON s.id = r.subject_id
        LEFT JOIN "taxonomy"."topics" t ON t.id = r.topic_id;

        RETURN v_diag;

    ELSIF p_entity_type = 'SUBJECT' THEN
        SELECT "content"."fn_diag_homepage_subject_projection"(
            p_target_country_id,
            p_eval_time,
            (s.id IS NOT NULL),
            v_country_status,
            cur.id,
            cur.country_id,
            cur.status,
            s.curriculum_version_id,
            cv.country_id,
            cv.curriculum_id,
            cv.status,
            s.education_level_id,
            el.curriculum_version_id,
            el.status,
            s.grade_id,
            g.curriculum_version_id,
            g.education_level_id,
            g.status,
            s.pathway_id,
            p.curriculum_version_id,
            p.education_level_id,
            p.grade_id,
            p.status,
            s.status
        )
        INTO v_diag
        FROM (SELECT 1) AS anchor
        LEFT JOIN "taxonomy"."subjects" s ON s.id = p_entity_id
        LEFT JOIN "taxonomy"."curriculum_versions" cv ON cv.id = s.curriculum_version_id
        LEFT JOIN "taxonomy"."curricula" cur ON cur.id = cv.curriculum_id
        LEFT JOIN "taxonomy"."education_levels" el ON el.id = s.education_level_id
        LEFT JOIN "taxonomy"."grades" g ON g.id = s.grade_id
        LEFT JOIN "taxonomy"."pathways" p ON p.id = s.pathway_id;

        RETURN v_diag;

    ELSIF p_entity_type = 'UPDATE' THEN
        SELECT
            u.id,
            u.country_id,
            u.category_id,
            u.publication_status,
            u.published_at,
            cat.status AS category_status,
            EXISTS (
                SELECT 1
                FROM "content"."education_update_curricula" euc
                JOIN "taxonomy"."curricula" ucur ON ucur.id = euc.curriculum_id
                WHERE euc.update_id = u.id
                  AND (ucur.country_id = p_target_country_id) IS NOT TRUE
            ) AS has_cross_country_curriculum,
            EXISTS (
                SELECT 1
                FROM "content"."education_update_curricula" euc
                JOIN "taxonomy"."curricula" ucur ON ucur.id = euc.curriculum_id
                WHERE euc.update_id = u.id
                  AND (ucur.status = 'ACTIVE') IS NOT TRUE
            ) AS has_inactive_curriculum
        INTO v_u
        FROM "content"."education_updates" u
        LEFT JOIN "content"."education_update_categories" cat ON cat.id = u.category_id
        WHERE u.id = p_entity_id;

        IF NOT FOUND THEN
            RETURN 'ENTITY_NOT_FOUND';
        END IF;
        IF v_u.country_id IS NULL THEN
            RETURN 'UPDATE_COUNTRY_MISSING';
        END IF;
        IF (v_u.country_id = p_target_country_id) IS NOT TRUE THEN
            RETURN 'COUNTRY_MISMATCH';
        END IF;
        IF (v_country_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'COUNTRY_INACTIVE';
        END IF;
        IF (v_u.publication_status = 'PUBLISHED') IS NOT TRUE THEN
            RETURN 'UPDATE_NOT_PUBLISHED';
        END IF;
        IF v_u.published_at IS NULL OR NOT isfinite(v_u.published_at) THEN
            RETURN 'UPDATE_PUBLISHED_AT_MISSING';
        END IF;
        IF (v_u.published_at <= p_eval_time) IS NOT TRUE THEN
            RETURN 'UPDATE_FUTURE_DATED';
        END IF;
        IF v_u.category_id IS NOT NULL AND (v_u.category_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'UPDATE_CATEGORY_INACTIVE';
        END IF;
        IF v_u.has_cross_country_curriculum IS TRUE THEN
            RETURN 'UPDATE_CURRICULUM_COUNTRY_MISMATCH';
        END IF;
        IF v_u.has_inactive_curriculum IS TRUE THEN
            RETURN 'UPDATE_CURRICULUM_INACTIVE';
        END IF;

        RETURN 'ELIGIBLE';

    ELSIF p_entity_type = 'CALENDAR_EVENT' THEN
        SELECT
            ce.id,
            ce.start_date,
            ce.end_date,
            ce.source_type,
            ce.visibility,
            ce.status AS event_status,
            cal.id AS cal_id,
            cal.calendar_scope,
            cal.country_id AS cal_country_id,
            cal.curriculum_id AS cal_curriculum_id,
            cal.education_level_id AS cal_el_id,
            cal.school_id AS cal_school_id,
            cal.user_id AS cal_user_id,
            cal.session_id AS cal_session_id,
            cal.status AS cal_status,
            cal.expires_at AS cal_expires_at,
            cet.status AS event_type_status,
            cal_cur.country_id AS cal_cur_country_id,
            cal_cur.status AS cal_cur_status,
            cal_el.status AS cal_el_status,
            cal_el_cv.country_id AS cal_el_cv_country_id,
            cal_el_cv.curriculum_id AS cal_el_cv_curriculum_id,
            cal_el_cv.status AS cal_el_cv_status,
            cal_el_cur.status AS cal_el_cur_status
        INTO v_ce
        FROM "calendar"."calendar_events" ce
        LEFT JOIN "calendar"."calendars" cal ON cal.id = ce.calendar_id
        LEFT JOIN "calendar"."calendar_event_types" cet ON cet.id = ce.event_type_id
        LEFT JOIN "taxonomy"."curricula" cal_cur ON cal_cur.id = cal.curriculum_id
        LEFT JOIN "taxonomy"."education_levels" cal_el ON cal_el.id = cal.education_level_id
        LEFT JOIN "taxonomy"."curriculum_versions" cal_el_cv ON cal_el_cv.id = cal_el.curriculum_version_id
        LEFT JOIN "taxonomy"."curricula" cal_el_cur ON cal_el_cur.id = cal_el_cv.curriculum_id
        WHERE ce.id = p_entity_id;

        IF NOT FOUND THEN
            RETURN 'ENTITY_NOT_FOUND';
        END IF;
        IF (v_ce.calendar_scope = 'OFFICIAL') IS NOT TRUE THEN
            RETURN 'CALENDAR_NOT_OFFICIAL';
        END IF;
        IF v_ce.cal_school_id IS NOT NULL OR v_ce.cal_user_id IS NOT NULL OR v_ce.cal_session_id IS NOT NULL THEN
            RETURN 'CALENDAR_OWNER_CONTAMINATED';
        END IF;
        IF v_ce.cal_country_id IS NULL THEN
            RETURN 'CALENDAR_COUNTRY_MISSING';
        END IF;
        IF (v_ce.cal_country_id = p_target_country_id) IS NOT TRUE THEN
            RETURN 'COUNTRY_MISMATCH';
        END IF;
        IF (v_country_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'COUNTRY_INACTIVE';
        END IF;
        IF (v_ce.cal_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_INACTIVE';
        END IF;
        IF v_ce.cal_expires_at IS NOT NULL AND (v_ce.cal_expires_at > p_eval_time) IS NOT TRUE THEN
            RETURN 'CALENDAR_EXPIRED';
        END IF;
        IF v_ce.cal_curriculum_id IS NOT NULL AND (v_ce.cal_cur_country_id = p_target_country_id) IS NOT TRUE THEN
            RETURN 'CALENDAR_CURRICULUM_COUNTRY_MISMATCH';
        END IF;
        IF v_ce.cal_curriculum_id IS NOT NULL AND (v_ce.cal_cur_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_CURRICULUM_INACTIVE';
        END IF;
        IF v_ce.cal_el_id IS NOT NULL AND (
            (v_ce.cal_el_cv_country_id = p_target_country_id) IS NOT TRUE
            OR (v_ce.cal_curriculum_id IS NOT NULL AND (v_ce.cal_el_cv_curriculum_id = v_ce.cal_curriculum_id) IS NOT TRUE)
        ) THEN
            RETURN 'CALENDAR_EDUCATION_LEVEL_MISMATCH';
        END IF;
        IF v_ce.cal_el_id IS NOT NULL AND (v_ce.cal_el_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_EDUCATION_LEVEL_INACTIVE';
        END IF;
        IF v_ce.cal_el_id IS NOT NULL AND (v_ce.cal_el_cv_status = 'CURRENT') IS NOT TRUE THEN
            RETURN 'CALENDAR_CURRICULUM_VERSION_NOT_CURRENT';
        END IF;
        IF v_ce.cal_el_id IS NOT NULL AND (v_ce.cal_el_cur_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_CURRICULUM_INACTIVE';
        END IF;
        IF (v_ce.event_type_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_EVENT_TYPE_INACTIVE';
        END IF;
        IF (v_ce.visibility = 'PUBLIC') IS NOT TRUE THEN
            RETURN 'CALENDAR_EVENT_NOT_PUBLIC';
        END IF;
        IF (v_ce.event_status = 'ACTIVE') IS NOT TRUE THEN
            RETURN 'CALENDAR_EVENT_NOT_ACTIVE';
        END IF;
        IF (v_ce.source_type = 'OFFICIAL') IS NOT TRUE THEN
            RETURN 'CALENDAR_EVENT_SOURCE_NOT_OFFICIAL';
        END IF;
        IF (COALESCE(v_ce.end_date, v_ce.start_date) >= (p_eval_time AT TIME ZONE 'UTC')::date) IS NOT TRUE THEN
            RETURN 'CALENDAR_EVENT_PAST';
        END IF;

        RETURN 'ELIGIBLE';
    END IF;

    RETURN 'INVALID_EVALUATION_INPUT';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "content"."fn_is_homepage_entity_eligible"(
    p_target_country_id UUID,
    p_entity_type "content"."homepage_entity_type",
    p_entity_id UUID,
    p_eval_time TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT ("content"."fn_evaluate_homepage_entity_eligibility"(
        p_target_country_id,
        p_entity_type,
        p_entity_id,
        p_eval_time
    ) = 'ELIGIBLE') IS TRUE;
$$;
--> statement-breakpoint

-- 6. Table 1: content.homepage_configurations (25 columns)
CREATE TABLE IF NOT EXISTS "content"."homepage_configurations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "country_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "notes" TEXT,
    "status" "content"."homepage_config_status" NOT NULL DEFAULT 'DRAFT',
    "scheduled_start_at" TIMESTAMPTZ,
    "scheduled_until_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "superseded_at" TIMESTAMPTZ,
    "superseded_by_configuration_id" UUID,
    "rolled_back_at" TIMESTAMPTZ,
    "rolled_back_by" UUID,
    "rollback_reason" TEXT,
    "restored_from_configuration_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "discarded_at" TIMESTAMPTZ,
    "discarded_by" UUID,
    "discard_reason" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "uq_homepage_cfg_id_country"
        UNIQUE ("id", "country_id"),

    CONSTRAINT "uq_homepage_cfg_country_version"
        UNIQUE ("country_id", "version_number"),

    CONSTRAINT "fk_homepage_cfg_country"
        FOREIGN KEY ("country_id")
        REFERENCES "platform"."countries"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_published_by"
        FOREIGN KEY ("published_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_superseded_by"
        FOREIGN KEY ("superseded_by_configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT "fk_homepage_cfg_rolled_back_by"
        FOREIGN KEY ("rolled_back_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_restored_from"
        FOREIGN KEY ("restored_from_configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_archived_by"
        FOREIGN KEY ("archived_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_discarded_by"
        FOREIGN KEY ("discarded_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_created_by"
        FOREIGN KEY ("created_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_cfg_updated_by"
        FOREIGN KEY ("updated_by")
        REFERENCES "identity"."users"("id") ON DELETE RESTRICT,

    CONSTRAINT "chk_homepage_cfg_version_positive"
        CHECK ("version_number" >= 1),

    CONSTRAINT "chk_homepage_cfg_title_not_empty"
        CHECK (length(trim("title")) BETWEEN 1 AND 160),

    CONSTRAINT "chk_homepage_cfg_notes_length"
        CHECK ("notes" IS NULL OR length("notes") <= 2000),

    CONSTRAINT "chk_homepage_cfg_no_self_restore"
        CHECK ("restored_from_configuration_id" IS NULL OR "restored_from_configuration_id" <> "id"),

    CONSTRAINT "chk_homepage_cfg_timestamps_finite"
        CHECK (
            ("scheduled_start_at" IS NULL OR isfinite("scheduled_start_at"))
            AND ("scheduled_until_at" IS NULL OR isfinite("scheduled_until_at"))
            AND ("published_at" IS NULL OR isfinite("published_at"))
            AND ("superseded_at" IS NULL OR isfinite("superseded_at"))
            AND ("rolled_back_at" IS NULL OR isfinite("rolled_back_at"))
            AND ("archived_at" IS NULL OR isfinite("archived_at"))
            AND ("discarded_at" IS NULL OR isfinite("discarded_at"))
            AND isfinite("created_at")
            AND isfinite("updated_at")
        ),

    CONSTRAINT "chk_homepage_cfg_schedule_order"
        CHECK (
            "scheduled_start_at" IS NULL
            OR "scheduled_until_at" IS NULL
            OR "scheduled_until_at" > "scheduled_start_at"
        ),

    CONSTRAINT "chk_homepage_cfg_status_invariants"
        CHECK (
            (
                "status" = 'DRAFT'
                AND "published_at" IS NULL
                AND "published_by" IS NULL
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'SCHEDULED'
                AND "scheduled_start_at" IS NOT NULL
                AND "published_at" IS NULL
                AND "published_by" IS NULL
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'PUBLISHED'
                AND "published_at" IS NOT NULL
                AND "published_by" IS NOT NULL
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'SUPERSEDED'
                AND "published_at" IS NOT NULL
                AND "published_by" IS NOT NULL
                AND "superseded_at" IS NOT NULL
                AND "superseded_by_configuration_id" IS NOT NULL
                AND "superseded_by_configuration_id" <> "id"
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'ROLLED_BACK'
                AND "published_at" IS NOT NULL
                AND "published_by" IS NOT NULL
                AND "rolled_back_at" IS NOT NULL
                AND "rolled_back_by" IS NOT NULL
                AND "rollback_reason" IS NOT NULL
                AND length(trim("rollback_reason")) BETWEEN 3 AND 1000
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'ARCHIVED'
                AND "published_at" IS NOT NULL
                AND "published_by" IS NOT NULL
                AND "archived_at" IS NOT NULL
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "discarded_at" IS NULL
                AND "discarded_by" IS NULL
                AND "discard_reason" IS NULL
            )
            OR (
                "status" = 'DISCARDED'
                AND "published_at" IS NULL
                AND "published_by" IS NULL
                AND "superseded_at" IS NULL
                AND "superseded_by_configuration_id" IS NULL
                AND "rolled_back_at" IS NULL
                AND "rolled_back_by" IS NULL
                AND "rollback_reason" IS NULL
                AND "archived_at" IS NULL
                AND "archived_by" IS NULL
                AND "discarded_at" IS NOT NULL
                AND "discarded_by" IS NOT NULL
                AND "discard_reason" IS NOT NULL
                AND length(trim("discard_reason")) BETWEEN 3 AND 1000
            )
        ),

    CONSTRAINT "excl_homepage_cfg_country_schedule_window"
        EXCLUDE USING gist (
            "country_id" WITH =,
            tstzrange("scheduled_start_at", COALESCE("scheduled_until_at", 'infinity'::timestamptz), '[)') WITH &&
        )
        WHERE ("status" = 'SCHEDULED')
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_cfg_one_active_draft_per_country"
    ON "content"."homepage_configurations" ("country_id")
    WHERE ("status" = 'DRAFT');
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_cfg_one_published_per_country"
    ON "content"."homepage_configurations" ("country_id")
    WHERE ("status" = 'PUBLISHED');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_homepage_cfg_country_status_version"
    ON "content"."homepage_configurations" ("country_id", "status", "version_number" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_homepage_cfg_scheduled_due"
    ON "content"."homepage_configurations" ("country_id", "scheduled_start_at" ASC)
    WHERE ("status" = 'SCHEDULED');
--> statement-breakpoint

-- 7. Table 2: content.homepage_configuration_slots
CREATE TABLE IF NOT EXISTS "content"."homepage_configuration_slots" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "configuration_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "slot_key" "content"."homepage_slot_key" NOT NULL,
    "slot_order" SMALLINT NOT NULL,
    "entity_type" "content"."homepage_entity_type" NOT NULL,
    "mode" "content"."homepage_slot_mode" NOT NULL DEFAULT 'AUTOMATED',
    "section_title" VARCHAR(120) NOT NULL,
    "section_subtitle" VARCHAR(240),
    "max_items" SMALLINT NOT NULL DEFAULT 6,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "uq_homepage_slots_cfg_key"
        UNIQUE ("configuration_id", "slot_key"),

    CONSTRAINT "uq_homepage_slots_cfg_order"
        UNIQUE ("configuration_id", "slot_order"),

    CONSTRAINT "uq_homepage_slots_id_cfg_country_type"
        UNIQUE ("id", "configuration_id", "country_id", "entity_type"),

    CONSTRAINT "fk_homepage_slots_cfg_country"
        FOREIGN KEY ("configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "chk_homepage_slots_order_range"
        CHECK ("slot_order" BETWEEN 1 AND 6),

    CONSTRAINT "chk_homepage_slots_max_items_range"
        CHECK ("max_items" BETWEEN 1 AND 6),

    CONSTRAINT "chk_homepage_slots_title_not_empty"
        CHECK (length(trim("section_title")) BETWEEN 1 AND 120),

    CONSTRAINT "chk_homepage_slots_subtitle_length"
        CHECK ("section_subtitle" IS NULL OR length("section_subtitle") <= 240),

    CONSTRAINT "chk_homepage_slots_timestamps_finite"
        CHECK (isfinite("created_at") AND isfinite("updated_at")),

    CONSTRAINT "chk_homepage_slots_canonical_mapping"
        CHECK (
            ("slot_key" = 'trending_resources' AND "slot_order" = 1 AND "entity_type" = 'RESOURCE')
            OR ("slot_key" = 'most_downloaded_resources' AND "slot_order" = 2 AND "entity_type" = 'RESOURCE')
            OR ("slot_key" = 'curated_resources' AND "slot_order" = 3 AND "entity_type" = 'RESOURCE')
            OR ("slot_key" = 'education_updates' AND "slot_order" = 4 AND "entity_type" = 'UPDATE')
            OR ("slot_key" = 'calendar_highlights' AND "slot_order" = 5 AND "entity_type" = 'CALENDAR_EVENT')
            OR ("slot_key" = 'curriculum_shortcuts' AND "slot_order" = 6 AND "entity_type" = 'SUBJECT')
        )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_homepage_slots_cfg_order"
    ON "content"."homepage_configuration_slots" ("configuration_id", "slot_order" ASC);
--> statement-breakpoint

-- 8. Table 3: content.homepage_configuration_items
CREATE TABLE IF NOT EXISTS "content"."homepage_configuration_items" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "slot_id" UUID NOT NULL,
    "configuration_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "entity_type" "content"."homepage_entity_type" NOT NULL,
    "position" SMALLINT NOT NULL,
    "resource_id" UUID,
    "update_id" UUID,
    "calendar_event_id" UUID,
    "subject_id" UUID,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "pin_note" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "uq_homepage_items_slot_position"
        UNIQUE ("slot_id", "position"),

    CONSTRAINT "fk_homepage_items_slot_cfg_country_type"
        FOREIGN KEY ("slot_id", "configuration_id", "country_id", "entity_type")
        REFERENCES "content"."homepage_configuration_slots"("id", "configuration_id", "country_id", "entity_type")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_items_resource_country"
        FOREIGN KEY ("resource_id", "country_id")
        REFERENCES "content"."resources"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_items_update"
        FOREIGN KEY ("update_id")
        REFERENCES "content"."education_updates"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_items_calendar_event"
        FOREIGN KEY ("calendar_event_id")
        REFERENCES "calendar"."calendar_events"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_items_subject"
        FOREIGN KEY ("subject_id")
        REFERENCES "taxonomy"."subjects"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_items_created_by"
        FOREIGN KEY ("created_by")
        REFERENCES "identity"."users"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "chk_homepage_items_position_range"
        CHECK ("position" BETWEEN 1 AND 6),

    CONSTRAINT "chk_homepage_items_pin_note_length"
        CHECK ("pin_note" IS NULL OR length("pin_note") <= 500),

    CONSTRAINT "chk_homepage_items_timestamps_finite"
        CHECK (
            ("starts_at" IS NULL OR isfinite("starts_at"))
            AND ("ends_at" IS NULL OR isfinite("ends_at"))
            AND isfinite("created_at")
            AND isfinite("updated_at")
        ),

    CONSTRAINT "chk_homepage_items_window_order"
        CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),

    CONSTRAINT "chk_homepage_items_entity_xor"
        CHECK (
            ("entity_type" = 'RESOURCE' AND "resource_id" IS NOT NULL AND "update_id" IS NULL AND "calendar_event_id" IS NULL AND "subject_id" IS NULL)
            OR ("entity_type" = 'UPDATE' AND "update_id" IS NOT NULL AND "resource_id" IS NULL AND "calendar_event_id" IS NULL AND "subject_id" IS NULL)
            OR ("entity_type" = 'CALENDAR_EVENT' AND "calendar_event_id" IS NOT NULL AND "resource_id" IS NULL AND "update_id" IS NULL AND "subject_id" IS NULL)
            OR ("entity_type" = 'SUBJECT' AND "subject_id" IS NOT NULL AND "resource_id" IS NULL AND "update_id" IS NULL AND "calendar_event_id" IS NULL)
        )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_items_slot_resource"
    ON "content"."homepage_configuration_items" ("slot_id", "resource_id")
    WHERE ("resource_id" IS NOT NULL);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_items_slot_update"
    ON "content"."homepage_configuration_items" ("slot_id", "update_id")
    WHERE ("update_id" IS NOT NULL);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_items_slot_calendar_event"
    ON "content"."homepage_configuration_items" ("slot_id", "calendar_event_id")
    WHERE ("calendar_event_id" IS NOT NULL);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_homepage_items_slot_subject"
    ON "content"."homepage_configuration_items" ("slot_id", "subject_id")
    WHERE ("subject_id" IS NOT NULL);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_homepage_items_cfg_slot_pos"
    ON "content"."homepage_configuration_items" ("configuration_id", "slot_id", "position" ASC);
--> statement-breakpoint

-- 9. Table 4: content.homepage_configuration_rollbacks (D3 / C45 xid8 Pairing Ledger)
CREATE TABLE IF NOT EXISTS "content"."homepage_configuration_rollbacks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "country_id" UUID NOT NULL,
    "rolled_back_configuration_id" UUID NOT NULL,
    "target_source_configuration_id" UUID NOT NULL,
    "clone_configuration_id" UUID NOT NULL,
    "txid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "uq_homepage_rollbacks_predecessor"
        UNIQUE ("rolled_back_configuration_id"),

    CONSTRAINT "uq_homepage_rollbacks_clone"
        UNIQUE ("clone_configuration_id"),

    CONSTRAINT "fk_homepage_rollbacks_country"
        FOREIGN KEY ("country_id")
        REFERENCES "platform"."countries"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_rollbacks_predecessor_country"
        FOREIGN KEY ("rolled_back_configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_rollbacks_target_source_country"
        FOREIGN KEY ("target_source_configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_rollbacks_clone_country"
        FOREIGN KEY ("clone_configuration_id", "country_id")
        REFERENCES "content"."homepage_configurations"("id", "country_id")
        ON DELETE RESTRICT,

    CONSTRAINT "fk_homepage_rollbacks_actor"
        FOREIGN KEY ("actor_user_id")
        REFERENCES "identity"."users"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "chk_homepage_rollbacks_reason_length"
        CHECK (length(trim("reason")) BETWEEN 3 AND 1000),

    CONSTRAINT "chk_homepage_rollbacks_occurred_finite"
        CHECK (isfinite("occurred_at")),

    CONSTRAINT "chk_homepage_rollbacks_distinct_configs"
        CHECK (
            "rolled_back_configuration_id" <> "clone_configuration_id"
            AND "target_source_configuration_id" <> "clone_configuration_id"
            AND "rolled_back_configuration_id" <> "target_source_configuration_id"
        )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_homepage_rollbacks_country_occurred"
    ON "content"."homepage_configuration_rollbacks" ("country_id", "occurred_at" DESC);
--> statement-breakpoint

-- 10. Trigger T1: Lifecycle State Machine & Immutability Guard on homepage_configurations
CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_cfg_lifecycle_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of content.homepage_configurations is permanently disallowed'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'DRAFT' THEN
            RETURN NEW;
        ELSIF NEW.status = 'PUBLISHED'
              AND NEW.restored_from_configuration_id IS NOT NULL
              AND NEW.scheduled_start_at IS NULL
              AND NEW.scheduled_until_at IS NULL THEN
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Homepage configurations may only be inserted as DRAFT or as an unscheduled PUBLISHED rollback clone'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- TG_OP = 'UPDATE'
    IF NEW.country_id IS DISTINCT FROM OLD.country_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.restored_from_configuration_id IS DISTINCT FROM OLD.restored_from_configuration_id THEN
        RAISE EXCEPTION 'Immutable homepage configuration identity/provenance columns cannot be modified'
            USING ERRCODE = '23514';
    END IF;

    -- Terminal states are strictly immutable
    IF OLD.status IN ('SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED', 'DISCARDED') THEN
        RAISE EXCEPTION 'Cannot modify homepage configuration in terminal status %', OLD.status
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'DRAFT' THEN
        IF NEW.status NOT IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'DISCARDED') THEN
            RAISE EXCEPTION 'Invalid homepage configuration status transition from DRAFT to %', NEW.status
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'SCHEDULED' THEN
        IF NEW.status NOT IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'DISCARDED') THEN
            RAISE EXCEPTION 'Invalid homepage configuration status transition from SCHEDULED to %', NEW.status
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status <> 'DRAFT' AND (
            NEW.title IS DISTINCT FROM OLD.title
            OR NEW.notes IS DISTINCT FROM OLD.notes
        ) THEN
            RAISE EXCEPTION 'Cannot mutate title or notes of a SCHEDULED homepage configuration without unscheduling to DRAFT'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'PUBLISHED' THEN
        IF NEW.status NOT IN ('SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED') THEN
            RAISE EXCEPTION 'Invalid homepage configuration status transition from PUBLISHED to %', NEW.status
                USING ERRCODE = '23514';
        END IF;
        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.notes IS DISTINCT FROM OLD.notes
           OR NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.published_by IS DISTINCT FROM OLD.published_by
           OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
           OR NEW.scheduled_until_at IS DISTINCT FROM OLD.scheduled_until_at THEN
            RAISE EXCEPTION 'Cannot mutate published metadata or schedule window of a PUBLISHED homepage configuration'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_cfg_lifecycle_guard" ON "content"."homepage_configurations";
--> statement-breakpoint

CREATE TRIGGER "trg_homepage_cfg_lifecycle_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "content"."homepage_configurations"
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_cfg_lifecycle_guard"();
--> statement-breakpoint

-- 11. Trigger T2: Deferred Completeness, Live Eligibility & Bidirectional Rollback Handshake
CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_cfg_publish_completeness"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_slot_count INTEGER;
    v_empty_manual_count INTEGER;
    v_non_contiguous_count INTEGER;
    v_eval_time TIMESTAMPTZ;
    v_bad_item RECORD;
    v_rb RECORD;
    v_sup RECORD;
BEGIN
    -- 1. Rollback clone creation must be paired in same xid8 transaction
    IF TG_OP = 'INSERT' AND NEW.restored_from_configuration_id IS NOT NULL THEN
        SELECT rb.id, pre.status AS pre_status, pre.version_number AS pre_ver
        INTO v_rb
        FROM "content"."homepage_configuration_rollbacks" rb
        JOIN "content"."homepage_configurations" pre
          ON pre.id = rb.rolled_back_configuration_id
         AND pre.country_id = rb.country_id
        WHERE rb.clone_configuration_id = NEW.id
          AND rb.country_id = NEW.country_id
          AND rb.target_source_configuration_id = NEW.restored_from_configuration_id
          AND rb.txid = pg_current_xact_id();

        IF NOT FOUND OR (v_rb.pre_status = 'ROLLED_BACK') IS NOT TRUE OR (NEW.version_number > v_rb.pre_ver) IS NOT TRUE THEN
            RAISE EXCEPTION 'Rollback clone configuration % must be atomically paired with a ROLLED_BACK predecessor in content.homepage_configuration_rollbacks within the same transaction',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 2. ROLLED_BACK predecessor must be paired in same xid8 transaction with newly created clone
    IF NEW.status = 'ROLLED_BACK' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ROLLED_BACK') THEN
        SELECT rb.id, cl.status AS clone_status, cl.version_number AS clone_ver, cl.restored_from_configuration_id AS clone_restored_from
        INTO v_rb
        FROM "content"."homepage_configuration_rollbacks" rb
        JOIN "content"."homepage_configurations" cl
          ON cl.id = rb.clone_configuration_id
         AND cl.country_id = rb.country_id
        WHERE rb.rolled_back_configuration_id = NEW.id
          AND rb.country_id = NEW.country_id
          AND rb.txid = pg_current_xact_id();

        IF NOT FOUND
           OR (v_rb.clone_restored_from = (SELECT r2.target_source_configuration_id FROM "content"."homepage_configuration_rollbacks" r2 WHERE r2.id = v_rb.id)) IS NOT TRUE
           OR (v_rb.clone_ver > NEW.version_number) IS NOT TRUE
           OR v_rb.clone_status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED') THEN
            RAISE EXCEPTION 'Transition to ROLLED_BACK on configuration % requires same-transaction xid8 pairing row and forward PUBLISHED clone',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 3. SUPERSEDED must reference a newer published configuration in the same country
    IF NEW.status = 'SUPERSEDED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'SUPERSEDED') THEN
        SELECT s.id, s.version_number, s.status
        INTO v_sup
        FROM "content"."homepage_configurations" s
        WHERE s.id = NEW.superseded_by_configuration_id
          AND s.country_id = NEW.country_id;

        IF NOT FOUND
           OR (v_sup.version_number > NEW.version_number) IS NOT TRUE
           OR v_sup.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED') THEN
            RAISE EXCEPTION 'SUPERSEDED configuration % must reference a newer published configuration in the same country',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 4. SCHEDULED and PUBLISHED completeness & live item eligibility
    IF NEW.status IN ('SCHEDULED', 'PUBLISHED') THEN
        SELECT COUNT(*)::int INTO v_slot_count
        FROM "content"."homepage_configuration_slots" s
        WHERE s.configuration_id = NEW.id;

        IF v_slot_count <> 6 THEN
            RAISE EXCEPTION 'Homepage configuration % in status % must have exactly 6 canonical slots (found %)',
                NEW.id, NEW.status, v_slot_count
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "content"."homepage_configuration_slots" s
            WHERE s.configuration_id = NEW.id
              AND s.mode = 'MANUAL_OVERRIDE'
              AND NOT EXISTS (
                  SELECT 1 FROM "content"."homepage_configuration_items" i WHERE i.slot_id = s.id
              )
        ) THEN
            RAISE EXCEPTION 'MANUAL_OVERRIDE slot in homepage configuration % must contain at least 1 pinned item',
                NEW.id
                USING ERRCODE = '23514';
        END IF;

        SELECT COUNT(*)::int INTO v_non_contiguous_count
        FROM (
            SELECT
                s.id,
                s.max_items,
                COUNT(i.id)::int AS item_cnt,
                COALESCE(MAX(i.position), 0)::int AS max_pos
            FROM "content"."homepage_configuration_slots" s
            LEFT JOIN "content"."homepage_configuration_items" i ON i.slot_id = s.id
            WHERE s.configuration_id = NEW.id
            GROUP BY s.id, s.max_items
        ) sq
        WHERE sq.max_pos <> sq.item_cnt OR sq.item_cnt > sq.max_items;

        IF v_non_contiguous_count > 0 THEN
            RAISE EXCEPTION 'Pinned item positions in homepage configuration % must be contiguous 1..N within slot max_items',
                NEW.id
                USING ERRCODE = '23514';
        END IF;

        v_eval_time := CASE
            WHEN NEW.status = 'PUBLISHED' THEN NEW.published_at
            ELSE NEW.updated_at
        END;

        SELECT
            i.id AS item_id,
            s.slot_key,
            "content"."fn_evaluate_homepage_entity_eligibility"(
                NEW.country_id,
                i.entity_type,
                COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
                v_eval_time
            ) AS diag
        INTO v_bad_item
        FROM "content"."homepage_configuration_items" i
        JOIN "content"."homepage_configuration_slots" s ON s.id = i.slot_id
        WHERE i.configuration_id = NEW.id
          AND (
              "content"."fn_is_homepage_entity_eligible"(
                  NEW.country_id,
                  i.entity_type,
                  COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
                  v_eval_time
              ) IS NOT TRUE
              OR (i.ends_at IS NOT NULL AND (i.ends_at > v_eval_time) IS NOT TRUE)
          )
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'Ineligible or expired pinned item % in slot % of homepage configuration % (reason: %)',
                v_bad_item.item_id, v_bad_item.slot_key, NEW.id, v_bad_item.diag
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_cfg_publish_completeness" ON "content"."homepage_configurations";
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "trg_homepage_cfg_publish_completeness"
    AFTER INSERT OR UPDATE OF "status" ON "content"."homepage_configurations"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_cfg_publish_completeness"();
--> statement-breakpoint

-- 12. Trigger T3: Slot Immutability & Max-Items Guard
CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_slots_mutation_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_cfg RECORD;
    v_overflow_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of content.homepage_configuration_slots is permanently disallowed'
            USING ERRCODE = '23514';
    END IF;

    SELECT c.id, c.status, c.restored_from_configuration_id
    INTO v_cfg
    FROM "content"."homepage_configurations" c
    WHERE c.id = NEW.configuration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent homepage configuration % does not exist', NEW.configuration_id
            USING ERRCODE = '23503';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF v_cfg.status = 'DRAFT' THEN
            RETURN NEW;
        ELSIF v_cfg.status = 'PUBLISHED'
              AND v_cfg.restored_from_configuration_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM "content"."homepage_configuration_rollbacks" rb
                  WHERE rb.clone_configuration_id = v_cfg.id
                    AND rb.txid = pg_current_xact_id()
              ) THEN
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Cannot insert slots into homepage configuration % in status %',
                NEW.configuration_id, v_cfg.status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- TG_OP = 'UPDATE'
    IF v_cfg.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot modify slots of non-DRAFT homepage configuration % (status: %)',
            NEW.configuration_id, v_cfg.status
            USING ERRCODE = '23514';
    END IF;

    IF NEW.configuration_id IS DISTINCT FROM OLD.configuration_id
       OR NEW.country_id IS DISTINCT FROM OLD.country_id
       OR NEW.slot_key IS DISTINCT FROM OLD.slot_key
       OR NEW.slot_order IS DISTINCT FROM OLD.slot_order
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Immutable homepage slot identity columns cannot be modified'
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*)::int INTO v_overflow_count
    FROM "content"."homepage_configuration_items" i
    WHERE i.slot_id = NEW.id
      AND i.position > NEW.max_items;

    IF v_overflow_count > 0 THEN
        RAISE EXCEPTION 'Cannot reduce slot max_items to % while % pinned items exceed max_items',
            NEW.max_items, v_overflow_count
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_slots_mutation_guard" ON "content"."homepage_configuration_slots";
--> statement-breakpoint

CREATE TRIGGER "trg_homepage_slots_mutation_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "content"."homepage_configuration_slots"
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_slots_mutation_guard"();
--> statement-breakpoint

-- 13. Trigger T4: Pinned Item Draft-Only Mutation & Cross-Table Country/Position Guard
CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_items_mutation_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_target_cfg_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.configuration_id ELSE NEW.configuration_id END;
    v_cfg RECORD;
    v_max_items SMALLINT;
    v_foreign_country_id UUID;
    v_cal RECORD;
BEGIN
    SELECT c.id, c.status, c.restored_from_configuration_id
    INTO v_cfg
    FROM "content"."homepage_configurations" c
    WHERE c.id = v_target_cfg_id;

    IF TG_OP = 'DELETE' THEN
        IF NOT FOUND OR v_cfg.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot delete pinned items from non-DRAFT homepage configuration %', v_target_cfg_id
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent homepage configuration % does not exist', v_target_cfg_id
            USING ERRCODE = '23503';
    END IF;

    IF v_cfg.status = 'DRAFT' THEN
        NULL;
    ELSIF TG_OP = 'INSERT'
          AND v_cfg.status = 'PUBLISHED'
          AND v_cfg.restored_from_configuration_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM "content"."homepage_configuration_rollbacks" rb
              WHERE rb.clone_configuration_id = v_cfg.id
                AND rb.txid = pg_current_xact_id()
          ) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Cannot mutate pinned items of non-DRAFT homepage configuration % (status: %)',
            v_target_cfg_id, v_cfg.status
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.slot_id IS DISTINCT FROM OLD.slot_id
        OR NEW.configuration_id IS DISTINCT FROM OLD.configuration_id
        OR NEW.country_id IS DISTINCT FROM OLD.country_id
        OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Immutable homepage item identity columns cannot be modified'
            USING ERRCODE = '23514';
    END IF;

    SELECT s.max_items INTO v_max_items
    FROM "content"."homepage_configuration_slots" s
    WHERE s.id = NEW.slot_id
      AND s.configuration_id = NEW.configuration_id;

    IF FOUND AND NEW.position > v_max_items THEN
        RAISE EXCEPTION 'Pinned item position % exceeds slot max_items %', NEW.position, v_max_items
            USING ERRCODE = '23514';
    END IF;

    -- Cross-table country alignment for non-composite-FK entity types
    IF NEW.entity_type = 'UPDATE' AND NEW.update_id IS NOT NULL THEN
        SELECT u.country_id INTO v_foreign_country_id
        FROM "content"."education_updates" u
        WHERE u.id = NEW.update_id;

        IF FOUND AND (v_foreign_country_id = NEW.country_id) IS NOT TRUE THEN
            RAISE EXCEPTION 'Pinned education update % does not belong to country %', NEW.update_id, NEW.country_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.entity_type = 'CALENDAR_EVENT' AND NEW.calendar_event_id IS NOT NULL THEN
        SELECT cal.country_id, cal.calendar_scope, cal.school_id, cal.user_id, cal.session_id
        INTO v_cal
        FROM "calendar"."calendar_events" ce
        JOIN "calendar"."calendars" cal ON cal.id = ce.calendar_id
        WHERE ce.id = NEW.calendar_event_id;

        IF FOUND AND (
            (v_cal.country_id = NEW.country_id) IS NOT TRUE
            OR (v_cal.calendar_scope = 'OFFICIAL') IS NOT TRUE
            OR v_cal.school_id IS NOT NULL
            OR v_cal.user_id IS NOT NULL
            OR v_cal.session_id IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Pinned calendar event % is not an uncontaminated OFFICIAL event for country %',
                NEW.calendar_event_id, NEW.country_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.entity_type = 'SUBJECT' AND NEW.subject_id IS NOT NULL THEN
        SELECT cv.country_id INTO v_foreign_country_id
        FROM "taxonomy"."subjects" s
        JOIN "taxonomy"."curriculum_versions" cv ON cv.id = s.curriculum_version_id
        WHERE s.id = NEW.subject_id;

        IF FOUND AND (v_foreign_country_id = NEW.country_id) IS NOT TRUE THEN
            RAISE EXCEPTION 'Pinned curriculum subject % does not belong to country %', NEW.subject_id, NEW.country_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_items_mutation_guard" ON "content"."homepage_configuration_items";
--> statement-breakpoint

CREATE TRIGGER "trg_homepage_items_mutation_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "content"."homepage_configuration_items"
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_items_mutation_guard"();
--> statement-breakpoint

-- 14. Trigger T5 & T6: Append-Only Rollback Ledger & Deferred xid8 Handshake
CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_rollbacks_immutable"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'content.homepage_configuration_rollbacks is strictly append-only; % is disallowed', TG_OP
            USING ERRCODE = '23514';
    END IF;

    IF NEW.txid IS DISTINCT FROM pg_current_xact_id() THEN
        RAISE EXCEPTION 'Rollback ledger txid (%) must match pg_current_xact_id() (%)',
            NEW.txid, pg_current_xact_id()
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_rollbacks_immutable" ON "content"."homepage_configuration_rollbacks";
--> statement-breakpoint

CREATE TRIGGER "trg_homepage_rollbacks_immutable"
    BEFORE INSERT OR UPDATE OR DELETE ON "content"."homepage_configuration_rollbacks"
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_rollbacks_immutable"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "content"."fn_trg_homepage_rollbacks_handshake"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_pre RECORD;
    v_src RECORD;
    v_cln RECORD;
BEGIN
    SELECT id, status, version_number INTO v_pre
    FROM "content"."homepage_configurations"
    WHERE id = NEW.rolled_back_configuration_id
      AND country_id = NEW.country_id;

    SELECT id, status, version_number INTO v_src
    FROM "content"."homepage_configurations"
    WHERE id = NEW.target_source_configuration_id
      AND country_id = NEW.country_id;

    SELECT id, status, version_number, restored_from_configuration_id INTO v_cln
    FROM "content"."homepage_configurations"
    WHERE id = NEW.clone_configuration_id
      AND country_id = NEW.country_id;

    IF v_pre.id IS NULL OR (v_pre.status = 'ROLLED_BACK') IS NOT TRUE THEN
        RAISE EXCEPTION 'Rollback ledger predecessor % must be in ROLLED_BACK status',
            NEW.rolled_back_configuration_id
            USING ERRCODE = '23514';
    END IF;

    IF v_src.id IS NULL OR v_src.status NOT IN ('SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED') THEN
        RAISE EXCEPTION 'Rollback target source % must be a previously published historical configuration',
            NEW.target_source_configuration_id
            USING ERRCODE = '23514';
    END IF;

    IF v_cln.id IS NULL
       OR v_cln.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED')
       OR (v_cln.restored_from_configuration_id = NEW.target_source_configuration_id) IS NOT TRUE
       OR (v_cln.version_number > v_pre.version_number) IS NOT TRUE THEN
        RAISE EXCEPTION 'Rollback clone % must be versioned forward from predecessor % and linked to target source %',
            NEW.clone_configuration_id, NEW.rolled_back_configuration_id, NEW.target_source_configuration_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_homepage_rollbacks_handshake" ON "content"."homepage_configuration_rollbacks";
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "trg_homepage_rollbacks_handshake"
    AFTER INSERT ON "content"."homepage_configuration_rollbacks"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "content"."fn_trg_homepage_rollbacks_handshake"();
