-- =============================================================================
-- Migration 0023: Security Hardening Wave 2 — Public Visibility & Cache Invalidation
-- 1. Hardens content.fn_evaluate_homepage_entity_eligibility to exclude infected,
--    scan-error, or quarantined files from available homepage resource projections.
-- 2. Hardens content.fn_get_resource_scoring_dataset to enforce rv.published_at <= p_eval_now
--    and exclude resources with infected, scan-error, or quarantined files.
-- 3. Extends content.notify_recommendation_invalidation() with Table 8
--    (files.resource_files) and registers trg_resource_files_invalidation so file
--    quarantine/scan transitions immediately evict cached recommendations.
-- =============================================================================

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
              AND rf.malware_scan_status NOT IN ('INFECTED', 'SCAN_ERROR')
              AND rf.object_key NOT LIKE 'quarantine/%'
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
       AND rv.published_at <= p_eval_now
       AND NOT EXISTS (
           SELECT 1
           FROM "files"."resource_files" rf
           WHERE rf.resource_version_id = rv.id
             AND (
                 rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
                 OR rf.object_key LIKE 'quarantine/%'
             )
       )
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
                   AND rv.published_at <= p_eval_now
                   AND NOT EXISTS (
                       SELECT 1
                       FROM "files"."resource_files" rf
                       WHERE rf.resource_version_id = rv.id
                         AND (
                             rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
                             OR rf.object_key LIKE 'quarantine/%'
                         )
                   )
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
               AND rv.published_at <= p_eval_now
               AND NOT EXISTS (
                   SELECT 1
                   FROM "files"."resource_files" rf
                   WHERE rf.resource_version_id = rv.id
                     AND (
                         rf.malware_scan_status IN ('INFECTED', 'SCAN_ERROR')
                         OR rf.object_key LIKE 'quarantine/%'
                     )
               )
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "content"."notify_recommendation_invalidation"()
RETURNS TRIGGER AS $$
DECLARE
    v_old_country UUID;
    v_new_country UUID;
    v_old_topic UUID;
    v_new_topic UUID;
    v_old_res_id UUID;
    v_new_res_id UUID;
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

    -- Table 4: governance.resource_verifications
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

    -- Table 5: taxonomy.topics
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

    -- Table 6: platform.countries
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

    -- Table 7: content.resource_types
    ELSIF TG_TABLE_SCHEMA = 'content' AND TG_TABLE_NAME = 'resource_types' THEN
        IF TG_OP = 'DELETE' OR
           (TG_OP = 'UPDATE' AND ((OLD.status IS DISTINCT FROM NEW.status) OR (OLD.pillar IS DISTINCT FROM NEW.pillar))) THEN
            PERFORM pg_notify('rec_invalid', json_build_object(
                'scope', 'global_type', 'op', TG_OP
            )::text);
        END IF;

    -- Table 8: files.resource_files (malware scan / quarantine / availability changes)
    ELSIF TG_TABLE_SCHEMA = 'files' AND TG_TABLE_NAME = 'resource_files' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT r.country_id, r.id, r.topic_id
            INTO v_new_country, v_new_res_id, v_new_topic
            FROM "content"."resource_versions" rv
            INNER JOIN "content"."resources" r ON r.id = rv.resource_id
            WHERE rv.id = NEW.resource_version_id;

            IF v_new_res_id IS NOT NULL THEN
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'file', 'op', 'INSERT',
                    'country_id', v_new_country,
                    'source_resource_id', v_new_res_id,
                    'source_topic_id', v_new_topic,
                    'target_resource_id', v_new_res_id
                )::text);
            END IF;
        ELSIF TG_OP = 'DELETE' THEN
            SELECT r.country_id, r.id, r.topic_id
            INTO v_old_country, v_old_res_id, v_old_topic
            FROM "content"."resource_versions" rv
            INNER JOIN "content"."resources" r ON r.id = rv.resource_id
            WHERE rv.id = OLD.resource_version_id;

            IF v_old_res_id IS NOT NULL THEN
                PERFORM pg_notify('rec_invalid', json_build_object(
                    'scope', 'file', 'op', 'DELETE',
                    'country_id', v_old_country,
                    'source_resource_id', v_old_res_id,
                    'source_topic_id', v_old_topic,
                    'target_resource_id', v_old_res_id
                )::text);
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF (OLD.resource_version_id IS DISTINCT FROM NEW.resource_version_id) OR
               (OLD.status IS DISTINCT FROM NEW.status) OR
               (OLD.malware_scan_status IS DISTINCT FROM NEW.malware_scan_status) OR
               (OLD.object_key IS DISTINCT FROM NEW.object_key) THEN
                SELECT r.country_id, r.id, r.topic_id
                INTO v_old_country, v_old_res_id, v_old_topic
                FROM "content"."resource_versions" rv
                INNER JOIN "content"."resources" r ON r.id = rv.resource_id
                WHERE rv.id = OLD.resource_version_id;

                IF v_old_res_id IS NOT NULL THEN
                    PERFORM pg_notify('rec_invalid', json_build_object(
                        'scope', 'file', 'op', 'UPDATE_OLD',
                        'country_id', v_old_country,
                        'source_resource_id', v_old_res_id,
                        'source_topic_id', v_old_topic,
                        'target_resource_id', v_old_res_id
                    )::text);
                END IF;

                IF OLD.resource_version_id IS DISTINCT FROM NEW.resource_version_id THEN
                    SELECT r.country_id, r.id, r.topic_id
                    INTO v_new_country, v_new_res_id, v_new_topic
                    FROM "content"."resource_versions" rv
                    INNER JOIN "content"."resources" r ON r.id = rv.resource_id
                    WHERE rv.id = NEW.resource_version_id;

                    IF v_new_res_id IS NOT NULL THEN
                        PERFORM pg_notify('rec_invalid', json_build_object(
                            'scope', 'file', 'op', 'UPDATE_NEW',
                            'country_id', v_new_country,
                            'source_resource_id', v_new_res_id,
                            'source_topic_id', v_new_topic,
                            'target_resource_id', v_new_res_id
                        )::text);
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_resource_files_invalidation" ON "files"."resource_files";
--> statement-breakpoint
CREATE TRIGGER "trg_resource_files_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "files"."resource_files"
FOR EACH ROW EXECUTE FUNCTION "content"."notify_recommendation_invalidation"();
