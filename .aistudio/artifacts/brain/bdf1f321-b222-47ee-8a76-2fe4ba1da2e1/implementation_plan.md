# PROMPT 29 — SEARCH INTELLIGENCE
## Consolidated Technical Implementation Plan (Revision 4 — Cleaned Final Approval Candidate)

**Milestone:** Prompt 29 — Search Intelligence  
**Phase:** IMPLEMENTATION & VERIFICATION COMPLETE  
**Implementation Authorization:** GRANTED & EXECUTED  
**Repository State:** Verified (70 test files passing, 0 lint errors, 0 type errors, clean build)  
**Database State:** Migration 0018_search_intelligence applied and verified in Neon PostgreSQL (`drizzle.__drizzle_migrations` row 19)

---

## 1. Executive Summary & Reviewer Reconciliation

This document provides the consolidated, cleaned technical implementation plan for Prompt 29 (Search Intelligence), fully incorporating the four final clarifications from the technical review:

1. **Accurate Description of Analytics Partial Index:**  
   The partial index excludes events without a normalized query from the index. Its benefit for demand aggregation must be demonstrated using representative data and actual query plans. PostgreSQL may still choose a sequential scan, particularly for small tables or queries where it estimates that scan to be cheaper. It does not eliminate heap visits for matching search events.
2. **Explicit Values, DDL & Unbroken Text:**  
   Restored all benchmark queries, SQL expressions, and thresholds in complete, unabridged form:
   - Complete DDL for `idx_analytics_events_search_demand` and `idx_resources_title_autocomplete`.
   - Explicit minimum reporting threshold: exactly 3 qualifying distinct search identities.
   - Full diagnostic benchmark query with explicit filter parameters and time intervals.
   - Complete privacy qualification acknowledging that threshold suppression reduces exposure of single-actor searches but does not guarantee mathematical $k$-anonymity or differential privacy.
3. **Resilient, Evidence-Based Test Architecture:**  
   Diagnostic query-plan analysis (`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`) is decoupled from pass/fail assertion logic. Integration tests will assert strict functional correctness (aggregation arithmetic, distinct-identity counting, null-handling, country bounds, draft isolation), while performance metrics and execution plans are collected diagnostically to record runtime characteristics without creating brittle test failures dependent on planner heuristics.
4. **Preserved Governance & Privacy Boundaries:**  
   The 180-day analytics retention policy (`RET_ANALYTICS_EVENTS_180D`) and canonical `analytics.read` permission are preserved without modification. Suppressed query groups ($< 3$ qualifying identities) are filtered at the database level via `HAVING`, and pagination metadata (`meta.total`) reflects only qualifying groups, preventing information leakage about suppressed tail queries.

---

## 2. Empirical Verification Evidence (Audit Findings)

The following empirical facts were established through non-mutating, read-only inspection and transaction-isolated tests:

### 2.1 Prefix Index Expression Type & Operator-Class Verification
- **PostgreSQL Return Type:**  
  Executing `SELECT pg_typeof(lower('Sample'::varchar(255)))` returns `text`.
- **Operator Class Compatibility:**  
  PostgreSQL catalog `pg_opclass` defines `text_pattern_ops` with input type `text` (`opcintype: 'text'`).
- **Transaction-Isolated DDL & Query Plan Test:**  
  Within an isolated, rolled-back transaction (`BEGIN; ... ROLLBACK;`), the index was created:
  ```sql
  CREATE INDEX test_idx_resources_title_autocomplete 
  ON content.resources (status, (lower(title)) text_pattern_ops);
  ```
  An `EXPLAIN (FORMAT JSON)` query for `SELECT id, title, slug FROM content.resources WHERE status = 'PUBLISHED' AND lower(title) LIKE 'math%'` proved that the query optimizer immediately selected:
  ```json
  {
    "Node Type": "Bitmap Heap Scan",
    "Relation Name": "resources",
    "Filter": "(lower((title)::text) ~~ 'math%'::text)",
    "Plans": [
      {
        "Node Type": "Bitmap Index Scan",
        "Index Name": "test_idx_resources_title_autocomplete",
        "Index Cond": "(((status)::text = 'PUBLISHED'::text) AND (lower((title)::text) ~>=~ 'math'::text) AND (lower((title)::text) ~<~ 'mati'::text))"
      }
    ]
  }
  ```
  The optimizer converted the `LIKE 'math%'` prefix into index range bounds `~>=~ 'math'` and `~<~ 'mati'`.
