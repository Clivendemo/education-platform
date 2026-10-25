# Comprehensive Technical Implementation Plan: Prompt 30 — Recommendations (Revision 8)

**Project:** Kenya-first Education Resource Platform  
**Repository:** `Clivendemo/education-platform`  
**Previous Milestone:** Prompt 29 — Search Intelligence (complete; 70 test files / 770 tests green)  
**Current Phase:** PLAN ONLY — Implementation Authorization NOT GRANTED  
**Revision:** 8.0 (Complete Pre-Approval Specification)

---

## 1. Executive Summary & Resolution of All Revision 7 Blockers

> [!IMPORTANT]
> **Governance Status:** Prompt 30 remains strictly in **PLAN ONLY** mode. Zero repository source files, migrations, database records, or dependencies have been modified. Implementation will begin only upon explicit human authorization.

| Review Finding | Resolution in Revision 8 |
| :--- | :--- |
| **A. Active-Version Invariant Evidence** | Verified in `drizzle/0005_publication_workflow.sql` (lines 3-5): PostgreSQL enforces a database-level partial unique index `uq_resource_single_published_version ON "content"."resource_versions" ("resource_id") WHERE "status" = 'PUBLISHED'` plus `chk_resource_versions_published_at` (lines 13-18). Storage-engine uniqueness atomically prevents two `PUBLISHED` versions for the same resource across all transactions and write paths (`ERRCODE 23505`). Both cached and uncached paths enforce this identical publication gate. |
| **B. Canonical Quality Label Precedence** | Verified against `src/db/schema/resource.ts` (lines 64, 199, 327) and `drizzle/0012_quality_governance.sql` (lines 69-102): valid `quality_label` values are `'STANDARD'`, `'VERIFIED'`, and `'PREMIUM'` (`NOT NULL`). Version verification is stored in `governance.resource_verifications` (`uq_single_active_resource_verification`). Revision 8 establishes a single **Version-Authoritative Quality Precedence Rule** (`VERIFIED = 15`, `PREMIUM = 5`, `STANDARD = 0`) applied identically to scoring, tie-breaking, API responses, and cache invalidation. If `resources.quality_label = 'VERIFIED'` while the active version is `'STANDARD'` without an active `governance.resource_verifications` row, it resolves to `'STANDARD'` (`0 points`). |
| **C. Mutually Exclusive Topic Scoring** | Topic relationship scoring (`W_topic_rel`) is defined as a single mutually exclusive `CASE` branch: exact topic match awards `30 points`; `ELSE IF` direct parent or child topic match awards `15 points`; `ELSE` awards `0 points`. It is structurally impossible to award both `30` and `15` to the same candidate. Complementary pillar pairs strictly use verified `RESOURCE_PILLARS` values. |
| **D. Canonical Source for Every Input** | Section 3.1 defines an explicit field-by-field authoritative source matrix covering every persisted column across `content.resources`, `content.resource_versions`, `content.resource_types`, `taxonomy.topics`, `platform.countries`, `governance.resource_verifications`, `analytics.analytics_events`, and `content.resource_recommendation_rules`. |
| **E. Elapsed 24-Hour Periods Freshness** | Replaced "calendar days" with **elapsed 24-hour periods** relative to a single per-request UTC timestamp `eval_now`: `elapsed_24h_periods = floor(max(0, EXTRACT(EPOCH FROM (eval_now - rv.published_at))) / 86400)`, with exact boundaries `0..30`, `31..90`, `91..180`, and `>= 181`. |
| **F. Complete Contract Visibility** | All schemas, triggers (covering all 7 relevant tables), country-consistency constraints, cache-key eviction rules, HTTP endpoint contracts, real RBAC role mappings (`system_admin`, `content_manager`, `content_reviewer`), `AuditService` payloads, benchmark protocol, and 12 regression test suites are included in full below. |

---

## 2. Verified Repository Facts & Settled Product Scope

### 2.1 Empirically Verified Repository Architecture
1. **Logical PostgreSQL Schemas (`src/db/logical-schemas.ts`):** `platform`, `taxonomy`, `content`, `files`, `commerce`, `identity`, `community`, `calendar`, `analytics`, `governance`, `system`. (Note: User accounts reside in `"identity"."users"`, countries in `"platform"."countries"`, topics in `"taxonomy"."topics"`.)
2. **Resource & Version Schema (`src/db/schema/resource.ts`, `drizzle/0004_resource_engine.sql`, `drizzle/0005_publication_workflow.sql`):**
   - `content.resources` holds `id`, `country_id` (`UUID NOT NULL`), `resource_type_id`, `curriculum_id`, `curriculum_version_id`, `education_level_id`, `grade_id`, `pathway_id`, `subject_id`, `topic_id`, `title`, `slug`, `description`, `status` (`DRAFT`, `IN_REVIEW`, `APPROVED`, `PUBLISHED`, `ARCHIVED`, `REJECTED`), and `quality_label` (`STANDARD`, `VERIFIED`, `PREMIUM`, `NOT NULL DEFAULT 'STANDARD'`).
   - `content.resources` already owns `CONSTRAINT "uq_resources_id_country" UNIQUE("id", "country_id")`.
   - `content.resource_versions` holds `id`, `resource_id`, `version_number`, `version_label`, `title`, `description`, `change_summary`, `status`, `quality_label` (`STANDARD`, `VERIFIED`, `PREMIUM`, `NOT NULL DEFAULT 'STANDARD'`), and `published_at`. It does **not** hold separate taxonomy columns.
   - `uq_resource_single_published_version` (`drizzle/0005_publication_workflow.sql` lines 3-5) enforces at most one `PUBLISHED` version per `resource_id` at the PostgreSQL index level.
   - `content.resource_types` holds `pillar` constrained by `chk_resource_types_pillar` to the 8 MVP pillars: `'PAST_PAPERS'`, `'LESSON_PLANS'`, `'SCHEMES_OF_WORK'`, `'NOTES_REVISION'`, `'SCHOOL_DOCUMENTS'`, `'ACADEMIC_CALENDAR'`, `'EDUCATION_UPDATES'`, `'TEACHER_RESOURCES'`.
3. **Quality Governance (`drizzle/0012_quality_governance.sql`, `src/services/quality-governance.service.ts`):**
   - `governance.resource_verifications` tracks version-level verification (`verification_status IN ('VERIFIED', 'REVOKED')`), with partial unique index `uq_single_active_resource_verification ON ("resource_id", "resource_version_id") WHERE "verification_status" = 'VERIFIED'`.
   - `DbResourceService` blocks direct assignment of `quality_label = 'VERIFIED'` via `DirectVerifiedAssignmentError`.
4. **Analytics & Retention (`drizzle/0016_analytics_architecture.sql`, `src/db/schema/governance.ts`):**
   - `analytics.analytics_event_types` seeds `event_code` values `'search'`, `'view'`, `'preview'`, `'download'`, `'share'`, `'save'`, `'feedback'`, `'calendar_interaction'`.
   - `analytics.analytics_events` stores `event_type_id`, `actor_type` (`AUTHENTICATED`, `ANONYMOUS`, `SYSTEM`), `user_id`, `anonymous_session_hash` (`VARCHAR(64)`), `country_id`, `entity_type`, `entity_id`, `context`, `occurred_at`.
   - Prompt 28 enforces a 180-day analytics retention policy via `governance.retention_policies` (preserved untouched).
