# API SPECIFICATION

**Project:** Kenya-first Education Resource Platform
**Document:** API Specification
**Status:** Locked Foundation Specification
**Version:** 1.0

---

## 1. Purpose

This document defines the backend API contract for the education-resource platform.

The API must:

* serve the public website
* serve authenticated user experiences
* serve the admin application
* support contributor workflows
* support commerce and payments
* support calendar functionality
* support analytics and governance
* remain independent of any particular frontend framework
* remain usable if a mobile application is introduced later

The API is a service boundary.

Frontend applications must not directly access PostgreSQL.

---

# 2. API Architecture

The backend uses:

* Node.js
* TypeScript
* Fastify
* PostgreSQL
* Drizzle ORM
* Zod
* secure cookie-based sessions
* Redis-compatible background-job infrastructure where required
* object storage through `StorageProvider`
* payment providers through `PaymentProvider`
* email through `EmailProvider`
* SMS through `SmsProvider`
* search through `SearchProvider`
* PDF generation through `PdfProvider`
* optional AI services through `AiProvider`

The backend is a **modular monolith**.

The API must not expose internal database implementation details.

---

# 3. API Versioning

All public API endpoints must use:

```text
/api/v1/
```

Example:

```text
GET /api/v1/resources
```

Future breaking API changes must use a new version:

```text
/api/v2/
```

Existing API versions must remain stable according to the platform's compatibility policy.

Do not silently introduce breaking changes into `/api/v1`.

---

# 4. API Design Principles

The API must be:

* predictable
* explicit
* validated
* secure
* versioned
* idempotent where required
* pagination-aware
* authorization-aware
* provider-independent
* frontend-independent

The API must not:

* expose database passwords
* expose storage credentials
* expose internal SQL
* expose private audit information
* expose private analytics
* expose payment-provider secrets
* expose internal moderation notes
* expose private user information
* trust frontend authorization claims
* rely on frontend validation alone

All important authorization decisions occur server-side.

---

# 5. Response Format

Successful responses should use a consistent structure.

Example:

```json
{
  "data": {},
  "meta": {}
}
```

Collection response:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

The exact pagination implementation may evolve, but it must remain consistent across endpoints.

---

# 6. Error Format

All API errors must use a consistent structure.

