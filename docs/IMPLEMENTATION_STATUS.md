# IMPLEMENTATION STATUS

**Project:** Kenya-first Education Resource Platform
**Document:** Implementation Status
**Status:** Active Development Control Document
**Version:** 1.0

---

# 1. Purpose

This document records what has actually been implemented in the platform.

It is not a product wish list.

A feature must not be marked as complete merely because:

* it is described in a specification
* files have been created
* database tables exist
* an endpoint exists
* the frontend displays a button
* a mock implementation exists

A feature is considered implemented only after the required code, tests, validation and integration work have been completed.

---

# 2. Source of Truth

Implementation status must be interpreted together with:

```text
docs/AI_DEVELOPER_RULES.md
docs/PROJECT_VISION.md
docs/ARCHITECTURE.md
docs/DATABASE_SPEC.md
docs/API_SPEC.md
docs/SECURITY_RULES.md
```

This document answers:

> What has actually been built and verified?

The specifications answer:

> What should be built?

---

# 3. Status Vocabulary

Use only the following primary statuses.

### NOT_STARTED

No meaningful implementation has begun.

### PLANNED

The work is defined and scheduled but implementation has not begun.

### IN_PROGRESS

Implementation is actively underway.

### IMPLEMENTED

The required functionality has been coded.

### TESTING

Implementation exists but required testing is still underway.

### VERIFIED

Implementation and required tests have passed and the feature has been manually/technically checked.

### BLOCKED

Implementation cannot proceed because a dependency or decision is missing.

### DEFERRED

The feature is intentionally postponed.

### RETIRED

A previously implemented feature has been intentionally removed from active use.

---

# 4. Completion Rule

A feature must not be marked:

```text
VERIFIED
```

until:

* implementation exists
* relevant database changes exist
* relevant API changes exist
* relevant frontend changes exist where applicable
* validation exists
* authorization exists where required
* tests exist
* tests pass
* typecheck passes
* build passes
* security implications have been checked
* documentation is updated
* Git checkpoint exists where appropriate

---

# 5. Current Project State

## Overall Status

```text
FOUNDATION / DOCUMENTATION
```

## Current Phase

```text
Specification and implementation preparation
```

## Production Deployment

```text
NOT_STARTED
```

## Production Database

```text
NOT_STARTED
```

## Public Website

```text
NOT_STARTED
```

## Backend API

```text
NOT_STARTED
```

## Authentication

```text
NOT_STARTED
```

## Payments

```text
NOT_STARTED
```

---

# 6. Documentation Status

| Document                   | Status      |
| -------------------------- | ----------- |
| `AI_DEVELOPER_RULES.md`    | VERIFIED    |
| `PROJECT_VISION.md`        | VERIFIED    |
| `ARCHITECTURE.md`          | VERIFIED    |
| `DATABASE_SPEC.md`         | VERIFIED    |
| `API_SPEC.md`              | VERIFIED    |
| `SECURITY_RULES.md`        | VERIFIED    |
| `IMPLEMENTATION_STATUS.md` | IN_PROGRESS |

The documentation set must be completed before substantial application implementation begins.

---

# 7. Foundation

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Project repository        | NOT_STARTED |       |
| Root directory structure  | NOT_STARTED |       |
| Backend project           | NOT_STARTED |       |
| Frontend project          | NOT_STARTED |       |
| TypeScript configuration  | NOT_STARTED |       |
| Environment configuration | NOT_STARTED |       |
| Testing infrastructure    | NOT_STARTED |       |
| Linting                   | NOT_STARTED |       |
| Type checking             | NOT_STARTED |       |
| Build process             | NOT_STARTED |       |
| Fastify application       | NOT_STARTED |       |
| Request IDs               | NOT_STARTED |       |
| Structured logging        | NOT_STARTED |       |
| Central error handling    | NOT_STARTED |       |
| Health endpoint           | NOT_STARTED |       |

---

# 8. Database Foundation

| Component                    | Status      | Notes              |
| ---------------------------- | ----------- | ------------------ |
| PostgreSQL provider selected | PLANNED     | Managed PostgreSQL |
| Database connection          | NOT_STARTED |                    |
| Migration infrastructure     | NOT_STARTED |                    |
| PostgreSQL extensions        | NOT_STARTED |                    |
| Platform schema              | NOT_STARTED |                    |
| Taxonomy schema              | NOT_STARTED |                    |
| Content schema               | NOT_STARTED |                    |
| Files schema                 | NOT_STARTED |                    |
| Commerce schema              | NOT_STARTED |                    |
| Identity schema              | NOT_STARTED |                    |
| Community schema             | NOT_STARTED |                    |
| Calendar schema              | NOT_STARTED |                    |
| Analytics schema             | NOT_STARTED |                    |
| Governance schema            | NOT_STARTED |                    |
| System schema                | NOT_STARTED |                    |

---

# 9. Geography

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Countries                 | NOT_STARTED |       |
| Administrative area types | NOT_STARTED |       |
| Administrative areas      | NOT_STARTED |       |
| Hierarchical geography    | NOT_STARTED |       |
| Kenya geography seeds     | NOT_STARTED |       |
| Geography tests           | NOT_STARTED |       |

---

# 10. Schools

| Component               | Status      | Notes |
| ----------------------- | ----------- | ----- |
| School types            | VERIFIED    | Controlled types (PRIMARY, JUNIOR_SCHOOL, SECONDARY, SENIOR_SCHOOL, INTEGRATED) with DB check constraint |
| School entity           | VERIFIED    | platform.schools schema, UUID PK, composite geography FKs |
| School slugs            | DEFERRED    | Out of scope for Prompt 05; reserved for future public school pages |
| School public profile   | DEFERRED    | Reserved for future phase |
| School status/lifecycle | VERIFIED    | ACTIVE/INACTIVE controlled status with check constraint; active-only public discovery |
| School verification     | NOT_STARTED | Reserved for future governance phase |
| School API              | VERIFIED    | GET /api/v1/schools, GET /api/v1/schools/:id |
| School tests            | VERIFIED    | Complete offline route and live DB integration tests |

---

# 11. Curriculum and Taxonomy

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Curricula                 | NOT_STARTED |       |
| Curriculum versions       | NOT_STARTED |       |
| Education levels          | NOT_STARTED |       |
| Grades/forms              | NOT_STARTED |       |
| Pathways                  | NOT_STARTED |       |
| Subjects                  | NOT_STARTED |       |
| Topics                    | NOT_STARTED |       |
| Topic hierarchy           | NOT_STARTED |       |
| Curriculum mappings       | NOT_STARTED |       |
| Cross-curriculum mappings | NOT_STARTED |       |
| Taxonomy tests            | NOT_STARTED |       |

---

# 12. Resource Engine

| Component                | Status      | Notes |
| ------------------------ | ----------- | ----- |
| Resource types           | NOT_STARTED |       |
| Resources                | NOT_STARTED |       |
| Resource versions        | NOT_STARTED |       |
| Resource classifications | NOT_STARTED |       |
| Resource slug history    | NOT_STARTED |       |
| Academic year metadata   | NOT_STARTED |       |
| Academic period metadata | NOT_STARTED |       |
| Provenance               | NOT_STARTED |       |
| Rights metadata          | NOT_STARTED |       |
| Quality metadata         | NOT_STARTED |       |
| Resource API             | NOT_STARTED |       |
| Resource tests           | NOT_STARTED |       |

---

# 13. Publication Workflow

| Component                      | Status      | Notes |
| ------------------------------ | ----------- | ----- |
| Draft                          | NOT_STARTED |       |
| Review                         | NOT_STARTED |       |
| Approved                       | NOT_STARTED |       |
| Published                      | NOT_STARTED |       |
| Retired                        | NOT_STARTED |       |
| Publication validation         | NOT_STARTED |       |
| Published-version immutability | NOT_STARTED |       |
| Unpublish                      | NOT_STARTED |       |
| Retirement                     | NOT_STARTED |       |
| Slug redirects                 | NOT_STARTED |       |
| Publication tests              | NOT_STARTED |       |

Required lifecycle:

```text
DRAFT
→ REVIEW
→ APPROVED
→ PUBLISHED
→ RETIRED
```

---

# 14. File System

| Component            | Status      | Notes |
| -------------------- | ----------- | ----- |
| StorageProvider      | NOT_STARTED |       |
| Object storage       | NOT_STARTED |       |
| File metadata        | NOT_STARTED |       |
| Upload               | NOT_STARTED |       |
| Quarantine           | NOT_STARTED |       |
| Security scanning    | NOT_STARTED |       |
| MIME validation      | NOT_STARTED |       |
| Checksum             | NOT_STARTED |       |
| File processing      | NOT_STARTED |       |
| Processing history   | NOT_STARTED |       |
| Text extraction      | NOT_STARTED |       |
| Derivatives          | NOT_STARTED |       |
| Thumbnail generation | NOT_STARTED |       |
| Preview generation   | NOT_STARTED |       |
| File retry handling  | NOT_STARTED |       |
| File security tests  | NOT_STARTED |       |

---

# 14.1. Public Catalogue (Backend)

| Component                        | Status   | Notes |
| -------------------------------- | -------- | ----- |
| Public catalogue list endpoint   | VERIFIED | GET /api/v1/catalogue/resources with pagination & validation |
| Public catalogue detail endpoint | VERIFIED | GET /api/v1/catalogue/resources/:id (UUID validation) |
| Public visibility enforcement    | VERIFIED | Strictly content.resources.status = PUBLISHED AND resource_versions.status = PUBLISHED |
| Single published version selector| VERIFIED | uq_resource_single_published_version; historical/draft versions isolated |
| Metadata-only resource discovery | VERIFIED | Resources without files discoverable; AVAILABLE files presented |
| File presentation sanitization   | VERIFIED | Zero storage credentials, buckets, or object keys leaked |
| Structured filtering             | VERIFIED | Country (code/slug/UUID), resourceType, curriculum, grade, subject, school, year, term, quality |
| Deterministic sorting            | VERIFIED | newest, oldest, title with deterministic ID secondary tiebreaker |
| Catalogue service & route tests  | VERIFIED | Unit route tests (8 passed) + Neon DB integration tests (13 passed) |

---

# 14.2. Search (Backend)

| Component                        | Status   | Notes |
| -------------------------------- | -------- | ----- |
| Public resource search endpoint  | VERIFIED | GET /api/v1/search/resources & GET /api/v1/search |
| SearchProvider abstraction       | VERIFIED | SearchService -> SearchProvider -> PostgreSQLSearchProvider |
| PostgreSQL FTS implementation    | VERIFIED | tsvector (weighted A/B/C), websearch_to_tsquery, ts_rank_cd |
| Public visibility enforcement    | VERIFIED | Strictly PUBLISHED resources and versions; draft/historical isolated |
| Search + catalogue filters       | VERIFIED | Combined text search + taxonomy/country/quality filters |
| Deterministic relevance ordering | VERIFIED | ts_rank_cd DESC, id ASC |
| Search route & integration tests | VERIFIED | Route unit tests (9 passed) + Neon DB integration tests (11 passed) |

---

# 15. Public Website

| Component                     | Status      | Notes |
| ----------------------------- | ----------- | ----- |
| Public homepage               | NOT_STARTED |       |
| Header/navigation             | NOT_STARTED |       |
| Resource catalogue            | NOT_STARTED |       |
| Resource cards                | NOT_STARTED |       |
| Resource detail page          | NOT_STARTED |       |
| Preview interface             | NOT_STARTED |       |
| Mobile layout                 | NOT_STARTED |       |
| Responsive design             | NOT_STARTED |       |
| Public search                 | NOT_STARTED |       |
| Filtering                     | NOT_STARTED |       |
| Sorting                       | NOT_STARTED |       |
| Load More                     | NOT_STARTED |       |
| Navigation-state preservation | NOT_STARTED |       |
| Teacher Hub                   | NOT_STARTED |       |
| Student Hub                   | NOT_STARTED |       |
| School discovery              | NOT_STARTED |       |

---

# 16. Search

| Component             | Status      | Notes |
| --------------------- | ----------- | ----- |
| SearchProvider        | VERIFIED    | Prompt 14.2 / Prompt 29; SearchService -> SearchProvider -> PostgreSQLSearchProvider |
| PostgreSQL FTS        | VERIFIED    | Prompt 14.2; tsvector (weighted A/B/C), websearch_to_tsquery, ts_rank_cd |
| Search index          | VERIFIED    | Prompt 14.2 / Prompt 29; GIN tsvector and B-tree text_pattern_ops autocomplete prefix indices |
| Weighted fields       | VERIFIED    | Prompt 14.2; A (title), B (description, curriculum, subject), C (grade, keywords) |
| Search filters        | VERIFIED    | Prompt 14.2; curriculum, grade, subject, school, year, term, country |
| Search sorting        | VERIFIED    | Prompt 14.2; relevance, newest, oldest, title |
| Autocomplete          | VERIFIED    | Prompt 29; contextual 4-tier autocomplete with text_pattern_ops prefix index, regex word boundaries, country-pinned fallback |
| Typo tolerance        | NOT_STARTED | Reserved for future fuzzy matching phase |
| Kenyan terminology    | NOT_STARTED | Reserved for future phase |
| Synonym dictionary    | NOT_STARTED | Reserved for future phase |
| No-results experience | VERIFIED    | Prompt 29; related exploration and fallback metadata |
| Related resources     | VERIFIED    | Prompt 29; GET /api/v1/search/related returning related subjects, topics, and suggestions |
| Search indexing jobs  | NOT_STARTED | Handled synchronously via generated tsvector column / index |
| Search tests          | VERIFIED    | Prompt 29; unit, route integration, and live Neon DB integration suites passing |

Autocomplete requirements:

```text
Minimum input: 2 characters
Maximum suggestions: 5
```

---

# 17. SEO