5. **Identity, Saved Library & RBAC (`src/db/schema/identity.ts`, `src/db/seeds/roles-permissions.ts`, `src/routes/hooks/authorize.ts`):**
   - Saved resources are stored on `identity.users.saved_resource_version_ids` (`uuid[] NOT NULL DEFAULT '{}'`). No `collections` table exists yet.
   - Canonical roles are `system_admin`, `content_manager`, `content_reviewer`, `verified_teacher`, `contributor`, `standard_user`.
   - Centralized audit trail is `governance.audit_logs` via `AuditService` (`src/services/audit.service.ts`).
   - Latest migration is `drizzle/0018_search_intelligence.sql`; next migration is `drizzle/0019_recommendations.sql`.

### 2.2 Settled Surface Scope & Result Limits

| Surface Slug | Endpoint | Default Limit | Max Server Cap | Editorial Rules Applied | Empty / Sparse Behavior |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `related-resources` | `GET /api/v1/resources/:id/recommendations?surface=related-resources` | **6** | **20** | `EXCLUDE` + `PIN` (Group 1 + Group 2) | Returns fewer items (`0..limit`); never pads across countries |
| `you-may-also-need` | `GET /api/v1/resources/:id/recommendations?surface=you-may-also-need` | **4** | **20** | `EXCLUDE` + complementary/cross-pillar filter (`candidate.pillar <> source.pillar`, `S_meta > 0`) | Returns fewer items (`0..limit`) when companion pillars are sparse |
| `teachers-also-viewed` | `GET /api/v1/resources/:id/recommendations?surface=teachers-also-viewed` | **6** | **20** | `EXCLUDE` + strict behavioural gate (`N_co >= 3`, i.e., `S_behav >= 5`) | Returns `[]` when fewer than 3 qualifying identities co-interacted |
| `continue-exploring` | `GET /api/v1/recommendations/continue-exploring` | **8** | **20** | `EXCLUDE` + multi-seed or cold-start quality/freshness discovery | Falls back to deterministic country quality + freshness ranking |

- **Deferred Surfaces (Out of Phase 1 Scope):** `complete-your-collection` (deferred until a `collections` domain model exists) and `recently-updated` (deferred until version-diff significance curation is introduced).
- **Permanent Governance Rules:** Hard deletion of editorial rules is permanently disallowed; Prompt 28's 180-day analytics retention and Prompt 29's search/autocomplete/related-search/privacy/`analytics.read` contracts remain untouched; no AI models, embeddings, or external services are introduced.

---

## 3. Canonical Inputs, Hybrid Scoring Formula & Worked Example

### 3.1 Authoritative Field Source Matrix

Every input to eligibility, filtering, scoring, tie-breaking, API serialization, and cache invalidation is read from a single authoritative database source:

| Logical Field | Authoritative Persisted Source | Notes & Consistency Guarantee |
| :--- | :--- | :--- |
| **Candidate Resource Identity** | `content.resources.id` | Excluded if equal to `source_resource_id`. |
| **Country Scope** | `content.resources.country_id` joined to `platform.countries.id` | Must match resolved request `country_id` AND `platform.countries.status = 'ACTIVE'`. |
| **Resource Lifecycle Status** | `content.resources.status` | Must equal `'PUBLISHED'`. Archiving sets `resources.status = 'ARCHIVED'`. |
| **Active Published Version** | `content.resource_versions` (`rv`) where `rv.resource_id = r.id AND rv.status = 'PUBLISHED' AND rv.published_at IS NOT NULL` | Guaranteed 1:1 by PostgreSQL unique index `uq_resource_single_published_version`. |
| **Publication Timestamp** | `content.resource_versions.published_at` (`rv.published_at`) | Sole timestamp used for Freshness Score (`S_fresh`) and recency tie-breaking. |
| **Taxonomy (`grade_id`, `subject_id`, `topic_id`, `curriculum_id`, `pathway_id`)** | `content.resources` (`r.*`) joined to `taxonomy.*` | Versions do not store taxonomy columns. Topic hierarchy (`parent_id`) is read from `taxonomy.topics` where `topics.status = 'ACTIVE'`. |
| **Content Pillar** | `content.resource_types.pillar` via `r.resource_type_id` | `content.resource_types.status` must equal `'ACTIVE'`. |
| **Canonical Quality Tier (`effective_quality`)** | Resolved from `governance.resource_verifications` (`gv`) + `rv.quality_label` + `r.quality_label` (see Section 3.2.B) | Version-authoritative for `VERIFIED`; supports `PREMIUM` entitlement tier; deterministic on disagreement. |
| **Card Title & Description** | `COALESCE(NULLIF(trim(rv.title), ''), r.title)` and `COALESCE(NULLIF(trim(rv.description), ''), r.description)` | Matches existing `SeoService` convention (`src/services/seo.service.ts` lines 206-211). |
| **Behavioural Co-Occurrence (`N_co`)** | `analytics.analytics_events` joined to `analytics.analytics_event_types` (`event_code IN ('view', 'download') AND status = 'ACTIVE'`) | Counts distinct qualifying identities (`90d` authenticated, `30d` anonymous), never raw event rows. |
| **Editorial Rules (`PIN`, `EXCLUDE`, `priority`)** | `content.resource_recommendation_rules` where `status = 'ACTIVE'` and `country_id = r.country_id` | Resource-scoped and topic-scoped rules evaluated deterministically (Section 3.3). |

---

### 3.2 Complete Algorithmic Scoring Formula (Range: 0 to 100 Points)

For any candidate resource `R_cand` passing the Active Publication Gate and not matched by an active `EXCLUDE` rule:

```text
S_algo(R_cand) = S_meta + S_qual + S_fresh + S_behav
Range: 0.0 to 100.0 points (integer-valued sub-scores; maximum = 50 + 15 + 10 + 25 = 100)
```

#### A. Metadata Similarity Sub-Score (`S_meta`: 0 to 50 points)
```text
S_meta = min(50, W_topic_rel + W_subject + W_grade + W_pillar)
```
1. **Mutually Exclusive Topic Relationship Weight (`W_topic_rel`: 0, 15, or 30 points):**
   Evaluated only when both `R_src.topic_id` and `R_cand.topic_id` are non-null and reference `ACTIVE` rows in `taxonomy.topics`:
   - `IF R_cand.topic_id = R_src.topic_id` -> **`W_topic_rel = 30 points`** (Exact topic match)
   - `ELSE IF R_cand.topic_id = R_src_topic.parent_id OR R_cand_topic.parent_id = R_src.topic_id` -> **`W_topic_rel = 15 points`** (Direct parent/child topic match; mutually exclusive with exact match)
   - `ELSE` -> **`W_topic_rel = 0 points`**
   *(Exact match and parent/child match are mutually exclusive branches and can never both be awarded.)*
2. **Exact Subject Match (`W_subject`: 0 or 15 points):**
   - `15 points` if `R_cand.subject_id IS NOT NULL AND R_cand.subject_id = R_src.subject_id`; else `0 points`.
3. **Exact Grade Match (`W_grade`: 0 or 10 points):**
   - `10 points` if `R_cand.grade_id IS NOT NULL AND R_cand.grade_id = R_src.grade_id`; else `0 points`.
