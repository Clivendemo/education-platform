# ARCHITECTURE

## 1. Purpose

This document defines the technical architecture of the education-resource platform.

It describes:

- Application structure
- Frontend architecture
- Backend architecture
- Database architecture
- Storage architecture
- Search architecture
- Authentication
- Authorization
- Background jobs
- External providers
- API architecture
- Caching
- CDN delivery
- Analytics
- Observability
- Environments
- Deployment
- Scalability
- Disaster recovery
- Africa-readiness

This document defines how the system is structured.

It does not replace:

- `AI_DEVELOPER_RULES.md` for AI development behaviour
- `PROJECT_VISION.md` for product goals
- `DATABASE_SPEC.md` for detailed database design
- `API_SPEC.md` for API contracts
- `SECURITY_RULES.md` for detailed security requirements
- `IMPLEMENTATION_STATUS.md` for actual implementation status

---

# 2. Architectural Philosophy

The platform should use a modular, maintainable architecture that can initially be operated without unnecessary infrastructure complexity.

The initial backend architecture is a:

> Modular monolith with clear internal boundaries.

The system should not begin as a collection of microservices.

The architecture should nevertheless maintain clear modules so that individual components can be extracted or scaled independently in the future if justified.

The primary principle is:

> Start simple enough to operate, but structured enough to grow.

---

# 3. High-Level Architecture

The intended architecture is:

