# AI DEVELOPER RULES

## Kenya-First Education Resource Platform

**Document status:** LOCKED
**Purpose:** Governing rules for AI-assisted development
**Audience:** AI coding agents, developers, reviewers and maintainers

---

# 1. PURPOSE OF THIS DOCUMENT

This document defines how AI coding agents must work on this project.

The AI agent is an implementation assistant, not the product architect.

The agent must implement approved decisions accurately and incrementally.

The agent must not redesign the product, database or architecture simply because it believes another approach is better.

These rules apply to every coding task unless the project owner explicitly overrides them.

---

# 2. PROJECT CONTEXT

This project is a Kenya-first education-resource platform designed to become a high-quality education ecosystem.

The platform is intended to support:

* Teachers
* Students
* Schools
* Parents/guardians
* Education professionals
* Contributors
* Institutional users

The platform will initially focus on Kenya while remaining architecturally ready for other African countries.

The platform is public by default.

Anonymous users are important primary users.

Authentication must not be introduced merely because it makes implementation easier.

---

# 3. SOURCE OF TRUTH HIERARCHY

Before implementing any significant feature, inspect the relevant project documentation.

The expected documentation includes:

```text
docs/
├── AI_DEVELOPER_RULES.md
├── PROJECT_VISION.md
├── ARCHITECTURE.md
├── DATABASE_SPEC.md
├── API_SPEC.md
├── SECURITY_RULES.md
└── IMPLEMENTATION_STATUS.md
```

Use the following priority order:

1. Explicit project-owner instruction in the current task
2. Locked architectural decisions
3. Database specification
4. Security specification
5. API specification
6. Architecture specification
7. Product specification
8. Existing implementation
9. AI agent assumptions

If existing code conflicts with an approved specification, do not silently adapt the specification to the code.

Report the conflict.

---

# 4. NEVER GUESS IMPORTANT REQUIREMENTS

The AI must not invent important requirements.

If something is genuinely unspecified, use the smallest reasonable implementation that preserves future flexibility.

However, STOP and report the issue when the uncertainty affects:

* Security
* Payments
* Database integrity
* User permissions
* Data ownership
* Legal/commercial access
* Published content
* Data deletion
* Personal information
* External-provider behaviour
* Resource entitlement
* Curriculum structure

Do not make consequential assumptions silently.

---

# 5. LOCKED ARCHITECTURE PRINCIPLE

The following architectural decisions are considered locked unless explicitly changed by the project owner.

The project uses:

* Modular monolith architecture
* Dedicated frontend
* Backend API
* PostgreSQL
* Object storage
* CDN
* Background jobs
* Provider abstractions
* Central authentication
* RBAC
* PostgreSQL full-text search for MVP
* Versioned API
* Automated testing
* Development/staging/production environments

Do not convert the project into microservices unless explicitly instructed.

Do not introduce Kubernetes merely because the project is expected to grow.

Do not introduce a dedicated search engine before it is justified.

Do not introduce unnecessary infrastructure.

---

# 6. DATABASE IS A FIRST-CLASS SYSTEM

PostgreSQL is the authoritative transactional database.

The database must not be treated as an incidental implementation detail.

Important business rules should be protected by the database where practical.

Use:

* UUID primary keys
* Foreign keys
* Unique constraints
* Check constraints
* Appropriate indexes
* Transactions
* Controlled deletion
* Timestamps
* Auditability

Do not rely exclusively on frontend validation.

Do not rely exclusively on application validation when a critical invariant can reasonably be enforced at database level.

---

# 7. MIGRATION RULES

Every database structural change must be represented by a migration.

Never manually modify a database schema and leave the repository without a corresponding migration.

Migrations must be:

* Explicit
* Ordered
* Repeatable
* Reviewable
* Environment-safe

Do not rewrite old migrations after they have been applied to shared or production environments.

Create a new migration for changes.

Never solve migration problems by casually dropping tables or databases.