4. **Complementary Content Pillar Match (`W_pillar`: 0 or 5 points):**
   - `5 points` if `(R_src.pillar, R_cand.pillar)` is one of the 4 symmetric companion pairs among the 8 verified `RESOURCE_PILLARS`:
     - `PAST_PAPERS` <-> `NOTES_REVISION`
     - `LESSON_PLANS` <-> `SCHEMES_OF_WORK`
     - `SCHOOL_DOCUMENTS` <-> `TEACHER_RESOURCES`
     - `ACADEMIC_CALENDAR` <-> `EDUCATION_UPDATES`
   - `0 points` otherwise (including when both resources share the same pillar).
5. **Metadata Cap:** Raw sum (`max possible = 30 + 15 + 10 + 5 = 60`) is capped at **`50 points`**.

#### B. Canonical Quality Precedence & Sub-Score (`S_qual`: 0, 5, or 15 points)
Both `content.resources.quality_label` and `content.resource_versions.quality_label` are `NOT NULL` columns constrained to `('STANDARD', 'VERIFIED', 'PREMIUM')`, and official pedagogical verification of a version is recorded in `governance.resource_verifications` (`verification_status = 'VERIFIED'`).

To eliminate any ambiguity when resource-level and version-level labels differ, `resolveCanonicalQuality(r, rv, hasActiveVersionVerification)` resolves a single `effective_quality` in strict order:
1. **`VERIFIED` (`S_qual = 15 points`):** Awarded if and only if `hasActiveVersionVerification = true` (active row in `governance.resource_verifications` for `rv.id` with `verification_status = 'VERIFIED'`) **OR** `COALESCE(rv.quality_label, 'STANDARD') = 'VERIFIED'`.
   - *Disagreement Rule 1:* Pedagogical verification is strictly **version-authoritative**. If `r.quality_label = 'VERIFIED'` while `rv.quality_label = 'STANDARD'` and `rv` has **no** active row in `governance.resource_verifications`, the candidate is **not** `VERIFIED` and falls through to Step 2/3 (`STANDARD = 0 points`).
   - *Disagreement Rule 2:* If `rv` is actively `VERIFIED` AND `r.quality_label = 'PREMIUM'`, `effective_quality` for scoring and tie-breaking is `'VERIFIED'` (`15 points`), while the API payload sets `isVerified: true` and `isPremium: true` so download entitlement indicators remain accurate.
2. **`PREMIUM` (`S_qual = 5 points`):** Awarded when Step 1 is false AND (`COALESCE(rv.quality_label, 'STANDARD') = 'PREMIUM'` OR `COALESCE(r.quality_label, 'STANDARD') = 'PREMIUM'`).
3. **`STANDARD` (`S_qual = 0 points`):** Awarded in all other cases (including defensive fallback if any joined label were ever null).

This identical `effective_quality` value governs `S_qual`, tie-breaker #2/#3, API card `quality.effectiveTier`, and cache invalidation triggers.

#### C. Freshness Sub-Score Using Elapsed 24-Hour Periods (`S_fresh`: 0, 3, 6, or 10 points)
Let `eval_now` be a single UTC timestamp captured at the start of recommendation evaluation, and `rv.published_at` be the active version's `TIMESTAMPTZ`:
```text
elapsed_seconds     = max(0, EXTRACT(EPOCH FROM (eval_now - rv.published_at)))
elapsed_24h_periods = floor(elapsed_seconds / 86400)
```
- If `0 <= elapsed_24h_periods <= 30`: **`10 points`** (i.e., `0` seconds up to `2,678,399.999` seconds; strictly `< 31 * 86400` seconds)
- If `31 <= elapsed_24h_periods <= 90`: **`6 points`**
- If `91 <= elapsed_24h_periods <= 180`: **`3 points`**
- If `elapsed_24h_periods >= 181`: **`0 points`**

*(Using elapsed 24-hour periods eliminates all local-calendar and DST timezone ambiguity.)*

#### D. Behavioural Co-Occurrence Sub-Score (`S_behav`: 0 to 25 points)
1. **Eligible Events:** Rows in `analytics.analytics_events` (`e`) joined to `analytics.analytics_event_types` (`et`) where:
   - `et.event_code IN ('view', 'download') AND et.status = 'ACTIVE'`
   - `e.entity_type = 'resource'`
   - `(e.country_id IS NULL OR e.country_id = :request_country_id)`
2. **Partitioned Qualifying Identities & Observation Windows:**
   - **Authenticated Namespace (`90` elapsed 24-hour periods):** `e.actor_type = 'AUTHENTICATED' AND e.user_id IS NOT NULL AND e.occurred_at >= eval_now - INTERVAL '90 days'` -> canonical token `'u:' || e.user_id::text`.
   - **Anonymous Namespace (`30` elapsed 24-hour periods):** `e.actor_type = 'ANONYMOUS' AND e.anonymous_session_hash ~ '^[a-f0-9]{64}$' AND e.occurred_at >= eval_now - INTERVAL '30 days'` -> canonical token `'s:' || e.anonymous_session_hash`.
   - **Excluded Events:** `actor_type = 'SYSTEM'`, null `user_id` on `AUTHENTICATED`, malformed/uppercase/short `anonymous_session_hash`, and non-view/download event codes (`search`, `feedback`, `share`, etc.).
3. **Distinct Combined Co-Occurrence Count (`N_co`):**
   `N_co` is the count of **distinct** canonical identity tokens (`COUNT(DISTINCT qualified_identity)`) that appear on both `R_src` and `R_cand` within their respective valid windows. Repeated views or downloads by the same user or session hash count as **1** identity, never multiple.
4. **Combined 3-Identity Suppression Threshold & Logarithmic Formula:**
   - **Policy:** Combined qualifying identity threshold across the `u:` and `s:` namespaces (`N_co = |U_co union S_co|`, which equals `|U_co| + |S_co|` because prefixes `'u:'` and `'s:'` are disjoint). For example, `2` distinct authenticated users + `1` distinct valid anonymous session yields `N_co = 3` (qualifies); `1` user with `10` view events + `1` anonymous session with `5` download events yields `N_co = 2` (suppressed to `0`).
   - If `N_co < 3`: **`S_behav = 0 points`**
   - If `N_co >= 3`: **`S_behav = min(25, floor(5 * ln(N_co)))`** (natural logarithm base `e`)

**Reference Behavioural Lookup Points:**
- `N_co` in `{0, 1, 2}` -> `0 points` (Suppressed)
- `N_co = 3` -> `floor(5 * 1.098612)` = `5 points`
- `N_co = 4` -> `floor(5 * 1.386294)` = `6 points`
- `N_co = 5` -> `floor(5 * 1.609438)` = `8 points`
- `N_co = 8` -> `floor(5 * 2.079442)` = `10 points`
- `N_co = 10` -> `floor(5 * 2.302585)` = `11 points`
- `N_co = 25` -> `floor(5 * 3.218876)` = `16 points`
- `N_co = 50` -> `floor(5 * 3.912023)` = `19 points`
- `N_co = 100` -> `floor(5 * 4.605170)` = `23 points`
- `N_co >= 149` -> `min(25, floor(5 * 5.003946))` = `25 points` (Cap reached at `149`)

---