```text
                    INTERNET
                       │
                       ▼
                ┌─────────────┐
                │     CDN     │
                │ Cache/Edge  │
                └──────┬──────┘
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
      ┌──────────────┐    ┌──────────────┐
      │ Public Web   │    │ Shared App   │
      │ Frontend     │    │ Frontend     │
      └──────┬───────┘    └──────┬───────┘
             │                   │
             └─────────┬─────────┘
                       │ HTTPS/API
                       ▼
              ┌──────────────────┐
              │ Backend API      │
              │ Fastify/Node.js  │
              │ TypeScript       │
              └────────┬─────────┘
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
 ┌───────────┐   ┌────────────┐   ┌─────────────┐
 │ PostgreSQL│   │ Job/Queue  │   │ Object      │
 │           │   │ System     │   │ Storage     │
 └───────────┘   └────────────┘   └─────────────┘
                       │
             ┌─────────┼──────────┐
             │         │          │
             ▼         ▼          ▼
          Email      Payment    Other
          Provider   Provider   Providers

The exact hosting vendors may change.

The architectural interfaces should remain stable.

4. Major System Components

The platform consists of the following major components:

Public SEO frontend
Shared authenticated application frontend
Administrative frontend
Backend API
PostgreSQL database
Object storage
CDN
Background job system
Search subsystem
Authentication subsystem
Commerce/payment subsystem
Notification subsystem
Analytics subsystem
Governance subsystem
External provider adapters
Monitoring and observability
5. Frontend Architecture
5.1 Public Frontend

The public frontend is responsible for:

Homepage
Resource catalogue
Resource pages
Search
Curriculum pages
Subject pages
Grade/Form pages
Topic pages
Collections
Schools
Contributors
Education Updates
Calendar
Public help/FAQ
SEO landing pages

Public pages are a major search-engine entry point.

The public frontend should prioritize:

Server rendering or equivalent SEO-friendly rendering
Fast first load
Mobile performance
Progressive enhancement
Accessible HTML
Structured metadata
Stable URLs
Cacheability
6. Shared Application Frontend

The shared application frontend handles authenticated functionality such as:

User account
My Library
Saved resources
Preferences
Follows
Purchase history
Entitlements
Persistent calendar
Contributor workspace where applicable
Other identity-dependent features

The public frontend and authenticated application may share components and design systems.

They should not duplicate business logic.

Business rules belong primarily in the backend.

7. Administrative Frontend

The administrative interface is isolated logically from ordinary public functionality.

It should provide workflow-oriented interfaces for:

Resource management
Resource versions
File processing
Taxonomy
Schools
Collections
Bundles
Users
Roles
Permissions
Verification
Contributors
Education Updates
Calendar
Requests
Feedback
Reports
Commerce
Analytics
Governance

Administrative routes must always enforce server-side authorization.

Hiding an admin button is not considered authorization.

8. Frontend Route Architecture

Routes should reflect the platform's information architecture.

Conceptually:

/
├── resources/
├── search/
├── teachers/
├── students/
├── schools/
├── contributors/
├── collections/
├── updates/
├── calendar/
├── premium/
├── help/
├── account/
├── library/
└── admin/

Country-aware routes should be supported architecturally.

Future examples may include:

/ke/...
/ug/...
/tz/...

The exact final route implementation may evolve.

Permanent internal IDs remain the authoritative identity.

9. Backend Architecture

The backend uses:

Node.js
TypeScript
Fastify
PostgreSQL
Drizzle ORM
Zod
Secure cookie-based sessions
Background jobs
Provider abstractions

The backend is a modular monolith.

10. Backend Module Boundaries

The backend should be organized into logical modules.

A conceptual structure is:

backend/
├── src/
│   ├── app/
│   ├── config/
│   ├── plugins/
│   ├── middleware/
│   ├── modules/
│   │   ├── platform/
│   │   ├── geography/
│   │   ├── schools/
│   │   ├── taxonomy/
│   │   ├── resources/
│   │   ├── files/
│   │   ├── collections/
│   │   ├── identity/
│   │   ├── authentication/
│   │   ├── rbac/
│   │   ├── activity/
│   │   ├── requests/
│   │   ├── feedback/
│   │   ├── notifications/
│   │   ├── commerce/
│   │   ├── contributors/
│   │   ├── updates/
│   │   ├── calendar/
│   │   ├── analytics/
│   │   ├── governance/
│   │   ├── search/
│   │   └── administration/
│   ├── providers/
│   ├── jobs/
│   ├── db/
│   └── server.ts
└── tests/

The exact folder structure may evolve if it remains consistent with the architectural boundaries.

11. Layering

Backend modules should generally separate:

Route / Controller
       ↓
Application Service
       ↓
Domain / Business Logic
       ↓
Repository / Data Access
       ↓
PostgreSQL

External providers should be accessed through adapters/interfaces.

Routes should not contain large amounts of business logic.

Database queries should not be scattered throughout unrelated modules.

12. API Architecture

The backend exposes a versioned API.

Initial API namespace:

/api/v1/

The API should be frontend-independent.

The API must not assume that only the current frontend will consume it.

Future clients may include:

Web frontend
Mobile applications
Administrative interfaces
Partner integrations
Internal tools
13. API Principles

API endpoints should:

Validate input
Authenticate where required
Authorize actions
Return predictable response structures
Use appropriate HTTP status codes
Avoid leaking internal information
Support pagination
Support filtering where appropriate
Support sorting where appropriate
Be idempotent where required
Generate/request correlation IDs
Produce structured errors

The detailed endpoint contracts belong in API_SPEC.md.

14. Database Architecture

PostgreSQL is the primary transactional database.

The database is a first-class part of the architecture.

The platform uses PostgreSQL for:

Core entities
Curriculum taxonomy
Resource metadata
Resource versions
Users
Authentication metadata
RBAC
Commerce
Contributors
Calendar
Updates
Governance
Analytics
Search indexing data
Other structured platform information

Binary files do not belong directly in PostgreSQL.

15. PostgreSQL Schemas

Logical database schemas include:

platform
taxonomy
content
files
commerce
identity
community
calendar
analytics
governance
system

Each schema groups related functionality.

This is intended to improve:

Organization
Ownership
Security boundaries
Maintainability
Database readability
16. Database Migration Authority

Database migrations are explicit SQL files.

The migration system is authoritative.

The ORM must not silently redesign or mutate the production schema.

Migration changes must be:

Reviewable
Versioned
Repeatable
Tested
Ordered
Safe to deploy

Schema changes should be introduced through migrations rather than manual production edits.

17. ORM Role

Drizzle ORM is used for:

Type-safe application database access
Query construction
Application-level database integration
Developer productivity

Drizzle must not become an uncontrolled alternative source of truth for database architecture.

Explicit SQL migrations remain authoritative.

18. Resource Architecture

Resources are central platform entities.

The conceptual structure is:

RESOURCE
   │
   ├── VERSION 1
   │      ├── FILES
   │      └── CLASSIFICATION
   │
   ├── VERSION 2
   │      ├── FILES
   │      └── CLASSIFICATION
   │
   └── VERSION N

The resource has a permanent UUID.

Versions preserve the identity of the resource.

Files belong to versions.

19. Resource Classification Architecture

Resources can be associated with:

Curriculum versions
Grade/Form levels
Resource types
Subject
Topic

The classification model is relational rather than hardcoded into application logic.

Curriculum structure is:

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

The database remains flexible enough to support different educational systems.

20. File Architecture

Files are stored in object storage.

PostgreSQL stores file metadata.

Conceptually:

PostgreSQL
    │
    └── File metadata
            │
            ├── UUID
            ├── storage key
            ├── MIME type
            ├── checksum
            ├── size
            ├── processing status
            └── metadata

Object Storage
    │
    ├── Original
    ├── Thumbnail
    ├── Preview
    └── Other derivatives

Original uploaded files are immutable.

21. Storage Provider Abstraction

The platform uses a:

StorageProvider

interface.

The application should not become tightly coupled to one storage vendor.

The provider should support operations such as:

Upload
Read metadata
Generate protected access
Delete where permitted
Create derivatives where appropriate
Check object existence

Provider-specific credentials remain outside application source code.

22. File Processing Architecture

File processing is asynchronous.

Conceptually:

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

Each stage should have a traceable status/history.

Failures should be recoverable.

23. Background Jobs

Expensive or asynchronous operations should not unnecessarily block HTTP requests.

Examples:

File processing
OCR where required
Thumbnail generation
Preview generation
Search indexing
PDF generation
Email delivery
SMS delivery
Analytics processing
Notifications
Scheduled publication
Scheduled archive/unpublish
Other expensive operations

A Redis-compatible queue may be introduced when background processing is implemented.

The queue should not be installed prematurely if no current feature requires it.

24. Job Architecture

Jobs should support:

Unique job IDs
Status
Attempts
Retry policy
Error information
Timestamps
Worker reference
Idempotency
Dead/failure handling
Administrative visibility where appropriate

Retries should be controlled.

Repeated failure should eventually require intervention rather than infinite retry loops.

25. Search Architecture

The initial search implementation uses PostgreSQL full-text search.

Search is accessed through:

SearchProvider

The application should not expose PostgreSQL-specific search implementation details to the frontend.

Conceptually:

Frontend
   ↓
Search API
   ↓
Search Service
   ↓
SearchProvider
   ↓
PostgreSQL FTS

A future dedicated search engine can replace the provider implementation.

26. Search Index

Search indexing should be separate conceptually from transactional resource data.

Publishing a resource should trigger indexing.

Unpublishing a resource should remove it from public search.

Indexing should be asynchronous where appropriate.

The system should support a full rebuild.

Search ranking should combine:

Text relevance
Quality
Freshness
Popularity
Usage
Context
Other approved signals
27. Authentication Architecture

Authentication identity is separate from the user profile.

Conceptually:

User
  │
  └── Authentication Identity
           ├── Email/password
           └── Future providers

Initial authentication supports:

Email
Password
Secure sessions
Password recovery
Email verification architecture

Future authentication providers should use an abstraction rather than redesigning the user model.

28. Session Architecture

Sessions should be:

Secure
Expirable
Revocable
Device-aware where supported
Stored safely
Protected against token leakage

Session identifiers must not be exposed unnecessarily.

Authentication cookies should use appropriate security attributes.

29. Authorization Architecture

Authorization uses:

User
 ↓
Role
 ↓
Permission

Permissions may be scoped.

A user may have multiple roles.

Roles may have:

Status
Start date
End date
Scope

Server-side authorization is mandatory.

The frontend is never the authorization boundary.

30. Administrative Security Boundary

Administrative operations require stronger controls.

Sensitive operations may require:

Strong authentication
MFA
Specific permission
Scope verification
Audit logging
Confirmation where appropriate

Examples:

Changing permissions
Publishing sensitive content
Changing financial configuration
Changing payment settings
Rights decisions
Destructive administrative operations
31. Commerce Architecture

Commerce is separated from resource identity.

The conceptual model is:

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
   ↓
Access

Pricing and commercial state should not be embedded directly into the core resource identity.

32. Payment Provider Architecture

Payments use:

PaymentProvider

The core commerce system should not depend directly on M-Pesa-specific implementation details.

The provider adapter handles provider-specific operations.

The commerce system remains responsible for:

Orders
Payments
State
Entitlements
Idempotency
Reconciliation
33. M-Pesa Architecture

The initial Kenyan payment provider is M-Pesa.

The conceptual flow is:

User
 ↓
Order
 ↓
Payment Request
 ↓
M-Pesa
 ↓
Callback / Verification
 ↓
Payment Confirmation
 ↓
Entitlement
 ↓
Protected Access

Frontend success messages are not authoritative.

The backend verifies payment status before granting entitlement.

34. Entitlement Architecture

Entitlements determine access to purchased content.

An entitlement is linked to the permanent resource identity.

Therefore, resource version changes should not unnecessarily invalidate legitimate ownership.

The access flow is:

Download Request
      ↓
Authentication
      ↓
Entitlement Check
      ↓
Resource/File Validation
      ↓
Signed Delivery

The frontend cannot bypass this flow.

35. Calendar Architecture

The calendar is a first-class subsystem.

It supports four scopes:

OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION

The system separates official calendar data from personal calendar data.

Anonymous users can create temporary calendar data tied to a session.

Authenticated users can maintain persistent calendars.

Calendar rendering may combine multiple sources without merging their ownership.

36. Calendar Export Architecture

The initial export format is PDF.

PDF generation should use:

PdfProvider

Exports may be generated synchronously for small requests or asynchronously where appropriate.

Generated temporary files should use controlled storage and short-lived access.

Future formats may include:

ICS
XLSX
CSV
37. Education Updates Architecture

Education Updates are separate from Resources.

They have their own:

Entity
Lifecycle
Categories
SEO metadata
Curriculum relationships
Resource relationships
Search/discovery

They should not reuse the resource/file model merely for convenience.

38. Contributor Architecture

Contributor functionality is a separate community module.

The conceptual flow is:

User
 ↓
Contributor Application
 ↓
Approval
 ↓
Contributor Profile
 ↓
Submission
 ↓
Processing
 ↓
Review
 ↓
Publication
 ↓
Earnings

Contributor verification and resource verification are separate.

Contributor suspension must preserve historical submissions and financial records.

39. Collections Architecture

Collections are editorial/discovery entities.

A collection can contain multiple resources.

Collection membership includes explicit ordering.

Collections may be:

Controlled
Public
Private
Moderated

Collections and commercial bundles are separate concepts.

40. Bundle Architecture

Bundles belong to commerce.

A bundle may contain multiple resources.

Bundles cannot contain other bundles.

A bundle has its own commercial identity and price.

41. User Activity Architecture

Activity should be represented separately from core resource entities.

Activity may include:

Views
Searches
Previews
Downloads
Saves
Shares
Purchases
Requests
Feedback
Calendar activity

Anonymous activity may be tied to browser/session identifiers.

Authenticated activity may be associated with the user's account.

42. Personalization Architecture

Personalization uses:

Explicit preferences
Follows
Activity signals
Structured education context

The personalization layer should not modify core resource truth.

It produces discovery/recommendation signals.

The platform should continue functioning without personalization.

43. Recommendation Architecture

Recommendations should be implemented behind a recommendation/intelligence interface.

Conceptually:

Frontend
   ↓
Recommendation API
   ↓
Recommendation Service
   ↓
Signals
   ↓
Recommendation Provider

The initial implementation should prefer conventional algorithms and structured signals.

AI is optional.

44. Notification Architecture

Notifications are centralized.

Conceptually:

Event
 ↓
Notification
 ↓
Delivery
 ├── In-App
 ├── Email
 └── SMS

Email is the primary communication channel.

SMS is secondary.

Delivery status and retries should be tracked.

45. Email Architecture

Email should use:

EmailProvider

The platform should support multiple providers over time.

Templates should be centralized.

Templates should distinguish:

Transactional
Marketing

Users should have appropriate controls for optional communications.

Critical transactional communications may follow different rules.

46. SMS Architecture

SMS should use:

SmsProvider

The implementation should be provider-independent.

SMS should be used selectively because it has a direct operational cost.

47. Analytics Architecture

Analytics uses a centralized event model.

Conceptually:

Application Events
       ↓
Analytics Event
       ↓
Analytics Storage
       ↓
Dashboards / Intelligence

Analytics should be separated from the main transactional workload where scale requires it.

The event model should support:

Anonymous actors
Authenticated actors
Entity context
Country
Event type
Structured metadata
48. Governance Architecture

Governance functionality handles:

Quality
Verification
Rights
Publication
Corrections
Retention
Audit
Review workflows

Governance actions should produce audit records.

49. Audit Architecture

Important administrative and system actions should produce append-only audit records.

Examples:

Permission changes
Publication
Unpublication
Verification
Rights decisions
Financial changes
Contributor status
Retention actions
Other sensitive operations

Audit records should not be casually edited or deleted.

50. Caching Architecture

Caching should be layered.

Potential layers include:

Browser
   ↓
CDN
   ↓
Application Cache
   ↓
Database

Caching should be based on data volatility.

Highly volatile or user-specific data should not receive inappropriate public caching.

Public pages should be highly cacheable where safe.

51. Cache Invalidation

Important content changes should trigger appropriate invalidation.

Examples:

Resource publication
Resource unpublication
Resource update
Collection update
Homepage configuration change
Education Update publication
Taxonomy changes

Cache invalidation should not expose stale restricted information.

52. CDN Architecture

The CDN should serve:

Public static assets
Cacheable public pages
Appropriate public previews
Protected file delivery through controlled mechanisms where supported

Premium files require protected access.

Signed URLs or equivalent controlled delivery should be used.

Permanent unrestricted premium file URLs must not be exposed.

53. Image Architecture

Images should be optimized for:

Mobile
Desktop
Low bandwidth

The platform should support:

Responsive image sizes
Lazy loading where appropriate
Optimized formats
Thumbnail generation
Branded covers
Administrative custom covers

Images should not unnecessarily block page rendering.

54. SEO Architecture

SEO is implemented across the public frontend and backend content APIs.

Indexable entities may include:

Resources
Collections
Curricula
Subjects
Grades/Forms
Topics
Schools
Contributors
Education Updates
Other useful landing pages

The system should generate:

Canonical URLs
Metadata
Structured data
Breadcrumbs
Sitemaps
55. Sitemap Architecture

Sitemaps should be divided by content type where useful.

Potential groups include:

Resources
Collections
Schools
Updates
Curriculum pages
Other indexable entities

Sitemaps should contain only eligible public URLs.

Unpublished, private or restricted pages should not accidentally enter public sitemaps.

56. Country Architecture

Country is a first-class platform entity.

Major entities that are country-specific should be associated with a country directly or indirectly.

The platform should not assume one global curriculum.

Country-specific configuration may include:

Country
 ├── Currency
 ├── Language
 ├── URL Prefix
 ├── Education Terminology
 ├── Payment Configuration
 └── Policy Configuration
57. Localization Architecture

The initial interface language is English.

The architecture should be localization-ready.

Localization should separate:

UI translations
Resource language
Education terminology
Search synonyms
Curriculum terminology

Translation should not automatically modify original resource content.

58. Provider Abstraction Architecture

External dependencies should use provider interfaces.

Required interfaces include:

PaymentProvider
StorageProvider
EmailProvider
SmsProvider
SearchProvider
PdfProvider
AiProvider

The application should depend on interfaces/contracts rather than vendor-specific implementations wherever practical.

59. AI Architecture

AI is optional.

Where used, AI should be accessed through:

AiProvider

AI may assist with:

Metadata suggestions
Classification suggestions
Editorial tasks
Other bounded tasks

AI must not become a mandatory dependency for:

Core resource discovery
Core file processing
Core search
Core recommendations
Core duplicate detection
Core quality decisions
Core content-gap detection

Human review remains authoritative for appropriate governance decisions.

60. Configuration Architecture

Configuration must be separated from source code.

Environment-specific values belong in environment configuration.

Examples include:

Database URLs
Storage credentials
Payment credentials
Email credentials
SMS credentials
Session secrets
API keys
Feature configuration

Secrets must never be committed to Git.

61. Environment Architecture

The platform uses three environments:

Development
Staging
Production

Each environment should have separate:

Database
Storage
Secrets
Payment credentials
External provider configuration

Development must not accidentally connect to production.

62. Development Environment

Development is for:

Local coding
Unit tests
Integration tests
Local database development where appropriate
Safe provider mocks
Feature development

Real production payment credentials must never be used casually in development.

63. Staging Environment

Staging should resemble production closely enough to test:

Migrations
Authentication
File processing
Search
Payments using appropriate test credentials
Background jobs
Deployment
SEO
Performance
End-to-end journeys

Staging data should remain separate from production data.

64. Production Environment

Production contains real:

Users
Resources
Files
Purchases
Entitlements
Analytics
Administrative data

Production changes require controlled deployment.

65. CI/CD Architecture

The project should use automated CI/CD.

A typical pipeline is:

Git Push
   ↓
Install Dependencies
   ↓
Lint
   ↓
Typecheck
   ↓
Unit Tests
   ↓
Integration Tests
   ↓
Build
   ↓
Migration Validation
   ↓
Deployment

Production deployment should be controlled.

66. Git Architecture

Git is the source-control system.

The main branch should remain deployable or close to deployable.

Changes should be:

Small
Understandable
Reviewable
Testable

AI-generated changes must not be accumulated indefinitely without checkpoints.

67. AI Development Architecture

AI coding agents are implementation assistants.

They do not replace architectural authority.

The development loop is:

Specification
     ↓
Bounded Task
     ↓
AI Implementation
     ↓
Tests
     ↓
Typecheck
     ↓
Build
     ↓
Human Inspection
     ↓
Git Commit
     ↓
Next Task

The AI should stop after completing its assigned scope.

68. Observability Architecture

The system should provide:

Structured logs
Request IDs
Error grouping
Health checks
Job monitoring
Payment monitoring
File-processing monitoring
Search monitoring
Infrastructure monitoring
Alerts

Logs should not unnecessarily expose sensitive user information.

69. Health Checks

The backend should expose a basic health endpoint.

Initial example:

GET /api/v1/health

Future health checks may distinguish:

Application health
Database health
Queue health
Storage health
Provider health

Health endpoints should not expose secrets or internal infrastructure details.

70. Error Architecture

Errors should be centralized.

The API should return predictable error structures.

Internal error details should not be exposed to public clients unnecessarily.

Errors should include enough information for support and debugging through internal logs.

71. Rate Limiting

Rate limiting should protect:

Authentication
Password recovery
Search
Autocomplete
Resource requests
Feedback
File operations
Payment operations
Admin endpoints
Other abuse-prone endpoints

Limits should be configurable.

72. Idempotency Architecture

Critical operations should support idempotency.

Examples:

Payments
Payment callbacks
Orders
Entitlements
File processing
Important background jobs
Other operations where duplicate execution could cause harm

Duplicate requests must not create duplicate financial or access records.

73. Data Integrity

The architecture should use multiple layers of protection:

Frontend validation
        +
API validation
        +
Application logic
        +
Database constraints
        +
Transactions

The database must protect important invariants.

74. Transactions

Multi-record operations that must succeed or fail together should use PostgreSQL transactions.

Examples:

Order creation
Payment confirmation
Entitlement creation
Important resource publication changes
Critical relationship changes
75. Concurrency

The system should account for concurrent operations.

Examples include:

Two admins editing content
Duplicate payment callbacks
Multiple downloads
Concurrent publication
Simultaneous user actions

Important state transitions should use appropriate transactional or locking mechanisms.

76. Scalability Strategy

The initial architecture should scale vertically and then horizontally where justified.

Likely scaling path:

Single Application
       ↓
Larger Application Resources
       ↓
Multiple Application Instances
       ↓
Separate Background Workers
       ↓
Specialized Services where justified

The platform should not introduce microservices simply because they are technically possible.

77. Database Scaling

Initial database scaling should prioritize:

Correct schema
Correct indexes
Efficient queries
Pagination
Connection management
Query monitoring

Later options may include:

Read replicas
Partitioning
Dedicated analytics storage
Search engine
Other scaling strategies

These should be introduced based on demonstrated need.

78. Analytics Scaling

Analytics should eventually be separated from transactional workloads.

The centralized event model should allow events to be moved or replicated to a dedicated analytics system later.

The application should not require a heavyweight analytics infrastructure on day one.

79. Search Scaling

PostgreSQL FTS is the initial search engine.

If search volume or complexity requires it, a dedicated engine may be introduced behind SearchProvider.

The public API should remain stable.

80. File Delivery Scaling

File delivery should rely on:

Object storage
CDN
Signed URLs
Range requests where appropriate
Caching where permitted

The backend should authorize access but should not unnecessarily stream every large file through the application server.

81. Backup Architecture

Backups should include:

PostgreSQL
Critical object-storage data
Appropriate configuration
Other critical persistent information

Backups should be separated from primary infrastructure.

Restore procedures must be tested.

82. Disaster Recovery

Disaster recovery should preserve:

Permanent UUIDs
Resource identities
Resource versions
Purchases
Entitlements
User relationships
Audit history
Critical files

The platform should define:

Recovery Point Objective (RPO)
Recovery Time Objective (RTO)

These values may be refined as operational requirements become clearer.

83. Security Architecture

Security is implemented across every layer.

Browser
   ↓
HTTPS/CDN
   ↓
API
   ↓
Authentication
   ↓
Authorization
   ↓
Validation
   ↓
Application Logic
   ↓
Database
   ↓
Storage

No single layer should be assumed to provide complete security.

Detailed requirements are defined in SECURITY_RULES.md.

84. Accessibility Architecture

Accessibility should be implemented in the shared design system and frontend components.

Components should support:

Keyboard interaction
Semantic markup
Screen readers
Focus management
Accessible forms
Appropriate labels
Error messaging
Responsive layouts

Accessibility should be tested continuously.

85. Performance Architecture

Performance should be designed into the platform.

Important strategies include:

Server-side/public rendering where appropriate
CDN caching
Efficient database queries
Proper indexes
Pagination
Optimized images
Lazy loading
Small client bundles
Efficient APIs
Direct file delivery
Background processing
86. Low-Bandwidth Strategy

The platform targets users who may have:

Mobile devices
Slow connections
Limited data
Older hardware

Therefore:

Public pages should remain lightweight.
Images should be optimized.
Unnecessary JavaScript should be avoided.
Large downloads should not block ordinary navigation.
Previews should be efficient.
Important information should load before non-essential content.
87. Mobile Architecture

The platform is responsive by default.

Important public journeys must work on mobile:

Search
Catalogue
Resource page
Preview
Download
Calendar
Education Updates
Account
Payment

Mobile is not treated as a secondary experience.

88. Accessibility and SEO Relationship

Semantic and accessible HTML should also support search-engine understanding.

The platform should use:

Meaningful headings
Semantic navigation
Descriptive links
Breadcrumbs
Structured metadata
Proper document hierarchy

Accessibility must not be sacrificed for visual shortcuts.

89. Public Cache vs Private Data

Public cacheable content includes appropriate:

Resource pages
Curriculum pages
Subject pages
Topic pages
Public collections
Public schools
Public updates

Private or user-specific information should not be publicly cached.

Examples:

My Library
Purchases
Entitlements
User preferences
Private calendar
Contributor financial information
Administrative data
90. Provider Failure Strategy

External providers may fail.

The application should handle failures gracefully.

Examples:

Payment failure

Do not grant entitlement.

Email failure

Record delivery failure and retry where appropriate.

Storage failure

Do not report successful upload when storage failed.

Search failure

Provide a controlled fallback where practical.

PDF provider failure

Report export failure and preserve the calendar.

AI failure

Core platform functionality continues without AI.

91. Feature Flags and Controlled Rollout

Features may be introduced through controlled configuration where useful.

This can support:

Internal testing
Beta release
Limited rollout
Feature restriction
Emergency disabling
Progressive exposure

Feature flags should not replace proper authorization.

92. Launch Architecture

The launch process should progress through:

Internal Testing
      ↓
Private/Beta Testing
      ↓
Limited Invitation
      ↓
Controlled Public Exposure
      ↓
Broader Release

Each stage should have:

Monitoring
Feedback
Rollback capability
Incident tracking
93. Future Mobile Applications

The backend API should remain independent of the web frontend.

This allows future:

Android application
iOS application
Progressive Web App improvements
Other clients

without redesigning the backend.

94. Future African Expansion

The architecture should support additional countries through configuration and structured data.

Adding a country should primarily involve:

Country configuration
Administrative geography
Curriculum
Curriculum versions
Education levels
Grade structures
Pathways
Subjects
Topics
Terminology
Currency
Payment provider
Policy configuration
Country-specific content

It should not require a separate codebase.

95. Architecture Decision Principle

When choosing between two technically valid implementations, prefer the implementation that:

Preserves data integrity.
Keeps security strong.
Keeps the public experience fast.
Minimizes unnecessary infrastructure.
Is easy to maintain.
Supports future migration.
Avoids unnecessary vendor lock-in.
Is understandable by future developers.
Is testable.
Does not create hidden architectural debt.
96. What Must Not Happen

The architecture must not drift into:

Uncontrolled microservices
Frontend-only authorization
Files stored permanently in PostgreSQL
Hardcoded Kenyan curriculum logic
Vendor-specific business logic throughout the application
AI-dependent core functionality
Payment logic inside UI components
Search logic scattered across routes
Database schema changes without migrations
Uncontrolled ORM schema redesign
Permanent public premium file URLs
Large amounts of business logic inside frontend code
Raw database forms replacing proper workflows
Production secrets in Git
Production data in development
Unbounded background retries
97. Architecture Evolution

The architecture is expected to evolve.

Changes are allowed when supported by:

Demonstrated technical need
Performance evidence
Security requirements
Product requirements
Operational requirements
Scale
Cost considerations

Architectural changes must be documented.

They must not be introduced silently.

98. Current Technology Direction

The approved initial technology direction is:

Backend
Node.js
TypeScript
Fastify
Drizzle ORM
Zod
Argon2id
Database
Managed PostgreSQL
Frontend
Dedicated public SEO frontend
Shared authenticated application frontend
Isolated administrative frontend
Storage
S3-compatible object storage
Search
PostgreSQL FTS initially
Jobs
Redis-compatible queue when required
Authentication
Secure cookie sessions
Payments
Provider abstraction
M-Pesa initially for Kenya
Testing
Vitest
Integration tests
End-to-end tests
Deployment
Development
Staging
Production
CI/CD
GitHub Actions or equivalent
99. Infrastructure Introduction Principle

Infrastructure should be introduced only when required.

Do not install or configure everything at the beginning merely because the final architecture contains those components.

Introduce infrastructure in the implementation sequence.

Examples:

PostgreSQL when database foundation begins
Object storage when file functionality begins
Queue when background jobs begin
M-Pesa when commerce begins
Email provider when notifications require it
SMS provider when SMS functionality requires it
Dedicated search engine only when PostgreSQL search is no longer sufficient

This reduces unnecessary complexity during development.

100. Final Architecture Principle

The platform should remain:

Modular enough to evolve, simple enough to operate, secure enough to trust, structured enough to scale, and flexible enough to serve Kenya first and Africa later.

Architecture decisions must serve the product rather than becoming the product themselves.