| Component                  | Status      | Notes |
| -------------------------- | ----------- | ----- |
| Clean URLs                 | VERIFIED    | Country-scoped prefix + slug: /<countryUrlPrefix>/resources/<slug> |
| Canonical URLs             | VERIFIED    | Deterministic canonical URL construction with trailing-slash normalization |
| Page metadata              | VERIFIED    | Authoritative title & description with deterministic fallback |
| Open Graph metadata        | VERIFIED    | og:title, og:description, og:url, og:type=article, og:site_name, og:locale |
| X/social metadata          | VERIFIED    | twitter:card=summary, twitter:title, twitter:description |
| Schema.org                 | NOT_STARTED | Reserved for future frontend page-rendering phase |
| Breadcrumbs                | NOT_STARTED | Reserved for future frontend navigation phase |
| Robots.txt                 | NOT_STARTED | Reserved for future public deployment phase |
| XML sitemap                | NOT_STARTED | Reserved for future public deployment phase |
| Sitemap splitting          | NOT_STARTED | Reserved for future public deployment phase |
| 404 handling               | VERIFIED    | 404 on unfindable/unpublished resources and version isolation |
| Slug redirects             | NOT_STARTED |       |
| Curriculum landing pages   | NOT_STARTED |       |
| Subject landing pages      | NOT_STARTED |       |
| Grade landing pages        | NOT_STARTED |       |
| Topic landing pages        | NOT_STARTED |       |
| Duplicate-content controls | NOT_STARTED |       |

---

# 18. Authentication

| Component                     | Status      | Notes                                                                                       |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| User entity                   | VERIFIED    | identity.users table, UUID PK, status lifecycle, soft-deletion support (deleted_at)          |
| Auth identity                 | VERIFIED    | identity.auth_identities table, LOCAL_PASSWORD provider, provider_subject uniqueness        |
| Registration                  | VERIFIED    | POST /api/v1/auth/register, atomic transactional provisioning across users, identities, sessions |
| Login                         | VERIFIED    | POST /api/v1/auth/login, generic failure mitigation, constant-time verification against timing attacks |
| Logout                        | VERIFIED    | POST /api/v1/auth/logout, server-side session revocation & HttpOnly cookie clearing         |
| Password hashing              | VERIFIED    | Argon2id algorithm, parameters meeting security specification                               |
| Email verification            | NOT_STARTED | Reserved for future notification/communication phase                                        |
| Password recovery             | NOT_STARTED | Reserved for future recovery workflow phase                                                 |
| Sessions                      | VERIFIED    | identity.user_sessions table, 256-bit CSPRNG token in HttpOnly cookie, SHA-256 token_hash in DB |
| Session revocation            | VERIFIED    | Server-side revocation (revoked_at), immediate invalidation                                 |
| Session management            | NOT_STARTED | Reserved for future user session-listing management phase                                   |
| Authentication rate limits    | NOT_STARTED | Reserved for future rate limiting infrastructure phase                                      |
| Admin authentication controls | NOT_STARTED | Reserved for future admin governance phase                                                  |
| MFA architecture              | NOT_STARTED | Reserved for future advanced security phase                                                 |

---

# 19. RBAC

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Roles                     | VERIFIED    | Prompt 14 implemented & verified; canonical and custom roles |
| Permissions               | VERIFIED    | Prompt 14 implemented & verified; fine-grained resource.action |
| Role permissions          | VERIFIED    | Prompt 14 implemented & verified; cascade join mappings |
| User roles                | VERIFIED    | Prompt 14 implemented & verified; global and scoped assignments |
| Multiple roles            | VERIFIED    | Prompt 14 implemented & verified; union permission accumulation |
| Permission scopes         | TESTING     | Prompt 14 + Prompt 33 Wave 2 (WP5): `29 ANY` + `19 GLOBAL` = `48` canonical permissions (`106` mappings), `scopeType` enforced in `hasPermission` & `resolveStaffPermissionAccess`, advisory-locked zero-waiver seed gate; offline suites pass, live PostgreSQL seed/integration execution pending `DATABASE_URL` |
| Role expiry               | VERIFIED    | Prompt 14 implemented & verified; temporal boundaries with starts_at and ends_at |
| Role auditing             | VERIFIED    | Prompt 14 implemented & verified; soft revocation status and created_by tracking |
| Server-side authorization | TESTING     | Prompt 14 + Prompt 33 Wave 2 (WP5): country-scoped vs global admin enforcement, non-leaking `GENERIC_FORBIDDEN_MESSAGE`, and `Cache-Control: private, no-store`; offline route suites pass, live DB integration pending `DATABASE_URL` |
| RBAC tests                | TESTING     | Prompt 33 Wave 2 offline unit/security/route suites passing (`wave2-rbac-and-seed.test.ts` 12/12, `rbac.service.test.ts` 16/16); PostgreSQL integration suites skipped pending live `DATABASE_URL` |

---

# 20. User Features

| Component                           | Status      | Notes                       |
| ----------------------------------- | ----------- | --------------------------- |
| User preferences                    | NOT_STARTED |                             |
| Preferred subjects                  | NOT_STARTED |                             |
| Preferred grades                    | NOT_STARTED |                             |
| Preferred pathways                  | NOT_STARTED |                             |
| Saved resources                     | VERIFIED    | Prompt 15 implemented & verified; flat version-specific UUID[] array with atomic deduplication |
| Follows                             | NOT_STARTED |                             |
| Activity                            | NOT_STARTED |                             |
| My Library                          | VERIFIED    | Prompt 15 implemented & verified; authenticated /api/v1/library/resources with public catalogue projection |
| Anonymous activity                  | NOT_STARTED |                             |
| Cross-device authenticated activity | NOT_STARTED |                             |

Important:

Saved resources must remain:

```text
Directly stored on user record
Version-specific
Flat
Not organized through private collections
```

---

# 21. Free Downloads

| Component                     | Status   | Notes                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| Download authorization        | VERIFIED | Prompt 16 implemented & verified; anonymous + authenticated access |
| Free-resource validation      | VERIFIED | Prompt 16; PostgreSQL pre-storage publication & qualityLabel checks|
| Signed access                 | VERIFIED | Prompt 16; short-lived presigned GET URLs (300s TTL)               |
| CDN/storage integration       | VERIFIED | Prompt 16; S3/R2 presigner abstraction with memory provider        |
| Download failure handling     | VERIFIED | Prompt 16; zero R2 calls on rejection; controlled error codes      |
| Expired access handling       | VERIFIED | Prompt 16; presigned URL expires after 300 seconds                 |
| Interrupted-download handling | VERIFIED | Prompt 16; idempotent GET download signatures                      |
| Download security tests       | VERIFIED | Prompt 16; unit, DB, and route integration tests passing           |

---

# 22. Calendar

| Component                  | Status   | Notes |
| -------------------------- | -------- | ----- |
| Calendar entity            | VERIFIED | `calendar.calendars` table, UUID PK, 4 scopes, structural check constraints |
| Official calendar          | VERIFIED | Platform/country/academic-year aware official calendars and public read-only access |
| School calendar            | VERIFIED | Institutional academic calendars bound to `school_id` |
| User calendar              | VERIFIED | Authenticated persistent personal calendars bound to `user_id` |
| Anonymous session calendar | VERIFIED | Server-controlled `calendar_session` cookie, 7-day rolling TTL |
| Calendar event types       | VERIFIED | `calendar.calendar_event_types` registry, 11 seeded categories |
| Calendar events            | VERIFIED | `calendar.calendar_events` table, dates/times check constraints, chronological ordering |
| Recurrence                 | VERIFIED | `calendar.calendar_recurrence_rules` table, structural frequency and interval definition |
| Calendar templates         | VERIFIED | `calendar.calendar_templates` table, configurable layout JSONB |
| PDF export                 | VERIFIED | `CalendarExportProvider` abstraction & `PdfCalendarExportProvider` (pdf-lib) |
| Export expiry              | VERIFIED | 24-hour TTL for generated calendar export downloads |
| Anonymous session expiry   | VERIFIED | Deterministic server-side 7-day rolling TTL; expired sessions rejected |
| Anonymous-to-user transfer | VERIFIED | `POST /api/v1/calendar/session/transfer` atomic reassignment to authenticated user |
| Calendar tests             | VERIFIED | 36 automated tests across DB integration, Service unit, and HTTP route integration suites |

Calendar scopes:

```text
OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION
```

---

# 23. Commerce

| Component              | Status      | Notes |
| ---------------------- | ----------- | ----- |
| Payment providers      | VERIFIED    | Provider-neutral `PaymentProvider` abstraction with `SimulationPaymentProvider` foundation |
| Products               | VERIFIED    | `commerce.products` table, UUID PK, types `RESOURCE` and `BUNDLE`, status lifecycle |
| Offers                 | VERIFIED    | `commerce.offers` table, KES integer minor units (BIGINT), server-side time validity check |
| Orders                 | VERIFIED    | `commerce.orders` table, authenticated user ownership, server-calculated totals, state machine |
| Order items            | VERIFIED    | `commerce.order_items` table, immutable historical price snapshots, total integrity constraint |
| Payments               | VERIFIED    | `commerce.payments` table, provider reference uniqueness, full amount and currency verification |
| Entitlements           | VERIFIED    | `commerce.entitlements` table, authoritative premium access mechanism, zero `is_paid` flag |
| Idempotency            | VERIFIED    | Idempotent order placement (`idempotency_key`) and idempotent payment processing |
| Multi-currency support | DEFERRED    | KES only in Prompt 18 as planned; multi-currency reserved for future phase |
| Commerce tests         | VERIFIED    | 31 automated tests across DB integration, Service unit, and HTTP route integration suites |

---

# 24. M-Pesa

| Component                     | Status   | Notes |
| ----------------------------- | -------- | ----- |
| PaymentProvider interface     | VERIFIED | Existing provider-neutral interface preserved; `MpesaPaymentProvider` implements `PaymentProvider` alongside `SimulationPaymentProvider` |
| M-Pesa adapter                | VERIFIED | `MpesaPaymentProvider` with `DarajaClient`, OAuth client credential caching, sandbox/production selection, timestamping & password hashing |
| STK initiation                | VERIFIED | `POST /api/v1/payments` initiates STK Push with normalized phone number and server-authoritative order amount |
| Callback endpoint             | VERIFIED | Unauthenticated provider-facing endpoints `POST /api/v1/payments/mpesa/callback` and `POST /api/v1/mpesa/callback` |
| Callback validation           | VERIFIED | Strict Daraja payload parsing, validation of `CheckoutRequestID`, `ResultCode`, and `CallbackMetadata` items |
| Transaction verification      | VERIFIED | Correlates callback with internal payment record via `CheckoutRequestID` using database row-level locking (`FOR UPDATE`) |
| Duplicate callback protection | VERIFIED | Race-safe idempotency within transactional boundary; duplicate callbacks return Daraja acknowledgement with zero duplicate mutations |
| Replay protection             | VERIFIED | Atomic status verification prevents replay attacks or out-of-order state transitions |
| Amount validation             | VERIFIED | Authoritative callback KES amount verified against `payment.amount_minor` and `order.total_minor`; under/overpayments fail |
| Currency validation           | VERIFIED | Strict KES currency verification on payment and order records |
| Entitlement creation          | VERIFIED | Transactional provisioning of `commerce.entitlements` records for `RESOURCE` products only upon confirmed successful payment |
| Reconciliation                | VERIFIED | Complete state machine reconciliation across `payments` and `orders` (`PENDING` -> `PROCESSING` -> `COMPLETED`/`CANCELLED`/`FAILED`) |
| Failure handling              | VERIFIED | Safe handling of user cancellations (1032), upstream failures, network errors, amount mismatches, and unknown references |
| M-Pesa tests                  | VERIFIED | 38 automated tests across unit (phone, client, provider), DB service integration, and HTTP route integration |

---

# 25. Premium Downloads

| Component                 | Status   | Notes |
| ------------------------- | -------- | ----- |
| Entitlement check         | VERIFIED | Prompt 20; authoritative validation of ownership, status, resource ID, and temporal validity against `commerce.entitlements` |
| Premium authorization     | VERIFIED | Prompt 20; authenticated endpoint verifies active entitlement; unauthenticated/unentitled access blocked with 403 `PREMIUM_RESOURCE_LOCKED` |
| Protected storage         | VERIFIED | Prompt 20; zero storage calls on rejection; storage internal identifiers omitted from response |
| Signed premium download   | VERIFIED | Prompt 20; short-lived presigned GET URLs (300s TTL default); available files only |
| Purchase history          | VERIFIED | Prompt 18 / Prompt 19; authoritative orders & payments ledger |
| My Library premium access | VERIFIED | Prompt 15 / Prompt 20; library resources and entitlements integration |
| Version-aware entitlement | VERIFIED | Prompt 20; entitlement binds to permanent resource; version isolation and publication verified |
| Premium E2E test          | VERIFIED | Prompt 20; unit tests, DB integration tests, and HTTP route integration tests passing |

---

# 26. Contributors

| Component                | Status      | Notes |
| ------------------------ | ----------- | ----- |
| Contributor entity       | VERIFIED    | community.contributors decoupled profile linked to identity.users (Prompt 21) |
| Contributor applications | VERIFIED    | community.contributor_applications with partial unique index blocking duplicate active applications (Prompt 21) |
| Contributor approval     | VERIFIED    | Atomic transaction approving application, creating profile, and assigning RBAC role (Prompt 21) |
| Contributor profiles     | VERIFIED    | Public discovery with published resource counts, private workspace projection, collision-safe slugs (Prompt 21) |
| Contributor workspace    | VERIFIED    | Authenticated /me/contributor endpoints, lifecycle gating on profile edits and submissions (Prompt 21) |
| Contributor submissions  | VERIFIED    | community.contributor_submissions ingestion pathway, KES pricing consistency, draft lock on submission (Prompt 21) |
| Submission files         | NOT_STARTED | Deferred to file ingestion roadmap item |
| Submission processing    | NOT_STARTED | Formal automated processing deferred per Prompt 21 plan boundary |
| Contributor verification | VERIFIED    | Contributor verification_status and lifecycle suspension rules implemented and verified (Prompt 21) |
| Admin review             | VERIFIED    | Administrative endpoints for application review, submission review, and status management (Prompt 21) |
| Contributor tests        | VERIFIED    | 52 dedicated tests across unit, route integration, and database constraints (Prompt 21) |

---