Example:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found.",
    "requestId": "..."
  }
}
```

Production error responses must not expose:

* stack traces
* SQL
* database structure
* filesystem paths
* secrets
* internal provider responses
* security-sensitive implementation details

Errors must have stable machine-readable codes.

Human-readable messages may change without changing the error code.

---

# 7. HTTP Status Codes

Use appropriate HTTP status codes.

### `200 OK`

Successful retrieval or update.

### `201 Created`

Successful creation.

### `202 Accepted`

Accepted for asynchronous processing.

### `204 No Content`

Successful operation with no response body.

### `400 Bad Request`

Malformed request.

### `401 Unauthorized`

Authentication required or authentication invalid.

### `403 Forbidden`

Authenticated but not authorized.

### `404 Not Found`

Requested resource does not exist or is intentionally hidden.

### `409 Conflict`

State conflict or duplicate operation.

### `422 Unprocessable Entity`

Validation failure where appropriate.

### `429 Too Many Requests`

Rate limit exceeded.

### `500 Internal Server Error`

Unexpected server error.

---

# 8. Request IDs

Every API request must receive a request ID.

The request ID must:

* be generated if absent
* be accepted from a trusted incoming request identifier where appropriate
* appear in logs
* appear in error responses
* help administrators trace failures

Example header:

```text
X-Request-ID
```

---

# 9. Authentication Model

Public browsing does not require authentication.

Authentication is required for operations involving:

* personal persistence
* purchases
* premium entitlements
* saved resources
* persistent calendar
* contributor workspace
* administrative functions
* other identity-dependent operations

Authentication must use secure server-managed sessions.

### Session Cookie Contract
* The session token is transmitted exclusively via an `HttpOnly` cookie.
* Cookie name: `session_token` (default, configurable via environment variable `SESSION_COOKIE_NAME`).
* Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (in production).
* Transport policy: Session authentication is strictly cookie-based. Authorization `Bearer` headers are not accepted for web user sessions, preventing client-side token storage in JavaScript storage mechanisms (`localStorage`/`sessionStorage`) and eliminating XSS exfiltration vectors.
* Machine-readable 401 error code: Unauthenticated requests to protected endpoints return HTTP 401 with standardized error code `UNAUTHENTICATED`.

The frontend must not be trusted to determine whether a user is authenticated.

---

# 10. Public API

## 10.1 Countries

```text
GET /api/v1/countries
GET /api/v1/countries/:countrySlug
```

Used for:

* country discovery
* country-aware browsing
* future Africa expansion

---

# 11. Geography API

```text
GET /api/v1/geography/areas
GET /api/v1/geography/areas/:id
GET /api/v1/geography/children/:id
```

Supports configurable geography.

The API must not hardcode Kenya's hierarchy into frontend logic.

---

# 12. Schools API

Public:

```text
GET /api/v1/schools
GET /api/v1/schools/:slug
GET /api/v1/schools/:slug/resources
```

Authenticated school-management operations must use authorization checks.

Admin operations:

```text
POST /api/v1/admin/schools
PATCH /api/v1/admin/schools/:id
POST /api/v1/admin/schools/:id/verify
POST /api/v1/admin/schools/:id/archive
```

Physical deletion is not the normal school lifecycle.

---

# 13. Curriculum API

Public:

```text
GET /api/v1/curricula
GET /api/v1/curricula/:slug
GET /api/v1/curricula/:slug/versions
GET /api/v1/curriculum-versions/:id
GET /api/v1/curriculum-versions/:id/levels
GET /api/v1/education-levels/:id/grades
GET /api/v1/grades/:id/pathways
GET /api/v1/subjects
GET /api/v1/topics
```

Curriculum relationships must follow:

```text
Country
→ Curriculum
→ Curriculum Version
→ Education Level
→ Grade/Form
→ Pathway
→ Subject
→ Topic
```

The API must not invent curriculum relationships.

---

# 14. Resource API

Resources are the central content entity.

Public:

```text
GET /api/v1/resources
GET /api/v1/resources/:slug
GET /api/v1/resources/:slug/preview
GET /api/v1/resources/:slug/related
GET /api/v1/resources/:slug/collections
GET /api/v1/resources/:slug/versions
```

The permanent resource identity is the internal UUID.

The public slug is not the permanent identity.

---

# 15. Resource Listing

```text
GET /api/v1/resources
```

Supported query parameters may include:

```text
q
country
curriculum
curriculumVersion
level
grade
pathway
subject
topic
resourceType
academicYear
academicPeriod
language
quality
access
sort
page
pageSize
```

Example:

```text
GET /api/v1/resources?q=photosynthesis&grade=form-3&subject=biology
```

The API must validate all query parameters.

Unknown or unsupported parameters should not silently alter business logic.

---

# 15.1. Public Catalogue API

The Public Catalogue provides read-only anonymous discovery of strictly published educational resources.

### Visibility Invariants
1. `content.resources.status = 'PUBLISHED'`
2. `content.resource_versions.status = 'PUBLISHED'`
3. Exactly one published version is selected per resource (`uq_resource_single_published_version`).
4. Historical and draft versions are excluded.
5. Resources without attached files remain discoverable; when attached files are present, only those with `status = 'AVAILABLE'` are presented. Zero storage secrets or R2 credentials are leaked.

### List Catalogue Resources
```text
GET /api/v1/catalogue/resources
```

Supported Query Parameters:
* `country` (string, e.g. `ke`, `tz`, or UUID)
* `resourceType` (string, e.g. `past-papers`, or UUID)
* `curriculum` (string, code or UUID)
* `curriculumVersion` (string, slug, versionCode, or UUID)
* `educationLevel` (string, code or UUID)
* `grade` (string, code or UUID)
* `pathway` (string, code or UUID)
* `subject` (string, code or UUID)
* `topic` (string, code or UUID)
* `school` (string, school code or UUID)
* `academicYear` (integer, 1970–2100)
* `term` (integer, 1, 2, or 3)
* `quality` (`STANDARD` | `VERIFIED` | `PREMIUM`)
* `sort` (`newest` | `oldest` | `title`, default: `newest`)
* `page` (integer >= 1, default: 1)
* `pageSize` (integer 1..100, default: 20)

### Catalogue Resource Detail
```text
GET /api/v1/catalogue/resources/:id
```
Returns 200 with full catalogue presentation and public file metadata if published; returns 404 if unpublished or not found.


---

# 16. Resource Search

Search provides public discovery over published educational resources using the `SearchProvider` abstraction.

Initial backend provider:
```text
PostgreSQLSearchProvider (PostgreSQL Full-Text Search)
```

The public API and application services interact exclusively through `SearchService` and `SearchProvider`. The PostgreSQL FTS implementation is an internal provider detail.

### Canonical Endpoints
```text
GET /api/v1/search/resources?q=photosynthesis
GET /api/v1/search?q=photosynthesis
```
*(Both endpoints route to the exact same canonical search logic.)*

### Query Parameters
* `q`: **Required** string, minimum 1 character (trimmed). Missing, empty, or whitespace-only queries are rejected with `400 VALIDATION_ERROR`.
* `country` (string, e.g. `ke`, `tz`, or UUID)
* `resourceType` (string, slug, code, or UUID)
* `curriculum` (string, code or UUID)
* `curriculumVersion` (string, slug, versionCode, or UUID)
* `educationLevel` (string, code or UUID)
* `grade` (string, code or UUID)
* `pathway` (string, code or UUID)
* `subject` (string, code or UUID)
* `topic` (string, code or UUID)
* `school` (string, school code or UUID)
* `academicYear` (integer, 1970–2100)
* `term` (integer, 1, 2, or 3)
* `quality` (`STANDARD` | `VERIFIED` | `PREMIUM`)
* `page` (integer >= 1, default: 1)
* `pageSize` (integer 1..100, default: 20)

### Public Visibility & Version Isolation Invariants
1. `content.resources.status = 'PUBLISHED'`
2. `content.resource_versions.status = 'PUBLISHED'`
3. Exactly one published version participates in search (`uq_resource_single_published_version`). Unreleased draft or historical iterations are strictly isolated and not searched.
4. Metadata-only resources (zero attached files) remain discoverable.
5. When files are present, only files with `status = 'AVAILABLE'` are counted/projected. Zero storage buckets, object keys, storage providers, storage metadata, signed URLs, or R2 credentials are leaked.
6. Zero R2 calls occur during search discovery.

### Relevance Ranking & Deterministic Sorting
* Scored via PostgreSQL Cover Density: `ts_rank_cd(document_tsvector, websearch_to_tsquery('english', :q))`.
* Weighted document: Weight A (`resources.title`), Weight B (`resources.description`), Weight C (`subjects.name`, `topics.name`, `grades.name`, `curricula.name`, `schools.name`, `resource_types.name`).
* Safe parsing via `websearch_to_tsquery('english', :q)` supporting boolean phrases and negation without SQL injection risk.
* Deterministic secondary tie-breaker: `rank DESC, resources.id ASC`.


---

# 16.1. Public Resource SEO API

The SEO metadata service generates authoritative, machine-readable OpenGraph and Twitter/X card metadata for publicly discoverable resources, supporting future frontend SSR, static site generation, and social share unfurling.

### Canonical Endpoint
```text
GET /api/v1/seo/resources/:id
```
*(The `:id` parameter strictly accepts UUIDs matching the established resource API identifier conventions.)*

### Visibility Invariants
1. `content.resources.status = 'PUBLISHED'`
2. `content.resource_versions.status = 'PUBLISHED'`
3. Exactly one published version participates. Draft, in-review, approved, rejected, or archived resources return `404 RESOURCE_NOT_FOUND`.
4. Zero storage credentials, R2 buckets, or object keys are exposed.

### Deterministic Canonical URL Construction
Canonical URLs are constructed from the authoritative configured domain (`CANONICAL_DOMAIN`), the country's unique URL prefix (`/ke/`), and the resource slug:
```text
https://<CANONICAL_DOMAIN>/<countryUrlPrefix>/resources/<slug>
```
Discovery query parameters (`?q=`, `?page=`, `?sort=`, `?subject=`) are strictly excluded from canonical identity.

### Fallback Description Normalization
When a resource or version description is not provided, a deterministic fallback description is assembled from the resource title and authoritative curriculum taxonomy (e.g. `"<Title> - <ResourceType> educational resource for <Grade> <Subject> under <Curriculum> in <Country>."`), preventing keyword stuffing while preserving educational relevance.


---

# 17. Autocomplete API

```text
GET /api/v1/search/autocomplete?q=photo
```

Rules:

* minimum 2 characters
* maximum 5 exact-title suggestions
* text-focused
* typo correction where practical
* controlled abbreviations
* no unnecessary counts
* no recent searches
* no trending data
* no popularity data

Autocomplete should target approximately 250 ms response time under normal conditions.

---

# 18. Search Suggestions / No Results

```text
GET /api/v1/search/related
```

Where a search produces no useful results, the API may return:

* related resources
* alternative terms
* related subjects
* related topics
* request-resource option
* demand-intelligence signal

Internal demand information must not be exposed publicly.

---

# 19. Resource Creation

Administrative/resource-authorized endpoint:

```text
POST /api/v1/resources
```

Creation creates the resource identity.

Resource creation must not automatically publish the resource.

---

# 20. Resource Versions

```text
POST /api/v1/resources/:id/versions
GET /api/v1/resources/:id/versions
GET /api/v1/resources/:id/versions/:versionId
```

Major changes create a new version.

Published versions are immutable.

A resource's permanent UUID remains unchanged across versions.

---

# 21. Resource Classification

Classification operations may include:

```text
PUT /api/v1/resources/:id/classification
```

Classification supports:

* countries
* curricula
* curriculum versions
* grades
* pathways
* subjects
* topics
* resource types

The database remains the source of truth.

---

# 22. Resource Publication

Publication is a controlled workflow.

Internal operations:

```text
POST /api/v1/admin/resources/:id/submit-review
POST /api/v1/admin/resources/:id/approve
POST /api/v1/admin/resources/:id/publish
POST /api/v1/admin/resources/:id/unpublish
POST /api/v1/admin/resources/:id/retire
```

Publication must validate:

* metadata
* classification
* version
* rights
* file readiness
* required quality checks
* required publication fields

Incomplete resources must not be published.

---

# 23. Resource Preview

```text
GET /api/v1/resources/:slug/preview
```

The backend determines what portion of a resource can be previewed.

Premium resources must not expose the full original file through preview mechanisms.

Preview access must not grant download entitlement.

---

# 24. Free Download API (Prompt 16)

### Canonical Endpoint
```text
POST /api/v1/resources/:id/download
```

### Parameters
* **URL Parameter `:id`** (UUID, required): The canonical UUID identifier of the resource.
* **Request Body** (JSON, optional):
  ```json
  {
    "fileId": "uuid" // Optional: specific file attached to the active published version. If omitted, the primary available file is selected deterministically.
  }
  ```

### Anonymous-Access & Authentication Behaviour
* **Anonymous Access**: Free downloads do not require authentication or user registration. Requests without session cookies are fully permitted.
* **Optional Authenticated Context**: If a valid session cookie (`session_token`) is present, user context is captured for operational observability.
* **Resilient Session Handling**: If an invalid or expired session cookie is submitted, the request continues as anonymous rather than returning `401 UNAUTHENTICATED`.

### Free vs Premium Rule
* Resources with `qualityLabel !== 'PREMIUM'` are classified as free content and eligible for instant download anonymously or authenticated.
* Resources with `qualityLabel === 'PREMIUM'` are commercial assets. Download requests strictly require authenticated user context and an authoritative active entitlement record in `commerce.entitlements` (Prompt 20). Requests by unauthenticated visitors or authenticated users lacking an active valid entitlement are strictly blocked with HTTP `403 FORBIDDEN` (`code: 'PREMIUM_RESOURCE_LOCKED'`).

### Pre-Storage Eligibility Invariants (Zero R2 Calls on Rejection)
All checks execute in PostgreSQL before any interaction with object storage:
1. `content.resources.status = 'PUBLISHED'` (non-published resources return `404 RESOURCE_NOT_FOUND`).
2. Entitlement verification for `PREMIUM` resources: Authoritative active, non-expired, non-revoked entitlement record in `commerce.entitlements` matching the requesting `user_id` and `resource_id` (returns `403 PREMIUM_RESOURCE_LOCKED` on failure).
3. `content.resource_versions.status = 'PUBLISHED'` (active published version must exist; returns `404 RESOURCE_NOT_FOUND` if absent).
4. `files.resource_files.status = 'AVAILABLE'` (quarantined, pending, archived, or failed files reject with `400 FILE_NOT_AVAILABLE`).
5. **Cross-Version File Isolation**: The requested file must belong to the active published version. Attempting to download files belonging to draft iterations, archived versions, or other resources rejects with `404 FILE_NOT_FOUND`.
6. **Deterministic Primary File Selection**: When `fileId` is omitted, the primary file is resolved deterministically:
   `is_primary = true` → `file_type = 'MAIN_DOCUMENT'` → lowest `sequence_order ASC` → earliest `created_at ASC` → `id ASC` tie-breaker.

### Expiration Semantics
* Download URLs are generated using S3/R2 presigned GET signatures (`@aws-sdk/s3-request-presigner`).
* **TTL**: Short-lived, with a default lifespan of 300 seconds (5 minutes).
* Clients must fetch the binary directly before the timestamp in `expiresAt`.

### Storage Internals Privacy Rule
* The presigned URL contains the target cloud endpoint and signed query parameters needed to retrieve the object.
* The API response strictly omits internal storage metadata fields: `storage_metadata`, `storage_bucket`, `object_key`, and `storage_provider` are never exposed in the response payload.
* The response contains only the presigned `downloadUrl`, expiration timestamps, and controlled public file metadata.

### Response Schema (`200 OK`)
```json
{
  "data": {
    "downloadUrl": "https://<bucket>.<r2-endpoint>/resources/...?X-Amz-Signature=...&X-Amz-Expires=300",
    "expiresAt": "2026-10-05T08:05:00.000Z",
    "expiresInSeconds": 300,
    "file": {
      "id": "3f00c951-363f-459e-a9d4-cd27cabf0140",
      "originalFilename": "grade10-math-exam.pdf",
      "fileType": "MAIN_DOCUMENT",
      "mimeType": "application/pdf",
      "fileSizeBytes": 2048576,
      "checksumSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

### Error Codes
* `400 VALIDATION_ERROR`: Invalid UUID format in URL parameter or request body.
* `400 FILE_NOT_AVAILABLE`: Target file is in `QUARANTINED`, `PENDING`, `ARCHIVED`, or `FAILED` status.
* `403 PREMIUM_RESOURCE_LOCKED`: Resource is marked `PREMIUM` and the request is unauthenticated or user lacks a valid active entitlement.
* `404 RESOURCE_NOT_FOUND`: Resource does not exist or is not in `PUBLISHED` status (or has no active published version).
* `404 NO_AVAILABLE_FILES`: Published resource version has zero `AVAILABLE` files attached.
* `404 FILE_NOT_FOUND`: Specified `fileId` does not exist or does not belong to the published version.

---

# 25. Premium Download (Prompt 20)

### Architecture & Security Invariants
Premium downloads strictly enforce the authoritative commercial entitlement model:

```text
Resource (quality_label = 'PREMIUM')
→ Product (type = 'RESOURCE', status = 'ACTIVE')
→ Offer (status = 'ACTIVE', time-valid)
→ Order (status = 'COMPLETED', owned by user)
→ Payment (status = 'COMPLETED', verified amount)
→ Entitlement (status = 'ACTIVE', starts_at <= now, ends_at > now, revoked_at IS NULL)
→ Download Authorization (POST /api/v1/resources/:id/download)
```

1. **Server-Authoritative Access**:
   * The client or payment callback never directly authorises download access.
   * Access is solely verified against `commerce.entitlements` records created via successful transactional payment reconciliation.
   * Failed, pending, or cancelled orders/payments never unlock downloads.
2. **Authentication Requirement**:
   * Premium resources strictly require a valid authenticated session cookie (`session_token`).
   * Anonymous visitors or requests with invalid/expired session cookies are blocked with HTTP `403 FORBIDDEN` (`code: 'PREMIUM_RESOURCE_LOCKED'`).
3. **Entitlement Validity Validation**:
   * Checks `user_id = user.id` (ownership).
   * Checks `resource_id = resource.id` (resource-specific access; access to resource A does not grant access to resource B).
   * Checks `status = 'ACTIVE'`.
   * Checks `starts_at <= now` and `(ends_at IS NULL OR ends_at > now)`.
   * Checks `revoked_at IS NULL`.
4. **Lifecycle & File Invariants**:
   * The resource must remain `PUBLISHED` (unpublished/draft resources return `404 RESOURCE_NOT_FOUND` even if entitled).
   * An active `PUBLISHED` version must exist (returns `404 RESOURCE_NOT_FOUND`).
   * Only files with `AVAILABLE` status are accessible (`400 FILE_NOT_AVAILABLE` for quarantined files).
   * Deterministic primary-file selection is preserved when `fileId` is omitted.
5. **Zero Storage Provider Calls on Rejection**:
   * Any validation failure terminates the request immediately in PostgreSQL without contacting the storage provider (R2 / S3).
   * Signed download URLs are only generated after authorization succeeds, using the established 300-second (5 minute) TTL.
6. **No Structural Drift**:
   * No `is_paid` flag on resources; `commerce.entitlements` remains the sole source of truth.

---

# 26. File API

Administrative/internal APIs:

```text
POST /api/v1/admin/files
GET /api/v1/admin/files/:id
POST /api/v1/admin/files/:id/process
POST /api/v1/admin/files/:id/retry
```

File binaries are stored outside PostgreSQL.

PostgreSQL stores metadata and processing state.

---

# 27. File Processing

Processing may be asynchronous.

Example:

```text
POST /api/v1/admin/files/:id/process
```

Response may be:

```text
202 Accepted
```

Processing stages include:

```text
Uploaded
→ Security Scan
→ Validation
→ Checksum
→ Extraction
→ Duplicate Detection
→ Derivatives
→ Preview
→ Classification
→ Review
→ Ready
```

Failures must be recorded.

Retries must be controlled.

---

# 28. Collections

Public:

```text
GET /api/v1/collections
GET /api/v1/collections/:slug
GET /api/v1/collections/:slug/resources
```

Admin:

```text
POST /api/v1/admin/collections
PATCH /api/v1/admin/collections/:id
POST /api/v1/admin/collections/:id/publish
POST /api/v1/admin/collections/:id/archive
```

Collections are editorial/discovery entities.

They are not commerce bundles.

---

# 29. Bundles and Commerce Products

Public:

```text
GET /api/v1/bundles
GET /api/v1/bundles/:slug
GET /api/v1/products
GET /api/v1/products/:id
```

Authenticated Commerce:

```text
POST /api/v1/checkout
GET  /api/v1/orders/:id
GET  /api/v1/me/orders
GET  /api/v1/me/entitlements
POST /api/v1/payments
GET  /api/v1/payments/:id
POST /api/v1/payments/:id/simulate-success
```

Provider-Facing Callbacks (Prompt 19 — M-Pesa Daraja):

```text
POST /api/v1/payments/mpesa/callback
POST /api/v1/mpesa/callback
```

### 29.1. M-Pesa Payment Provider & STK Push (Prompt 19)

#### 1. STK Push Payment Initiation (`POST /api/v1/payments`)
* Requires active authenticated user session.
* Request Body:
  * `orderId` (UUID, required): The target order owned by the authenticated user.
  * `providerCode` (string, default: `SIMULATION`): Set to `MPESA` for Safaricom Daraja STK Push.
  * `phoneNumber` (string, required when `providerCode = 'MPESA'`): Customer's Kenyan mobile number. Accepted formats: `07XXXXXXXX`, `01XXXXXXXX`, `+2547XXXXXXXX`, `+2541XXXXXXXX`, `2547XXXXXXXX`, `2541XXXXXXXX`, or formatted variations. Normalized server-side to `2547XXXXXXXX` or `2541XXXXXXXX` (12 digits).
* Security & Invariants:
  * Amount is strictly derived from server-authoritative order total (`order.total_minor` / 100). The client cannot alter the payable amount.
  * Transition order status to `PROCESSING`.
  * Creates payment record with `status = 'PENDING'`, `provider_code = 'MPESA'`, `provider_reference = CheckoutRequestID`.
  * Returns safe payment DTO and order DTO. Upstream credentials, consumer keys, passkeys, and authorization tokens are never exposed.

#### 2. Daraja Callback Handling (`POST /api/v1/payments/mpesa/callback` & `/api/v1/mpesa/callback`)
* Unauthenticated provider-facing webhook.
* Idempotency & Race Safety:
  * Correlates callback by `provider_reference` (`CheckoutRequestID`) with row-level locking (`FOR UPDATE`) within a database transaction.
  * Duplicate or retry callbacks for already `COMPLETED` payments immediately return Daraja acknowledgement without creating duplicate entitlements, orders, or mutations.
* Server-Authoritative Validation:
  * Strict amount verification: Callback `Amount` in KES converted to minor units must exactly match `payment.amount_minor` and `order.total_minor`.
  * Underpayment or overpayment transitions payment to `FAILED` with no entitlements granted.
  * User cancellation (`ResultCode = 1032`) transitions payment and order to `CANCELLED`.
  * Provider failure (`ResultCode != 0`) transitions payment and order to `FAILED`.
  * Successful payment confirmation (`ResultCode = 0` and verified amount) transitions payment and order to `COMPLETED` and provisionally grants entitlements for all `RESOURCE` items in the order.
* Safe Acknowledgement:
  * Unknown callbacks acknowledge with `{ "ResultCode": 0, "ResultDesc": "Accepted" }` without leaking record existence.
  * Malformed payloads return `400 INVALID_CALLBACK_PAYLOAD`.

Commerce relationships:

```text
Product
→ Offer
→ Order
→ Payment
→ MpesaPaymentProvider (STK Push)
→ Callback Confirmation
→ Entitlement
```

Bundles must not contain nested bundles.

---

# 30. Authentication API

All authenticated endpoints rely on the session cookie (`SESSION_COOKIE_NAME`, default: `session_token`).
Unauthenticated requests to protected endpoints return `401 Unauthorized` with error code `UNAUTHENTICATED`.

Registration:

```text
POST /api/v1/auth/register
```

Login:

```text
POST /api/v1/auth/login
```

Logout:

```text
POST /api/v1/auth/logout
```

Current user:

```text
GET /api/v1/auth/me
```

Password recovery:

```text
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Email verification architecture:

```text
POST /api/v1/auth/verify-email
POST /api/v1/auth/resend-verification
```

Password-reset tokens must be:

* single-use
* short-lived
* securely generated
* stored safely
* invalidated after use

---

# 31. Session API

```text
GET /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:id
POST /api/v1/auth/sessions/revoke-all
```

Users must be able to manage active sessions/devices where supported.

Administrative sessions require stronger security.

---

# 32. User API

```text
GET /api/v1/me
PATCH /api/v1/me
```

User preferences:

```text
GET /api/v1/me/preferences
PATCH /api/v1/me/preferences
POST /api/v1/me/preferences/reset
```

The API must collect only information required for platform functionality.

---

# 33. Saved Resources

The locked database model stores saved resource version IDs directly on the user record.

Endpoints:

```text
GET /api/v1/me/saved-resources
POST /api/v1/me/saved-resources/:resourceVersionId
DELETE /api/v1/me/saved-resources/:resourceVersionId
```

Do not redesign this as a private collection system.

Saved resources are:

* version-specific
* flat
* directly associated with the user
* not organized through private collections

---

# 34. Activity

```text
GET /api/v1/me/activity
DELETE /api/v1/me/activity
```

Activity can include:

* viewed
* previewed
* downloaded
* searched
* saved
* purchased
* shared
* followed

Anonymous activity is associated with a controlled session/browser identifier.

Authenticated activity can persist across devices.

---

# 35. Follows

```text
GET /api/v1/me/follows
POST /api/v1/me/follows
DELETE /api/v1/me/follows/:followId
```

Followable entities may include:

* contributors
* subjects
* grades
* curricula
* resources
* education updates
* other approved entities

The backend must validate that the target entity exists and is followable.

---

# 36. Resource Requests

Public:

```text
POST /api/v1/resource-requests
GET /api/v1/resource-requests/:id
POST /api/v1/resource-requests/:id/upvote
```

Requests may be anonymous.

Authenticated users may receive fulfillment notifications.

Internal request counts and demand intelligence are not publicly exposed unless deliberately configured.

---

# 37. Feedback

```text
POST /api/v1/resources/:id/feedback
```

Supported structured reasons include:

* Helpful
* Outdated
* Incorrect
* Missing Information
* Poor Formatting
* Wrong Classification
* File Problem

Optional details may be provided.

Numerical/star ratings are not used.

---

# 38. Serious Reports

```text
POST /api/v1/resources/:id/report
```

Reports are separate from ordinary feedback.

Reports may trigger moderation workflows.

Sensitive report details must never be publicly exposed.

---

# 39. Notifications

```text
GET /api/v1/me/notifications
POST /api/v1/me/notifications/:id/read
POST /api/v1/me/notifications/read-all
```

Notification delivery may use:

* in-app
* email
* SMS

Provider implementation must remain behind provider interfaces.

---

# 40. Calendar API

Calendar supports four scopes:

```text
OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION
```

Public calendar:

```text
GET /api/v1/calendar
GET /api/v1/calendar/events
```

---

# 41. Official Calendar

Official data must be protected from user modification.

Example:

```text
GET /api/v1/calendar/official
```

Anonymous and authenticated users may read official events.

No public endpoint may modify official events.

Administrative management:

```text
POST /api/v1/admin/calendar/official/events
PATCH /api/v1/admin/calendar/official/events/:id
POST /api/v1/admin/calendar/official/events/:id/publish
POST /api/v1/admin/calendar/official/events/:id/archive
```

---

# 42. School Calendar

```text
GET /api/v1/schools/:schoolId/calendar
GET /api/v1/schools/:schoolId/calendar/events
```

Authorized school users may manage school-calendar content according to RBAC.

---

# 43. Anonymous Calendar

Anonymous users may create temporary calendar data.

```text
POST /api/v1/calendar/session
GET /api/v1/calendar/session
POST /api/v1/calendar/session/events
PATCH /api/v1/calendar/session/events/:id
DELETE /api/v1/calendar/session/events/:id
```

Anonymous calendar data must:

* belong to the current session
* never modify official events
* never modify another session
* have an expiry
* remain temporary

A UUID alone is not authorization.

---

# 44. Authenticated User Calendar

```text
GET /api/v1/me/calendar
POST /api/v1/me/calendar/events
PATCH /api/v1/me/calendar/events/:id
DELETE /api/v1/me/calendar/events/:id
```

Authenticated calendar events persist across devices.

---

# 45. Anonymous-to-Account Calendar Transfer

If an anonymous user later creates or logs into an account, the platform may offer:

```text
POST /api/v1/calendar/session/transfer
```

Transfer must require explicit authorization.

Only the user's own anonymous session data may be transferred.

The operation must be idempotent.

---

# 46. Calendar Exports

Initial supported format:

```text
PDF
```

Endpoint:

```text
POST /api/v1/calendar/export
GET /api/v1/calendar/export/:id
```

Future formats may include:

```text
ICS
XLSX
CSV
```

Exports must not expose another user's calendar.

Temporary generated files must use controlled storage and expiry.

---

# 47. Contributors

Public Discovery:

```text
GET /api/v1/contributors
Query: ?page=1&limit=20
Response: 200 { data: ContributorPublicDto[], pagination: { page, limit, total, totalPages } }

GET /api/v1/contributors/:slug
Response: 200 { data: ContributorPublicDto } | 404 (if not found or status !== 'ACTIVE')

GET /api/v1/contributors/:slug/resources
Query: ?page=1&limit=20
Response: 200 { data: Resource[], pagination: { page, limit, total, totalPages } } | 404
```

Contributor Application Workflow:

```text
POST /api/v1/contributor-applications
Auth: Required (Standard User)
Body: { applicationText: string }
Response: 201 { data: ContributorApplicationDto } | 409 DUPLICATE_APPLICATION (if active app already pending)
```

Contributor Workspace:

```text
GET /api/v1/me/contributor
Auth: Required
Response: 200 { data: ContributorPrivateDto } | 404 NOT_A_CONTRIBUTOR

PATCH /api/v1/me/contributor
Auth: Required (Permission: contributor.profile.update)
Body: { displayName?: string, bio?: string | null }
Response: 200 { data: ContributorPrivateDto } | 403 CONTRIBUTOR_SUSPENDED

GET /api/v1/me/contributor/submissions
Auth: Required (Permission: contributor.submit)
Query: ?page=1&limit=20
Response: 200 { data: ContributorSubmissionDto[], pagination }

POST /api/v1/me/contributor/submissions
Auth: Required (Permission: contributor.submit)
Body: { title: string, description?: string | null, proposedPriceMinor?: number | null, proposedCurrencyCode?: 'KES' | null, resourceId?: string | null }
Response: 201 { data: ContributorSubmissionDto } | 403 CONTRIBUTOR_SUSPENDED

GET /api/v1/me/contributor/submissions/:id
Auth: Required (Permission: contributor.submit)
Response: 200 { data: ContributorSubmissionDto } | 404 SUBMISSION_NOT_FOUND (isolated to owning contributor)

PATCH /api/v1/me/contributor/submissions/:id
Auth: Required (Permission: contributor.submit)
Body: { title?: string, description?: string | null, proposedPriceMinor?: number | null, proposedCurrencyCode?: 'KES' | null }
Response: 200 { data: ContributorSubmissionDto } | 400 SUBMISSION_LOCKED (if status !== 'DRAFT')

POST /api/v1/me/contributor/submissions/:id/submit
Auth: Required (Permission: contributor.submit)
Response: 200 { data: ContributorSubmissionDto (status: 'SUBMITTED') } | 400 SUBMISSION_LOCKED
```

Contributor access requires appropriate role and active lifecycle standing.

---

# 48. Contributor Submissions & Editorial Review

Submission workflow:

```text
Application
→ Review & Approval (creates profile, assigns 'contributor' role)
→ Workspace Draft
→ Submission (DRAFT → SUBMITTED)
→ Editorial Review (APPROVE / REJECT)
→ Controlled Resource Linking (resources.contributor_id)
→ Editorial Publication (PublicationService only)
```

A contributor must not be able to directly publish content.

Administrative Review Endpoints:

```text
GET /api/v1/admin/contributor-applications
Auth: Required (Permission: contributor.application.review)
Query: ?status=SUBMITTED&page=1&limit=20
Response: 200 { data: ContributorApplicationDto[], pagination }

POST /api/v1/admin/contributor-applications/:id/review
Auth: Required (Permission: contributor.application.review)
Body: { action: 'APPROVE' | 'REJECT', notes?: string }
Response: 200 { data: { application, contributor? } }

POST /api/v1/admin/contributor-submissions/:id/review
Auth: Required (Permission: contributor.application.review)
Body: { action: 'APPROVE' | 'REJECT', notes?: string }
Response: 200 { data: ContributorSubmissionDto }

GET /api/v1/admin/contributors
Auth: Required (Permission: contributor.manage)
Query: ?status=ACTIVE&page=1&limit=20
Response: 200 { data: ContributorPrivateDto[], pagination }

PATCH /api/v1/admin/contributors/:id/status
Auth: Required (Permission: contributor.manage)
Body: { status: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED' | 'INACTIVE', reason?: string }
Response: 200 { data: ContributorPrivateDto }
```

---

# 49. Contributor Financial API

Authenticated contributor:

```text
GET /api/v1/me/contributor/earnings
GET /api/v1/me/contributor/payouts
```

Financial information must have strict authorization.

Historical earnings must preserve the revenue rule/value applicable at the time.

---

# 50. Education Updates

Education Updates are a dedicated entity.

Public:

```text
GET /api/v1/updates
GET /api/v1/updates/:slug
GET /api/v1/updates/:slug/related
```

Admin:

```text
POST /api/v1/admin/updates
PATCH /api/v1/admin/updates/:id
POST /api/v1/admin/updates/:id/publish
POST /api/v1/admin/updates/:id/archive
```

Education Updates must not be forced into the Resource entity.

---

# 51. Quality and Verification

Public resource quality information may be returned with resource data.

Example:

```json
{
  "quality": {
    "label": "VERIFIED",
    "displayMark": "✓"
  }
}
```

Detailed internal review information must not be exposed.

Admin:

```text
GET /api/v1/admin/resources/:id/quality
POST /api/v1/admin/resources/:id/quality-checks
POST /api/v1/admin/resources/:id/verify
POST /api/v1/admin/resources/:id/revoke-verification
```

No numerical quality ratings.

---

# 52. Admin API

Administrative routes must be clearly separated.

Base path:

```text
/api/v1/admin/
```

Examples:

```text
GET /api/v1/admin/resources
GET /api/v1/admin/users
GET /api/v1/admin/orders
GET /api/v1/admin/payments
GET /api/v1/admin/contributors
GET /api/v1/admin/reports
GET /api/v1/admin/analytics
GET /api/v1/admin/audit-logs
```

Every admin endpoint must enforce server-side permissions.

Admin UI visibility alone is not authorization.

---

# 53. RBAC

Authorization is based on:

```text
User
→ Roles
→ Permissions
→ Scope
```

Users may have multiple roles.

Permissions may be scoped by:

* platform
* country
* school
* resource
* contributor
* administrative area
* other approved boundaries

Role checks must occur server-side.

---

# 54. Commerce API

Products:

```text
GET /api/v1/products
GET /api/v1/products/:id
```

Checkout:

```text
POST /api/v1/checkout
GET /api/v1/orders/:id
```

Current user orders:

```text
GET /api/v1/me/orders
```

Entitlements:

```text
GET /api/v1/me/entitlements
```

The API must not create an entitlement merely because the frontend reports payment success.

---

# 55. Payment API

Payment providers operate behind:

```text
PaymentProvider
```

Example:

```text
POST /api/v1/payments
GET /api/v1/payments/:id
```

Provider callbacks:

```text
POST /api/v1/payments/webhooks/:provider
```

Webhook handling must include:

* signature/authentication validation where supported
* idempotency
* duplicate protection
* amount validation
* currency validation
* order validation
* provider transaction validation
* status verification
* reconciliation support

---

# 56. M-Pesa

M-Pesa is implemented through the payment-provider abstraction.

The frontend must never directly determine:

```text
payment successful
```

The server must determine payment state from validated provider information.

Duplicate/replayed callbacks must be safely ignored or handled idempotently.

---

# 57. Idempotency

Idempotency is required for operations such as:

* payments
* checkout
* order creation where appropriate
* contributor submissions where duplication is harmful
* calendar transfer
* exports where appropriate
* webhook processing

Example header:

```text
Idempotency-Key
```

The backend must define which endpoints support idempotency.

Repeated requests must not create duplicate financial or entitlement records.

---

# 58. Analytics API

Public clients may submit approved analytics events through a controlled endpoint.

Example:

```text
POST /api/v1/analytics/events
```

Events may include:

* search
* view
* preview
* download
* save
* purchase
* share
* request
* feedback
* calendar interaction

The API must validate event types.

Clients must not be allowed to create arbitrary analytics event types.

---

# 59. Recommendations API

```text
GET /api/v1/resources/:id/recommendations
GET /api/v1/me/recommendations
```

Recommendation categories may include:

* similar resources
* next useful resource
* collection suggestions
* subject-related
* topic-related
* personalized

Recommendations must use structured platform signals.

Premium status must not dominate recommendations.

---

# 60. Homepage API

The homepage may consume a dedicated discovery endpoint:

```text
GET /api/v1/homepage
```

The response may contain:

* discovery sections
* trending
* most downloaded
* curated resources
* Teacher Hub
* Student Hub
* calendar highlights
* education updates
* collections
* free/premium discovery

Anonymous users receive useful cold-start discovery.

Authenticated users may receive deeper personalization where permitted.

---

# 61. Homepage Editorial Controls

Admin operations:

```text
GET /api/v1/admin/homepage
POST /api/v1/admin/homepage/drafts
PATCH /api/v1/admin/homepage/drafts/:id
POST /api/v1/admin/homepage/drafts/:id/preview
POST /api/v1/admin/homepage/drafts/:id/publish
POST /api/v1/admin/homepage/drafts/:id/discard
POST /api/v1/admin/homepage/rollback
```

Controls include:

* pin
* schedule
* expiry
* override
* preview
* publish
* rollback

Only one active draft is allowed.

---

# 62. SEO API

SEO data is primarily server-generated and stored as platform content metadata.

Admin endpoints may include:

```text
GET /api/v1/admin/seo/:entityType/:id
PATCH /api/v1/admin/seo/:entityType/:id
GET /api/v1/admin/seo/:entityType/:id/history
```

SEO metadata may include:

* title
* description
* canonical URL
* social title
* social description
* social image
* index/noindex
* structured metadata configuration

Admin overrides must be audited.

---

# 63. Slugs and Redirects

Public resources use SEO-friendly slugs.

If a slug changes:

```text
GET /old-slug
→ redirect
→ new-slug
```

The permanent internal UUID does not change.

Slug history must remain available to the routing layer.

---

# 64. Pagination

Public collection endpoints must paginate.

Default resource catalogue page size:

```text
20
```

The frontend may implement:

```text
Load More
```

without changing the API's underlying pagination model.

Maximum page size must be enforced server-side.

Clients must not request unlimited records.

---

# 65. Filtering

Filters must be composable.

Example:

```text
/resources?
grade=form-3
&subject=biology
&resourceType=notes
&access=free
```

Filtering must be separate from sorting.

Filter state must be safely serializable into URLs where appropriate.

---

# 66. Sorting

Supported sorting options may include:

```text
relevance
newest
recently_updated
most_downloaded
```

Sorting must not accidentally remove active filters.

Default:

```text
relevance
```

where a search query exists.

---

# 67. Public Data Minimization

Public APIs must expose only information required for the public experience.

Do not expose:

* private email addresses
* phone numbers unless deliberately public
* internal notes
* internal quality scores
* private analytics
* private user activity
* financial details
* moderation information
* security metadata

---

# 68. API Authorization Layers

Every protected request should conceptually pass through:

```text
Request
→ Authentication
→ Input Validation
→ Resource Resolution
→ Authorization
→ Business Rules
→ Database Operation
→ Response
```

Do not rely on frontend route protection.

---

# 69. Input Validation

All external input must be validated with schemas.

Validate:

* path parameters
* query parameters
* request bodies
* headers where required
* webhook payloads
* file metadata
* pagination
* filters
* identifiers

Unexpected fields should be rejected or safely stripped according to endpoint policy.

---

# 70. SQL Injection Protection

Database queries must use parameterized ORM/query mechanisms.

Never concatenate user input directly into SQL.

Search input must also be safely parameterized.

---

# 71. File Security

File APIs must enforce:

* allowed MIME types
* allowed extensions
* file-size limits
* malware/security scanning
* checksum
* quarantine
* controlled storage
* processing status
* authorization

User-provided filenames must never become unrestricted filesystem paths.

---

# 72. Download Security

Downloads must use controlled authorization.

Where signed URLs are used:

* short expiry
* appropriate scope
* appropriate object
* no permanent public URL
* revocation/blocking strategy where supported

Premium files require entitlement validation before access is granted.

---

# 73. Rate Limiting

Rate limits must protect:

* login
* registration
* password recovery
* autocomplete
* search
* downloads
* feedback
* requests
* upvotes
* file uploads
* payment initiation
* webhooks
* analytics ingestion
* expensive admin operations

Limits must be configurable.

Anonymous users require additional abuse protection.

---

# 74. Background Jobs

Long-running operations must not block ordinary API requests.

Examples:

* file processing
* OCR where eventually used
* thumbnail generation
* PDF generation
* email
* SMS
* search indexing
* analytics aggregation
* recommendation calculations
* sitemap generation
* scheduled publication
* scheduled retirement
* cache refresh

The API should return `202 Accepted` where appropriate.

---

# 75. Search Indexing

Publishing a resource must trigger appropriate search indexing.

Unpublishing/retiring must remove or suppress the resource from public search.

Indexing should be asynchronous where practical.

Search failures must not silently corrupt publication state.

The transactional database remains authoritative.

---

# 76. Cache Behaviour

Public API responses may be cached where safe.

Sensitive endpoints must not be publicly cached.

Cache rules must distinguish:

* public
* authenticated
* personalized
* administrative
* premium/protected

Cache invalidation must occur after relevant publication/content changes.

---

# 77. API Performance

Public APIs should be designed for:

* mobile users
* low-bandwidth networks
* moderate devices
* efficient payloads
* pagination
* indexed database queries
* minimal unnecessary joins
* predictable response times

Do not return large database objects when only summary data is required.

---

# 78. Provider Abstraction

External services must be accessed through interfaces.

Required abstractions include:

```text
PaymentProvider
StorageProvider
EmailProvider
SmsProvider
SearchProvider
PdfProvider
AiProvider
```

Business logic must not become permanently coupled to one provider.

---

# 79. Provider Failure

The API must gracefully handle provider failure.

Examples:

* payment provider unavailable
* storage unavailable
* email failure
* SMS failure
* search failure
* PDF generation failure

Do not report success when an external operation has not actually succeeded.

Retry policies must be controlled.

---

# 80. Transactions

Database transactions must be used where multiple related operations must succeed or fail together.

Examples:

* order creation
* payment state transitions
* entitlement creation
* contributor financial records
* important resource publication state changes
* calendar transfer

---

# 81. Commerce State Integrity

Payment and entitlement state must be server-authoritative.

Example:

```text
Order: PENDING
Payment: PENDING
Entitlement: NONE
```

After validated successful payment:

```text
Order: PAID
Payment: SUCCEEDED
Entitlement: ACTIVE
```

Invalid or failed payment must not grant entitlement.

---

# 82. Resource Lifecycle Integrity

Public resources must respect:

```text
DRAFT
REVIEW
APPROVED
PUBLISHED
RETIRED
```

Visibility and lifecycle are distinct concepts.

The API must prevent impossible state transitions.

---

# 83. Version Integrity

A published resource version must remain immutable.

Corrections requiring a new major version must create a new version.

Existing saved-resource relationships and entitlements must continue to resolve according to the platform's version rules.

---

# 84. Calendar Integrity

Rules:

* official calendars cannot have user ownership
* school calendars require school ownership
* user calendars require user ownership
* anonymous calendars require session ownership
* anonymous calendars expire
* users cannot modify another user's calendar
* anonymous users cannot modify another session
* user events cannot alter official events
* invalid date/time combinations are rejected

---

# 85. API Auditability

Important state-changing actions must generate audit records.

Examples:

* publish
* unpublish
* retire
* verify
* revoke verification
* change permissions
* financial changes
* rights changes
* contributor approval
* user role changes
* administrative changes

Audit logs are append-only.

---

# 86. API Documentation

The backend must generate or maintain OpenAPI documentation.

The API contract must be machine-readable where practical.

The implementation and API documentation must not silently diverge.

Changes to public API contracts must be documented.

---

# 87. Testing Requirements

Every API module must have appropriate tests.

Minimum categories:

### Unit tests

Business rules and services.

### Integration tests

API + database interactions.

### Authorization tests

Unauthorized and incorrectly scoped requests.

### Validation tests

Invalid input.

### Security tests

Rate limiting, access control, file/download security.

### Workflow tests

Publication, payment, contributor, calendar, etc.

### E2E tests

Critical complete user journeys.

---

# 88. Critical E2E Journeys

The system must eventually test at least:

## Free Resource

```text
Anonymous
→ Search
→ Resource page
→ Preview
→ Download
```

## Premium Resource

```text
Anonymous
→ Search
→ Resource page
→ Preview
→ Purchase
→ Authenticate
→ Payment
→ Entitlement
→ Download
```

## Anonymous Calendar

```text
Anonymous
→ Calendar
→ Add Event
→ Edit Event
→ Preview
→ Download PDF
```

## Authenticated Calendar

```text
Login
→ Calendar
→ Add Event
→ Save
→ Logout
→ Login
→ Event remains
```

## Contributor

```text
Application
→ Approval
→ Workspace
→ Submission
→ Processing
→ Review
→ Publication
```

---

# 89. API Security Tests

Tests must verify:

* ordinary user cannot access admin routes
* ordinary user cannot access another user's data
* user cannot access another user's calendar
* anonymous session cannot access another session
* user cannot modify official calendar events
* contributor cannot publish directly
* user cannot bypass premium entitlement
* expired session is rejected
* revoked session is rejected
* expired signed download is rejected
* invalid payment cannot grant entitlement
* duplicate payment callback does not duplicate entitlement
* invalid input is rejected
* oversized pagination is rejected
* unauthorized file access is rejected

---

# 90. API Naming Conventions

Use plural nouns for collections where practical:

```text
/resources
/users
/schools
/collections
/contributors
/updates
```

Use explicit actions only when the operation is genuinely an action:

```text
/publish
/approve
/archive
/verify
```

Avoid inconsistent naming.

---

# 91. Internal vs Public APIs

Public:

```text
/api/v1/...
```

Administrative:

```text
/api/v1/admin/...
```

Authenticated personal:

```text
/api/v1/me/...
```

Provider callbacks:

```text
/api/v1/payments/webhooks/...
```

Internal worker functions do not need to be exposed as public HTTP endpoints.

---

# 92. No Fake API Implementations

The coding agent must not create fake implementations merely to make the frontend appear functional.

Do not use:

* hardcoded resource arrays
* fake payment success
* fake entitlements
* fake database responses
* fake authentication
* fake calendar persistence
* fake search results

If a dependency is not yet implemented, expose a clearly marked development stub only where explicitly authorized by the implementation task.

---

# 93. Environment Configuration

API configuration must come from environment/configuration.

Examples:

```text
DATABASE_URL
SESSION_SECRET
STORAGE_PROVIDER
STORAGE_BUCKET
PAYMENT_PROVIDER
EMAIL_PROVIDER
SMS_PROVIDER
SEARCH_PROVIDER
REDIS_URL
```

Secrets must never be committed to Git.

`.env` must remain ignored.

`.env.example` must document required configuration without real secrets.

---

# 94. Development, Staging and Production

API configuration must distinguish:

```text
development
staging
production
```

Each environment must use separate:

* database
* storage
* payment credentials
* secrets
* relevant external resources

Production data must never be casually used in development.

---

# 95. API Change Policy

Before changing an API contract, the coding agent must:

1. inspect this specification
2. inspect current implementation
3. identify affected consumers
4. identify database impact
5. identify test impact
6. implement the smallest correct change
7. update documentation
8. run tests
9. run typecheck
10. run build
11. update implementation status
12. report the change
13. stop

The agent must not silently redesign the API.

---

# 96. API Source of Truth

For API behaviour:

1. `AI_DEVELOPER_RULES.md`
2. `API_SPEC.md`
3. `DATABASE_SPEC.md`
4. `ARCHITECTURE.md`
5. approved implementation decisions
6. existing code
7. tests

Existing code must not override locked architectural decisions merely because it is already present.

If a conflict is discovered, stop and report it.

---

# 97. MVP API Priority

The API should be implemented in stages.

Initial foundation:

```text
Health
→ Countries
→ Geography
→ Schools
→ Curriculum
→ Resources
→ Resource versions
→ Files
→ Publication
→ Public catalogue
→ Search
→ SEO
```

Then:

```text
Authentication
→ RBAC
→ User preferences
→ Saved resources
→ Activity
→ Free downloads
→ Calendar
```

Then:

```text
Commerce
→ Payments
→ M-Pesa
→ Entitlements
→ Premium downloads
```

Then:

```text
Contributors
→ Contributor finance
→ Education updates
→ Quality governance
→ Feedback
→ Notifications
→ Analytics
→ Recommendations
→ Admin intelligence
```

---

# 98. API Definition of Done

An API feature is not complete merely because an endpoint exists.

It is complete only when:

* requirements were reviewed
* correct module exists
* input is validated
* authorization is correct
* database operations are correct
* errors are handled
* important state changes are audited
* idempotency is implemented where required
* tests exist
* security implications were considered
* typecheck passes
* tests pass
* build passes
* documentation is updated
* implementation status is updated
* no unrelated architecture was changed

---

# 99. Final API Principle

The API must make the platform:

**Public by default.**

**Structured by design.**

**Secure by default.**

**Server-authoritative.**

**Versioned.**

**Testable.**

**Provider-independent.**

**Ready for web and future mobile applications.**

The frontend is a consumer of the platform.

The API and database together form the authoritative application foundation.

The coding agent must preserve this principle throughout implementation.
