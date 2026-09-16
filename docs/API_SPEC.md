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

# 16. Resource Search

Search must use the `SearchProvider` abstraction.

Initial implementation:

```text
PostgreSQL full-text search
```

The public API must not depend directly on PostgreSQL-specific search implementation.

Example:

```text
GET /api/v1/search?q=photosynthesis
```

Search may return:

* resources
* schools
* contributors
* collections
* education updates
* calendar information
* curriculum entities

Entity types must be distinguishable.

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

# 24. Free Download

```text
POST /api/v1/resources/:id/download
```

The backend must:

1. identify the resource/version
2. verify publication state
3. verify file readiness
4. verify free-access status
5. authorize the request
6. create an appropriate short-lived access mechanism
7. return controlled download information

Permanent public storage URLs must not be returned.

---

# 25. Premium Download

Premium downloads follow:

```text
Resource
→ Product
→ Offer
→ Order
→ Payment
→ Entitlement
→ Download authorization
```

The frontend must never decide whether a user owns a premium resource.

The backend must verify entitlement.

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
```

Commerce relationships:

```text
Product
→ Offer
→ Order
→ Payment
→ Entitlement
```

Bundles must not contain nested bundles.

---

# 30. Authentication API

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

Public:

```text
GET /api/v1/contributors
GET /api/v1/contributors/:slug
GET /api/v1/contributors/:slug/resources
```

Contributor application:

```text
POST /api/v1/contributor-applications
```

Contributor workspace:

```text
GET /api/v1/me/contributor
GET /api/v1/me/contributor/submissions
POST /api/v1/me/contributor/submissions
GET /api/v1/me/contributor/submissions/:id
```

Contributor access requires appropriate role/relationship.

---

# 48. Contributor Submissions

Submission workflow:

```text
Application
→ Review
→ Approval
→ Workspace
→ Submission
→ Processing
→ Review
→ Approval
→ Resource
```

A contributor must not be able to directly publish content.

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