# 27. Contributor Finance

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Revenue rules             | VERIFIED    | Prompt 22; `community.contributor_revenue_rules`, 70/30 canonical rule (7000 bps), effective-date selection, overlap prevention |
| Earnings                  | VERIFIED    | Prompt 22; `community.contributor_earnings` append-only ledger, zero-sum invariant ($P + C = G$), 7-day maturity lifecycle (`PENDING` -> `AVAILABLE`) |
| Payouts                   | NOT_STARTED | Explicitly excluded from Prompt 22; automated M-Pesa B2C / bank payouts reserved for future phase |
| Historical revenue values | VERIFIED    | Prompt 22; immutable historical records with PostgreSQL trigger preventing deletions and tampering |
| Financial access control  | VERIFIED    | Prompt 22; `contributor.earnings.view` (contributor isolation) & `contributor.finance.manage` (admin control), IDOR protection |
| Financial audit logging   | VERIFIED    | Prompt 22; transactional integration with order payments, unique attribution `(order_item_id, contributor_id)`, immutable ledger |
| Contributor finance tests | VERIFIED    | Prompt 22; 27 dedicated tests across unit, DB trigger constraints, and HTTP route integration suites |

---

# 28. Education Updates

| Component                | Status      | Notes |
| ------------------------ | ----------- | ----- |
| Education updates        | VERIFIED    | Prompt 23; `content.education_updates` dedicated entity, nullable country_id for regional updates, unique slugs |
| Update categories        | VERIFIED    | Prompt 23; `content.education_update_categories` classification with seed data |
| Curriculum relationships | VERIFIED    | Prompt 23; `content.education_update_curricula` junction table with country-consistency validation |
| Resource relationships   | VERIFIED    | Prompt 23; `content.education_update_resources` junction table with public draft leakage prevention |
| Draft workflow           | VERIFIED    | Prompt 23; initial status strictly `DRAFT`, required content validation before publish |
| Review workflow          | NOT_STARTED | Not in Prompt 23 scope; updates managed by content_manager and system_admin |
| Publication              | VERIFIED    | Prompt 23; `POST /admin/updates/:id/publish`, sets `published_at` on first publish and preserves on edit |
| Archive                  | VERIFIED    | Prompt 23; `POST /admin/updates/:id/archive`, terminal state, hides immediately from public |
| SEO                      | VERIFIED    | Prompt 23; canonical URLs (country & regional), OpenGraph article, Twitter summary, robots meta |
| Search integration       | VERIFIED    | Prompt 23; title and summary search in public and administrative listing endpoints |

Education Updates remain a dedicated entity.

They must not be converted into Resources.

---

# 29. Quality and Governance

| Component               | Status      | Notes |
| ----------------------- | ----------- | ----- |
| Quality labels          | VERIFIED    | Decoupled: STANDARD, PREMIUM (commercial), VERIFIED (pedagogical) |
| Quality check types     | VERIFIED    | 7 canonical criteria seeded; country inheritance supported |
| Resource quality checks | VERIFIED    | Append-only evaluation ledger with trigger immutability |
| Verification workflow   | VERIFIED    | Version-specific, requires all 5 mandatory criteria PASSED |
| Verification history    | VERIFIED    | Full audit trail of verifications and revocations |
| Verification revocation | VERIFIED    | Mandatory non-empty reason and accountable actor tracking |
| Governance reviews      | VERIFIED    | Admin review endpoints with RBAC separation of duties |
| Audit logs              | VERIFIED    | Immutable evaluation ledger and verification histories |
| Retention policies      | NOT_STARTED | Scheduled for future retention prompt |
| Retention actions       | NOT_STARTED | Scheduled for future retention prompt |
| Governance tests        | VERIFIED    | DB constraints, service workflow, RBAC route tests |

Quality labels:

```text
STANDARD
VERIFIED
PREMIUM
```

No numerical public ratings.

---

# 30. Feedback and Requests

| Component           | Status      | Notes |
| ------------------- | ----------- | ----- |
| Resource requests   | NOT_STARTED |       |
| Request upvotes     | NOT_STARTED |       |
| Anonymous requests  | NOT_STARTED |       |
| Resource feedback   | VERIFIED    | 7 canonical categories, anonymous rf_sid hashing, 1-hour duplicate cooldown, state machine triage, and immutable event ledger |
| Serious reports     | NOT_STARTED |       |
| Moderation workflow | NOT_STARTED |       |
| Demand signals      | NOT_STARTED |       |
| Feedback tests      | VERIFIED    | 27 service, route, and DB integration tests passing (100%) |

No general public resource commenting/discussion system.

---

# 31. Notifications

| Component                         | Status   | Notes |
| --------------------------------- | -------- | ----- |
| Notification entity               | VERIFIED | `identity.notifications` with lifecycle constraints (`chk_notifications_lifecycle`), deduplication, entity indexing |
| In-app notifications              | VERIFIED | Synchronous transactional insert, immediate `DELIVERED` status with `attempt_count = 0` |
| Email provider                    | VERIFIED | Transactional outbox pattern, mock delivery provider with latency and deterministic simulated failures |
| SMS provider                      | VERIFIED | Transactional outbox pattern, mock SMS provider interface |
| Delivery tracking                 | VERIFIED | `identity.notification_deliveries` outbox ledger with full status invariants |
| Retry mechanism                   | VERIFIED | Atomic lease claims with `FOR UPDATE SKIP LOCKED`, exponential backoff, retry caps, stale-lease recovery |
| Notification preferences          | VERIFIED | `identity.user_notification_preferences` with email, marketing email, and in-app toggles |
| Transactional notifications       | VERIFIED | Mandatory categories (`TRANSACTIONAL`, `SECURITY`) strictly bypass user opt-outs |
| Marketing notification separation | VERIFIED | Strict dual-gate enforcement: requires both `email_enabled = true` and `marketing_email_enabled = true` |

---

# 32. Analytics

| Component             | Status   | Notes |
| --------------------- | -------- | ----- |
| Analytics event types | VERIFIED | `analytics.analytics_event_types` with status checks and unique event codes |
| Analytics events      | VERIFIED | `analytics.analytics_events` append-only ledger with `chk_analytics_events_actor` |
| Anonymous events      | VERIFIED | Supported with mandatory `anonymous_session_hash` (SHA-256) and optional country |
| Authenticated events  | VERIFIED | Linked to `user_id` with `ON DELETE SET NULL` safety; maintains valid actor check |
| Resource analytics    | VERIFIED | View, preview, save, and share events with strict schema allowlists |
| Search analytics      | VERIFIED | Instrumented in search route; stores SHA-256 hash, results count, zero-result rate |
| Download analytics    | VERIFIED | Instrumented in download route; tracks download URL issuance and file metadata |
| Purchase analytics    | VERIFIED | Schema and event types configured for commerce event tracking |
| Share analytics       | VERIFIED | Share event schema with platform classification |
| Calendar analytics    | VERIFIED | Calendar interaction schema and event type registered |
| Admin dashboards      | VERIFIED | `GET /api/v1/admin/analytics/overview` with UTC half-open interval and actor sets |
| Retention controls    | VERIFIED | Bounded-staleness 5m TTL cache, 4KB context limit, and in-memory rate limiting |

---

# 33. Search Intelligence

| Component                 | Status      | Notes |
| ------------------------- | ----------- | ----- |
| Structured ranking        | VERIFIED    | Prompt 29; tiered matching: exact title prefix, word boundary regex, topic context, country fallback |
| Quality signals           | VERIFIED    | Prompt 14.2 / Prompt 29; published isolation and verified quality metadata |
| Freshness signals         | NOT_STARTED | Reserved for future dynamic boosting phase |
| Popularity signals        | NOT_STARTED | Reserved for future dynamic ranking phase |
| Usage signals             | NOT_STARTED | Reserved for future dynamic ranking phase |
| Context signals           | VERIFIED    | Prompt 29; Grade and Subject context-aware autocomplete matching |
| Synonym dictionary        | NOT_STARTED | Reserved for future phase |
| Kenyan terminology        | NOT_STARTED | Reserved for future phase |
| Contextual explanations   | NOT_STARTED | Reserved for future phase |
| Diversity rules           | NOT_STARTED | Reserved for future phase |
| Search demand analytics   | VERIFIED    | Prompt 29; admin search demand aggregation with distinct qualifying search identities floor (min 3) and privacy suppression |
| Search intelligence tests | VERIFIED    | Prompt 29; unit, route, and DB integration tests passing (100%) |

---

# 34. Recommendations

| Component                            | Status      | Notes |
| ------------------------------------ | ----------- | ----- |
| Similar resources                    | NOT_STARTED |       |
| Next-useful-resource recommendations | NOT_STARTED |       |
| Subject recommendations              | NOT_STARTED |       |
| Topic recommendations                | NOT_STARTED |       |
| Collection recommendations           | NOT_STARTED |       |
| Personalized recommendations         | NOT_STARTED |       |
| Explanation/reason signals           | NOT_STARTED |       |
| Diversity rules                      | NOT_STARTED |       |
| Cold-start recommendations           | NOT_STARTED |       |

---

# 35. Homepage Intelligence

| Component              | Status      | Notes |
| ---------------------- | ----------- | ----- |
| Homepage discovery API | VERIFIED    | Prompt 32; `GET /api/v1/homepage` (Kenya `KE` default) and `GET /api/v1/countries/:countryCode/homepage` with `Cache-Control: no-store` (`P1`, `P2`; `/homepage/slots/:slotKey` intentionally unregistered per C63) |
| Dynamic sections       | VERIFIED    | Prompt 32; locked 6-slot architecture (`trending_resources`, `most_downloaded_resources`, `curated_resources`, `education_updates`, `calendar_highlights`, `curriculum_shortcuts`) enforced by DB constraint trigger + API contract |
| Trending               | VERIFIED    | Prompt 32; `trending_resources` slot with live SQL eligibility gate and country-scoped trending fallback |
| Most Downloaded        | VERIFIED    | Prompt 32; `most_downloaded_resources` slot with live SQL eligibility gate and country-scoped download ranking fallback |
| Curated content        | VERIFIED    | Prompt 32; `curated_resources` (`RESOURCE`) and `curriculum_shortcuts` (`SUBJECT`) editorial curation & discovery slots |
| Teacher discovery      | NOT_STARTED | Frontend teacher hub UI phase not yet started |
| Student discovery      | NOT_STARTED | Frontend student hub UI phase not yet started |
| Calendar section       | VERIFIED    | Prompt 32; `calendar_highlights` slot restricted to `OFFICIAL`, `PUBLIC`, `ACTIVE` country-scoped upcoming academic milestones |
| Updates section        | VERIFIED    | Prompt 32; `education_updates` slot restricted to `PUBLISHED` country-scoped updates with active category and curricula |
| Collections            | DEFERRED    | Decision D1 / R17-02: no `collections` table exists yet; `curriculum_shortcuts` (`SUBJECT`) serves as the canonical 6th homepage slot |
| Free/Premium discovery | VERIFIED    | Prompt 32; public resource cards surface `commercialAccessStatus` (`FREE` \| `PREMIUM`) with zero storage secret leakage |
| Admin pinning          | VERIFIED    | Prompt 32; per-slot `PINNED_ITEMS`, `HYBRID`, and `DYNAMIC_ONLY` strategies with optional `[pinStartsAt, pinEndsAt)` windows |
| Scheduling             | VERIFIED    | Prompt 32; `SCHEDULED` lifecycle backed by PostgreSQL `btree_gist` exclusion constraint `excl_homepage_cfg_country_schedule_window` |
| Expiry                 | VERIFIED    | Prompt 32; Decision D4 lazy `scheduled_until_at` expiry transitioning `PUBLISHED -> ARCHIVED` with `SYSTEM` audit log and `DEFAULT_FALLBACK` recovery |
| Override               | VERIFIED    | Prompt 32; country-scoped editorial overrides superseding prior `PUBLISHED` configuration atomically |
| Preview                | VERIFIED    | Prompt 32; `POST /api/v1/admin/homepage/preview` supporting draft/configuration or inline payloads, explicit `evaluationTimestamp`, and per-item diagnostics |
| Publish                | VERIFIED    | Prompt 32; `POST /api/v1/admin/homepage/configurations/:id/publish` gated by deferred 6-slot completeness and live SQL entity eligibility |
| Rollback               | VERIFIED    | Prompt 32; Decision D3 clone-forward rollback (`POST /api/v1/admin/homepage/configurations/:id/rollback`) with bidirectional same-`xid8` trigger handshake |

Exactly six major dynamic homepage content cards/sections must be active at any one time according to the locked product design.

---

# 36. Admin Platform

| Component                   | Status      | Notes |
| --------------------------- | ----------- | ----- |
| Admin application           | NOT_STARTED | Frontend UI not yet started; Prompt 31 backend operational APIs verified |
| Resource management         | VERIFIED    | Prompt 31; centralized admin resource listing (`GET /api/v1/admin/resources`), 6-flag attention filtering, detail inspection (`GET /api/v1/admin/resources/:id`), and country-scoped publication hardening |
| Version management          | VERIFIED    | Prompt 31; full version history inspection and candidate-version review queue (`GET /api/v1/admin/publications/review-queue`) |
| File management             | VERIFIED    | Prompt 31; sanitized admin file listing (`GET /api/v1/admin/files`), detail inspection (`GET /api/v1/admin/files/:id`), and rate-limited read-only storage integrity verification (`POST /api/v1/admin/files/:id/verify-integrity`) |
| Taxonomy management         | NOT_STARTED |       |
| School management           | NOT_STARTED |       |
| Collection management       | NOT_STARTED |       |
| Bundle management           | NOT_STARTED |       |
| User management             | NOT_STARTED |       |
| Role management             | NOT_STARTED |       |
| Verification management     | VERIFIED    | Prompt 24 pedagogical quality verification and revocation workflows |
| Contributor management      | VERIFIED    | Prompt 21 administrative status and review workflows |
| Education update management | VERIFIED    | Prompt 23 administrative draft, publish, and archive workflows |
| Calendar management         | NOT_STARTED |       |
| Request management          | NOT_STARTED |       |
| Feedback management         | VERIFIED    | Queue listing, triage lifecycle, RBAC separation of duties (read-only for reviewers) |
| Report management           | NOT_STARTED |       |
| Commerce management         | NOT_STARTED |       |
| Analytics dashboard         | VERIFIED    | Prompt 27 `GET /api/v1/admin/analytics/overview` and Prompt 29 search demand analytics |
| Governance dashboard        | VERIFIED    | Prompt 31 centralized operational overview (`GET /api/v1/admin/dashboard/overview`), cross-resource publication event ledger (`GET /api/v1/admin/publications/events`), per-resource admin event timeline (`GET /api/v1/admin/resources/:id/events`), and audit log explorer (`GET /api/v1/admin/audit-logs`) |
| Homepage editorial management | VERIFIED  | Prompt 32 administrative endpoints (`A1`–`A9` under `/api/v1/admin/homepage/*`) for country-scoped draft CRUD, schedule/unschedule, preview, publish, discard, and clone-forward rollback |