Never use destructive database commands without explicit approval.

---

# 8. DATABASE DELETION RULES

The platform preserves historical information wherever required.

Use:

* soft deletion
* deactivation
* archival
* retirement
* anonymization

where appropriate.

Do not physically delete:

* published resource history
* important financial history
* audit history
* important contributor history
* historical school relationships
* other records explicitly protected by the architecture

Physical deletion is allowed only where the specification explicitly permits it or where it is technically necessary for temporary/non-critical data.

---

# 9. UUID RULE

Major entities use UUID primary keys.

UUIDs are permanent internal identities.

Do not use titles, filenames or slugs as permanent identities.

A URL slug may change.

A resource UUID must not change simply because:

* title changes
* slug changes
* resource version changes
* curriculum changes
* resource metadata changes

---

# 10. RESOURCE IDENTITY RULE

A resource is a permanent logical identity.

A resource version is a version of that identity.

The architecture is:

```text
RESOURCE
   │
   ├── VERSION 1
   │      └── FILES
   │
   ├── VERSION 2
   │      └── FILES
   │
   └── VERSION 3
          └── FILES
```

Do not turn every new version into a completely unrelated resource.

Do not overwrite published historical versions.

Published versions are immutable.

Significant corrections normally require a new version.

---

# 11. RESOURCE CLASSIFICATION RULES

The locked classification model must be preserved.

A resource may have:

* Multiple curriculum versions
* Multiple grade levels
* Multiple resource types

A resource has:

* Exactly one subject
* Exactly one topic
* One primary curriculum classification
* One primary resource type

Do not silently convert these relationships into a different model.

---

# 12. CURRICULUM RULES

Curriculum structures must remain configurable.

Do not hardcode Kenya-specific assumptions throughout the application.

The conceptual structure is:

```text
Country
    ↓
Curriculum
    ↓
Curriculum Version
    ↓
Education Level
    ↓
Grade/Form
    ↓
Pathway
    ↓
Subject
    ↓
Topic
```

Curriculum versions must support historical and current structures.

Historical curriculum data must not be destroyed simply because a new curriculum becomes current.

Topics have stable identities and may be mapped across curricula.

---

# 13. SCHOOL RULES

Schools belong to a country.

Schools may optionally belong to administrative areas.

Schools have permanent UUID identities.

Government/institutional codes are external identifiers and are not substitutes for UUIDs.

Schools must support:

* Active
* Inactive
* Archived

Do not physically delete schools where historical relationships or content depend on them.

Users may belong to multiple schools.

School relationships are separate records.

Do not place a single permanent `school_id` on the user as a replacement for the approved relationship model.

---

# 14. FILE STORAGE RULE

Binary files do not belong directly in PostgreSQL.

PostgreSQL stores file metadata.

Object storage stores the actual binary.

The system must maintain:

* Permanent file UUID
* Original filename
* MIME type
* File size
* Storage provider
* Storage key
* Checksum
* Processing status
* Processing history
* Derivatives
* Extracted text where applicable

Original uploaded files are immutable.

---

# 15. FILE PROCESSING RULE

File processing must follow the approved conceptual pipeline:

```text
Acquire
 ↓
Upload
 ↓
Security Scan
 ↓
Validation
 ↓
Checksum
 ↓
Text/OCR Extraction
 ↓
Metadata Extraction
 ↓
Duplicate Detection
 ↓
Thumbnail/Preview
 ↓
Classification
 ↓
Quality Checks
 ↓
Human Review
 ↓
Approval
 ↓
Publication
 ↓
Monitoring
```

Expensive processing must use background jobs.

Processing must be retryable.

Repeated failures must become visible to administrators.

Do not hide failed processing from administrators.

---

# 16. SECURITY RULE — NEVER TRUST THE FRONTEND

The frontend is untrusted.

Never make security decisions solely in frontend code.

The backend must independently verify:

* Identity
* Authentication
* Authorization
* Ownership
* Role
* Permission
* Scope
* Entitlement
* Resource status