### 3.3 Independent Two-Tier Ranking Pipeline (`EXCLUDE`, `PIN`, Algorithmic)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Step 1: Candidate Eligibility & Country Gate                                 │
│ - r.id <> R_src.id, r.country_id = reqCountryId, c.status = 'ACTIVE'         │
│ - r.status = 'PUBLISHED', rt.status = 'ACTIVE'                               │
│ - Active version rv: rv.status = 'PUBLISHED' AND rv.published_at IS NOT NULL │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Step 2: Absolute EXCLUDE Pre-Filter                                          │
│ - Discard any candidate matching an ACTIVE rule with rule_type = 'EXCLUDE'   │
│   for (source_resource_id = R_src.id) OR (source_topic_id = R_src.topic_id). │
│ - Resource-level or topic-level EXCLUDE overrides any topic-level PIN.       │
└──────────────────┬───────────────────────────────────────┬───────────────────┘
                   ▼                                       ▼
┌─────────────────────────────────────────┐ ┌──────────────────────────────────┐
│ Group 1: Eligible PIN Candidates        │ │ Group 2: Algorithmic Candidates  │
│ (Active PIN rule on R_src.id or topic;  │ │ (Remaining eligible candidates   │
│  resource-level PIN priority wins over  │ │  not in Group 1)                 │
│  topic-level PIN if both exist)         │ │                                  │
│                                         │ │ Sorted strictly by:              │
│ Sorted strictly by:                     │ │  1. S_algo DESC (0..100)         │
│  1. rule_scope_rank ASC                 │ │  2. S_qual DESC (15, 5, 0)       │
│     (1 = resource PIN, 2 = topic PIN)   │ │  3. rv.published_at DESC         │
│  2. priority ASC (1 highest .. 10 low)  │ │  4. r.id ASC (UUID text order)   │
│  3. S_algo DESC (0..100 tie-breaker)    │ │                                  │
│  4. S_qual DESC (15, 5, 0)              │ │                                  │
│  5. rv.published_at DESC                │ │                                  │
│  6. r.id ASC (UUID text order)          │ │                                  │
└──────────────────┬──────────────────────┘ └─────────────────┬────────────────┘
                   └───────────────────┬──────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Step 3: Deterministic Slot Assembly (effectiveLimit = min(reqLimit, 20))     │
│ - Take first K = min(Group1.length, effectiveLimit) items from Group 1.      │
│ - If K < effectiveLimit, append first (effectiveLimit - K) items of Group 2. │
│ - If K >= effectiveLimit, Group 1 fills all slots and Group 2 is omitted.    │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Surface-Specific Filtering & `continue-exploring` Ranking Rules
1. **`related-resources` (default `6`, cap `20`):** Applies the full two-tier pipeline above (`EXCLUDE`, `PIN` Group 1, Algorithmic Group 2).
2. **`you-may-also-need` (default `4`, cap `20`):** Applies Step 1 + Step 2 (`EXCLUDE`), restricts candidates to cross-pillar resources (`R_cand.pillar <> R_src.pillar`) with non-zero metadata overlap (`S_meta > 0`), and sorts deterministically by `S_algo DESC, S_qual DESC, rv.published_at DESC, r.id ASC`.
3. **`teachers-also-viewed` (default `6`, cap `20`):** Applies Step 1 + Step 2 (`EXCLUDE`), restricts candidates to those meeting the combined 3-identity privacy threshold (`N_co >= 3`, i.e., `S_behav >= 5`), and sorts deterministically by `S_behav DESC, S_algo DESC, S_qual DESC, rv.published_at DESC, r.id ASC` (returns `[]` when zero candidates have `N_co >= 3`).
4. **`continue-exploring` (default `8`, cap `20`):**
   - **Seed Extraction (`max 5` distinct published resources in `requestCountryId`):**
     - *Authenticated caller (`SESSION_COOKIE_NAME` validated via `AuthService`):* Up to `5` most recent distinct `PUBLISHED` resources in `requestCountryId` drawn from `identity.users.saved_resource_version_ids` (mapped `rv.id -> r.id` in reverse save order) unioned with the user's `analytics.analytics_events` (`actor_type = 'AUTHENTICATED'`, `event_code IN ('view', 'download', 'save')`) within `90` elapsed 24-hour periods (`ORDER BY last_seen_at DESC, resource_id ASC LIMIT 5`).
     - *Anonymous caller with `x-anonymous-session-id` header or `elimu_anon_sid` cookie:* Compute `sessionHash = sha256(rawSessionId.trim())` (`64` lowercase hex chars) and select up to `5` most recent distinct `PUBLISHED` resources in `requestCountryId` from `analytics.analytics_events` (`actor_type = 'ANONYMOUS'`, `anonymous_session_hash = sessionHash`, `event_code IN ('view', 'download')`) within `30` elapsed 24-hour periods (`ORDER BY last_seen_at DESC, resource_id ASC LIMIT 5`).
   - **Contextual Mode (`mode = 'contextual'`, when `1 <= m <= 5` seeds exist):** Excludes all seed IDs (`r.id NOT IN (seed_ids)`) and any candidate matching an `ACTIVE` `EXCLUDE` rule on any seed resource or seed topic; scores each candidate by `S_explore(R_cand) = max_{i=1..m} S_algo(R_cand | seed_i)` (`0..100`); sorts by `S_explore DESC, S_qual DESC, rv.published_at DESC, r.id ASC`.
   - **Cold-Start Mode (`mode = 'cold_start'`, when `0` seeds exist or contextual candidate pool is empty):** Scores eligible `PUBLISHED` resources in `requestCountryId` by `S_cold(R_cand) = S_qual + S_fresh` (`0..25`); sorts by `S_cold DESC, S_qual DESC, rv.published_at DESC, r.id ASC`.

---

### 3.4 Complete Reproducible Worked Example (4 Evaluated Candidates, Limit = 3)

**Evaluation Context:**
- `eval_now`: `2026-10-24T12:00:00Z`
- **Source Resource (`R_src`):** `id = 00000000-0000-4000-8000-000000000010`, Country = Kenya (`country_id = 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`), Grade = Form 3 (`grade-f3`), Subject = Mathematics (`subj-math`), Topic = Quadratic Equations (`topic-quad`, whose `parent_id = topic-alg`), Resource Type Pillar = `NOTES_REVISION`.
- **Request:** `GET /api/v1/resources/00000000-0000-4000-8000-000000000010/recommendations?surface=related-resources&limit=3`
- **Active Editorial Rules in Kenya:**
  1. `PIN` on `source_resource_id = R_src.id` -> `target_resource_id = res-002` (Candidate B), `priority = 1`, `status = 'ACTIVE'`.
  2. `EXCLUDE` on `source_resource_id = R_src.id` -> `target_resource_id = res-004` (Candidate D), `priority = NULL`, `status = 'ACTIVE'`.

#### Candidate A (`res-001 = 00000000-0000-4000-8000-000000000001`):
- **Persisted State:** `r.status = 'PUBLISHED'`, `rv.status = 'PUBLISHED'`, `rv.published_at = 2026-10-10T12:00:00Z` (`14` elapsed 24-hour periods), `grade_id = grade-f3`, `subject_id = subj-math`, `topic_id = topic-quad`, `pillar = PAST_PAPERS`, active `governance.resource_verifications` row (`verification_status = 'VERIFIED'`), `rv.quality_label = 'STANDARD'`, `r.quality_label = 'STANDARD'`. Co-interactions with `R_src`: `5` distinct authenticated users within 90d + `3` distinct valid anonymous sessions within 30d (`N_co = 8`).
- **Calculation:**
  - `W_topic_rel` = `30` (exact topic match `topic-quad`; parent/child branch skipped)
  - `W_subject` = `15` (exact subject match `subj-math`)
  - `W_grade` = `10` (exact grade match `grade-f3`)
  - `W_pillar` = `5` (`NOTES_REVISION` <-> `PAST_PAPERS` complementary pair)
  - `S_meta` = `min(50, 30 + 15 + 10 + 5)` = `min(50, 60)` = **`50`**
  - `S_qual` = **`15`** (active `governance.resource_verifications` row -> `effective_quality = 'VERIFIED'`)
  - `S_fresh` = **`10`** (`elapsed_24h_periods = 14`, within `0..30`)
  - `S_behav` = `min(25, floor(5 * ln(8)))` = `min(25, floor(10.3972))` = **`10`** (`N_co = 8 >= 3`)
  - **`S_algo(A)`** = `50 + 15 + 10 + 10` = **`85`**
  - **Tier:** Group 2 (Algorithmic).

