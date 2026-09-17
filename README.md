Education Platform

A Kenya-first, Africa-ready education-resource platform designed to make high-quality educational resources easier to discover, understand, access, share and use.

The platform is being designed as a structured education ecosystem rather than a simple collection of downloadable files.

Its guiding philosophy is:

Public by default. Structured by design. Trusted through quality. Intelligent through data. Monetized without obstructing discovery. Built for Kenya, ready for Africa.

1. Project Status

Current phase: Documentation and architecture foundation

Production implementation has not yet started.

The project is being implemented incrementally through bounded development tasks. Each implementation stage must be inspected, tested, documented and committed before the next stage begins.

The repository must never claim that a feature is complete unless it has actually been implemented and verified.

2. Product Vision

The platform will provide a public-first education ecosystem serving:

Teachers
Students
Schools
Parents and guardians
Education professionals
Contributors
Institutional users
Resource buyers

The core experience is designed around:

Discover → Use → Trust → Create an account when there is a reason

Public users should be able to discover and use appropriate free resources without being forced to create an account.

Authentication is introduced when identity, persistence, personalization, entitlement or other functionality genuinely requires it.

3. Initial Resource Pillars

The initial platform will support:

Past Papers & Exams
Lesson Plans
Schemes of Work
Notes & Revision
School Forms & Documents
Academic Calendar
Education Updates
Teacher Resources

These are platform content pillars and should not be confused with the underlying resource-type architecture.

4. Kenya-First, Africa-Ready

The initial launch focuses on Kenya.

The architecture is nevertheless designed to support additional African countries without requiring a separate platform or database for each country.

Country-aware architecture will support:

Countries
Curricula
Curriculum versions
Education levels
Grades/forms
Pathways
Subjects
Topics
Geography
Schools
Currencies
Payment providers
Localization

Future country routes may follow a structure such as:

/ke/...
/ug/...
/tz/...

English is the initial platform language.

Localization is designed into the architecture so that additional languages and terminology can be introduced later without redesigning the core system.

5. Public-First Access

Anonymous users are first-class users of the platform.

Public users may be able to:

Browse resources
Search resources
Filter resources
View resource pages
Preview eligible resources
Download free resources
Browse curricula
Browse subjects
Browse grades/forms
Browse topics
Browse schools
Browse collections
Read education updates
Use the official academic calendar
Create temporary personal calendar events
Download a temporary calendar
Share public pages
Submit resource requests
Provide permitted feedback

Authentication may be required for:

Premium purchases
Premium downloads
Saved resources
Purchase history
Persistent personalization
Persistent calendars
Cross-device access
Contributor functionality
Persistent identity features
6. Core Architecture

The platform follows a modular architecture with a frontend-independent service/API layer.

The intended backend stack includes:

Node.js
TypeScript
Fastify
PostgreSQL
Drizzle ORM
Zod
Argon2id
Secure cookie-based sessions
Redis-compatible background-job infrastructure
S3-compatible object storage
CDN delivery
PostgreSQL full-text search initially
OpenAPI
Vitest
Integration and end-to-end testing
GitHub Actions
Containerized deployment where appropriate

The architecture must remain provider-independent wherever practical.

7. Database

PostgreSQL is the authoritative transactional database.

Database migrations remain explicit and reviewable.

The ORM must not silently redesign the database.

The database uses:

UUID primary keys
PostgreSQL schemas
TIMESTAMPTZ
DATE
TIME
JSONB
explicit foreign keys
database constraints
indexes
triggers where appropriate
audited lifecycle operations

The major database domains include:

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
8. Resource Identity and Versioning

Every resource has a permanent internal UUID.

A resource's SEO slug may change, but its permanent identity does not.

Significant changes create a new resource version.

Published versions are immutable.

Previous versions remain available according to lifecycle, rights and retention policies.

The permanent resource identity is important for:

SEO
saved resources
analytics
relationships
purchases
entitlements
version history
future integrations
9. File Architecture

Binary files are stored in object storage rather than directly inside PostgreSQL.

PostgreSQL stores file metadata.

The file pipeline is designed around:

Acquire
→ Upload
→ Security Scan
→ File Validation
→ Checksum
→ Text/OCR Extraction
→ Metadata Extraction
→ Duplicate Detection
→ Thumbnail / Preview
→ Curriculum Classification
→ Quality Checks
→ Human Review
→ Approval
→ Schedule / Publish
→ Monitor

Original files are immutable.