A hidden button is not security.

A disabled frontend control is not security.

---

# 17. AUTHENTICATION RULES

Authentication identity is separate from the user profile.

The architecture supports:

```text
User
  ↓
Authentication Identity
  ↓
Sessions
```

Passwords must use an approved secure password hashing mechanism such as Argon2id.

Session tokens must not be stored as plaintext.

Sessions must support:

* Expiry
* Revocation
* Device/session visibility where appropriate

Password-reset tokens must be:

* Short-lived
* Single-use
* Securely generated
* Safely stored

Do not expose authentication secrets.

---

# 18. PUBLIC-FIRST RULE

Anonymous users are first-class users of the platform.

Do not require login for:

* Homepage
* Public catalogue
* Search
* Filtering
* Public resource pages
* Eligible previews
* Free-resource downloads
* Public collections
* Public schools
* Education updates
* Official calendar
* Anonymous calendar
* Resource requests where permitted
* Permitted feedback
* Sharing

Require authentication only where identity, persistence or entitlement genuinely requires it.

---

# 19. RBAC RULES

Roles and permissions are separate.

Users may have multiple roles.

Permissions must be granular.

Permissions may be scoped.

Admin permissions are not equivalent to public/community roles.

Every protected endpoint must perform server-side authorization.

Never implement:

```text
if frontend says admin
    allow
```

Authorization must be determined by trusted backend data.

Sensitive administrative operations require stronger authentication where specified.

Permission changes must be auditable.

---

# 20. USER DATA RULES

Collect only information required for a legitimate platform purpose.

Do not collect sensitive information merely because it might be useful later.

Do not expose one user's private information to another user.

Do not expose private analytics.

Do not expose internal moderation information publicly.

Do not log unnecessary personal information.

---

# 21. SAVED RESOURCE RULE

The approved saved-resource architecture is locked.

Do not redesign it into a junction table merely because relational modelling appears more conventional.

Saved resources refer to specific resource versions according to the approved model.

Saved resources remain a flat list.

Do not silently introduce collection-based saved-resource organization.

If scalability or integrity problems emerge, report and benchmark them rather than changing the locked model silently.

---

# 22. ACTIVITY RULES

Anonymous activity may be associated with browser/session context.

Authenticated activity may be associated with the user account.

Activity/personalization signals are separate from core resource tables.

Do not embed analytics fields into resource records merely to avoid creating event infrastructure.

---

# 23. CALENDAR RULES

The calendar is a dedicated subsystem.

It supports:

```text
OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION
```

Official calendar events must never be modified by anonymous or ordinary users.

School calendars require appropriate school ownership/permissions.

Authenticated user calendars belong to authenticated users.

Anonymous calendars belong to their session.

A UUID is never sufficient authorization.

Calendar access must verify session/user ownership.

Anonymous calendar data must expire according to retention policy.

Calendar rendering may combine official and personal events, but their underlying records remain distinct.

---

# 24. COMMERCE RULES

Commerce is separate from resource identity.

Use:

```text
Resource
   ↓
Product
   ↓
Offer
   ↓
Order
   ↓
Payment
   ↓
Entitlement
```

Pricing must not be embedded directly into the resource.

Products and offers are separate concepts.

Multiple currencies must be supported.

---

# 25. PAYMENT SECURITY RULES

Never grant an entitlement merely because the frontend reports success.

Payment confirmation must come through the trusted backend/provider flow.

Payments must be idempotent.

Provider callbacks must handle:

* Duplicate delivery
* Delayed delivery
* Failed payment
* Cancelled payment
* Incorrect amount
* Incorrect order
* Replay attempts
* Unknown transaction

Never expose payment secrets.

Never log sensitive payment credentials.

---

# 26. ENTITLEMENT RULE

Access to premium resources is entitlement-based.

Entitlements follow the permanent resource identity across versions.

Do not make access depend on a particular physical file.