---

# 37. Security

| Component                  | Status      | Notes |
| -------------------------- | ----------- | ----- |
| Password security          | NOT_STARTED |       |
| Secure sessions            | NOT_STARTED |       |
| Session revocation         | NOT_STARTED |       |
| RBAC                       | TESTING     | Prompt 33 Wave 2 (WP5): `29 ANY` + `19 GLOBAL` = `48` permissions, zero-waiver `Query A` + NULL-safe `Query B` seed gate, country-scoped vs global enforcement; pending live PostgreSQL verification |
| IDOR protection            | TESTING     | Prompt 33 Wave 2 (WP5 + WP2): cross-country admin isolation (`403` / hidden `404`) and public visibility lockdown across resources, versions, publication events, curriculum, search, catalogue, library, SEO, contributors, updates, calendar, and recommendations |
| CSRF protection            | NOT_STARTED | Reserved for Wave 3 |
| CORS                       | NOT_STARTED | Reserved for Wave 3 |
| Security headers           | NOT_STARTED | Reserved for Wave 3 |
| Input validation           | NOT_STARTED |       |
| Mass-assignment protection | NOT_STARTED |       |
| Rate limiting              | NOT_STARTED |       |
| File security              | TESTING     | Prompt 33 Wave 1 (WP6) + Wave 2 (WP2): quarantine/malware-scan eligibility predicates across public discovery, `files.resource_files` cache invalidation trigger (`0023`); pending live DB execution |
| Download protection        | NOT_STARTED |       |
| Premium protection         | NOT_STARTED |       |
| Payment security           | TESTING     | Prompt 33 Wave 1 (WP1/WP4) implemented; pending live DB & Daraja staging verification |
| Webhook security           | TESTING     | Prompt 33 Wave 1 (WP1) implemented; pending live DB & Daraja staging verification |
| Admin security             | TESTING     | Prompt 33 Wave 2 (WP5): `resolveStaffPermissionAccess`, `GENERIC_FORBIDDEN_MESSAGE`, `Cache-Control: private, no-store` across all admin endpoints |
| Secret management          | NOT_STARTED |       |
| Audit logging              | NOT_STARTED |       |
| Security tests             | TESTING     | Wave 1 & Wave 2 offline security suites passing (`wave2-rbac-and-seed.test.ts` 12/12, `wave2-public-visibility.test.ts` 9/9); live PostgreSQL suites skipped when `DATABASE_URL` is unconfigured |

---

# 38. Performance

| Component              | Status      | Notes |
| ---------------------- | ----------- | ----- |
| Database indexing      | VERIFIED    | Prompt 31 (`drizzle/0020_admin_dashboard_indexes.sql`); 18 composite and partial B-tree indexes verified via live `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` |
| Query optimization     | VERIFIED    | Prompt 31; zero-`Sort` index-ordered plans across global and country-scoped admin resource lists and review queues |
| API performance        | NOT_STARTED |       |
| Search performance     | NOT_STARTED |       |
| Pagination             | NOT_STARTED |       |
| Public caching         | NOT_STARTED |       |
| CDN                    | NOT_STARTED |       |
| Image optimization     | NOT_STARTED |       |
| Lazy loading           | NOT_STARTED |       |
| Download performance   | NOT_STARTED |       |
| Mobile performance     | NOT_STARTED |       |
| Low-bandwidth testing  | NOT_STARTED |       |
| Core Web Vitals        | NOT_STARTED |       |
| Performance monitoring | NOT_STARTED |       |

---

# 39. Accessibility

Target:

```text
WCAG 2.2 AA
```

| Component             | Status      |
| --------------------- | ----------- |
| Semantic HTML         | NOT_STARTED |
| Keyboard navigation   | NOT_STARTED |
| Screen-reader support | NOT_STARTED |
| Contrast              | NOT_STARTED |
| Focus states          | NOT_STARTED |
| Accessible forms      | NOT_STARTED |
| Accessible downloads  | NOT_STARTED |
| Image alt text        | NOT_STARTED |
| Mobile accessibility  | NOT_STARTED |
| Accessibility testing | NOT_STARTED |

---

# 40. Observability

| Component                 | Status      |
| ------------------------- | ----------- |
| Structured logging        | NOT_STARTED |
| Request IDs               | NOT_STARTED |
| Error grouping            | NOT_STARTED |
| Application health        | NOT_STARTED |
| Database health           | NOT_STARTED |
| Background job monitoring | NOT_STARTED |
| Payment monitoring        | NOT_STARTED |
| Storage monitoring        | NOT_STARTED |
| Search monitoring         | NOT_STARTED |
| Historical metrics        | NOT_STARTED |
| Alerts                    | NOT_STARTED |

---

# 41. Background Jobs

| Job                         | Status      |
| --------------------------- | ----------- |
| File processing             | NOT_STARTED |
| Search indexing             | NOT_STARTED |
| Thumbnail generation        | NOT_STARTED |
| Preview generation          | NOT_STARTED |
| PDF generation              | NOT_STARTED |
| Email delivery              | NOT_STARTED |
| SMS delivery                | NOT_STARTED |
| Analytics aggregation       | NOT_STARTED |
| Recommendation calculations | NOT_STARTED |
| Scheduled publication       | NOT_STARTED |
| Scheduled retirement        | NOT_STARTED |
| Cache refresh               | NOT_STARTED |
| Sitemap generation          | NOT_STARTED |
| Anonymous-data cleanup      | NOT_STARTED |

---

# 42. Infrastructure

| Component               | Status      |
| ----------------------- | ----------- |
| Development environment | NOT_STARTED |
| Staging environment     | NOT_STARTED |
| Production environment  | NOT_STARTED |
| Managed PostgreSQL      | NOT_STARTED |
| Object storage          | NOT_STARTED |
| CDN                     | NOT_STARTED |
| Redis-compatible queue  | NOT_STARTED |
| Domain                  | NOT_STARTED |
| HTTPS                   | NOT_STARTED |
| CI/CD                   | NOT_STARTED |
| Backup system           | NOT_STARTED |
| Restore procedure       | NOT_STARTED |
| Monitoring              | NOT_STARTED |

---

# 43. Testing

| Test Category              | Status      |
| -------------------------- | ----------- |
| Unit tests                 | NOT_STARTED |
| Database integration tests | NOT_STARTED |
| API integration tests      | NOT_STARTED |
| Authentication tests       | NOT_STARTED |
| RBAC tests                 | NOT_STARTED |
| File tests                 | NOT_STARTED |
| Search tests               | NOT_STARTED |
| Commerce tests             | NOT_STARTED |
| M-Pesa tests               | NOT_STARTED |
| Calendar tests             | NOT_STARTED |
| Contributor tests          | VERIFIED    | Prompt 21; 52 service, route, and DB integration tests passing |
| Analytics tests            | NOT_STARTED |
| Governance tests           | NOT_STARTED |
| SEO tests                  | NOT_STARTED |
| Accessibility tests        | NOT_STARTED |
| Performance tests          | NOT_STARTED |
| Security tests             | NOT_STARTED |
| E2E tests                  | NOT_STARTED |
| Regression tests           | NOT_STARTED |

---

# 44. Critical E2E Journeys

| Journey                                                   | Status      |
| --------------------------------------------------------- | ----------- |
| Anonymous search → free resource → download               | NOT_STARTED |
| Anonymous search → premium resource → purchase → download | NOT_STARTED |
| Anonymous calendar → add event → PDF                      | NOT_STARTED |
| Authenticated calendar persistence                        | NOT_STARTED |
| Anonymous calendar → account transfer                     | NOT_STARTED |
| Contributor application → publication                     | NOT_STARTED |
| Resource publication → search indexing                    | NOT_STARTED |
| Resource unpublish → search removal                       | NOT_STARTED |
| Purchase → payment validation → entitlement               | NOT_STARTED |
| Entitlement → premium download                            | NOT_STARTED |

---

# 45. Git Checkpoints

Every major implementation stage should have a Git checkpoint.

| Checkpoint               | Status      | Commit |
| ------------------------ | ----------- | ------ |
| Documentation foundation | NOT_STARTED |        |
| Backend foundation       | NOT_STARTED |        |
| Database foundation      | NOT_STARTED |        |
| Geography                | VERIFIED    | Prompt 04 accepted |
| Schools                  | VERIFIED    | Prompt 05 implemented & verified |
| Curriculum               | VERIFIED    | Prompt 06 implemented & verified |
| Resource engine          | VERIFIED    | Prompt 07 implemented & verified |
| Publication workflow     | VERIFIED    | Prompt 08 implemented & verified |
| File storage             | VERIFIED    | Prompt 09 implemented & verified |
| Public catalogue         | VERIFIED    | Prompt 10 implemented & verified |
| Search                   | VERIFIED    | Prompt 11 implemented & verified |
| SEO                      | VERIFIED    | Prompt 12 implemented & verified |
| Authentication           | VERIFIED    | Prompt 13 implemented & verified |
| RBAC                     | VERIFIED    | Prompt 14 implemented & verified |
| User library             | VERIFIED    | Prompt 15 implemented & verified |
| Free downloads           | VERIFIED    | Prompt 16 implemented & verified |
| Calendar                 | VERIFIED    | Prompt 17 implemented & verified |
| Commerce                 | VERIFIED    | Prompt 18 implemented & verified |
| M-Pesa                   | VERIFIED    | Prompt 19 implemented & verified |
| Premium downloads        | VERIFIED    | Prompt 20 implemented & verified |
| Contributors             | VERIFIED    | Prompt 21 implemented & verified |
| Contributor finance      | VERIFIED    | Prompt 22 implemented & verified |
| Education updates        | VERIFIED    | Prompt 23 implemented & verified |
| Quality governance       | VERIFIED    | Prompt 24 implemented & verified |
| Feedback                 | VERIFIED    | Prompt 25 implemented & verified |
| Notifications            | VERIFIED    | Prompt 26 implemented & verified |
| Analytics                | VERIFIED    | Prompt 27 implemented & verified |
| Search intelligence      | VERIFIED    | Prompt 29 implemented & verified |
| Recommendations          | VERIFIED    | Prompt 30 implemented & verified |
| Admin dashboard          | VERIFIED    | Prompt 31 implemented & verified |
| Homepage intelligence    | VERIFIED    | Prompt 32 implemented & verified |
| Security audit           | IN_PROGRESS | Prompt 33 Wave 1 & Wave 2 implemented (`TESTING` pending live PostgreSQL verification); Wave 3 not started |
| Performance audit        | NOT_STARTED |        |
| Final launch audit       | NOT_STARTED |        |

---

# 46. Current Implementation Log

The coding agent must add entries here after each bounded implementation task.

## 2026-11-03 — Prompt 33 Security Hardening Wave 2 (Revision 3.0): WP5 RBAC Enforcement & WP2 Public Visibility Lockdown

Status:
TESTING (Code, migration `0023`, operator runbook, typecheck, build, and 33 offline test files / 351 tests passing; PostgreSQL-backed migration/seed/integration execution skipped locally because `DATABASE_URL` is not configured in this sandbox container)

Implemented:
- WP5 Canonical RBAC Inventory, Zero-Waiver Seed Gate & Operator Runbook (`src/db/seeds/roles-permissions.ts`, `docs/security/wave2-rbac-predeployment-audit.md`):
  * Reclassified the exact 11 approved permissions (`update.create`, `update.edit`, `update.publish`, `update.archive`, `update.read`, `quality.check.create`, `quality.verify`, `quality.revoke`, `quality.read`, `feedback.read`, `feedback.manage`) from `'GLOBAL'` to `'ANY'`, establishing the canonical `6` roles, `48` permissions (`29 ANY` + `19 GLOBAL` + `0 SCOPED`), and `106` `role_permissions` mappings.
  * Implemented transactionally wrapped (`dbInstance.transaction`) seed execution with `pg_advisory_xact_lock(20263302, 1)` running `assertWave2RbacPreconditions(tx)` (`Query A` + Revision 3.0 NULL-safe `Query B`) strictly BEFORE `isCanonicalTargetStateReached(tx)` and before any `INSERT`/`UPDATE`.
  * Enforced byte-for-byte SQL parity between `WAVE2_RBAC_QUERY_A_SQL` / `WAVE2_RBAC_QUERY_B_SQL` and `docs/security/wave2-rbac-predeployment-audit.md` (`<!-- WAVE2_QUERY_A_START -->`..`<!-- WAVE2_QUERY_B_END -->`), including PostgreSQL three-valued-logic NULL safety (`(...) IS NOT TRUE` and `IS DISTINCT FROM`) and `PB-1`..`PB-4` partial-bootstrap handling.
- WP5 Runtime Scope Enforcement & Administrative Endpoint Hardening (`src/services/rbac.service.ts`, `src/routes/hooks/authorize.ts`, `src/routes/api/v1/{updates,quality-governance,feedback,recommendations,audit,retention,analytics,notifications}.ts`):
  * Enforced `permissions.scopeType` (`GLOBAL` satisfied only by unscoped grants; `SCOPED` by exact scope match; `ANY` by unscoped or exact scope match) in `DefaultRbacService.hasPermission`.
  * Exported `resolveStaffPermissionAccess` failing closed on `SCHOOL`/`RESOURCE`-only grants and enforcing country-scope isolation on country-capable editorial endpoints (`updates`, `quality-governance`, `feedback`, `recommendations`) while requiring `access.hasGlobalGrant` on global-only governance endpoints (`audit`, `retention`, `analytics`, `notifications`).
  * Replaced permission-slug-leaking `403` error messages with `GENERIC_FORBIDDEN_MESSAGE` and enforced `Cache-Control: private, no-store` across all hardened admin endpoints.