Files use checksums and processing history.

Public and premium downloads are controlled by backend authorization and protected delivery mechanisms.

10. Quality and Trust

Resources use qualitative quality labels rather than numerical ratings.

Initial labels include:

Standard
Verified ✓
Premium ⭐

Verification is based on structured checks and authorized human review.

Checks may include:

Curriculum alignment
Factual accuracy
Completeness
Level and difficulty
Formatting and readability
Classification
Provenance
Rights
Exam relevance where applicable

Verification is auditable and can be revoked when appropriate.

11. Search and Discovery

Search is a core platform capability.

The initial implementation uses PostgreSQL full-text search behind a SearchProvider abstraction.

The architecture must allow a future dedicated search engine without changing the public API unnecessarily.

Search may consider:

Relevance
Resource metadata
Extracted text
Curriculum
Grade/form
Subject
Topic
Resource type
Quality
Freshness
Usage
Context
Platform terminology
Kenyan terminology and synonyms

Autocomplete is intentionally lightweight and should not become a disguised analytics or popularity interface.

12. SEO

The public platform is designed for search-engine discovery.

Important SEO capabilities include:

Clean URLs
Stable internal identities
Canonical URLs
Redirects after slug changes
Structured metadata
Schema.org
Breadcrumbs
Open Graph metadata
X/social metadata
XML sitemaps
Robots controls
Curriculum landing pages
Subject landing pages
Grade/form landing pages
Topic landing pages
Resource pages
Useful educational context
Duplicate-content safeguards
Freshness signals

SEO must support useful discovery rather than creating large numbers of thin pages.

13. Calendar

The calendar is a platform feature and a planning tool.

It supports four scopes:

OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION

Anonymous visitors can:

Open the calendar.
View official dates.
Add their own events.
Preview the combined calendar.
Download a calendar PDF.

Anonymous calendar data is temporary and associated with the user's browser/session.

It does not modify official platform calendar data.

Authenticated users may save calendars permanently and access them across devices.

Future calendar formats may include:

PDF
ICS
XLSX
CSV

Integration with external calendar providers may be added later.

14. Authentication and Accounts

Accounts are optional for the core public experience.

The platform uses a central user identity model.

Users may have multiple roles.

Authentication and authorization are separate concerns.

The architecture supports:

Email/password authentication
Email verification
Password recovery
Session management
Device/session management
Role-based access control
Granular permissions
Stronger administrative authentication
Future passwordless authentication
Optional social authentication through provider abstractions

Passwords must never be stored in plaintext.

15. Saved Resources

Saved-resource architecture is intentionally simple.

Saved resources are stored directly on the user record as version-specific resource UUID references.

They are not organized through private collections.

This is a locked architectural decision and must not be silently redesigned.

Anonymous users may have temporary browser/session activity.

Authenticated users may access persistent saved resources across devices.

16. Commerce

Premium resources use a controlled commerce flow:

Resource
→ Product
→ Offer
→ Order
→ Payment
→ Entitlement
→ Protected Download

The frontend must never be the authority for entitlement.

Payment providers are accessed through provider abstractions.

M-Pesa will be implemented through a payment-provider interface rather than tightly coupling the platform to one provider.

Payment callbacks must be validated, idempotent and protected against replay.

17. Contributors

The platform supports an independent contributor ecosystem.

Contributor status is separate from resource verification.

The intended workflow is:

Application
→ Review
→ Approval
→ Contributor Workspace
→ Submission
→ Processing
→ Review
→ Approval
→ Publication

Contributor ownership, licensing, pricing, revenue rules and earnings are handled separately from ordinary users.

Administrative controls remain available for quality, rights, fraud and policy concerns.

18. Education Updates

Education Updates are a dedicated content entity.

They are not forced into the resource/file model.

Updates can be:

Drafted
Reviewed
Published
Archived
Classified
Linked to curricula
Linked to relevant resources
Indexed for search
Optimized for SEO
19. Analytics

The platform uses a centralized event model.

Events may include:

Search
Resource view
Preview
Download
Save
Purchase
Share
Resource request
Feedback
Calendar activity

Analytics should minimize sensitive information.

Anonymous and authenticated activity are supported with appropriate privacy controls.

20. Security

Security is designed into the platform rather than added after development.

Important principles include:

Server-side authorization
Least privilege
Secure sessions
Strong password hashing
MFA for administrators
RBAC
Input validation
Protection against IDOR
CSRF protection where applicable
CORS controls
Security headers
XSS protection
SQL injection prevention
File security
Protected downloads
Signed URLs
Payment security
Webhook replay protection
Rate limiting
Abuse protection
Secret management
Audit logging
Data minimization

Security requirements are documented separately in:

docs/SECURITY_RULES.md
21. Accessibility

The target is WCAG 2.2 AA.

The platform should support:

Keyboard navigation
Semantic HTML
Screen readers
Adequate contrast
Accessible forms
Accessible downloads
Meaningful alternative text
Accessible interactive controls
Mobile accessibility
Accessibility testing during release
22. Performance

The platform is designed for:

Mobile-first use
Low-bandwidth environments
Public page caching
Efficient database queries
Optimized images
Responsive image sizes
Lazy loading
CDN delivery
Efficient downloads
Resumable/range downloads where appropriate
Core Web Vitals monitoring

Performance improvements should be based on measured problems rather than unnecessary complexity.

23. Environments

The intended environments are:

Development
Staging
Production

Each environment should have appropriately isolated:

Database
Object storage
Payment credentials
Secrets
Configuration
External services

Production credentials must never be committed to Git.

24. Development Method

The project uses bounded implementation tasks.

The development loop is:

Specification
→ Bounded Task
→ Inspect Existing Code
→ Implement
→ Test
→ Typecheck
→ Build
→ Inspect
→ Update Status
→ Git Commit
→ Next Task

AI coding agents must not be instructed to build the entire platform in one operation.

Each task must have a clearly defined scope and a clear stopping point.

25. AI Development Rules

The primary AI development rules are located at:

docs/AI_DEVELOPER_RULES.md

AI coding agents must read and follow those rules before implementing code.

Important principles include:

Do not guess important requirements.
Do not silently change locked architecture.
Do not invent business data.
Do not create fake implementations.
Do not bypass security requirements.
Do not silently redesign the database.
Do not expose internal information.
Do not make published data mutable when immutability is required.
Do not introduce unnecessary paid services.
Do not add unnecessary dependencies.
Do not claim completion without verification.
Stop after the assigned bounded task.
26. Documentation

The project documentation is separated by responsibility:

docs/
├── AI_DEVELOPER_RULES.md
├── PROJECT_VISION.md
├── ARCHITECTURE.md
├── DATABASE_SPEC.md
├── API_SPEC.md
├── SECURITY_RULES.md
└── IMPLEMENTATION_STATUS.md
AI_DEVELOPER_RULES.md

Defines how AI coding agents must operate.

PROJECT_VISION.md

Defines what the platform is and why it exists.

ARCHITECTURE.md

Defines how the platform is structured.

DATABASE_SPEC.md

Defines the database model and structural decisions.

API_SPEC.md

Defines how clients communicate with the backend.

SECURITY_RULES.md

Defines security requirements.

IMPLEMENTATION_STATUS.md

Records what has actually been implemented and verified.

27. Repository Structure

The planned high-level repository structure is:

education-platform
├── backend
├── database
│   ├── migrations
│   ├── seeds
│   └── tests
├── docs
├── frontend
├── scripts
├── tests
├── .gitignore
├── LICENSE
└── README.md

Additional directories may be introduced when justified by implementation requirements.

28. Source Code vs Educational Content

The repository license applies to the project's source code and repository materials that are actually covered by that license.

It does not automatically grant permission to copy, redistribute, sell, modify or republish third-party educational resources, examination papers, government documents, teacher submissions or other content.

Educational content must be handled according to its applicable:

Copyright status
Ownership
License
Distribution permission
Attribution requirements
Provenance
Platform rights
Version-specific restrictions

Content rights are governed by the platform's rights and provenance architecture.

29. Current Implementation Principle

Correctness takes priority over raw development speed.

The implementation should prioritize:

Data integrity
Security
Maintainability
Performance
Accessibility
SEO
User experience
Cost efficiency
Future flexibility

Complexity should only be introduced when it provides a justified platform benefit.

30. Development Checkpoints

Every meaningful implementation stage should produce a Git checkpoint.

A checkpoint should normally contain:

Working code
Relevant tests
Typecheck passing
Build passing
Documentation/status updated
No accidental secrets
No unexplained architectural changes

A clean Git history is part of the project's engineering discipline.

31. License

The project's source code is licensed under the MIT License.

See:

LICENSE

for the complete license text.

The MIT License does not override third-party copyright, licensing or distribution restrictions applicable to educational content hosted or referenced by the platform.