If a resource receives a new version, valid entitlement should continue according to the approved product rules.

---

# 27. CONTRIBUTOR RULES

Contributor identity is separate from user identity.

Contributor verification is separate from resource verification.

Being a teacher does not automatically make someone a verified contributor.

Being a contributor does not automatically make every submitted resource verified.

Contributor submissions must pass the normal processing and quality workflow.

Admin retains final authority over publication and pricing.

---

# 28. EDUCATION UPDATES RULE

Education Updates are a dedicated content entity.

Do not model every education update as a resource.

Updates must have their own:

* Identity
* Publication lifecycle
* Categories
* SEO metadata
* Curriculum relationships
* Resource relationships

---

# 29. SEARCH RULES

MVP search uses PostgreSQL full-text search.

Search must be implemented behind a SearchProvider abstraction.

Do not expose PostgreSQL-specific search behaviour directly throughout the frontend.

Search ranking should consider appropriate signals such as:

* Relevance
* Quality
* Freshness
* Popularity
* Usage
* Context

Premium status must not automatically outrank a more relevant or higher-quality free resource.

Search architecture must allow a future dedicated search engine without requiring a public API redesign.

---

# 30. SEO RULES

Public pages should be designed for search engines from the beginning.

Use:

* Clean URLs
* Stable identities
* Canonical URLs
* Sitemap generation
* Structured data
* Breadcrumbs
* Useful metadata
* Internal linking
* Mobile performance

A slug is not the identity of a resource.

Changing a slug requires redirect handling.

Do not create thousands of thin pages simply for SEO.

SEO content must provide genuine educational value.

---

# 31. API RULES

The frontend must never directly access PostgreSQL.

Use:

```text
Frontend
   ↓
API
   ↓
Controller
   ↓
Service
   ↓
Repository
   ↓
PostgreSQL
```

Controllers should be thin.

Business logic belongs in services.

Database access belongs in repositories/data-access modules.

API inputs must be validated.

API responses should be consistent.

Internal database errors must not be exposed directly.

Use versioned API routes:

```text
/api/v1/
```

---

# 32. API DESIGN RULES

Prefer predictable REST-style naming.

Use resource-oriented endpoints.

Use pagination for large collections.

Do not return massive datasets by default.

Validate query parameters.

Validate request bodies.

Validate path parameters.

Use appropriate HTTP status codes.

Protect sensitive endpoints.

Use idempotency where necessary.

---

# 33. BACKGROUND JOB RULES

Use background jobs for expensive or asynchronous operations including:

* File processing
* OCR
* Thumbnail generation
* Preview generation
* Search indexing
* PDF generation
* Email
* SMS
* Notifications
* Analytics processing
* Retention processing
* Payment reconciliation

Do not make a normal user request wait unnecessarily for expensive processing.

Jobs must support:

* Status
* Retry
* Failure reporting
* Attempt tracking
* Error information

---

# 34. THIRD-PARTY PROVIDER RULE

Use provider abstractions where external services are involved.

Examples:

```text
StorageProvider
PaymentProvider
EmailProvider
SmsProvider
SearchProvider
PdfProvider
AiProvider
```

Do not spread provider-specific implementation throughout the application.

The provider can change without forcing the entire application to change.

---

# 35. AI USAGE RULE

AI is optional infrastructure, not the foundation of the platform.

Do not add AI simply because the platform is described as intelligent.

Use normal deterministic software when it is sufficient.

The core platform must function without AI.

AI may assist with:

* Metadata suggestions
* Classification suggestions
* Other approved intelligence features

AI-generated results must be validated before becoming authoritative data.

Do not allow AI to silently publish authoritative educational metadata.

Avoid unnecessary paid AI APIs.

Prefer free/open-source/local solutions where practical.

---

# 36. DEPENDENCY RULE

Do not install a package simply because it is popular.

Before installing a dependency:

1. Determine whether the current stack can solve the problem.
2. Confirm that the dependency is necessary.
3. Prefer mature and maintained packages.
4. Consider security and maintenance implications.
5. Avoid duplicate libraries performing the same function.

After adding an important dependency, explain why it was added.

---

# 37. NO PREMATURE INFRASTRUCTURE RULE

Do not introduce:

* Microservices
* Kubernetes
* Dedicated search clusters
* Multiple queues
* Multiple databases
* Complex event streaming
* AI infrastructure
* Multiple payment gateways

until the actual project requirements justify them.

Start simple.

Keep abstraction boundaries that allow future growth.

---

# 38. FRONTEND RULES

The frontend must be:

* Responsive
* Mobile-first
* Accessible
* Low-bandwidth conscious
* SEO-friendly where public
* Clear
* Fast

Do not create unnecessary animations.

Do not create intrusive registration prompts.

Do not hide important resources behind UI complexity.

---

# 39. RESOURCE CARD RULE

Resource cards must follow the approved visual hierarchy.

Show:

* Resource title
* 2–3 useful metadata items
* Free/Premium status
* Verified status where applicable
* Resource-type indication
* Branded/generated thumbnail

Avoid clutter such as:

* Internal IDs
* Technical filenames
* Database fields
* Excessive timestamps
* Unnecessary counters

---

# 40. ACCESSIBILITY RULE

Target WCAG 2.2 AA.

Support:

* Keyboard navigation
* Semantic HTML
* Screen readers
* Adequate contrast
* Visible focus states
* Accessible forms
* Meaningful labels
* Alt text where appropriate
* Non-colour-only indicators

Do not treat accessibility as a post-launch feature.

---

# 41. PERFORMANCE RULES

Avoid:

* N+1 database queries
* Unnecessary API calls
* Huge frontend bundles
* Unoptimized images
* Blocking expensive operations
* Repeated database queries for identical public data

Use caching where justified.

Use pagination.

Use CDN delivery for appropriate public assets.

Optimize for mobile and slower networks.

Do not optimize blindly; measure where possible.

---

# 42. ANALYTICS RULES

Analytics use a centralized event model.

Events should support:

* Anonymous actors
* Authenticated actors
* Context
* Entity relationships
* Country context
* Time

Minimize sensitive information.

Analytics must not become a dumping ground for arbitrary personal information.

Do not make transactional database tables carry excessive analytics fields.

---

# 43. AUDIT RULES

Important administrative and business actions must be auditable.

Audit logs must be append-only.

Audit important changes including:

* Permissions
* Publication
* Verification
* Financial actions
* Rights
* Resource changes
* Contributor decisions
* Retention/deletion
* Administrative actions

Do not casually modify or delete audit history.

---

# 44. RETENTION RULES

Data retention must follow configured policies.

Different categories may have different retention periods.

Users may clear eligible personal activity.

Some records may require anonymization rather than deletion.

Critical business records may need long-term retention.

Retention actions must themselves be auditable.

---

# 45. ERROR HANDLING RULES

Errors must be:

* Predictable
* Structured
* Logged appropriately
* Safe for users

Never expose:

* Stack traces
* SQL queries
* Secrets
* Internal infrastructure details
* Authentication information

to normal users.

Use request IDs so errors can be traced internally.

---

# 46. LOGGING RULES

Use structured logs.

Logs should help diagnose:

* API failures
* Authentication failures
* Payment problems
* File-processing failures
* Job failures
* Database problems
* Security events

Never log:

* Passwords
* Raw session tokens
* Secret keys
* Payment secrets
* Unnecessary sensitive personal data

---

# 47. TESTING RULE

A feature is not complete merely because it works once in the browser.

Every significant feature should have appropriate tests.

Consider:

* Unit tests
* Integration tests
* API tests
* Database tests
* Authorization tests
* End-to-end tests
* Regression tests

Critical business rules must have automated tests.

---

# 48. SECURITY TESTING

Security tests must verify both allowed and denied behaviour.