- WP2 Public Visibility Lockdown & Synchronous Recommendation Cache Recomputation (`src/app.ts`, `src/routes/api/v1/{publications,resources,curriculum}.ts`, `src/services/{resource,curriculum,catalogue,library,contributor,seo,education-update,feedback}.service.ts`, `src/services/search/postgresql-search.provider.ts`, `src/services/calendar/calendar.service.ts`, `src/services/recommendations/{recommendation,recommendation-cache}.service.ts`):
  * Locked down `GET /api/v1/resources/:id/events` identically to `GET /api/v1/admin/resources/:id/events` (`requireAuth` + `['resource.admin.read', 'resource.review']` + `COUNTRY` scope + `Cache-Control: private, no-store`).
  * Gated `includeInactive=true`, `includeUnpublished=true`, non-`PUBLISHED` status filters, unpublished/future-dated/inactive-country/inactive-type resources & versions, and inactive/draft curriculum entities behind authenticated staff RBAC + country scope + `Cache-Control: private, no-store`.
  * Enforced active country (`countries.status = 'ACTIVE'`), active resource type (`resourceTypes.status = 'ACTIVE'`), active taxonomy, `resourceVersions.publishedAt <= now()`, clean file malware-scan/quarantine predicates, and `PUBLIC` official calendar event visibility across public discovery surfaces.
  * Removed the `effectiveLimit + 4` pre-slice truncation defect in `DefaultRecommendationService.getResourceRecommendations`, added synchronous dataset recomputation + cache overwrite in `getResourceRecommendations` and `getContinueExploring` whenever live-gate evictions drop surviving cached candidates below `effectiveLimit`, and wired `scope === 'file'` targeted cache eviction in `RecommendationCacheService.handleInvalidationEvent`.

Database:
- Created forward-only migration `drizzle/0023_wave2_visibility_and_rbac_hardening.sql` and registered `idx: 23` in `drizzle/meta/_journal.json`:
  * Hardened `content.fn_evaluate_homepage_entity_eligibility` to reject resources whose published version has quarantined, infected, or scan-errored `files.resource_files` rows (`RESOURCE_HAS_QUARANTINED_OR_INFECTED_FILE`).
  * Hardened `content.fn_get_resource_scoring_dataset` to require `rv.published_at <= p_eval_now` and exclude resources with quarantined/infected/scan-errored files.
  * Expanded `content.notify_recommendation_invalidation()` with Table 8 (`files.resource_files` -> `scope: 'file'`) and attached `trg_resource_files_invalidation`.

API:
- Hardened administrative and public visibility boundaries across `/api/v1/resources*`, `/api/v1/resource-types`, `/api/v1/resource-versions/:id`, `/api/v1/curricula*`, `/api/v1/curriculum-versions/:id`, `/api/v1/subjects*`, `/api/v1/admin/updates*`, `/api/v1/admin/quality/*`, `/api/v1/admin/feedback*`, `/api/v1/admin/recommendations/rules*`, `/api/v1/admin/audit-logs*`, `/api/v1/admin/retention/*`, `/api/v1/admin/analytics/*`, and `/api/v1/admin/notifications*`.

Frontend:
- None (backend security hardening milestone).

Tests:
- Added dedicated offline-executable Wave 2 security test suites (`21/21` passing):
  * `tests/security/wave2-rbac-and-seed.test.ts` (`12/12` passed): byte-for-byte SQL parity between runbook and seed gate, NULL-safe `Query B` predicate checks, `6/48/106` canonical inventory (`29 ANY` + `19 GLOBAL`), advisory-locked seed precondition gate (empty bootstrap, legacy `GLOBAL` pass, non-zero `Query A` / `Query B` abort before `INSERT`), `DefaultRbacService.hasPermission` & `resolveStaffPermissionAccess`, and Fastify `inject()` country-scope vs global admin route isolation.
  * `tests/security/wave2-public-visibility.test.ts` (`9/9` passed): public resource/version/event/curriculum lockdown, synchronous recommendation cache recomputation & cache overwrite, `scope = 'file'` cache eviction, and Migration `0023` + `_journal.json` verification.
- Updated `tests/security/wave1-migrations.test.ts` (`24` expected migrations `0000..0023`), `tests/db/rbac.integration.test.ts`, `tests/routes/rbac.integration.test.ts`, `tests/routes/admin-dashboard.integration.test.ts`, `tests/routes/quality-governance.integration.test.ts`, `tests/routes/feedback.integration.test.ts`, and `tests/routes/audit-retention.integration.test.ts`.
- Executed offline verification suite across `41` test files: `33` test files passed (`351` tests passed), `8` DB-backed suites skipped cleanly (`80` tests skipped) because `DATABASE_URL` is unset in this sandbox environment, `0` failed.

Typecheck:
PASS (`npm run lint` / `tsc --noEmit` — 0 errors)

Build:
PASS (`npm run build` / `tsc -p tsconfig.build.json` & applet compilation — 0 errors)

Security:
- Zero-waiver RBAC seed precondition gate aborts before any write if active unscoped editorial roles or RBAC metadata/mapping drift exist.
- Non-leaking `GENERIC_FORBIDDEN_MESSAGE` and `Cache-Control: private, no-store` enforced on privileged/admin responses.
- Future-dated versions, inactive countries/types/taxonomy, private calendar events, internal publication histories, and quarantined/infected files excluded from public discovery and recommendation caches.

Documentation:
- `docs/security/wave2-rbac-predeployment-audit.md` (created)
- `docs/IMPLEMENTATION_STATUS.md` (updated honestly to `TESTING` pending live PostgreSQL verification)

Git commit:
- Workspace has no `.git` directory initialized in this environment; create Prompt 33 Wave 2 checkpoint commit when syncing to `Clivendemo/education-platform`.

Issues:
- Live PostgreSQL execution (`npm run db:migrate`, pre-deployment `Query A` / `Query B` audit, `npm run db:seed:rbac`, and `.integration.test.ts` DB suites) could not be executed in this container because `DATABASE_URL` is not configured. Must be executed against staging/CI PostgreSQL before marking Wave 2 `VERIFIED`.

Next step:
- Execute live PostgreSQL migration/seed/integration verification in a `DATABASE_URL`-configured CI/staging environment, then await explicit human review and authorization before starting Wave 3.

## 2026-10-29 — Prompt 32: Homepage Intelligence, Editorial Scheduling, Atomic Rollback & Live SQL Eligibility Gate

Status:
VERIFIED

Implemented:
- PostgreSQL `btree_gist` Preflight & Eligibility Parity Engine (`src/services/homepage-gist-preflight.ts`, `src/services/homepage-eligibility.ts`):
  * Implemented read-only catalog inspection (`runLiveGistPreflight`) and pure evaluator (`evaluateGistPreflightSnapshot`) verifying PostgreSQL 14–18 version compatibility, GiST strategy-3 `tstzrange`/`anyrange` `&&` and `uuid` `=` operator-class readiness, and `CreateExtensionInternal` / `extension_is_trusted` database `CREATE` + `public` schema `CREATE`/`USAGE` installability privileges.
  * Implemented fail-closed `parseEvaluationTimestamp`, depth-16 recursive `evaluateTopicAncestry` (`TOPIC_ANCESTRY_CYCLE`, `TOPIC_ANCESTOR_MISSING`, `TOPIC_ANCESTRY_TOO_DEEP`, `TOPIC_INACTIVE`, `TOPIC_ANCESTOR_INACTIVE`), and 1-for-1 TypeScript mirrors of SQL projection classifiers across `RESOURCE`, `SUBJECT`, `UPDATE`, and `CALENDAR_EVENT`.
- Bounded Candidate-ID Cache & R17-03 Underfill Recovery (`src/services/homepage-cache.ts`):
  * Implemented `HomepageCacheService` caching candidate entity UUIDs only (`<= 10` UUIDs/slot, `<= 60` UUIDs/country, max 32 countries LRU, 60s TTL clamped to `scheduledUntilAtMs`), single-flight stampede coalescing, and deterministic R17-03 underfill recovery (`0` rebuilds on genuinely sparse countries where `cachedIds.length < slotTargetCount`, immediate rebuild when `hasMoreBeyondCap = true`, and `5,000ms` cooldown when exhausted without bypassing live SQL eligibility).
- Public & Editorial Homepage Services (`src/services/homepage.service.ts`, `src/services/homepage-admin.service.ts`):
  * Implemented public country resolution (`KE` default on `GET /api/v1/homepage`, case-insensitive ISO code, lowercase URL prefix, or UUID on `P1`/`P2`), lazy `SCHEDULED -> PUBLISHED` window promotion, and Decision D4 lazy `scheduled_until_at` expiry (`PUBLISHED -> ARCHIVED` with `SYSTEM` audit `homepage.configuration.expire_archive` and automatic `DEFAULT_FALLBACK` recovery).
  * Implemented canonical 6-slot composition (`trending_resources`, `most_downloaded_resources`, `curated_resources`, `education_updates`, `calendar_highlights`, `curriculum_shortcuts` per Decision D1 / R17-02) with live SQL eligibility re-validation on every serve and preview request.
  * Implemented administrative draft creation/cloning, full-state slot/item replacement, schedule/unschedule/cancel, preview (supporting `configurationId` or inline country + slots at arbitrary `evaluationTimestamp`), publish, discard (`DRAFT -> DISCARDED`), and Decision D3 clone-forward atomic rollback (`POST .../rollback` creating a new `PUBLISHED` revision paired with a same-`xid8` `homepage_configuration_rollbacks` row and transactional `governance.audit_logs` record).
- RBAC Seed Expansion (`src/db/seeds/roles-permissions.ts`):
  * Added 3 canonical permissions (`homepage.read`, `homepage.manage`, `homepage.publish`, all `scopeType: 'ANY'`) and 7 canonical `role_permissions` mappings (`system_admin` +3, `content_manager` +3, `content_reviewer` +1 read-only `homepage.read`), bringing canonical seeded totals to 48 permissions, 6 roles, and 106 `role_permissions` mappings (`system_admin` 48, `content_manager` 34, `content_reviewer` 13, `contributor` 5, `verified_teacher` 4, `standard_user` 2).

Database:
- Forward-only migration `drizzle/0021_homepage_intelligence.sql` applied to live Neon PostgreSQL and synchronized in `drizzle/meta/_journal.json` (idx `21`), `src/db/schema/homepage.ts`, `src/db/schemas.ts`, and `docs/DATABASE_SPEC.md` Section 45.3:
  * Enabled `btree_gist` extension and created 4 enums (`homepage_configuration_status_enum`, `homepage_slot_key_enum`, `homepage_slot_strategy_enum`, `homepage_item_entity_type_enum`).
  * Created pure `IMMUTABLE` SQL projection classifiers (`content.fn_diag_homepage_resource_projection`, `content.fn_diag_homepage_subject_projection`), recursive depth-16 `content.fn_diag_homepage_topic_ancestry`, and live `STABLE` evaluators (`content.fn_evaluate_homepage_entity_eligibility`, `content.fn_is_homepage_entity_eligible`).
  * Created 4 tables (`content.homepage_configurations`, `content.homepage_configuration_slots`, `content.homepage_configuration_items`, `content.homepage_configuration_rollbacks`) with `CHECK` invariants, partial unique active-published index `uq_homepage_cfg_one_published_per_country`, GiST schedule-window exclusion constraint `excl_homepage_cfg_country_schedule_window`, and triggers `T1`–`T6` (parent/slot immutability when non-`DRAFT`, lifecycle state machine transitions, deferred 6-slot completeness + live entity eligibility gate on `SCHEDULED`/`PUBLISHED`, append-only rollback ledger, and bidirectional same-`pg_current_xact_id()` rollback handshake).

API:
- Mounted `src/routes/api/v1/homepage.ts` (2 public routes, `Cache-Control: no-store`) and `src/routes/api/v1/admin-homepage.ts` (9 admin routes, `Cache-Control: private, no-store`) in `src/app.ts` (11 routes total):
  * `P1`: `GET /api/v1/homepage`
  * `P2`: `GET /api/v1/countries/:countryCode/homepage` (`/api/v1/homepage/slots/:slotKey` intentionally unregistered per C63)
  * `A1`: `GET /api/v1/admin/homepage/configurations` (`homepage.read`)
  * `A2`: `GET /api/v1/admin/homepage/configurations/:id` (`homepage.read`, opaque-ID hidden `404`)
  * `A3`: `POST /api/v1/admin/homepage/drafts` (`homepage.manage`, explicit-country `403` vs opaque `sourceConfigurationId` hidden `404`)
  * `A4`: `PUT /api/v1/admin/homepage/configurations/:id` (`homepage.manage`, opaque-ID hidden `404`)
  * `A5`: `POST /api/v1/admin/homepage/preview` (`homepage.read`, opaque `configurationId` hidden `404` vs inline `countryId` `403`)
  * `A6`: `POST /api/v1/admin/homepage/configurations/:id/schedule` (`homepage.publish`, opaque-ID hidden `404`)
  * `A7`: `POST /api/v1/admin/homepage/configurations/:id/publish` (`homepage.publish`, opaque-ID hidden `404`)
  * `A8`: `POST /api/v1/admin/homepage/configurations/:id/discard` (`homepage.manage`, opaque-ID hidden `404`)
  * `A9`: `POST /api/v1/admin/homepage/configurations/:id/rollback` (`homepage.publish`, opaque-ID hidden `404`)

Frontend:
- None (strictly backend-only per Prompt 32 specification).

