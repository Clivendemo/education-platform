-- Wave 3 Security Hardening (WP4): Distributed Rate-Limit Token Buckets & Two-Phase Atomic Admission Claims
CREATE SCHEMA IF NOT EXISTS "system";
--> statement-breakpoint

CREATE UNLOGGED TABLE IF NOT EXISTS "system"."rate_limit_buckets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bucket_key" VARCHAR(160) NOT NULL,
  "policy_id" VARCHAR(64) NOT NULL,
  "millitokens" BIGINT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "uq_rate_limit_buckets_bucket_key" UNIQUE ("bucket_key"),
  CONSTRAINT "chk_rlb_bucket_key_bounds" CHECK (
    length(btrim("bucket_key")) >= 16 AND length("bucket_key") <= 160
  ),
  CONSTRAINT "chk_rlb_policy_id_bounds" CHECK (
    length(btrim("policy_id")) >= 3 AND length("policy_id") <= 64
  ),
  CONSTRAINT "chk_rlb_millitokens_bounds" CHECK (
    "millitokens" >= 0 AND "millitokens" <= 1000000000
  ),
  CONSTRAINT "chk_rlb_expires_after_updated" CHECK (
    "expires_at" > "updated_at"
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rate_limit_buckets_expires_at"
  ON "system"."rate_limit_buckets" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "system"."rate_limit_admissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "admission_key" VARCHAR(200) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "claim_token" UUID NOT NULL,
  "payload_fingerprint" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "claimed_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "uq_rate_limit_admissions_key" UNIQUE ("admission_key"),
  CONSTRAINT "chk_rla_admission_key_bounds" CHECK (
    length(btrim("admission_key")) >= 16 AND length("admission_key") <= 200
  ),
  CONSTRAINT "chk_rla_status_valid" CHECK (
    "status" IN ('UNCLAIMED', 'CLAIMED')
  ),
  CONSTRAINT "chk_rla_fingerprint_bounds" CHECK (
    length(btrim("payload_fingerprint")) >= 32 AND length("payload_fingerprint") <= 128
  ),
  CONSTRAINT "chk_rla_claimed_at_consistency" CHECK (
    ("status" = 'UNCLAIMED' AND "claimed_at" IS NULL)
    OR ("status" = 'CLAIMED' AND "claimed_at" IS NOT NULL)
  ),
  CONSTRAINT "chk_rla_expires_after_created" CHECK (
    "expires_at" > "created_at"
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rate_limit_admissions_expires_at"
  ON "system"."rate_limit_admissions" ("expires_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "system"."consume_rate_limit_buckets"(
  p_bucket_keys TEXT[],
  p_capacities_mt BIGINT[],
  p_refill_tokens_mt BIGINT[],
  p_refill_periods_ms BIGINT[],
  p_costs_mt BIGINT[],
  p_admission_key TEXT,
  p_claim_token UUID,
  p_admission_ttl_secs INTEGER,
  p_payload_fingerprint TEXT,
  p_secondary_payload_fingerprint TEXT DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  admission_status TEXT,
  claim_token UUID,
  limiting_policy_id TEXT,
  retry_after_ms BIGINT,
  min_remaining_mt BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = system, pg_catalog
AS $$
DECLARE
  v_count INTEGER;
  v_idx INTEGER;
  v_lock_hash INTEGER;
  v_now TIMESTAMPTZ;
  v_existing "system"."rate_limit_admissions"%ROWTYPE;
  v_has_existing BOOLEAN := FALSE;
  v_fp_matches BOOLEAN := FALSE;
  v_all_allowed BOOLEAN;
  v_limiting_policy TEXT;
  v_max_retry_ms BIGINT;
  v_min_remaining_mt BIGINT;
BEGIN
  -- 1. Validate 10-parameter contract & array dimensions (SQLSTATE 22023 on invalid inputs)
  v_count := COALESCE(array_length(p_bucket_keys, 1), 0);
  IF v_count < 1 OR v_count > 8
     OR array_length(p_capacities_mt, 1) IS DISTINCT FROM v_count
     OR array_length(p_refill_tokens_mt, 1) IS DISTINCT FROM v_count
     OR array_length(p_refill_periods_ms, 1) IS DISTINCT FROM v_count
     OR array_length(p_costs_mt, 1) IS DISTINCT FROM v_count
  THEN
    RAISE EXCEPTION 'Invalid rate-limit bucket array dimensions (count=%)', v_count
      USING ERRCODE = '22023';
  END IF;

  IF p_admission_key IS NULL OR length(btrim(p_admission_key)) < 16 OR length(p_admission_key) > 200 THEN
    RAISE EXCEPTION 'Invalid p_admission_key bounds'
      USING ERRCODE = '22023';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'p_claim_token must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  IF p_admission_ttl_secs IS NULL OR p_admission_ttl_secs < 1 OR p_admission_ttl_secs > 604800 THEN
    RAISE EXCEPTION 'Invalid p_admission_ttl_secs (value=%)', p_admission_ttl_secs
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_fingerprint IS NULL OR length(btrim(p_payload_fingerprint)) < 32 OR length(p_payload_fingerprint) > 128 THEN
    RAISE EXCEPTION 'Invalid p_payload_fingerprint bounds'
      USING ERRCODE = '22023';
  END IF;

  IF p_secondary_payload_fingerprint IS NOT NULL
     AND (length(btrim(p_secondary_payload_fingerprint)) < 32 OR length(p_secondary_payload_fingerprint) > 128)
  THEN
    RAISE EXCEPTION 'Invalid p_secondary_payload_fingerprint bounds'
      USING ERRCODE = '22023';
  END IF;

  FOR v_idx IN 1..v_count LOOP
    IF p_bucket_keys[v_idx] IS NULL
       OR length(btrim(p_bucket_keys[v_idx])) < 16
       OR length(p_bucket_keys[v_idx]) > 160
       OR p_capacities_mt[v_idx] IS NULL
       OR p_capacities_mt[v_idx] <= 0
       OR p_capacities_mt[v_idx] > 1000000000
       OR p_refill_tokens_mt[v_idx] IS NULL
       OR p_refill_tokens_mt[v_idx] <= 0
       OR p_refill_periods_ms[v_idx] IS NULL
       OR p_refill_periods_ms[v_idx] <= 0
       OR p_costs_mt[v_idx] IS NULL
       OR p_costs_mt[v_idx] <= 0
       OR p_costs_mt[v_idx] > p_capacities_mt[v_idx]
    THEN
      RAISE EXCEPTION 'Invalid per-bucket rate-limit parameter at index %', v_idx
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 2. Strict deadlock-free lock hierarchy:
  --    Tier L1 (839200): admission key advisory lock
  --    Tier L2 (839201): distinct bucket key advisory locks in deterministic ASC hash order
  PERFORM pg_advisory_xact_lock(839200, hashtext(p_admission_key));

  FOR v_lock_hash IN
    SELECT DISTINCT hashtext(k) AS h
    FROM unnest(p_bucket_keys) AS k
    ORDER BY h ASC
  LOOP
    PERFORM pg_advisory_xact_lock(839201, v_lock_hash);
  END LOOP;

  -- 3. Post-lock authoritative database timestamp
  v_now := clock_timestamp();

  -- 4. Inspect and row-lock existing admission record if present
  SELECT *
  INTO v_existing
  FROM "system"."rate_limit_admissions"
  WHERE "admission_key" = p_admission_key
  FOR UPDATE;

  v_has_existing := FOUND;

  IF v_has_existing AND v_existing.expires_at > v_now THEN
    v_fp_matches := (
      v_existing.payload_fingerprint = p_payload_fingerprint
      OR (
        p_secondary_payload_fingerprint IS NOT NULL
        AND v_existing.payload_fingerprint = p_secondary_payload_fingerprint
      )
    );

    -- Payload conflict MUST reject with 409 before any additional token deduction
    IF NOT v_fp_matches THEN
      RETURN QUERY SELECT
        FALSE,
        'CONFLICT_PAYLOAD'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        0::BIGINT,
        0::BIGINT;
      RETURN;
    END IF;

    -- Already claimed key is terminal for its TTL window (409, zero additional token deduction)
    IF v_existing.status = 'CLAIMED' THEN
      RETURN QUERY SELECT
        FALSE,
        'ALREADY_CLAIMED'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        0::BIGINT,
        0::BIGINT;
      RETURN;
    END IF;

    -- Active UNCLAIMED recovery: rotate claim_token, bidirectionally re-tag payload_fingerprint
    -- to current active secret digest, NEVER extend expires_at, and deduct zero extra tokens.
    UPDATE "system"."rate_limit_admissions"
    SET
      "claim_token" = p_claim_token,
      "payload_fingerprint" = p_payload_fingerprint,
      "updated_at" = v_now
    WHERE "id" = v_existing.id
      AND "status" = 'UNCLAIMED';

    RETURN QUERY SELECT
      TRUE,
      'EXISTING_UNCLAIMED'::TEXT,
      p_claim_token,
      NULL::TEXT,
      0::BIGINT,
      0::BIGINT;
    RETURN;
  END IF;

  -- 5. Fresh or expired admission: atomically evaluate all bucket dimensions with per-bucket p_costs_mt
  WITH dims AS (
    SELECT
      ord::int AS idx,
      p_bucket_keys[ord] AS bucket_key,
      LEFT(
        CASE
          WHEN length(btrim(split_part(p_bucket_keys[ord], ':', 1))) >= 3
            THEN btrim(split_part(p_bucket_keys[ord], ':', 1))
          ELSE 'default_policy'
        END,
        64
      ) AS policy_id,
      p_capacities_mt[ord] AS capacity_mt,
      p_refill_tokens_mt[ord] AS refill_tokens_mt,
      p_refill_periods_ms[ord] AS refill_period_ms,
      p_costs_mt[ord] AS cost_mt
    FROM generate_subscripts(p_bucket_keys, 1) AS ord
  ),
  computed AS (
    SELECT
      d.idx,
      d.bucket_key,
      d.policy_id,
      d.capacity_mt,
      d.refill_tokens_mt,
      d.refill_period_ms,
      d.cost_mt,
      GREATEST(
        p_admission_ttl_secs::bigint,
        CEIL((d.capacity_mt::numeric * d.refill_period_ms::numeric) / (d.refill_tokens_mt::numeric * 1000.0))::bigint + 60
      ) AS effective_ttl_sec,
      CASE
        WHEN r.id IS NULL OR r.expires_at <= v_now THEN d.capacity_mt
        ELSE LEAST(
          d.capacity_mt,
          r.millitokens + FLOOR(
            (GREATEST(0::numeric, EXTRACT(EPOCH FROM (v_now - r.updated_at)) * 1000.0) * d.refill_tokens_mt::numeric)
            / d.refill_period_ms::numeric
          )::bigint
        )
      END AS refilled_mt,
      CASE
        WHEN r.id IS NULL OR r.expires_at <= v_now THEN v_now
        WHEN r.millitokens + FLOOR(
          (GREATEST(0::numeric, EXTRACT(EPOCH FROM (v_now - r.updated_at)) * 1000.0) * d.refill_tokens_mt::numeric)
          / d.refill_period_ms::numeric
        )::bigint >= d.capacity_mt THEN v_now
        ELSE LEAST(
          v_now,
          r.updated_at + (
            CEIL(
              (
                FLOOR(
                  (GREATEST(0::numeric, EXTRACT(EPOCH FROM (v_now - r.updated_at)) * 1000.0) * d.refill_tokens_mt::numeric)
                  / d.refill_period_ms::numeric
                ) * d.refill_period_ms::numeric
              ) / d.refill_tokens_mt::numeric
            )::bigint * INTERVAL '1 millisecond'
          )
        )
      END AS next_updated_at
    FROM dims d
    LEFT JOIN "system"."rate_limit_buckets" r
      ON r."bucket_key" = d.bucket_key
  ),
  verdict AS (
    SELECT
      bool_and(c.refilled_mt >= c.cost_mt) AS all_ok,
      (
        SELECT c2.policy_id
        FROM computed c2
        WHERE c2.refilled_mt < c2.cost_mt
        ORDER BY CEIL(((c2.cost_mt - c2.refilled_mt)::numeric * c2.refill_period_ms::numeric) / c2.refill_tokens_mt::numeric)::bigint DESC,
                 c2.idx ASC
        LIMIT 1
      ) AS lim_policy,
      COALESCE(
        MAX(
          GREATEST(
            1::bigint,
            CEIL(((c.cost_mt - c.refilled_mt)::numeric * c.refill_period_ms::numeric) / c.refill_tokens_mt::numeric)::bigint
          )
        ) FILTER (WHERE c.refilled_mt < c.cost_mt),
        0::bigint
      ) AS retry_ms,
      COALESCE(MIN(c.refilled_mt - c.cost_mt), 0::bigint) AS min_rem_mt
    FROM computed c
  ),
  applied AS (
    INSERT INTO "system"."rate_limit_buckets" (
      "bucket_key",
      "policy_id",
      "millitokens",
      "updated_at",
      "expires_at"
    )
    SELECT
      c.bucket_key,
      c.policy_id,
      c.refilled_mt - c.cost_mt,
      c.next_updated_at,
      v_now + make_interval(secs => c.effective_ttl_sec::double precision)
    FROM computed c
    CROSS JOIN verdict v
    WHERE v.all_ok = TRUE
    ORDER BY c.bucket_key ASC
    ON CONFLICT ("bucket_key") DO UPDATE SET
      "policy_id" = EXCLUDED."policy_id",
      "millitokens" = EXCLUDED."millitokens",
      "updated_at" = EXCLUDED."updated_at",
      "expires_at" = EXCLUDED."expires_at"
    RETURNING 1
  )
  SELECT v.all_ok, v.lim_policy, v.retry_ms, GREATEST(0::bigint, v.min_rem_mt)
  INTO v_all_allowed, v_limiting_policy, v_max_retry_ms, v_min_remaining_mt
  FROM verdict v;

  IF NOT v_all_allowed THEN
    RETURN QUERY SELECT
      FALSE,
      'RATE_LIMITED'::TEXT,
      NULL::UUID,
      v_limiting_policy,
      v_max_retry_ms,
      0::BIGINT;
    RETURN;
  END IF;

  -- 6. All bucket dimensions passed: create or overwrite expired admission row in UNCLAIMED state
  INSERT INTO "system"."rate_limit_admissions" (
    "admission_key",
    "status",
    "claim_token",
    "payload_fingerprint",
    "created_at",
    "updated_at",
    "claimed_at",
    "expires_at"
  )
  VALUES (
    p_admission_key,
    'UNCLAIMED',
    p_claim_token,
    p_payload_fingerprint,
    v_now,
    v_now,
    NULL,
    v_now + make_interval(secs => p_admission_ttl_secs::double precision)
  )
  ON CONFLICT ("admission_key") DO UPDATE SET
    "status" = 'UNCLAIMED',
    "claim_token" = EXCLUDED."claim_token",
    "payload_fingerprint" = EXCLUDED."payload_fingerprint",
    "created_at" = EXCLUDED."created_at",
    "updated_at" = EXCLUDED."updated_at",
    "claimed_at" = NULL,
    "expires_at" = EXCLUDED."expires_at";

  RETURN QUERY SELECT
    TRUE,
    'NEW_UNCLAIMED'::TEXT,
    p_claim_token,
    NULL::TEXT,
    0::BIGINT,
    v_min_remaining_mt;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "system"."claim_rate_limit_admission"(
  p_admission_key TEXT,
  p_claim_token UUID
)
RETURNS TABLE (
  claimed BOOLEAN,
  claim_status TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = system, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_row "system"."rate_limit_admissions"%ROWTYPE;
BEGIN
  IF p_admission_key IS NULL OR length(btrim(p_admission_key)) < 16 OR length(p_admission_key) > 200 THEN
    RAISE EXCEPTION 'Invalid p_admission_key bounds'
      USING ERRCODE = '22023';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'p_claim_token must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(839200, hashtext(p_admission_key));
  v_now := clock_timestamp();

  SELECT *
  INTO v_row
  FROM "system"."rate_limit_admissions"
  WHERE "admission_key" = p_admission_key
  FOR UPDATE;

  IF NOT FOUND OR v_row.expires_at <= v_now THEN
    RETURN QUERY SELECT FALSE, 'EXPIRED_OR_MISSING'::TEXT;
    RETURN;
  END IF;

  -- Terminal single-winner invariant: once CLAIMED, even a matching claim_token cannot re-win
  IF v_row.status = 'CLAIMED' THEN
    RETURN QUERY SELECT FALSE, 'ALREADY_CLAIMED'::TEXT;
    RETURN;
  END IF;

  IF v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT FALSE, 'TOKEN_MISMATCH'::TEXT;
    RETURN;
  END IF;

  UPDATE "system"."rate_limit_admissions"
  SET
    "status" = 'CLAIMED',
    "claimed_at" = v_now,
    "updated_at" = v_now
  WHERE "id" = v_row.id
    AND "status" = 'UNCLAIMED'
    AND "claim_token" = p_claim_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'ALREADY_CLAIMED'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'CLAIMED_WINNER'::TEXT;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "system"."consume_rate_limit_buckets"(
  TEXT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], TEXT, UUID, INTEGER, TEXT, TEXT
) FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "system"."claim_rate_limit_admission"(TEXT, UUID) FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION "system"."consume_rate_limit_buckets"(TEXT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], TEXT, UUID, INTEGER, TEXT, TEXT) TO %I',
    current_user
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION "system"."claim_rate_limit_admission"(TEXT, UUID) TO %I',
    current_user
  );
END
$$;