For example:

```text
Authorized user → allowed

Unauthenticated user → denied

Wrong user → denied

Insufficient permission → denied

Expired permission → denied
```

Do not only test the happy path.

---

# 49. PAYMENT TESTING

Payment functionality must be tested for failure conditions.

At minimum test:

* Successful payment
* Failed payment
* Cancelled payment
* Duplicate callback
* Delayed callback
* Incorrect amount
* Incorrect order
* Replayed callback
* Duplicate entitlement attempt

---

# 50. FILE TESTING

Test:

* Valid file
* Unsupported file
* Corrupt file
* Duplicate file
* Large file
* Processing failure
* Processing retry
* Quarantined file
* Missing derivative
* Expired download URL
* Unauthorized download

---

# 51. CALENDAR TESTING

Test:

* Official calendar ownership
* School calendar ownership
* User calendar ownership
* Anonymous session ownership
* Unauthorized access
* Event date validity
* Event time validity
* Recurrence
* Expiry
* PDF generation
* Transfer from anonymous session to authenticated account where implemented

---

# 52. IMPLEMENTATION SCOPE RULE

Work only on the task currently assigned.

If asked to implement:

```text
Geography
```

do not simultaneously implement:

* Authentication
* Payments
* Search
* Recommendations
* Calendar

unless explicitly required.

Avoid scope creep.

---

# 53. BEFORE CODING

Before making significant changes, the AI must:

1. Read relevant documentation.
2. Inspect the current implementation.
3. Identify affected files.
4. Identify affected database objects.
5. Identify affected APIs.
6. Identify required tests.
7. Check for existing reusable code.
8. Confirm that the implementation does not violate a locked decision.

Then implement.

---

# 54. AFTER CODING

After implementation:

1. Run relevant tests.
2. Run type checking.
3. Run build.
4. Inspect the changed files.
5. Check for accidental changes.
6. Check security implications.
7. Check database migration integrity.
8. Update implementation status.
9. Report results.
10. STOP.

Do not automatically start the next feature.

---

# 55. GIT RULE

Use Git continuously.

Create a meaningful commit after each successfully completed bounded milestone.

Examples:

```text
chore: bootstrap project
feat: implement database foundation
feat: implement geography taxonomy
feat: implement curriculum model
feat: implement resource engine
feat: implement public catalogue
fix: enforce resource publication validation
```

Do not combine unrelated features into one commit.

---

# 56. NEVER DESTROY WORKING CODE

Do not rewrite large parts of the application merely because another implementation appears cleaner.

Prefer incremental changes.

Before deleting substantial code, determine:

* Why it exists
* What depends on it
* Whether tests cover it
* Whether the replacement preserves behaviour

If uncertain, report before deleting.

---

# 57. NO FAKE IMPLEMENTATIONS

Do not claim a feature is implemented when it is only visually mocked.

Examples of unacceptable fake implementation:

* Fake payment success
* Fake authentication
* Fake database persistence
* Fake download security
* Fake analytics
* Hardcoded search results
* Hardcoded dashboard statistics
* UI buttons that do nothing

If a feature is intentionally mocked for development, label it clearly as a mock/test implementation.

---

# 58. NO HARDCODED BUSINESS DATA

Do not hardcode data that belongs in the database.

Examples:

* Resource types
* Curriculum subjects
* Grades
* Pathways
* Calendar event types
* School types
* Quality labels
* Permissions
* Configurable categories

Configuration belongs in appropriate database/configuration structures.

---

# 59. CONFIGURATION RULE

Environment-specific values must not be hardcoded.

Examples:

* Database URLs
* API keys
* Payment credentials
* Storage credentials
* Email credentials
* SMS credentials
* Session secrets
* Production URLs

Use environment variables or secure secret management.

---

# 60. ENVIRONMENT RULE

Maintain clear separation between:

```text
Development
Staging
Production
```

Do not accidentally connect development code to production databases or payment credentials.