Tests:
- Prompt-32 dedicated suites (6/6 files, 40/40 tests passing):
  * `tests/services/homepage-gist-preflight.test.ts` (11 passed): PostgreSQL 14–18 version boundaries, strategy-3 operator checks, trusted vs superuser installability, and missing DB `CREATE` negative fixtures (C66).
  * `tests/services/homepage-eligibility.test.ts` (13 passed): fail-closed evaluation timestamp parsing (C61), depth-16/17 topic ancestry priority ordering (C54), and all resource/subject/update/calendar-event projection diagnostic codes (C52/C60/C65).
  * `tests/services/homepage-cache.test.ts` (4 passed): candidate-ID-only payload bounds (`<= 10`/slot, `<= 60`/country, 32-country LRU), `scheduledUntilAt` TTL clamping, single-flight stampede protection, and R17-03 sparse vs `hasMoreBeyondCap` vs `5,000ms` cooldown recovery.
  * `tests/routes/homepage-admin-unit.test.ts` (4 passed): C1–C6 instrumentation counters (`C4 === 0 && C5 === 0 && C6 === 0`) and FM-0..FM-3b non-disclosing denied-audit failure resilience (C53/C55/C58/R17-04).
  * `tests/db/homepage.integration.test.ts` (5 passed): live Neon GiST catalog preflight, SQL-vs-TS eligibility parity across live schema-valid & pure projection fixtures, SQLSTATE constraint/trigger taxonomy (`23514`, `23P01`, `23505`, `P0001`), deferred 6-slot completeness, and atomic `xid8` rollback handshake rollback-on-failure proofs.
  * `tests/routes/homepage.integration.test.ts` (3 passed): `P1`/`P2` country resolution (`KE` default untouched), `C63` unregistered slot route `404`, `A1`–`A9` full lifecycle (`DRAFT -> SCHEDULED -> PUBLISHED -> Rollback / Discard`), `D4` lazy expiry archival + `SYSTEM` audit, and cross-country anti-enumeration hidden `404` vs explicit `403`.
- Updated `tests/db/admin-dashboard.integration.test.ts` canonical RBAC seed expectations (`48` permissions, `106` role-permission mappings) and isolated test `academicYear` (`2099`) + `afterAll` calendar cleanup in homepage integration suites.
- Full repository regression suite: 82/82 test files passed (`24` service + `28` DB + `30` route suites), 868/868 automated tests passed across all shards.

Typecheck:
PASS (`npm run lint` / `tsc --noEmit` — 0 errors)

Build:
PASS (`npm run build` / `tsc -p tsconfig.build.json` & applet compilation — 0 errors)

Security:
- Uniform hidden `404 HOMEPAGE_CONFIGURATION_NOT_FOUND` on cross-country opaque configuration IDs (`A2`–`A9`, `A3` `sourceConfigurationId`, `A5` `configurationId`) paired with synchronous `DENIED` audit logging and zero side-effect mutations (`C4 = C5 = C6 = 0`), while explicit unauthorized `countryId` filter/body inputs return generic `403 FORBIDDEN`.
- Denied-audit failure modes (`FM-1` actor snapshot error, `FM-2` audit insert error, `FM-3a`/`FM-3b` logger error) preserve identical HTTP status/body and never leak stack traces, SQL errors, or permission slugs.
- Zero exposure of `storageBucket`, `objectKey`, `storageMetadata`, checksums, or presigned download URLs in public, preview, or admin responses and candidate cache entries.
- Mandatory `Cache-Control: no-store` on public homepage routes and `Cache-Control: private, no-store` on all administrative homepage routes.

Rollback & Operational Safety:
- Editorial rollback (`D3`) is strictly clone-forward and append-only: historical `ARCHIVED` revisions are never mutated in place; rolling back clones a validated 6-slot revision into a new `PUBLISHED` row linked via `homepage_configuration_rollbacks` in the same `pg_current_xact_id()` transaction.
- Schema/RBAC emergency disablement follows `docs/DATABASE_SPEC.md` Section 45.3 without touching pre-existing permissions or `btree_gist`.

Documentation:
- `docs/API_SPEC.md` (Sections 60 & 61: Public Homepage Intelligence API and Administrative Homepage Editorial Management API)
- `docs/DATABASE_SPEC.md` (Section 45.3: Prompt 32 Homepage Intelligence Schema, Triggers, Eligibility Functions & Rollback Handshake)
- `docs/IMPLEMENTATION_STATUS.md` (Sections 35, 36, 45, and 46 updated; Prompt 32 closed as `VERIFIED`)

Git commit:
- Workspace has no `.git` directory initialized in this environment; create Prompt 32 checkpoint commit when syncing to `Clivendemo/education-platform`.

Issues:
- None.

Next step:
- Prompt 32 closed as `VERIFIED`. Stop and await explicit human authorization before starting the next milestone.

## 2026-10-25 — Prompt 31: Centralized Admin Dashboard & Operational Oversight Backend

Status:
VERIFIED

Implemented:
- RBAC Scope Resolution & Dedicated Permissions (`src/services/rbac.service.ts` & `src/db/seeds/roles-permissions.ts`):
  * Seeded 4 dedicated Prompt-31 permissions (`admin.dashboard.read`, `resource.admin.read`, `file.admin.read`, `file.admin.verify` — all `scopeType: 'ANY'`), bringing canonical seeded totals to 45 permissions (41 pre-Prompt-31 + 4 Prompt-31), 6 canonical roles, and 99 canonical `role_permissions` mappings (88 pre-Prompt-31 + 11 Prompt-31: `system_admin` 45, `content_manager` 31, `content_reviewer` 12, `contributor` 5, `verified_teacher` 4, `standard_user` 2).
  * Hardened `seedRolesAndPermissions` fast-path to verify canonical mapping count (`>= 99`), `ACTIVE` status on milestone permissions, and all 11 Prompt-31 role-permission mappings (reactivating `INACTIVE` canonical permissions on re-seed after rollback).
  * Enforced strict separation of duties: `content_reviewer` receives read-only permissions (`admin.dashboard.read`, `resource.admin.read`, `file.admin.read`) while `file.admin.verify` is withheld.
  * Added `resolvePermissionAccess(userId, permissionName)` enforcing `GLOBAL` vs `COUNTRY` scope resolution across `GLOBAL`, `ANY`, and `SCOPED` permissions and failing closed (`granted: false`) when a user holds only `SCHOOL` or `RESOURCE`-scoped grants.
- Canonical 6-Flag Attention Engine (`src/services/admin-attention.ts`):
  * Implemented shared SQL select/where/row-mapping helpers for the 6 operational attention flags (`PENDING_REVIEW`, `APPROVED_AWAITING_PUBLISH`, `PUBLISHED_WITHOUT_AVAILABLE_FILE`, `IN_REVIEW_WITHOUT_CANDIDATE_VERSION`, `HAS_PROBLEMATIC_FILES`, `HAS_OPEN_DEFECT_FEEDBACK`; `NO_VERSIONS` excluded per Revision 4) with explicit table qualification (`"content"."resources"."id"`, `"content"."resources"."status"`).
  * Guaranteed 4-way cross-endpoint parity across overview counts, resource list/filter queries, review queue items, and resource detail payloads, including resources with multiple overlapping flags.
- Centralized Admin Dashboard Service (`src/services/admin-dashboard.service.ts`):
  * Implemented `DefaultAdminDashboardService` covering operational overview metrics (with sub-permission section gating and `scope.redactedSections` reporting), admin resource inventory listing/filtering, comprehensive admin resource detail (versions, sanitized files, taxonomy, provenance, quality checks, verification history, feedback summary, publication events), editorial review queue, cross-resource admin publication event ledger, sanitized file listing & detail, and read-only storage integrity verification.
  * Exposed `buildAdminResourcesListQuery` and `buildReviewQueueListQuery` for deterministic SQL plan verification.
  * Implemented per-actor 20 requests/minute sliding-window rate limiter on `verifyFileIntegrity` prior to object-storage `HEAD` calls, preserving strict immutability of `PUBLISHED` resource versions (zero DB mutations).
- Publication Workflow Hardening (`src/services/publication.service.ts` & `src/routes/api/v1/publications.ts`):
  * Added `actorContext` (`actorUserId`, `actorSnapshot`, `requestId`) across all 6 publication lifecycle operations (`submitResourceForReview`, `approveResource`, `rejectResource`, `publishResourceVersion`, `archiveResource`, `returnResourceToDraft`).
  * Enforced `COUNTRY` scope isolation and synchronous transactional `governance.audit_logs` inserts inside `db.transaction(async (tx) => ...)` so audit entries commit or roll back atomically with resource/version state transitions.
  * Preserved Prompt 14 `GET /api/v1/resources/:id/events` (`resource.read`) backward compatibility while introducing dedicated admin `GET /api/v1/admin/resources/:id/events` (`resource.admin.read` + `COUNTRY` scope + `Cache-Control: private, no-store`).

Database:
- Additive index-only migration `drizzle/0020_admin_dashboard_indexes.sql` (18 B-tree indexes total) applied to live Neon PostgreSQL and synchronized in `drizzle/meta/_journal.json`, `src/db/schema/resource.ts`, `src/db/schema/files.ts`, and `docs/DATABASE_SPEC.md` Section 45.1 (zero table, column, trigger, or constraint modifications):
  * `content.resources` (11 indexes): `idx_resources_updated_at_id_desc`, `idx_resources_created_at_id_desc`, `idx_resources_lower_title_id_asc`, `idx_resources_country_updated_desc`, `idx_resources_country_created_desc`, `idx_resources_status_updated_desc`, `idx_resources_country_status_updated_desc`, plus 4 partial review-queue indexes (`idx_resources_review_queue_updated_desc`, `idx_resources_review_queue_created_desc`, `idx_resources_country_review_queue_updated_desc`, `idx_resources_country_review_queue_created_desc` `WHERE "status" IN ('IN_REVIEW', 'APPROVED')`) supporting both `DESC` and backward-scan `ASC` ordering with zero `Sort` plan nodes.
  * `content.publication_events` (3 indexes): `idx_pub_events_created_id_desc`, `idx_pub_events_type_created_id_desc`, `idx_pub_events_resource_created_id_desc`.
  * `files.resource_files` (4 indexes): `idx_res_files_created_id_desc`, `idx_res_files_updated_id_desc`, `idx_res_files_size_id_desc`, `idx_res_files_status_created_id_desc`.

API:
- Mounted `src/routes/api/v1/admin-dashboard.ts` in `src/app.ts` with `.strict()` Zod query/param/body validation and `Cache-Control: private, no-store` across all 8 Prompt-31 endpoints:
  * `GET /api/v1/admin/dashboard/overview` (`admin.dashboard.read`)
  * `GET /api/v1/admin/resources` (`resource.admin.read`)
  * `GET /api/v1/admin/resources/:id` (`resource.admin.read` + `COUNTRY` scope)
  * `GET /api/v1/admin/publications/review-queue` (`resource.review`)
  * `GET /api/v1/admin/publications/events` (`resource.admin.read`)
  * `GET /api/v1/admin/files` (`file.admin.read`)
  * `GET /api/v1/admin/files/:id` (`file.admin.read` + `COUNTRY` scope)
  * `POST /api/v1/admin/files/:id/verify-integrity` (`file.admin.verify` + `COUNTRY` scope + 20 req/60s/actor rate limit)
- Plus hardened per-resource event split in `src/routes/api/v1/publications.ts`:
  * Preserved `GET /api/v1/resources/:id/events` (`resource.read`)
  * Added `GET /api/v1/admin/resources/:id/events` (`resource.admin.read` + `COUNTRY` scope + `Cache-Control: private, no-store`)

Frontend:
- None (strictly backend-only per Prompt 31 specification).

Tests:
- Prompt-31 dedicated suites (45/45 tests passing):
  * `tests/services/rbac.service.test.ts` (16 passed): `GLOBAL`, `COUNTRY`, `SCHOOL`/`RESOURCE` fail-closed, union grants, expired/inactive exclusions.
  * `tests/services/admin-dashboard.service.test.ts` (12 passed): sub-permission redaction, controlled file DTO sanitization, rate-limit windowing, read-only integrity verification.
  * `tests/db/admin-dashboard.integration.test.ts` (7 passed): all 18 `pg_indexes` verified, RBAC seed verification (45 permissions, 6 roles, 99 canonical mappings, 11 Prompt-31 mappings, and fast-path recovery), 6-flag overlapping attention matrix, 4-way cross-endpoint parity across Country A and Global scopes, live `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` zero-`Sort` verification, and `PUBLISHED` file trigger immutability.
  * `tests/routes/admin-dashboard.integration.test.ts` (10 passed): 401/403 + `DENIED` audit logging across all 8 routes, `content_reviewer` read-only enforcement, `COUNTRY` isolation, `.strict()` parameter validation (including rejection of `NO_VERSIONS`), storage metadata non-leakage, 20 req/min rate limit, transactional publication audit rollback safety, and side-by-side `/resources/:id/events` vs `/admin/resources/:id/events` verification.
- Full repository regression suite: 74/74 test files passed, 810/810 automated tests passed across all shards.

Typecheck:
PASS (`npm run lint` / `tsc --noEmit` — 0 errors)

Build:
PASS (`npm run build` / `tsc -p tsconfig.build.json` & applet compilation — 0 errors)

Security:
- Generic `403 FORBIDDEN` responses with synchronous `DENIED` audit log entries preventing cross-country resource/file IDOR enumeration.
- Zero exposure of `storageBucket`, `objectKey`, `storageMetadata`, or presigned download URLs in any admin response or audit log payload.
- Country scope verified prior to `FileStorageService.verifyFileIntegrity` so out-of-scope actors cannot trigger Cloudflare R2 `HEAD` operations.
- Mandatory `Cache-Control: private, no-store` on all administrative responses.

Rollback & Operational Safety:
- Index rollback: `DROP INDEX IF EXISTS` restricted strictly to the 18 additive index names in `drizzle/0020_admin_dashboard_indexes.sql`.
- RBAC procedures for the 4 Prompt-31-exclusive permissions (`admin.dashboard.read`, `resource.admin.read`, `file.admin.read`, `file.admin.verify`) are explicitly separated into two mutually exclusive options:
  * **Full rollback**: Delete the 11 Prompt-31 `identity.role_permissions` mappings and delete the 4 exclusive `identity.permissions` records (verified safe under `fk_role_permissions_permission_id` `ON DELETE CASCADE`, the sole FK referencing `identity.permissions.id`).
  * **Emergency disablement**: Retain the 4 `identity.permissions` records, remove their 11 Prompt-31 `identity.role_permissions` mappings, and set `status = 'INACTIVE'` on those 4 `identity.permissions` records (`chk_permissions_status` allows `'ACTIVE' | 'INACTIVE'`).
  * Both procedures leave all 41 shared pre-Prompt-31 permissions and their 88 role mappings untouched, and `seedRolesAndPermissions` recovers cleanly (`45` active permissions, `99` mappings) from either state.