#### Candidate B (`res-002 = 00000000-0000-4000-8000-000000000002`):
- **Persisted State:** `r.status = 'PUBLISHED'`, `rv.status = 'PUBLISHED'`, `rv.published_at = 2026-04-07T12:00:00Z` (`200` elapsed 24-hour periods), `grade_id = grade-f3`, `subject_id = subj-math`, `topic_id = topic-trig` (unrelated topic), `pillar = NOTES_REVISION`, no active `governance.resource_verifications` row, `rv.quality_label = 'STANDARD'`, `r.quality_label = 'VERIFIED'` (stale resource label intentionally testing disagreement rule). Co-interactions with `R_src`: `1` authenticated user (`N_co = 1`).
- **Calculation:**
  - `W_topic_rel` = `0`, `W_subject` = `15`, `W_grade` = `10`, `W_pillar` = `0` (same pillar `NOTES_REVISION`) -> `S_meta` = `min(50, 0 + 15 + 10 + 0)` = **`25`**
  - `S_qual` = **`0`** (Disagreement Rule 1: `rv` has no active verification and `rv.quality_label = 'STANDARD'`, so stale `r.quality_label = 'VERIFIED'` is ignored -> `effective_quality = 'STANDARD'`)
  - `S_fresh` = **`0`** (`elapsed_24h_periods = 200 >= 181`)
  - `S_behav` = **`0`** (`N_co = 1 < 3`, suppressed)
  - **`S_algo(B)`** = `25 + 0 + 0 + 0` = **`25`** (used only as intra-priority tie-breaker)
  - **Tier:** Group 1 (Pinned: `rule_scope_rank = 1` [resource PIN], `priority = 1`).

#### Candidate C (`res-003 = 00000000-0000-4000-8000-000000000003`):
- **Persisted State:** `r.status = 'PUBLISHED'`, `rv.status = 'PUBLISHED'`, `rv.published_at = 2026-09-09T12:00:00Z` (`45` elapsed 24-hour periods), `grade_id = grade-f2`, `subject_id = subj-math`, `topic_id = topic-alg` (direct parent of `topic-quad`), `pillar = NOTES_REVISION`, no active `governance.resource_verifications` row, `rv.quality_label = 'PREMIUM'`, `r.quality_label = 'PREMIUM'`. Co-interactions with `R_src`: `4` distinct authenticated users (`N_co = 4`).
- **Calculation:**
  - `W_topic_rel` = `15` (direct parent topic `topic-alg`), `W_subject` = `15`, `W_grade` = `0` (`grade-f2 <> grade-f3`), `W_pillar` = `0` -> `S_meta` = `min(50, 15 + 15 + 0 + 0)` = **`30`**
  - `S_qual` = **`5`** (`effective_quality = 'PREMIUM'`)
  - `S_fresh` = **`6`** (`elapsed_24h_periods = 45`, within `31..90`)
  - `S_behav` = `min(25, floor(5 * ln(4)))` = `min(25, floor(6.9315))` = **`6`** (`N_co = 4 >= 3`)
  - **`S_algo(C)`** = `30 + 5 + 6 + 6` = **`47`**
  - **Tier:** Group 2 (Algorithmic).

#### Candidate D (`res-004 = 00000000-0000-4000-8000-000000000004`):
- Matches active `EXCLUDE` rule on `R_src.id` -> **Eliminated in Step 2 before scoring/grouping.**

#### Final Ordered Output (`effectiveLimit = 3`):
1. **Rank 1:** Candidate B (`res-002`) — Group 1 (Resource `PIN`, `priority = 1`, `S_algo = 25`)
2. **Rank 2:** Candidate A (`res-001`) — Group 2 (`S_algo = 85`, `S_qual = 15`)
3. **Rank 3:** Candidate C (`res-003`) — Group 2 (`S_algo = 47`, `S_qual = 5`)

---

## 4. Canonical Active Published Version Gate (Database-Enforced Uniqueness)

### 4.1 Proof of Active-Version Uniqueness Across All Write Paths
1. **Storage-Engine Constraint:** Migration `drizzle/0005_publication_workflow.sql` (lines 3-5) defines:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_single_published_version 
   ON "content"."resource_versions" ("resource_id") 
   WHERE "status" = 'PUBLISHED';
   ```
   And lines 13-18 define:
   ```sql
   CONSTRAINT "chk_resource_versions_published_at" CHECK (
     ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL) OR
     ("status" <> 'PUBLISHED' AND "published_at" IS NULL)
   )
   ```
2. **Write-Path Coverage:**
   - Every INSERT or UPDATE into `content.resource_versions` (whether via `PublicationService.publishResourceVersion`, `DbResourceService.createResourceVersion`, `DbResourceService.updateResourceVersion`, seeds, or direct SQL) is atomically validated by PostgreSQL's `uq_resource_single_published_version` index. Concurrent transactions attempting to publish two versions of the same resource cannot both commit; the second fails with SQLSTATE `23505` (and `PublicationService` additionally throws `409 PUBLISHED_VERSION_ALREADY_EXISTS`).
   - When a resource is archived (`PublicationService.archiveResource`), `content.resources.status` transitions to `'ARCHIVED'`, immediately disqualifying the resource on `r.status = 'PUBLISHED'`.
   - Therefore, for any resource with `r.status = 'PUBLISHED'`, joining `content.resource_versions rv ON rv.resource_id = r.id AND rv.status = 'PUBLISHED'` is **provably at most 1:1** at the database engine level and always identifies the sole active published version.

### 4.2 Canonical Eligibility & Hydration SQL (Shared by Uncached and Cached Paths)
```sql
SELECT
    r.id AS resource_id,
    r.country_id,
    r.resource_type_id,
    r.curriculum_id,
    r.curriculum_version_id,
    r.education_level_id,
    r.grade_id,
    r.pathway_id,
    r.subject_id,
    r.topic_id,
    r.slug,
    r.quality_label AS resource_quality_label,
    COALESCE(NULLIF(trim(rv.title), ''), r.title) AS display_title,
    COALESCE(NULLIF(trim(rv.description), ''), r.description) AS display_description,
    rv.id AS active_version_id,
    rv.version_number,
    rv.version_label,
    rv.quality_label AS version_quality_label,
    rv.published_at,
    rt.code AS resource_type_code,
    rt.name AS resource_type_name,
    rt.slug AS resource_type_slug,
    rt.pillar AS resource_pillar,
    gv.id AS verification_id,
    gv.verified_at
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
LEFT JOIN governance.resource_verifications gv
    ON gv.resource_id = r.id
   AND gv.resource_version_id = rv.id
   AND gv.verification_status = 'VERIFIED'