Do not use production files for testing unless explicitly approved.

---

# 61. DEPLOYMENT RULE

Production deployments must use repeatable processes.

Before production:

* Run tests
* Run typecheck
* Build
* Validate migrations
* Verify environment configuration
* Verify secrets
* Verify backups
* Verify monitoring

Do not deploy unfinished features merely because the application compiles.

---

# 62. BACKUP RULE

The production database must have appropriate automated backups.

Object storage must have appropriate redundancy/protection.

Restore procedures must be tested.

A backup that has never been restored should not be assumed to be reliable.

---

# 63. SEARCH INDEX RULE

The database remains the source of truth.

Search indexes are derived data.

When a resource becomes publicly searchable:

```text
Database publication
        ↓
Search indexing job
        ↓
Search index
```

When a resource becomes unavailable:

```text
Database status
        ↓
Search removal/update
```

A search-index failure must not corrupt the authoritative resource record.

---

# 64. CACHE RULE

Caches are derived data.

Never make the cache the source of truth.

If cache refresh fails, retain the last known good result where safe.

Cache invalidation must occur when important public content changes.

---

# 65. PROVIDER FAILURE RULE

External services can fail.

The application must handle:

* Timeout
* Temporary failure
* Rate limit
* Invalid response
* Provider outage
* Duplicate response
* Delayed response

Do not assume external services are always available.

---

# 66. DATA INTEGRITY RULE

For operations that modify several related records, use database transactions where appropriate.

Examples:

```text
Order
+
Payment
+
Entitlement
```

must not leave the database in an inconsistent state.

If a multi-step operation fails, the system must either recover safely or leave a known recoverable state.

---

# 67. IDEMPOTENCY RULE

Critical operations must be safe against accidental repetition.

Especially:

* Payments
* Payment callbacks
* Entitlement creation
* Important background jobs
* Some publication operations
* Other explicitly identified critical actions

Repeating a request must not accidentally create duplicate financial or access records.

---

# 68. PRIVACY RULE

Privacy must be considered during feature design.

Before collecting a new user attribute, ask:

> Is this actually required?

Do not collect information merely because it may be useful for future personalization.

---

# 69. STUDENT DATA RULE

Use additional care with student-related information.

Minimize collection.

Avoid unnecessary personally identifiable information.

Do not expose student information publicly.

Use stricter retention where appropriate.

Do not create unnecessary public student profiles.

---

# 70. COMMERCIAL FAIRNESS RULE

Premium content must not corrupt discovery quality.

Premium status is a commercial signal, not a substitute for:

* Relevance
* Quality
* Curriculum suitability

The platform should remain useful to users who never purchase anything.

---

# 71. CONTENT QUALITY RULE

The platform's competitive advantage is quality, not merely quantity.

Do not automatically mark content as Verified.

Do not expose numerical quality ratings.

Verification requires the approved review process.

Quality deterioration should create review signals rather than silently deleting content.

---

# 72. RIGHTS AND PROVENANCE RULE

Resources must preserve appropriate:

* Origin
* Attribution
* Source
* Ownership
* Distribution rights
* Rights status

Do not assume that publicly available material is automatically freely redistributable.

Rights information must be respected during publication and download.

---

# 73. PUBLICATION SAFETY RULE

A resource must not become publicly visible merely because an administrator uploaded a file.

Publication must pass the required checks.

Where appropriate:

```text
Draft
→ Review
→ Approved
→ Published
```

must be enforced.

---

# 74. ADMIN SAFETY RULE

Administrative interfaces are high-risk areas.

Every administrative operation must check:

* Authentication
* Permission
* Scope
* Resource ownership where applicable
* Valid state transition

Important operations should produce audit records.

Do not hide dangerous operations behind UI alone.

---

# 75. DOCUMENTATION RULE

When an implementation changes architecture or important behaviour, update the appropriate documentation.

Keep:

```text
IMPLEMENTATION_STATUS.md
```

accurate.