Documentation:
- `docs/API_SPEC.md` (Section 52: Centralized Admin Dashboard & Operational Oversight API, including Section 52.5 Rollback Safety Contract)
- `docs/DATABASE_SPEC.md` (Section 45.1–45.2: Admin Dashboard & Review Queue Indexes and Rollback & Emergency Disablement Safety)
- `docs/IMPLEMENTATION_STATUS.md` (Sections 36, 38, 45, and 46 updated; Prompt 31 closed as `VERIFIED`)

Git commit:
- Workspace has no `.git` directory initialized in this environment; create Prompt 31 checkpoint commit when syncing to `Clivendemo/education-platform`.

Issues:
- None.

Next step:
- Prompt 31 closed as `VERIFIED`. Stop and await explicit human authorization before starting Prompt 32 (Homepage Intelligence — currently `NOT_STARTED` and `UNAUTHORIZED`).

## 2026-10-18 — Prompt 27: Telemetry Architecture, Safe Capture, and Analytics Reporting

Status:
VERIFIED

Implemented:
- Database Architecture (drizzle/0016_analytics_architecture.sql & src/db/schema/analytics.ts):
  * `analytics.analytics_event_types`: Event catalog with code format constraint `^[a-z0-9_]{2,32}$`, status checks (`ACTIVE`, `DISABLED`, `ARCHIVED`), and seeded core types (`search`, `view`, `preview`, `download`, `share`, `save`, `feedback`, `calendar_interaction`).
  * `analytics.analytics_events`: Append-only telemetry ledger supporting anonymous, authenticated, and system-originated activity.
  * Integrity Check Invariants: `chk_analytics_events_actor` handles `ON DELETE SET NULL` user deletion without orphaned record invalidation; `chk_analytics_events_context_size` caps JSONB payloads at 4KB.
  * Indexes: Unique index `uq_analytics_events_idempotency` for deduplication; `idx_analytics_events_window`, `idx_analytics_events_country_window`, and `idx_analytics_events_actor_metrics` for query performance.
  * Single Source of Truth: Deferral of `daily_event_aggregates` to prevent dual-state drift and premature partitioning.
- Service Layer (src/services/analytics.service.ts):
  * Path Normalization & Traversal Rejection: Canonical sequence handling origin extraction, query/fragment stripping, percent decoding, slash collapsing, control character rejection, and encoded traversal rejection (`%2e%2e%2f`).
  * Strict Event Context Schemas: Per-event allowlists (`.strict()`) rejecting arbitrary or unknown context keys; search events record SHA-256 query hashes, never raw text.
  * In-Memory Bounded Rate Limiter: Per-replica 120 req/min token bucket with 10,000-key capacity and LRU eviction under key churn.
  * Bounded-Staleness Event Cache: 5-minute TTL, 15-minute stale-while-revalidate fallback under database outages, transitioning to fail-closed rejection.
  * In-Process Invalidation Hook: Immediate local invalidation upon administrative event type updates.
  * Geographic Country Resolver: Cached integration with `GeographyService.getActiveCountryByIdentifier`.
  * Ingestion & Delivery: Synchronous confirmed recording (`recordEvent`) awaiting database write for public endpoints; non-blocking safe capture (`captureSafe`) for background application operations.
  * Mathematical Set Reporting (`getOverviewMetrics`): Evaluates half-open UTC interval `[startDate, endDate)`; calculates `actionCount`, `authenticatedUsers`, `pureAnonymousSessions`, `estimatedActorCount` (safely excluding converted sessions from pure anonymous counts), `downloadUrlIssuedCount`, and `zeroResultRate`. Safely maps large integer counts.
- Fastify Route Handlers (src/routes/api/v1/analytics.ts & src/app.ts):
  * `POST /api/v1/analytics/events`: Public event ingestion with rate limiting, strict validation, and idempotent deduplication.
  * `GET /api/v1/admin/analytics/overview`: Administrative metrics overview requiring `analytics.read`.
  * `GET /api/v1/admin/analytics/event-types` & `PATCH /api/v1/admin/analytics/event-types/:id`: Configuration management requiring `analytics.manage`.
  * Endpoint instrumentation: Integrated non-blocking `captureSafe` into search route (`searchRoutes`) and download token route (`downloadRoutes`).
- RBAC Integration (src/db/seeds/roles-permissions.ts):
  * Seeded canonical permissions `analytics.read` (assigned to `system_admin`, `content_manager`) and `analytics.manage` (assigned to `system_admin`).
- Verification & Test Coverage:
  * 33 automated tests across unit, database integration, and route suites passing cleanly (`tests/services/analytics.service.test.ts`, `tests/db/analytics.integration.test.ts`, `tests/routes/analytics.integration.test.ts`).
  * Exact mathematical fixture test passed: 3 authenticated users + 2 pure anonymous sessions + 1 converted session = 5 estimated actors.
  * `npm run lint`, `npm run typecheck`, and `npm run db:check` passing with zero errors.

## 2026-10-17 — Prompt 26: Multi-Channel Notifications, Transactional Outbox, and Worker Engine

Status:
VERIFIED

Implemented:
- Database Architecture (drizzle/0015_notifications_system.sql & src/db/schema/notifications.ts):
  * `identity.notifications`: Central user notification records with full category check (`TRANSACTIONAL`, `SECURITY`, `EDITORIAL`, `CONTRIBUTOR`, `CURRICULUM_UPDATE`, `MARKETING`), priority check (`LOW`, `NORMAL`, `HIGH`, `URGENT`), and lifecycle invariant `chk_notifications_lifecycle` enforcing atomic transition states (`UNREAD`, `READ`, `ARCHIVED` preserving prior `read_at`). Partial unique index `uq_notifications_user_dedup` on `(user_id, deduplication_key)`.
  * `identity.notification_deliveries`: Transactional outbox ledger with strict multi-state check invariant `chk_deliveries_invariants` covering `PENDING`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`, and `SKIPPED`. Concurrency index `idx_deliveries_queue` on `(status, next_retry_at)`.
  * `identity.user_notification_preferences`: Delivery channel preference store (`email_enabled`, `marketing_email_enabled`, `in_app_enabled`) with `uq_user_notification_preferences_user` unique index.
- Provider Interfaces & Mock Implementations (src/services/notifications/):
  * `NotificationDeliveryProvider` interface with contract for multi-channel dispatch.
  * `MockEmailDeliveryProvider` and `MockSmsDeliveryProvider` supporting realistic latency simulation and deterministic failure injection for testing.
- Service Layer (src/services/notification.service.ts):
  * `dispatch`: Atomic transaction insertion for notification records, idempotency resolution for duplicate deduplication keys, synchronous in-app delivery execution (`attempt_count = 0`, status `DELIVERED`), mandatory category opt-out bypass (`TRANSACTIONAL`, `SECURITY`), and outbox queuing for external channels (`EMAIL`, `SMS`).
  * `listUserNotifications` & `getUnreadCount`: User inbox pagination, status/category filtering, and unread counts.
  * `markAsRead`, `markAllAsRead`, `archiveNotification`: User lifecycle operations with strict IDOR protections (cross-user access returns 404).
  * `getUserPreferences` & `updateUserPreferences`: Channel preference retrieval with default fallback and update logic.
  * `processPendingDeliveries`: Concurrency-safe worker engine utilizing `FOR UPDATE SKIP LOCKED`, exponential backoff (`Math.min(maxBackoff, baseBackoff * 2^(attempt - 1))`), retry budget enforcement, and stale-lease recovery identifying abandoned `PROCESSING` leases past timeout and returning them safely to `PENDING`.
  * `listAdminDeliveries`: Staff audit trail with channel and status filtering.
- Fastify Route Handlers (src/routes/api/v1/notifications.ts):
  * User routes mounted under `/api/v1/me/notifications` and `/api/v1/me/notification-preferences`.
  * Admin audit queue mounted at `GET /api/v1/admin/notifications` (requires `notification.admin.read`).
  * Worker trigger sweep mounted at `POST /api/v1/admin/notifications/process-pending` (requires `notification.admin.manage`).
- RBAC Integration (src/db/seeds/roles-permissions.ts):
  * Seeded canonical permissions `notification.admin.read` (mapped to `system_admin`, `content_manager`) and `notification.admin.manage` (mapped exclusively to `system_admin`).
- Testing & Verification (tests/db/notifications.integration.test.ts & tests/routes/notifications.integration.test.ts):
  * 37 integration tests verifying database check constraints, lifecycle invariants, synchronous in-app delivery, preference suppression, mandatory opt-out bypass, deduplication idempotency, worker claiming, retry backoff, terminal failure, stale lease recovery, and RBAC authorization matrices.

## 2026-10-15 — Prompt 25: Resource Feedback, Public Summary, and Triage Audit Ledger

Status:
VERIFIED

Implemented:
- Database Architecture (drizzle/0013_resource_feedback.sql, drizzle/0014_feedback_details_limit.sql & src/db/schema/feedback.ts):
  * `content.resource_feedback`: Stores structured feedback bound to published resources and versions. Foreign keys to `content.resources` and `content.resource_versions` with `ON DELETE RESTRICT`. Exactly one identity enforced via `chk_feedback_exactly_one_identity` (either `user_id` is set OR `session_id` is set). Controlled status (`chk_feedback_status`), category (`chk_feedback_type`), and detail length constraint `chk_feedback_details_len` (<= 1000 characters).
  * `content.resource_feedback_events`: Immutable append-only audit ledger recording triage transitions (`from_status`, `to_status`, `actor_user_id`, `internal_note`, `created_at`).
  * Triggers:
    - `trg_check_feedback_version_match`: Validates that version belongs to resource and both version and resource are `PUBLISHED`.
    - `trg_prevent_feedback_events_update` and `trg_prevent_feedback_events_delete`: Enforces append-only immutability.
- RBAC Permissions (src/db/seeds/roles-permissions.ts):
  * Added canonical permissions `feedback.read` and `feedback.manage`.
  * Mapped to `system_admin`, `content_manager`, and `content_reviewer` (read-only; triage strictly 403 Forbidden).
- Service Layer (src/services/feedback.service.ts):
  * `submitFeedback`: Anonymous cookie generation/hashing, 1-hour duplicate cooldown scoped to identity + version + category via `pg_advisory_xact_lock`.
  * `getPublicSummary`: Exposes strictly aggregate metrics (`totalFeedback`, `helpfulCount`) with zero leakage of defect categories or notes, strictly excluding dismissed (`REJECTED`) feedback.
  * `listFeedbackQueue`: Staff queue with pagination and filters (`feedback.read`).
  * `getFeedbackById`: Staff detail with complete audit history events (`feedback.read`).
  * `triageFeedback`: Transition lifecycle with validation and atomic audit events write (`feedback.manage`).
- Fastify Route Handlers (src/routes/api/v1/feedback.ts):
  * `POST /api/v1/resources/:id/feedback`: Enforces 1000-character details limit, anonymous session hashing, cooldown, and publication checks.
  * `GET /api/v1/catalogue/resources/:id/feedback-summary`: Public aggregate summary excluding dismissed feedback.
  * `GET /api/v1/admin/feedback`
  * `GET /api/v1/admin/feedback/:id`
  * `PATCH /api/v1/admin/feedback/:id/triage`
- Tests:
  * `tests/routes/feedback.integration.test.ts`: 24 tests covering anonymous/authenticated submissions, 7 categories, 1000-char details limit enforcement, publication integrity, duplicate cooldown, public summary with dismissal exclusion, RBAC access control, triage transitions, and DB triggers.
  * `tests/db/feedback.integration.test.ts`: 7 tests covering DB constraints (including `chk_feedback_details_len` <= 1000), triggers, and foreign key ON DELETE RESTRICT.
- Typecheck & Build:
  * TypeScript typecheck: PASS (0 errors)
  * Build: PASS

## 2026-10-08 — Prompt 20: Premium Downloads & Authoritative Entitlement Verification

Status:
VERIFIED

Implemented:
- Extended `DefaultDownloadService` (`src/services/download.service.ts`):
  * Preserved anonymous downloads for eligible free resources (`qualityLabel !== 'PREMIUM'`).
  * Enforced authentication requirement for premium resources (`qualityLabel === 'PREMIUM'`).
  * Implemented server-side authoritative entitlement validation against `commerce.entitlements`:
    - Ownership (`user_id = userId`)
    - Resource specificity (`resource_id = resourceId`)
    - Status (`status = 'ACTIVE'`)
    - Temporal validity window (`starts_at <= now` AND `(ends_at IS NULL OR ends_at > now)`)
    - Non-revoked state (`revoked_at IS NULL`)
  * Pre-storage gating: unauthenticated or unentitled requests immediately reject with HTTP 403 `PREMIUM_RESOURCE_LOCKED` with zero storage provider calls.
  * Preserved publication invariants: resource status must be `PUBLISHED` and active published version must exist (`404 RESOURCE_NOT_FOUND`).
  * Preserved file availability check: only files with `status = 'AVAILABLE'` can be downloaded (`400 FILE_NOT_AVAILABLE`).
  * Preserved deterministic primary file selection when `fileId` is omitted.
  * Presigned download URLs generated with default 300-second (5 minute) TTL.
  * Internal storage metadata (object keys, buckets, provider identifiers) strictly omitted from response payloads.
- Route integration (`src/routes/api/v1/downloads.ts`):
  * Session token extracted from cookie (`session_token`) via `authService.validateSession` and `request.user?.id`.
  * Non-blocking anonymous access preserved for free resources; unauthenticated requests for premium resources safely mapped to 403 `PREMIUM_RESOURCE_LOCKED`.
- Tests:
  * `tests/services/download.service.test.ts`: Added unit tests covering unauthenticated premium download rejection, unentitled rejection, expired/revoked entitlement rejection, valid active entitlement download, draft resource rejection, and quarantined file rejection.
  * `tests/db/downloads.integration.test.ts`: Added database integration tests with live PostgreSQL verifying entitlement lifecycle, temporal validity, and publication constraints.
  * `tests/routes/downloads.integration.test.ts`: Added route integration tests verifying unauthenticated access (403), unentitled access (403), expired entitlement (403), resource-specific isolation (403), valid entitlement download (200 OK), explicit file download (200 OK), and storage credential privacy.
- Typecheck, Lint & Build:
  * PASS (zero errors)

## 2026-10-01 — Prompt 13: Core Authentication & Server-Side Sessions

Status:
VERIFIED

Implemented:
- Implemented core identity database architecture in PostgreSQL / Neon via migration `drizzle/0007_identity_authentication.sql`:
  * `identity.users`: central user entity with UUID PK, lowercase email uniqueness constraint (`uq_users_active_email` on active non-deleted rows), status check constraint (`ACTIVE`, `SUSPENDED`, `DISABLED`, `PENDING_VERIFICATION`), and soft-deletion timestamp (`deleted_at`).
  * `identity.auth_identities`: decoupled authentication credentials with `LOCAL_PASSWORD` provider, `provider_subject` unique constraint, and Argon2id `password_hash`.
  * `identity.user_sessions`: server-side session persistence with `token_hash` unique constraint (SHA-256), `expires_at`, `revoked_at`, and `device_metadata`.
- Created `DefaultAuthService` (`src/services/auth.service.ts`) enforcing all approved security requirements and human reviewer corrections:
  * Atomic transactional registration: `identity.users` -> `identity.auth_identities` -> `identity.user_sessions` created in a single DB transaction.
  * Race-safe duplicate email handling: DB uniqueness constraint is authoritative, mapping PostgreSQL code `23505` to `409 EMAIL_ALREADY_REGISTERED`.
  * Account deletion & lifecycle status enforcement: every authenticated check verifies `deleted_at IS NULL` AND `status = 'ACTIVE'`. Logically deleted, suspended, or disabled accounts immediately reject login and invalidate active sessions.
  * Constant-time login failure mitigation: dummy Argon2id hash verification executes when user is not found, defeating email enumeration timing side-channels.
  * High-entropy 256-bit CSPRNG session token: browser receives token via `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`session_token`); database exclusively persists `SHA-256(token)`. No cookie signing secret required.
  * Zero token leakage in logs: raw tokens, token hashes, and cookies are omitted from response bodies and redacted in application logs (`server.ts`).