WHERE r.status = 'PUBLISHED'
  AND r.country_id = :request_country_id
  AND r.id = ANY(:candidate_ids);
```
*(Note: `uq_single_active_resource_verification` on `governance.resource_verifications(resource_id, resource_version_id) WHERE verification_status = 'VERIFIED'` also guarantees the `LEFT JOIN` to `gv` is strictly at most 1:1, so zero duplicate resource rows can ever be produced!)*

---

## 5. Complete Database Migration Specification (`drizzle/0019_recommendations.sql`)

```sql
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

-- 3. Database-level country consistency trigger for topic-scoped rules
-- Verifies taxonomy.topics -> taxonomy.curriculum_versions.country_id matches NEW.country_id
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

-- 5. Covering partial index for behavioural co-occurrence on analytics.analytics_events
CREATE INDEX IF NOT EXISTS "idx_analytics_events_resource_cooccurrence"
    ON "analytics"."analytics_events" (
        "entity_id",
        "event_type_id",
        "occurred_at" DESC,
        "actor_type",
        "user_id",
        "anonymous_session_hash"
    )
    WHERE "entity_type" = 'resource'
      AND "actor_type" IN ('AUTHENTICATED', 'ANONYMOUS');
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
```

---

## 6. Multi-Instance Cache Architecture, Eviction Contract & Recovery

### 6.1 Cache-Key Formats & In-Memory Reverse Indexes
Bounded per-instance LRU cache (`maxEntries = 1000`, `ttlMs = 300000` [300 seconds]) storing ordered `{ candidateId, isPinned, priority, algorithmicScore }` tuples (never bypassing the read-time Active Publication Gate in Section 4.2):

1. **Resource-Detail Cache Key:** `rec:res:{countryId}:{surface}:{sourceResourceId}:{limit}`
2. **Continue-Exploring Cold-Start Key (anonymous zero-history only):** `rec:cold:{countryId}:{limit}`
   *(Personalized `continue-exploring` requests with user/session seed history are computed from live seed lookups + cached per-seed candidate scores, never stored in shared public keys, preventing cross-actor history leakage.)*
3. **Reverse Index Maps Maintained Atomically on Cache Write/Delete:**
   - `keysBySourceResource: Map<resourceId, Set<cacheKey>>`
   - `keysByCandidateResource: Map<resourceId, Set<cacheKey>>`
   - `keysByTopic: Map<topicId, Set<cacheKey>>` (indexes every `cacheKey` whose source resource or any candidate resource belongs to `topicId` or its parent topic)
   - `keysByCountry: Map<countryId, Set<cacheKey>>`

### 6.2 Deterministic Payload-to-Eviction Contract
PostgreSQL guarantees `pg_notify('rec_invalid', payload)` is dispatched **only after transaction commit** (rolled-back transactions emit zero notifications). Upon receiving a payload on channel `rec_invalid`:
1. `scope = 'global_type'` or malformed JSON payload -> `cache.clearAll()` (purges all entries and reverse maps).
2. `scope = 'country'` -> Evict every `cacheKey` in `keysByCountry.get(country_id)` (including `rec:cold:${country_id}:*`).
3. `scope` in `('topic', 'resource', 'version', 'verification')` -> Evict `keysBySourceResource.get(source_resource_id)`, `keysByCandidateResource.get(target_resource_id)`, `keysByTopic.get(source_topic_id)`, `keysByTopic.get(related_topic_id)` (when non-null), AND `keysByCountry.get(country_id)` (when `country_id` is non-null). Evicting `keysByCountry.get(country_id)` (`O(K)` over `<= 1000` in-memory keys) guarantees that newly published, archived, verified, or metadata-edited resources—including general resources with `topic_id IS NULL` or cross-topic same-subject/grade matches—enter or exit every cached recommendation list in that country immediately without waiting for TTL.
4. `scope = 'rule'` ->
   - If `source_resource_id` non-null: evict `keysBySourceResource.get(source_resource_id)` and `rec:cold:${country_id}:*`.
   - If `source_topic_id` non-null: evict `keysByTopic.get(source_topic_id)`, `keysByCountry.get(country_id)`, and `rec:cold:${country_id}:*`.
   - If `target_resource_id` non-null: evict `keysByCandidateResource.get(target_resource_id)`.

### 6.3 Listener Reconnection, Degraded-Mode Safety & TTL Bound
- A dedicated `pg.Client` (outside the query pool; guarded in tests unless explicitly started) subscribes via `LISTEN rec_invalid`.
- On `error` or `end`: marks listener `DISCONNECTED`, immediately calls `cache.clearAll()`, and schedules exponential backoff reconnect (`base = 500 ms`, factor `2.0`, `max = 10,000 ms`, `+/- 20%` jitter).
- While `DISCONNECTED` (before `LISTEN rec_invalid` succeeds again): **caching writes are bypassed** (or capped to `0` TTL) so disconnected instances cannot serve stale editorial rules, and upon successful `LISTEN rec_invalid` re-subscription `cache.clearAll()` runs again before re-enabling normal 300-second caching.
- **Read-Time Safety Invariant:** Even within sub-millisecond `NOTIFY` propagation windows, every cached response executes the Section 4.2 SQL gate (`r.status = 'PUBLISHED'`, `rv.status = 'PUBLISHED'`, `rv.published_at IS NOT NULL`, `c.status = 'ACTIVE'`, `rt.status = 'ACTIVE'`). Withdrawn, archived, unpublished, or country-deactivated resources can **never** be returned from cache.

---

## 7. Complete API Contracts, Country Resolution, RBAC & Audit Logging

### 7.1 Canonical Country Resolution (Zero Hardcoded Country Fallbacks)
1. **Resource-Anchored Endpoints (`/api/v1/resources/:id/recommendations`):** Country is derived directly from the published source resource's `r.country_id` (verified `ACTIVE` in `platform.countries`). If optional `?country=` is also passed and resolves to a different country than `r.country_id`, return `404 RESOURCE_NOT_FOUND` (enforces strict country isolation).
2. **Global Discovery Endpoint (`/api/v1/recommendations/continue-exploring`):**
   - If `?country=<uuid|isoCode|urlPrefix>` is provided: resolve via `geographyService.getActiveCountryByIdentifier(country)`. If `null` (nonexistent or `INACTIVE`), return `404 COUNTRY_NOT_FOUND`.
   - Else if authenticated user has `user.profileData.country` / `countryId`: resolve via `geographyService.getActiveCountryByIdentifier(...)`.
   - Else if `process.env.DEFAULT_COUNTRY` is configured: resolve via `geographyService.getActiveCountryByIdentifier(process.env.DEFAULT_COUNTRY)`.
   - Else call `geographyService.listActiveCountries()`: if `length === 1`, use `activeCountries[0]`; if `length > 1`, return `400 VALIDATION_ERROR` requesting explicit `country` parameter.

### 7.2 Public HTTP Endpoints (`src/routes/api/v1/recommendations.ts`)

1. **`GET /api/v1/resources/:id/recommendations`** (Public; optional session/anon cookie)
   - **Query Schema (Zod):**
     - `surface`: `z.enum(['related-resources', 'you-may-also-need', 'teachers-also-viewed']).default('related-resources')`
     - `limit`: `z.coerce.number().int().min(1).optional()` — defaults per surface (`6`, `4`, `6`); clamped server-side via `Math.min(requestedLimit, 20)`.
     - `country`: `z.string().min(1).optional()`
   - **Responses:**
     - `200 OK`: `{ data: RecommendationCardDto[], meta: { surface, sourceResourceId, limit, count } }`
     - `400 Bad Request`: Invalid UUID `:id`, invalid `surface`, or `limit < 1`.
     - `404 Not Found`: Source resource missing, not `PUBLISHED`, country `INACTIVE`, or mismatched `country` filter.
   - **Public Privacy Contract:** `RecommendationCardDto` exposes strictly public catalogue card fields (`id`, `title`, `slug`, `description`, `qualityLabel`, `quality`, `resourceType`, `country`, `curriculum`, `grade`, `subject`, `topic`, `publishedVersion: { id, versionNumber, versionLabel, publishedAt }`). It **never** exposes internal scores, `N_co` identity counts, `user_id`, `anonymous_session_hash`, or editorial rule reasons/actors.

2. **`GET /api/v1/recommendations/continue-exploring`** (Public; optional auth/anon session)
   - **Query Schema (Zod):**
     - `country`: `z.string().min(1).optional()`
     - `limit`: `z.coerce.number().int().min(1).optional()` — default `8`, clamped server-side to `<= 20`.
   - **Responses:** `200 OK` `{ data: RecommendationCardDto[], meta: { surface: 'continue-exploring', countryId, limit, count, mode: 'contextual' | 'cold_start' } }`, `400`, or `404`.

### 7.3 Administrative Editorial Endpoints, RBAC Matrix & Audit Contract

#### A. Least-Privilege RBAC Role Assignments (`src/db/seeds/roles-permissions.ts`)
| Permission Name | `resource` | `action` | `scopeType` | Assigned Canonical Roles (`identity.roles.slug`) | Denied Roles |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `recommendation.read` | `recommendation` | `read` | `ANY` | `system_admin`, `content_manager`, `content_reviewer` | `verified_teacher`, `contributor`, `standard_user`, anonymous |
| `recommendation.manage` | `recommendation` | `manage` | `ANY` | `system_admin`, `content_manager` | `content_reviewer`, `verified_teacher`, `contributor`, `standard_user`, anonymous |

- Enforced via `createRequirePermission(rbacService, permission, { scopeResolver })` (`src/routes/hooks/authorize.ts`), passing `{ scopeType: 'COUNTRY', scopeId: resolvedCountryId }` when country-scoped so country-assigned `content_manager` users cannot manage another country's rules.
- Unauthenticated callers receive `401 UNAUTHENTICATED`; unauthorized callers receive `403 FORBIDDEN` with generic message `'You do not have permission to perform this action.'` (no permission-key leakage) and an audit record with `outcome = 'DENIED'`.
- Existing permissions (`analytics.read`, `resource.publish`, `quality.verify`, `retention.manage`, etc.) are **not** altered.

#### B. Administrative Endpoints
1. **`GET /api/v1/admin/recommendations/rules`** — Requires `recommendation.read`
   - Query params: `country` (UUID/ISO/prefix, optional for global admins, required/scoped for country-scoped roles), `status` (`ACTIVE` | `INACTIVE`), `ruleType` (`PIN` | `EXCLUDE`), `sourceResourceId` (UUID), `sourceTopicId` (UUID), `targetResourceId` (UUID), `page` (default `1`), `pageSize` (default `20`, max `100`).
   - Returns `200 OK` `{ data: RecommendationRuleDto[], meta: { page, pageSize, total, hasMore } }`.
2. **`POST /api/v1/admin/recommendations/rules`** — Requires `recommendation.manage` (scoped to `countryId`)
   - Body (Zod `.strict()`): `{ countryId: uuid, ruleType: 'PIN' | 'EXCLUDE', sourceResourceId?: uuid | null, sourceTopicId?: uuid | null, targetResourceId: uuid, priority?: int(1..10) | null, reason: string(min 3, max 1000) }`
   - Validates: XOR scope, self-target prohibition, `priority` required iff `PIN`, country consistency across `countryId` + source resource/topic + target resource (`422 COUNTRY_MISMATCH`), and no active rule collision on `(source, target)` (`409 ACTIVE_RULE_CONFLICT`). Note: Admins may pre-configure rules referencing not-yet-published target resources, or only published resources—target eligibility is still enforced at public read-time by the Active Publication Gate so unpublished pinned targets never leak publicly!
   - Returns `201 Created` `{ data: RecommendationRuleDto }`.
3. **`POST /api/v1/admin/recommendations/rules/:id/deactivate`** — Requires `recommendation.manage` (scoped to rule's `countryId`)
   - Body (Zod `.strict()`): `{ reason: string(min 3, max 1000) }`.
   - Transitions `ACTIVE -> INACTIVE`, sets `deactivated_by`, `deactivated_at = now()`, `deactivation_reason`. If already `INACTIVE`, returns `409 RULE_ALREADY_INACTIVE`.
   - Returns `200 OK` `{ data: RecommendationRuleDto }`.
4. **`POST /api/v1/admin/recommendations/rules/:id/reactivate`** — Requires `recommendation.manage` (scoped to rule's `countryId`)
   - Body (Zod `.strict()`): `{ reason: string(min 3, max 1000), priority?: int(1..10) }`.
   - Checks partial unique index collision (`409 ACTIVE_RULE_CONFLICT` if another `ACTIVE` rule now exists for the same `(source, target)`). Transitions `INACTIVE -> ACTIVE`, clears `deactivated_by`, `deactivated_at`, `deactivation_reason`, updates `updated_at`.
   - Returns `200 OK` `{ data: RecommendationRuleDto }`.
5. **`DELETE /api/v1/admin/recommendations/rules/:id`** — Returns `405 Method Not Allowed` (`code: 'HARD_DELETE_DISALLOWED'`), reinforced by PostgreSQL trigger `trg_prevent_rec_rule_delete`.

#### C. Centralized Audit Logging (`governance.audit_logs` via `AuditService`)
Every create, deactivate, reactivate, and denied management attempt writes inside/alongside the operation to `governance.audit_logs` matching `AuditEventInput`:
- `action`: `'recommendation.rule.create'` | `'recommendation.rule.deactivate'` | `'recommendation.rule.reactivate'`
- `entityType`: `'resource_recommendation_rule'`
- `entityId`: `rule.id`
- `actorType`: `'AUTHENTICATED'`, `actorUserId`: `user.id`
- `outcome`: `'SUCCESS'` | `'DENIED'` | `'FAILED'`
- `requestId`: `request.id`, `countryId`: `rule.countryId`
- `beforeState`: previous rule snapshot (`null` on create), `afterState`: updated rule snapshot, `context`: `{ reason }` (sanitized, `<= 4096` bytes).

---

## 8. Repeatable Performance Benchmark Protocol & Acceptance Criteria

### 8.1 Numerical SLA Targets (Under 10 Concurrent Virtual Users)
1. **PostgreSQL Candidate & Scoring Query Execution Time (P95):** **`<= 50 ms`**
2. **Uncached End-to-End HTTP API Latency (P95):** **`<= 120 ms`** (loopback HTTP request through Fastify routing, country resolution, full SQL scoring + co-occurrence + hydration, JSON serialization)
3. **Cached End-to-End HTTP API Latency (P95):** **`<= 15 ms`** (loopback HTTP request hitting in-memory LRU cache **plus** mandatory live PostgreSQL Active Publication Gate execution from Section 4.2 + JSON serialization)
4. **Hard Server-Side Result Ceiling:** **`20 items`** (`limit=100` returns at most `20`)

### 8.2 Reproducible Benchmark Execution & Percentile Definition
1. **Representative Seeded Workload:** `500` `PUBLISHED` resources in an `ACTIVE` country across `20` `ACTIVE` topics (`5` subjects, `4` grades, all `8` pillars), `500` corresponding `PUBLISHED` rows in `content.resource_versions`, `50` active rows in `governance.resource_verifications`, `20` active `PIN`/`EXCLUDE` rules, and `5,000` `analytics.analytics_events` rows (`view`/`download`) across `100` authenticated users and `300` valid anonymous session hashes.
2. **Safe Benchmark Cache-Bypass Mechanism:** Header `x-benchmark-cache-bypass: true` is honored **only** when `process.env.NODE_ENV === 'test' || process.env.ENABLE_BENCHMARK_BYPASS === 'true'`. In production (`NODE_ENV === 'production'` without flag), the header is completely ignored.
3. **Warm-Up:** `10 seconds` at `5` concurrent virtual users against `/api/v1/resources/:id/recommendations?surface=related-resources` (observations discarded).
4. **Measurement Runs:** `3` independent `60-second` runs at `10` concurrent virtual users for (a) Uncached mode (`x-benchmark-cache-bypass: true` across randomized 500 resource IDs) and (b) Cached mode (no bypass header across 25 pre-warmed resource IDs, still executing the mandatory PostgreSQL Active Publication Gate on every request).
5. **Percentile Definition (NIST / ISO Nearest-Rank Method):**
   For `N` sorted request durations `L[0] <= L[1] <= ... <= L[N-1]` in a run:
   `rankIndex = Math.ceil(0.95 * N) - 1`
   `P95 = L[rankIndex]`
6. **Acceptance Rule (No Averaging Mask):** **Each of Run 1, Run 2, and Run 3 must independently meet the target SLA** (`Run_i_P95 <= SLA` for all `i in {1, 2, 3}`), AND the pooled P95 across all `Run 1 + Run 2 + Run 3` observations must also meet the SLA. Per-run and pooled values are both recorded in the verification report.

---

## 9. Complete Verification & Regression Test Matrix (Post-Approval)

| Suite # | Test Suite Name | Exact Assertions & Edge Cases Verified |
| :---: | :--- | :--- |
| **1** | **Scoring & Worked-Example Determinism** | Verifies exact sub-scores (`S_meta` cap `50`, mutually exclusive `W_topic_rel` `30` vs `15` vs `0`, `S_qual` `15`/`5`/`0`, `S_fresh` at exact `30`/`31`/`90`/`91`/`180`/`181` elapsed 24-hour boundaries, `S_behav` suppression `< 3` and `floor(5 * ln(N_co))` cap `25`), reproduces the exact 4-candidate worked example (`B -> A -> C`, `D` excluded), and verifies deterministic UUID tie-breaking. |
| **2** | **Quality-Label Precedence & Disagreement** | Tests `r.quality_label = 'VERIFIED'` + `rv.quality_label = 'STANDARD'` (no `resource_verifications` row) -> scores `0` (`STANDARD`); active `resource_verifications` row -> scores `15` (`VERIFIED`); `r.quality_label = 'PREMIUM'` without verification -> scores `5` (`PREMIUM`); revoking verification immediately drops score from `15` to `0`/`5`. |
| **3** | **Active-Version Uniqueness & Concurrent Publish** | Verifies PostgreSQL `uq_resource_single_published_version` rejects concurrent publication of two versions for one resource (`Promise.all`), verifies zero duplicate resource IDs in recommendation output, and confirms archived resources (`r.status = 'ARCHIVED'` with frozen `rv.status = 'PUBLISHED'`) never appear in cached or uncached results. |
| **4** | **Editorial `PIN`, `EXCLUDE` & Excess Pins** | Verifies `EXCLUDE` overrides `PIN` and removes candidates across all surfaces; verifies resource-level `PIN` precedes topic-level `PIN`; verifies `priority` `1..10` ordering; verifies when `8` items are pinned and `limit = 6`, top `6` pins fill all slots and algorithmic items are omitted; verifies unpublished pinned targets never leak publicly. |
| **5** | **Soft Deactivation, Reactivation & Hard-Delete Block** | Verifies `POST .../deactivate`, `POST .../reactivate`, `409 ACTIVE_RULE_CONFLICT` when another active rule exists, `405` on `DELETE` endpoint, and PostgreSQL `trg_prevent_rec_rule_delete` blocking raw SQL `DELETE`. |
| **6** | **Country Isolation & Country Deactivation** | Verifies resources, behavioural events, and rules in Country A (`KE`) never appear in or influence Country B (`UG`); verifies topic-rule country mismatch fails via `trg_validate_rec_rule_ins_upd`; verifies setting `platform.countries.status = 'INACTIVE'` immediately blocks cached and uncached recommendations at read-time and evicts country caches. |
| **7** | **Behavioural Privacy, Windows & Event Filtering** | Verifies `90d` authenticated vs `30d` anonymous cutoffs (`31d` anonymous event ignored; `89d` authenticated event counted); verifies duplicate views/downloads by one user count as `1` identity; verifies `2 auth + 1 anon = 3` qualifies while `1 auth + 1 anon = 2` is suppressed; verifies `feedback` and `SYSTEM` events and malformed hashes are ignored; verifies zero identity/score leakage in HTTP JSON. |
| **8** | **Multi-Table Triggers & Commit Semantics** | Tests `INSERT`, `UPDATE` (including nullable `topic_id`, `parent_id` topic hierarchy re-parenting, `country_id` move, and `resource_versions.resource_id` reassignment), and `DELETE` across covered tables; verifies `UPDATE` emits both `UPDATE_OLD` and `UPDATE_NEW`; verifies rolled-back transactions emit zero `rec_invalid` notifications. |
| **9** | **Cache Eviction, Listener Recovery & 300s TTL** | Simulates multi-instance invalidation via `LISTEN rec_invalid`, simulates listener connection drop + missed mutation + exponential backoff reconnect + automatic `cache.clearAll()`, verifies bypass during disconnected state, and verifies 300-second TTL expiration via fake timers. |
| **10** | **Sparse Candidates, Cold-Start & Limit Clamping** | Verifies requesting `limit = 6` when only `2` candidates exist returns `2` items; `teachers-also-viewed` returns `[]` on cold start; `continue-exploring` works for authenticated, anonymous-with-session, and cold-start visitors; `limit = 999` clamps to `20`. |
| **11** | **RBAC Least Privilege & Audit Ledger** | Verifies `401` unauthenticated, `403` for `standard_user` / `verified_teacher` / `contributor` on admin routes, `content_reviewer` allowed `GET` (`recommendation.read`) but `403` on `POST` (`recommendation.manage`), country-scoped `content_manager` blocked from other countries, and immutable `governance.audit_logs` entries written for all mutations and denied attempts. |
| **12** | **Prompt 28 & Prompt 29 Non-Regression** | Runs the entire existing repository suite (`70` test files / `770` tests) plus `npm run typecheck` / `npm run build` to prove zero regression to Prompt 28 retention (`180` days) and Prompt 29 search, autocomplete, related searches, and `analytics.read`. |

---

“PROMPT 30 PLAN COMPLETE — AWAITING HUMAN APPROVAL. NO IMPLEMENTATION AUTHORIZED.”