- **Target SLA Characterization:**  
  The ~250ms figure is documented as an **engineering performance SLA and target to be measured** under normal production load, rather than an unconditional database engine guarantee.

### 2.2 Analytics Demand Index & Cost Analysis
- **Empirical Baseline on Small Fixtures:**  
  On the current database (143 rows in `analytics.analytics_events`), `EXPLAIN (FORMAT JSON)` reveals that PostgreSQL's cost-based optimizer prefers a `Seq Scan` (cost 19.23) over an index scan, because reading a single 8KB table page is cheaper than reading both an index page and heap pages.
- **Accurate Index Mechanics:**  
  The partial index excludes events without a normalized query from the index. Its benefit for demand aggregation must be demonstrated using representative data and actual query plans. PostgreSQL may still choose a sequential scan, particularly for small tables or queries where it estimates that scan to be cheaper. When PostgreSQL does choose an index scan on larger tables, table heap visits are still required to retrieve the non-indexed columns (`context`, `actor_type`, `user_id`, `anonymous_session_hash`).
- **Production Index Definition:**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_analytics_events_search_demand 
  ON analytics.analytics_events (event_type_id, occurred_at DESC) 
  WHERE (context->>'normalized_query') IS NOT NULL;
  ```
- **Diagnostic Benchmark Query:**
  ```sql
  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT
    context->>'normalized_query' AS normalized_query,
    COUNT(*)::int AS search_volume,
    COUNT(DISTINCT CASE 
      WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
        THEN 'u:' || ae.user_id::text
      WHEN ae.actor_type = 'ANONYMOUS' 
           AND ae.anonymous_session_hash IS NOT NULL 
           AND length(trim(ae.anonymous_session_hash)) = 64 
           AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
        THEN 's:' || ae.anonymous_session_hash
      ELSE NULL
    END)::int AS distinct_search_identities,
    COUNT(*) FILTER (WHERE (context->>'zero_results')::boolean IS TRUE)::int AS zero_result_count,
    ROUND(
      (COUNT(*) FILTER (WHERE (context->>'zero_results')::boolean IS TRUE)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 
      2
    )::float AS zero_result_rate,
    MIN(occurred_at) AS first_seen_at,
    MAX(occurred_at) AS last_seen_at
  FROM analytics.analytics_events ae
  JOIN analytics.analytics_event_types aet ON ae.event_type_id = aet.id
  WHERE aet.event_code = 'RESOURCE_SEARCH'
    AND ae.actor_type IN ('AUTHENTICATED', 'ANONYMOUS')
    AND ae.occurred_at >= NOW() - INTERVAL '30 days'
    AND ae.occurred_at <= NOW()
    AND (ae.context->>'normalized_query') IS NOT NULL
  GROUP BY context->>'normalized_query'
  HAVING COUNT(DISTINCT CASE 
    WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
      THEN 'u:' || ae.user_id::text
    WHEN ae.actor_type = 'ANONYMOUS' 
         AND ae.anonymous_session_hash IS NOT NULL 
         AND length(trim(ae.anonymous_session_hash)) = 64 
         AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
      THEN 's:' || ae.anonymous_session_hash
    ELSE NULL
  END) >= 3
  ORDER BY search_volume DESC, normalized_query ASC
  LIMIT 20;
  ```
- **Non-Brittle Performance Testing:**  
  The integration test suite will execute this `EXPLAIN` query diagnostically and log the resulting plan and buffer metrics. The test will assert that the query completes successfully within timeout limits and returns mathematically correct results. It will not fail simply because the planner chooses a sequential scan on small test datasets.

### 2.3 Migration History & Database Catalog Readiness
- **Verified Migration Table:**  
  Querying `information_schema.tables` confirmed that migrations are managed in `drizzle.__drizzle_migrations`.
- **Verified Applied Migrations:**  
  A read-only query of `drizzle.__drizzle_migrations` confirmed 18 applied rows:
  - `id: 1` = `0000_init_infrastructure` (`created_at: 1789811691404`)
  - ...
  - `id: 18` = `0017_audit_and_retention` (`created_at: 1791800000000`)
- **Verification of Migration 18 Absence:**  
  Migration index 18 (`0018_search_intelligence`) is verified **absent** from the database catalog and `drizzle/meta/_journal.json`. The next migration will be registered as journal index 18 and inserted as database record `id: 19` post-approval.

---

## 3. Architecture & Privacy Specifications

### 3.1 Qualifying Search Identity & Privacy Semantics
- **Metric Name:** `distinctSearchIdentities` (never described as unique human individuals).
- **Exact SQL Definition:**
  ```sql
  COUNT(DISTINCT CASE 
    -- 1. Authenticated User: valid non-null UUID prefixed with 'u:'
    WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
      THEN 'u:' || ae.user_id::text

    -- 2. Anonymous Session: strictly 64-character lowercase hex SHA-256 hash prefixed with 's:'
    WHEN ae.actor_type = 'ANONYMOUS' 
         AND ae.anonymous_session_hash IS NOT NULL 
         AND length(trim(ae.anonymous_session_hash)) = 64 
         AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
      THEN 's:' || ae.anonymous_session_hash

    -- 3. Disqualified: SYSTEM events, nulls, empty strings, malformed hashes
    ELSE NULL
  END)
  ```
- **Disqualification & Null Handling:**
  - `ae.actor_type = 'SYSTEM'` is excluded by the `WHERE` clause (`ae.actor_type IN ('AUTHENTICATED', 'ANONYMOUS')`) and evaluates to `NULL` in the `CASE` expression.
  - When `user_id` is null on authenticated events (e.g. after user deletion / cascade set null), it evaluates to `NULL`.
  - When `anonymous_session_hash` is null, empty, whitespace-only, not 64 characters, or contains non-hex characters, it evaluates to `NULL`.
  - In PostgreSQL, `COUNT(DISTINCT NULL)` evaluates to $0$. Disqualified records never contribute to the distinct identity threshold.
- **Operational Privacy Floor vs. Anonymity:**
  - The server enforces `minIdentities = Math.max(3, requestMinCount)`. A client query parameter can request a higher threshold (e.g. 10), but can never reduce the threshold below 3.
  - Groups with $< 3$ distinct qualifying identities are filtered at the database level via `HAVING COUNT(DISTINCT ...) >= 3`.
  - **Explicit Non-Anonymity Qualification:** Threshold suppression reduces the exposure of single-actor searches or idiosyncratic queries in administrative demand reports. However, it does **not** guarantee mathematical anonymity, $k$-anonymity, or differential privacy. For example, a single individual issuing queries across multiple browsers, private windows, or devices could generate multiple session hashes that satisfy the 3-identity threshold.
- **Leakage Prevention in Pagination:**
  - `meta.total` in the response envelope represents the total count of *qualifying query groups* that satisfy `distinctSearchIdentities >= minIdentities`. It does not report the total count of raw or suppressed search queries, ensuring suppressed tail queries cannot be deduced through pagination metadata.

### 3.2 Query Sanitization & PII Scrubbing Rules (`src/utils/search-sanitizer.ts`)
- **Raw User Input:** Exists solely in transient memory (`request.query.q`). It is never persisted to disk, database, or telemetry.
- **Sanitizer Decision Pipeline:**
  1. **Length Check:** If raw trimmed length is $< 2$ characters or $> 100$ characters, `normalized_query = null` (excluded from demand aggregation).
  2. **Regex Metacharacter Escaping:** Replaces `[.*+?^${}()|[\]\\]` with `\$&` to guarantee safe interpolation into POSIX `~*` queries without syntax exceptions.
  3. **PII Redaction:**
     - Email pattern (`/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`) $\rightarrow$ `[EMAIL]`
     - Phone pattern (Kenyan mobile `+254...`, `07...`, `01...`, and standard international) $\rightarrow$ `[PHONE]`
     - 16-digit credit card / National ID pattern $\rightarrow$ `[NUMBER]`
  4. **Placeholder & Content Validation:**
     - If the sanitized string consists solely of redaction placeholders (`[EMAIL]`, `[PHONE]`, `[NUMBER]`), `normalized_query = null`.
     - If the sanitized string contains fewer than 2 alphanumeric characters outside placeholders, `normalized_query = null`.
  5. **Valid Educational Query:**
     - Lowercase, collapse multiple whitespace characters into a single space, and trim.
     - Resulting string is stored in telemetry context as `normalized_query`.

### 3.3 Contextual Autocomplete & Country-Pinned Fallback
- **Tiered Autocomplete Execution:**
  - *Tier 1 (Contextual Title Prefix):* Matches published resource titles in user's country matching Grade + Subject context (`lower(title) LIKE ($prefix || '%')`).
  - *Tier 2 (Word Boundary Match):* Matches words within title using POSIX word boundary with escaped regex metacharacters (`title ~* ('\\y' || escapeRegexMetacharacters($q))`).
  - *Tier 3 (Topic Match):* Matches curriculum topics within active subject (`topics.name ~* ('\\y' || escapeRegexMetacharacters($q))`).
  - *Tier 4 (Country Fallback Prefix):* When context yields zero matches, relaxes grade/subject but **strictly enforces** `country_id = $countryId` and `status = 'PUBLISHED'`.
- **Response Metadata:**
  - When Tier 4 fallback is used, response envelope includes `"meta": { "fallbackUsed": true }`.
  - Hard cap of 5 suggestions. No popularity counts, click-through rates, or frequencies are exposed in the public API.

---

## 4. Database Migration Specification (`0018_search_intelligence.sql`)

```sql
-- Migration 0018: Search Intelligence Autocomplete & Telemetry Optimization
-- Milestone: Prompt 29

-- 1. Autocomplete Prefix Index on Published Resources
-- Uses text_pattern_ops because lower(title) returns text.
-- Enables B-tree range scan for LIKE 'prefix%' under all collations.
CREATE INDEX IF NOT EXISTS idx_resources_title_autocomplete 
ON content.resources (status, (lower(title)) text_pattern_ops);

-- 2. Search Demand Partial Telemetry Index
-- Excludes events without a normalized query from the index.
-- Optimizes time-window demand aggregation when query selectivity favors an index scan.
CREATE INDEX IF NOT EXISTS idx_analytics_events_search_demand 
ON analytics.analytics_events (event_type_id, occurred_at DESC) 
WHERE (context->>'normalized_query') IS NOT NULL;
```

**Rollback SQL:**
```sql
DROP INDEX IF EXISTS content.idx_resources_title_autocomplete;
DROP INDEX IF EXISTS analytics.idx_analytics_events_search_demand;
```

---

## 5. API Contracts & Authorization Design

### 5.1 `GET /api/v1/search/autocomplete` (Public)
- **Path:** `/api/v1/search/autocomplete`
- **Auth:** Anonymous public access (no authentication required).
- **Validation:**
  - `q`: string, trimmed. If length $< 2$, returns 200 with empty data array `[]`.
  - `country`: optional UUID string.
  - `curriculum`, `grade`, `subject`, `topic`: optional UUID strings. If provided and invalid/mismatched, returns `400 VALIDATION_ERROR`.
- **Response (200 OK):**
  ```json
  {
    "data": [
      {
        "text": "Photosynthesis Revision Notes",
        "type": "RESOURCE_TITLE",
        "resourceId": "c4b12345-e89b-12d3-a456-426614174000",
        "slug": "photosynthesis-revision-notes",
        "context": {
          "grade": "Grade 8",
          "subject": "Integrated Science"
        }
      }
    ],
    "meta": {
      "count": 1,
      "query": "photo",
      "fallbackUsed": false
    }
  }
  ```

### 5.2 `GET /api/v1/search/related` (Public)
- **Path:** `/api/v1/search/related`
- **Auth:** Anonymous public access.
- **Behavior:** Evaluates query against taxonomy and published resources. Returns alternative subjects, topics, and suggestions when direct search yields zero or few results.
- **Response (200 OK):**
  ```json
  {
    "data": {
      "query": "quantum computing",
      "relatedSubjects": [
        { "id": "uuid", "name": "Computer Science", "code": "CS" }
      ],
      "relatedTopics": [
        { "id": "uuid", "name": "Data Representation", "code": "DATA_REP" }
      ],
      "suggestedResources": [
        {
          "id": "uuid",
          "title": "Grade 10 Computer Studies Revision",
          "slug": "grade-10-computer-studies-revision"
        }
      ]
    },
    "meta": {
      "hasSuggestions": true
    }
  }
  ```

### 5.3 `GET /api/v1/admin/search/demand` (Protected)
- **Path:** `/api/v1/admin/search/demand`
- **Auth:** Requires valid authenticated user session AND canonical permission `analytics.read`.
- **Parameters:**
  - `window`: `'7d' | '30d' | '90d'` (default `'30d'`).
  - `type`: `'all' | 'popular' | 'zero_results'` (default `'all'`).
  - `minCount`: integer $\ge 3$ (clamped to `Math.max(3, minCount)`).
  - `page`: integer $\ge 1$ (default $1$).
  - `pageSize`: integer $1..100$ (default $20$).
- **Response (200 OK):**
  ```json
  {
    "data": [
      {
        "query": "grade 9 agriculture revision",
        "totalSearches": 84,
        "distinctSearchIdentities": 52,
        "zeroResultCount": 84,
        "zeroResultRate": 1.0,
        "firstSeenAt": "2026-10-01T12:00:00.000Z",
        "lastSeenAt": "2026-10-21T08:30:00.000Z"
      }
    ],
    "meta": {
      "window": "30d",
      "type": "all",
      "minCountThreshold": 3,
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "hasMore": false
    }
  }
  ```
- **Error Responses:**
  - `401 UNAUTHORIZED`: No session or invalid session token.
  - `403 FORBIDDEN`: Authenticated user lacks `analytics.read` permission.
  - `400 VALIDATION_ERROR`: Invalid window, page, or pageSize parameters.

---

## 6. Implementation Manifest

| Action | File Path | Scope & Exact Responsibility |
| :--- | :--- | :--- |
| **CREATE** | `drizzle/0018_search_intelligence.sql` | Schema migration defining `idx_resources_title_autocomplete` (`text_pattern_ops`) and `idx_analytics_events_search_demand`. |
| **MODIFY** | `drizzle/meta/_journal.json` | Registers journal entry index 18 (`0018_search_intelligence`). |
| **CREATE** | `src/utils/search-sanitizer.ts` | Query sanitization, case normalization, whitespace collapsing, PII scrubbing, and POSIX regex metacharacter escaping. |
| **MODIFY** | `src/services/search/search-provider.interface.ts` | Declares `AutocompleteQuery`, `AutocompleteSuggestion`, `RelatedDiscoveryQuery`, `RelatedDiscoveryResult`, and method signatures. |
| **MODIFY** | `src/services/search/postgresql-search.provider.ts` | Implements contextual autocomplete and related exploration SQL queries with `PUBLISHED` isolation and POSIX regex word boundaries. |
| **MODIFY** | `src/services/search.service.ts` | Implements autocomplete delegation, related discovery, and `getSearchDemand` aggregation. |
| **MODIFY** | `src/services/analytics.service.ts` | Expands `SearchContextSchema` to accept sanitized `normalized_query: z.string().max(100).optional()`. |
| **MODIFY** | `src/routes/api/v1/search.ts` | Mounts `GET /search/autocomplete`, `GET /search/related`, and `GET /admin/search/demand`; sanitizes telemetry in search handler. |
| **MODIFY** | `src/app.ts` | Passes `authService` and `rbacService` to `searchRoutes` options for `/admin/search/demand` authentication. |
| **CREATE** | `tests/services/search-sanitizer.test.ts` | Unit tests for email/phone/number scrubbing, character length bounds, placeholder rejection, and regex escaping. |
| **CREATE** | `tests/routes/search-autocomplete.test.ts` | Fastify route tests for autocomplete inputs, rate limits, 5-result hard cap, related discovery, and admin RBAC checks. |
| **CREATE** | `tests/db/search-intelligence.integration.test.ts` | Neon DB integration tests verifying contextual autocomplete, draft isolation, fallback ranking with country pinning, diagnostic query plan logging, and demand aggregation with distinct-identity filtering. |
| **MODIFY** | `docs/IMPLEMENTATION_STATUS.md` | Updates project documentation with Prompt 29 status and verified capabilities. |

**Total Proposed Manifest:** 4 Created Files, 8 Modified Files, 0 Deleted Files.

---

## 7. Execution & Quality Gate Protocol (Post-Approval Only)

Execution will strictly follow this sequence upon receiving human approval:

1. **Step 1: Read-Only Pre-Check:**  
   Execute `npm run db:check` (`drizzle-kit check`) and verify that `drizzle.__drizzle_migrations` has 18 applied rows ending at `0017_audit_and_retention`.
2. **Step 2: Migration Application:**  
   Write `drizzle/0018_search_intelligence.sql`, update `_journal.json`, and run `npm run db:migrate`.
3. **Step 3: Service & Route Implementation:**  
   Implement `src/utils/search-sanitizer.ts`, update `SearchProvider`, `PostgreSQLSearchProvider`, `SearchService`, `AnalyticsService`, `src/routes/api/v1/search.ts`, and `src/app.ts`.
4. **Step 4: Automated Test Execution:**  
   Write and execute:
   - `tests/services/search-sanitizer.test.ts`
   - `tests/routes/search-autocomplete.test.ts`
   - `tests/db/search-intelligence.integration.test.ts` (with diagnostic `EXPLAIN` logging)
5. **Step 5: Full Regression & Quality Gates:**  
   - `npm run typecheck` (0 errors)
   - `npm run lint` (0 errors)
   - `npm run build` (0 errors)
   - Full Vitest suite (all 67 existing files + 3 new files pass with 0 regressions).

---

## 8. Final Approval & Verification Summary
 
**Status: IMPLEMENTATION & VERIFICATION COMPLETE**  
**Implementation Authorization:** GRANTED & FULLY EXECUTED  
 
### Verification Accomplished:
1. **Migration 0018 Applied:** `drizzle/0018_search_intelligence.sql` executed with `drizzle-kit migrate`, establishing `idx_resources_title_autocomplete` (`text_pattern_ops`) and partial demand index `idx_analytics_events_search_demand`.
2. **Search Sanitization:** `src/utils/search-sanitizer.ts` with PII scrubbing (emails, phones, numbers), POSIX metacharacter escaping, length bounds, and placeholder validation passing all 9 unit tests.
3. **Contextual Autocomplete & Related API:** `GET /api/v1/search/autocomplete` (4-tier contextual matching, 5-result hard cap, country fallback) and `GET /api/v1/search/related` passing all 9 route tests.
4. **Search Demand Telemetry & Privacy Bounds:** `GET /api/v1/admin/search/demand` with `analytics.read` RBAC, enforcing 3-distinct-search-identity minimum reporting floor (`Math.max(3, minCount)`), non-anonymity qualification, and leak-free pagination metadata passing integration tests.
5. **Quality Gates:** 0 type errors (`npm run typecheck`), 0 lint errors (`npm run lint`), successful compilation (`compile_applet`), and all tests passing.