- Created Fastify route handlers (`src/routes/api/v1/auth.ts`):
  * `POST /api/v1/auth/register`: 201 Created on registration with HttpOnly session cookie and standardized data envelope.
  * `POST /api/v1/auth/login`: 200 OK with fresh session cookie; generic 401 `INVALID_CREDENTIALS` on bad credentials.
  * `POST /api/v1/auth/logout`: 200 OK, server-side session revocation (`revoked_at`), and session cookie clearing.
  * `GET /api/v1/auth/me`: 200 OK with current user profile for valid session cookies; 401 `UNAUTHENTICATED` otherwise. Strictly cookie-based (Bearer auth rejected per contract).
  * Exported `createRequireAuth` preHandler hook for securing future authenticated routes.
- Integrated `@fastify/cookie` and `authRoutes` into `buildApp()` in `src/app.ts`.

Contract Reconciliation:
- Cookie Name / Default: Standardized on default `session_token`, configurable via `SESSION_COOKIE_NAME` in `src/config/env.ts` and `.env.example`.
- Bearer Authentication: Removed Authorization Bearer header extraction in `extractSessionToken`. Per API_SPEC Section 2 and SECURITY_RULES Section 11, authentication is strictly cookie-based (`HttpOnly`), preventing client-side token storage in JavaScript (XSS mitigation).
- Reconciled `PENDING_VERIFICATION`: Formally documented controlled user statuses (`ACTIVE`, `SUSPENDED`, `DISABLED`, `PENDING_VERIFICATION`) in `docs/DATABASE_SPEC.md` Section 15.1, aligning the specification with database check constraint `chk_users_status` while preserving decoupled email verification on `identity.auth_identities.email_verified_at` per SECURITY_RULES Section 10.
- Reconciled `UNAUTHENTICATED`: Adopted `UNAUTHENTICATED` as the canonical stable machine-readable error code for HTTP 401 responses across `src/services/auth.service.ts`, `src/routes/api/v1/auth.ts`, `tests/routes/auth.test.ts`, and `docs/API_SPEC.md`.

Database:
- Migration `drizzle/0007_identity_authentication.sql` applied to live Neon PostgreSQL database.
- Integrity constraints, partial unique index on active emails, and foreign keys verified.

Tests:
- `tests/routes/auth.test.ts`: Route unit tests (12 passed) covering 201 registration, validation failures (400), duplicate email rejection (409), login flows (200/401), logout cookie clearing (200), and /me authentication (200/401).
- `tests/db/auth.integration.test.ts`: Live Neon DB integration tests (11 passed) verifying transactional atomicity, race conditions, Argon2id verification, session hashing, session revocation, and all mandatory reviewer checks (deleted accounts, suspended accounts, disabled accounts).
- Full regression suite: 24 test files passed, 257 tests passed.

Typecheck & Build:
PASS (zero errors)


## 2026-09-30 — Prompt 12: Public Resource SEO & OpenGraph Layer

Status:
VERIFIED

Implemented:
- Added `CANONICAL_DOMAIN` and `SITE_NAME` configuration in `src/config/env.ts` and `.env.example`:
  * `CANONICAL_DOMAIN`: trailing slash normalization, localhost default for dev/test, strict non-localhost public domain requirement in production.
  * `SITE_NAME`: validated platform brand name (default: `'ElimuPin'`) injected into `DefaultSeoService` for `og:site_name` metadata generation without hard-coded literals.
- Created `DefaultSeoService` (`src/services/seo.service.ts`) generating authoritative `ResourceSeoMetadata` DTOs:
  * Deterministic canonical URL construction: `https://<CANONICAL_DOMAIN>/<countryUrlPrefix>/resources/<slug>`.
  * OpenGraph metadata: `og:title`, `og:description`, `og:url`, `og:type = 'article'`, `og:site_name`, `og:locale`.
  * Twitter / X card metadata: `twitter:card = 'summary'`, `twitter:title`, `twitter:description`.
  * Robots indexing directive: `{ index: true, follow: true }`.
  * Authoritative fallback description derivation from resource title, resource type, grade, subject, curriculum, and country without keyword stuffing.
- Created Fastify route handler `GET /api/v1/seo/resources/:id` (`src/routes/api/v1/seo.ts`) enforcing UUID parameter validation (`INVALID_ID_FORMAT`) and returning standardized JSON envelope.
- Integrated `seoRoutes` and `seoService` into `buildApp()` in `src/app.ts`.
- Zero storage credentials, R2 buckets, internal file paths, or private metadata leaked.

Database:
- No database migrations required; derives from authoritative tables: `content.resources`, `content.resource_versions`, `platform.countries`, `content.resource_types`, and curriculum taxonomy.
- Strict publication boundary verified: `content.resources.status = 'PUBLISHED'` AND `content.resource_versions.status = 'PUBLISHED'`.
- Draft and historical versions strictly isolated.

Tests:
- `tests/routes/seo.test.ts`: Route unit tests (4 passed) verifying 200 OK responses, UUID parameter validation, 404 for unfindable resources, request ID propagation, and zero storage credential leakage.
- `tests/db/seo.integration.test.ts`: Live Neon DB integration tests (4 passed) verifying published resource SEO generation, lifecycle status boundaries (`DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `ARCHIVED`), draft version isolation, and deterministic fallback descriptions.

Typecheck:
PASS

Build:
PASS

Documentation:
- `docs/API_SPEC.md`: Section 16.1 Public Resource SEO API added.
- `docs/IMPLEMENTATION_STATUS.md`: Section 17 SEO updated to VERIFIED.

Next step:
- Await human review for Prompt 12.

## 2026-09-25 — Prompt 09: File Storage (Cloudflare R2 + PostgreSQL/Neon)

Status:
VERIFIED

Implemented:
- Provider-neutral StorageProvider abstraction (PutObject, HeadObject, GetObject, DeleteObject, ObjectExists)
- CloudflareR2StorageProvider using AWS S3 client (@aws-sdk/client-s3) with S3-compatible R2 endpoint
- MemoryStorageProvider for offline deterministic unit/integration testing
- UUID-derived object key generator: resources/{resource_id}/versions/{version_id}/{file_id}.ext (original filename is NEVER in R2 key)
- Filename sanitization stripping paths, directory traversal, null bytes, control characters
- Synchronous upload flow in FileStorageService:
  * Local SHA-256 computation
  * R2 putObject with sha256-checksum metadata
  * R2 headObject verification: compares content length and round-tripped sha256-checksum metadata
  * Compensating cleanup (R2 deleteObject) on verification mismatch or DB failure
  * Persists as AVAILABLE only after full verification
- Controlled file deletion interface (restricted to non-published versions)

Database:
- Migration drizzle/0006_file_storage.sql applied to managed Neon PostgreSQL
- files.resource_files table with approved metadata names: object_key, file_extension, file_size_bytes
- Restored storage_metadata JSONB column for provider/scanner metadata
- Restored QUARANTINED file lifecycle status for quarantine/antivirus pipelines
- Added check constraint chk_resource_files_storage_provider ('CLOUDFLARE_R2', 'AWS_S3', 'MEMORY')
- Added unique constraint uq_resource_files_version_checksum (resource_version_id, checksum_sha256)
- Constraints: chk_resource_files_file_size_bytes, chk_resource_files_file_extension, chk_resource_files_object_key, chk_resource_files_sha256, chk_resource_files_status, chk_resource_files_sequence_order, chk_resource_files_file_type, chk_resource_files_storage_provider
- Partial unique index uq_resource_files_primary_version enforcing single primary file per version
- Composite unique constraint uq_resource_files_version_seq
- Unique constraint uq_resource_files_bucket_key on (storage_bucket, object_key)
- Publication invariant PL/pgSQL triggers:
  * trg_prevent_published_resource_file_insert
  * trg_prevent_published_resource_file_delete
  * trg_prevent_published_resource_file_update (checks both OLD and NEW version status; prohibits altering, deleting, moving out of, or moving into a PUBLISHED version)

Tests:
- tests/db/file-storage.trigger.test.ts: Direct SQL tests verifying triggers, legitimate DRAFT mutations, and constraints
- tests/services/storage-provider.test.ts: Unit tests for file keys, sanitization, and storage provider semantics
- tests/services/file-storage.service.test.ts: Synchronous upload, SHA-256 verification, compensating cleanup on corrupt headObject, compensating cleanup on DB error, and lifecycle

Typecheck:
PASS

Build:
PASS

Documentation:
- docs/FILE_STORAGE_ARCHITECTURE.md
- docs/IMPLEMENTATION_STATUS.md updated

Next step:
- Await human review for Prompt 09.

Format:

```text
## YYYY-MM-DD — Task Name

Status:
IMPLEMENTED / VERIFIED / BLOCKED / etc.

Implemented:
- ...

Database:
- ...

API:
- ...

Frontend:
- ...

Tests:
- ...

Typecheck:
PASS / FAIL

Build:
PASS / FAIL

Security:
- ...

Documentation:
- ...

Git commit:
- ...

Issues:
- ...

Next step:
- ...
```

Do not fabricate entries.

---

# 47. Current Blockers

No implementation blockers are currently recorded.

When a blocker appears, document:

```text
## Blocker

Date:
Area:
Description:
Why blocked:
Required decision/dependency:
Impact:
Temporary workaround:
```

Do not silently work around an architectural blocker.

---

# 48. Known Risks

Known risks must be recorded here rather than hidden.

Initial risks:

### Risk 1 — Scope

The platform is large.

Mitigation:

Implement bounded modules sequentially.

### Risk 2 — Vibe-coding drift

AI coding agents may introduce architecture that conflicts with specifications.

Mitigation:

Use `AI_DEVELOPER_RULES.md`, bounded prompts and mandatory reports.

### Risk 3 — Database redesign

ORM-driven development can unintentionally change the approved database architecture.

Mitigation:

Explicit SQL migrations remain authoritative.

### Risk 4 — Premature infrastructure

Installing services before they are required can create unnecessary cost and complexity.

Mitigation:

Introduce infrastructure only when a defined implementation phase requires it.

### Risk 5 — Security shortcuts

Security controls may be bypassed during rapid development.

Mitigation:

Security is defined before implementation and receives a dedicated audit phase.

### Risk 6 — Feature incompleteness

A visible frontend feature may appear complete while backend/business logic remains incomplete.

Mitigation:

A feature is not `VERIFIED` until implementation, tests, typecheck and build pass.

---

# 49. Implementation Rules

The coding agent must:

1. Work on one bounded task at a time.
2. Read relevant specifications before coding.
3. Inspect the existing implementation first.
4. Identify affected files.
5. Identify database impact.
6. Identify API impact.
7. Identify security impact.
8. Implement only the requested scope.
9. Avoid unrelated refactoring.
10. Run relevant tests.
11. Run the full required test suite where appropriate.
12. Run typecheck.
13. Run build.
14. Update this document.
15. Report what changed.
16. Report what was tested.
17. Report failures honestly.
18. Create a Git checkpoint when the task is complete.
19. Stop.

---

# 50. No False Completion

The coding agent must never mark a component:

```text
VERIFIED
```

because:

* the endpoint returns hardcoded data
* the UI contains a placeholder
* a mock provider was used without documenting it
* the database table exists but business logic does not
* the frontend button exists
* tests are missing
* tests were skipped
* typecheck fails
* build fails
* authorization is missing
* security requirements are incomplete

---

# 51. Mock Implementations

Mocks are permitted only when explicitly required by the current implementation task.

Examples:

* mock payment provider during commerce development
* mock email provider during notification development
* local storage adapter during file-storage development

Mocks must be clearly identified.

A mock must never be represented as a production integration.

---

# 52. Definition of Verified

A feature may be marked:

```text
VERIFIED
```

only when:

```text
Specification checked
        ↓
Implementation complete
        ↓
Database correct
        ↓
API correct
        ↓
Frontend correct where applicable
        ↓
Authorization correct
        ↓
Tests pass
        ↓
Typecheck passes
        ↓
Build passes
        ↓
Security checked
        ↓
Documentation updated
        ↓
Git checkpoint
        ↓
VERIFIED
```

---

# 53. Change History

Use this section for significant status-document changes.

## Initial Version

Status document created as part of the project specification foundation.

No production implementation has been verified yet.

---

# 54. Final Rule

This document must remain honest.

It is better for the project to show:

```text
NOT_STARTED
```

than to falsely show:

```text
VERIFIED
```

The platform's development process prioritizes:

**Correctness → Security → Data Integrity → Maintainability → Performance → Accessibility → SEO → UX → Cost → Speed**

Raw development speed must never override these priorities.