Do not claim unfinished functionality as complete.

---

# 76. NO SILENT ARCHITECTURAL CHANGE

The AI must STOP before silently changing:

* Database relationships
* Authentication model
* Authorization model
* Resource identity
* Versioning
* Entitlement model
* Payment flow
* Calendar ownership
* File architecture
* Search abstraction
* Provider abstraction
* Public/authenticated access model

Explain the issue and request approval.

---

# 77. CODE QUALITY RULE

Prefer:

* Clear naming
* Small modules
* Explicit interfaces
* Typed data
* Reusable services
* Predictable error handling
* Testable functions

Avoid:

* Giant files
* Giant functions
* Hidden global state
* Duplicate business logic
* Magic values
* Unnecessary abstraction
* Clever code that is difficult to maintain

---

# 78. BEGINNER-FRIENDLY IMPLEMENTATION RULE

The project owner is using AI-assisted/vibe coding.

Therefore implementation should remain understandable.

Do not create unnecessarily sophisticated code merely to demonstrate technical complexity.

When a complicated pattern is genuinely required, document why.

---

# 79. CHANGE REPORT RULE

After every implementation task, provide:

```text
## Implemented

...

## Files Changed

...

## Database Changes

...

## API Changes

...

## Tests Added/Updated

...

## Verification

Typecheck: PASS/FAIL
Tests: PASS/FAIL
Build: PASS/FAIL

## Security Considerations

...

## Known Issues

...

## Documentation Updated

...

## Recommended Next Step

...

```

Then STOP.

---

# 80. DEFINITION OF DONE

A feature is considered complete only when:

* It implements the approved requirement.
* It integrates with the existing architecture.
* It does not violate locked decisions.
* Required database migrations exist.
* Required constraints exist.
* Required API validation exists.
* Required authorization exists.
* Relevant tests exist.
* Type checking passes.
* Build passes.
* Important errors are handled.
* Documentation/status is updated.
* The implementation has been reviewed.

"Works on my screen" is not sufficient.

---

# 81. AI IMPLEMENTATION LOOP

Every development task follows:

```text
READ
 ↓
UNDERSTAND
 ↓
INSPECT
 ↓
PLAN
 ↓
IMPLEMENT
 ↓
TEST
 ↓
TYPECHECK
 ↓
BUILD
 ↓
REVIEW
 ↓
REPORT
 ↓
STOP
```

Never skip directly from:

```text
READ
```

to:

```text
IMPLEMENT EVERYTHING
```

---

# 82. WHEN TO ASK THE PROJECT OWNER

Ask for clarification or STOP when:

* A locked decision conflicts with implementation reality.
* Two approved documents conflict.
* A security decision is unclear.
* Payment behaviour is unclear.
* User ownership is unclear.
* A migration could destroy data.
* A legal/rights issue affects publication.
* A third-party provider requirement is unclear.
* A proposed dependency materially changes architecture.
* A feature cannot be implemented without changing a locked decision.

Do not ask unnecessary questions when the specification already answers the issue.

---

# 83. WHEN NOT TO ASK

Do not ask the project owner about matters already explicitly decided.

Do not reopen locked decisions because:

* A framework prefers another pattern.
* An ORM recommends another schema.
* A tutorial uses another architecture.
* Another website uses another approach.
* A library makes another model easier.
* The AI personally prefers another design.

Implement the approved architecture.

---

# 84. FINAL PRINCIPLE

The goal is not to generate the largest amount of code.

The goal is to build a reliable education platform incrementally.

Prioritize:

```text
Correctness
Security
Data integrity
Maintainability
Performance
Accessibility
SEO
User experience
Cost control
Future flexibility
```

over:

```text
Speed of code generation
Number of features
Number of dependencies
Technical complexity
AI-generated novelty
```

The AI must behave as a disciplined senior implementation engineer working under an approved architecture.

It must build carefully, test continuously, preserve decisions, and stop when a decision requires human approval.
