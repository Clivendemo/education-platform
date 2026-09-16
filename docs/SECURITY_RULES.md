# SECURITY RULES

**Project:** Kenya-first Education Resource Platform
**Document:** Security Rules
**Status:** Locked Foundation Specification
**Version:** 1.0

---

# 1. Purpose

This document defines the security requirements for the platform.

Security is part of the architecture and must not be treated as a final-stage feature.

The platform handles:

* public educational content
* user accounts
* student-related preferences
* teacher information
* school information
* contributor information
* payments
* financial records
* premium entitlements
* uploaded files
* administrative operations
* analytics
* calendar data

The system must therefore apply security according to the sensitivity and risk of each operation.

---

# 2. Security Principles

The platform follows these principles:

1. Secure by default.
2. Public access is intentional, not accidental.
3. Authentication is required only where identity is necessary.
4. Authorization is always server-side.
5. Least privilege.
6. Defense in depth.
7. Minimize collected data.
8. Minimize exposed data.
9. Never trust the client.
10. Never trust user-supplied identifiers as authorization.
11. Protect financial operations.
12. Protect uploaded files.
13. Audit important administrative actions.
14. Fail safely.
15. Do not expose internal implementation details.
16. Security controls must be testable.
17. Secrets must never be committed to source control.

---

# 3. Security Source of Truth

For security-related implementation, use this hierarchy:

1. `docs/AI_DEVELOPER_RULES.md`
2. `docs/SECURITY_RULES.md`
3. `docs/API_SPEC.md`
4. `docs/DATABASE_SPEC.md`
5. `docs/ARCHITECTURE.md`
6. approved project decisions
7. existing code
8. tests

If implementation conflicts with these rules, the coding agent must not silently choose a different architecture.

It must report the conflict.

---

# 4. Threat Model

The platform must account for at least the following threats:

* account takeover
* password attacks
* session theft
* session fixation
* unauthorized API access
* privilege escalation
* IDOR/insecure direct object references
* SQL injection
* XSS
* CSRF
* malicious file uploads
* malware in uploaded documents
* unauthorized downloads
* premium-content bypass
* payment manipulation
* payment replay
* webhook replay
* duplicate transactions
* automated scraping/abuse
* spam
* fake contributor submissions
* fraudulent contributor activity
* calendar data exposure
* analytics abuse
* excessive API requests
* information leakage
* accidental publication
* administrative mistakes
* secret leakage
* dependency vulnerabilities
* data-retention failures

---

# 5. Trust Boundaries

Important trust boundaries include:

```text
Browser
    ↓
Frontend
    ↓
API
    ↓
Application Services
    ↓
PostgreSQL
```

Additional boundaries:

```text
API
    ↓
Object Storage

API
    ↓
Payment Provider

API
    ↓
Email Provider

API
    ↓
SMS Provider

API
    ↓
Search Provider

API
    ↓
PDF Provider

API
    ↓
Optional AI Provider
```

No external provider should be treated as the authoritative source for platform identity or internal resource identity.

---

# 6. Client Trust

The frontend is untrusted.

Never trust:

* hidden form fields
* disabled buttons
* frontend route guards
* frontend role values
* frontend price values
* frontend entitlement values
* frontend payment-success messages
* frontend resource-access decisions
* frontend ownership claims
* frontend calendar ownership
* frontend file paths

Every sensitive operation must be validated by the backend.

---

# 7. Authentication

The platform supports:

* email/password authentication
* future passwordless authentication
* optional future social authentication

Authentication providers must be abstracted where practical.

Public browsing does not require authentication.

Free-resource discovery and eligible free downloads must remain usable without an account.

---

# 8. Password Security

Passwords must:

* never be stored in plaintext
* never be logged
* never be returned by an API
* never appear in analytics
* never appear in audit logs

Use:

```text
Argon2id
```

Password policies must balance security and usability.

Do not impose arbitrary complexity requirements that encourage insecure password behaviour.

Password verification must use constant-time-safe mechanisms provided by the password-hashing library.

---

# 9. Password Recovery

Password-reset tokens must be:

* cryptographically random
* single-use
* short-lived
* stored securely
* invalidated after successful use
* invalidated when appropriate after account security changes

The database must not store a reusable plaintext reset token.

Forgot-password responses must avoid revealing whether an email address belongs to an account.

Example:

```text
If the account exists, recovery instructions have been sent.
```

---

# 10. Email Verification

Email verification should be supported through a secure single-use token flow.

Verification tokens must:

* expire
* be single-use
* be cryptographically random
* not be logged
* not be exposed in analytics

The system must distinguish between:

* email address supplied
* email verified
* account active

---

# 11. Session Security

Use secure server-managed sessions.

Sessions must have:

* secure random identifiers
* expiration
* revocation
* creation timestamp
* last-used information where appropriate
* device/session metadata where appropriate
* user association

Do not store plaintext session tokens in ordinary application data where avoidable.

Session cookies should use:

```text
HttpOnly
Secure
SameSite
```

with appropriate environment-specific configuration.

---

# 12. Session Expiration

Sessions must expire according to configurable security policy.

Administrative sessions should have stronger controls than ordinary user sessions.

Expired sessions must be rejected.

Revoked sessions must be rejected immediately.

---

# 13. Session Revocation

Users should be able to:

* view active sessions where supported
* revoke an individual session
* revoke all sessions

Security-sensitive account changes may require broader session revocation.

Administrative account security events should be logged.

---

# 14. Session Fixation

After successful authentication, the application must establish a fresh authenticated session.

Do not convert an attacker-controlled unauthenticated session into an authenticated session without session rotation.

---

# 15. Authentication Rate Limiting

Rate-limit:

* login
* registration
* password recovery
* password reset
* email verification
* verification resend
* session-related operations

Protection should account for:

* IP
* account/email identifier where appropriate
* session
* device characteristics where appropriate

Do not create a system where one attacker can trivially exhaust another user's rate limit.

---

# 16. Multi-Factor Authentication

Administrative accounts must support stronger authentication.

MFA is required for administrative access when the platform's chosen authentication infrastructure supports it.

Admin authentication must never rely solely on ordinary public-user security.

Future MFA implementation must support:

* enrollment
* verification
* recovery
* revocation
* audit logging

Do not invent a custom cryptographic MFA system.

---

# 17. Authorization

Authentication answers:

> Who is this?

Authorization answers:

> Is this person allowed to perform this operation on this object?

Authorization must always be enforced server-side.

---

# 18. RBAC

Use:

```text
User
→ Role
→ Permission
→ Scope
```

Users may have multiple roles.

Permissions must be granular.

Examples:

```text
resource.read
resource.create
resource.update
resource.publish
resource.retire

school.read
school.update
school.verify

user.read
user.update

contributor.review
contributor.approve

payment.read
payment.reconcile

analytics.read

calendar.manage_official
```

The exact permission registry is defined in the database/RBAC implementation.

---

# 19. Least Privilege

Users must receive only the permissions required for their role.

Do not create one broad:

```text
ADMIN
```

permission that automatically grants every operation unless explicitly required.

Administrative permissions should be separable.

---

# 20. Scoped Authorization

Permissions may be scoped to:

* platform
* country
* school
* resource
* contributor
* geographic area
* other approved scope

Example:

A school administrator may manage that school's permitted content without automatically gaining authority over all schools.

---

# 21. Role Changes

Changes to roles and permissions must:

* be authorized
* be validated
* be audited
* take effect according to defined policy
* not create orphaned privileges

Inactive or expired role assignments must not authorize actions.

---

# 22. IDOR Protection

Never assume that possessing a UUID grants access.

For every protected object:

```text
Authenticate
→ Resolve object
→ Check ownership/scope
→ Check permission
→ Perform operation
```

This applies to:

* users
* resources
* versions
* files
* orders
* payments
* entitlements
* contributor submissions
* calendars
* events
* reports
* exports
* audit information

---

# 23. User Data Isolation

A user must not be able to retrieve another user's:

* private profile data
* preferences
* saved resources
* activity
* calendar
* orders
* payments
* entitlements
* notifications
* contributor financial information
* private support information

unless an authorized administrative workflow explicitly permits access.

---

# 24. Anonymous Session Security

Anonymous users may have temporary:

* calendar events
* activity
* feedback
* resource requests
* analytics

Anonymous session identifiers must not be treated as authorization by themselves.

The backend must establish ownership through a secure session mechanism.

Anonymous data must have appropriate expiry.

---

# 25. Student Privacy

The platform may be used by students.

Student-related information must therefore be minimized.

Do not collect personally identifiable student information unless there is a clear product requirement.

Avoid exposing:

* student names
* student contact details
* student activity
* unnecessary student identifiers
* private student preferences

Public resource browsing should not require personal student data.

---

# 26. User Data Minimization

Collect only what is necessary.

Potential account data includes:

* email
* optional phone
* password credential information
* roles
* education preferences
* notification preferences
* school relationships
* contributor information where applicable

Do not collect additional personal information merely because it might be useful someday.

---

# 27. Sensitive Data in Logs

Never log:

* passwords
* password-reset tokens
* session tokens
* API secrets
* payment credentials
* full authentication headers
* private file URLs
* unnecessary personal information

Sensitive values must be redacted.

---

# 28. Logging

Logs should contain enough information to diagnose problems without exposing sensitive data.

Useful fields include:

* timestamp
* severity
* request ID
* route
* HTTP method
* status
* duration
* service/module
* error code
* safe user identifier where appropriate

Production logs must not contain secrets.

---

# 29. Audit Logs

Security-sensitive and important business actions must generate audit records.

Examples:

* login/security events
* role changes
* permission changes
* resource publication
* resource retirement
* verification
* verification revocation
* rights changes
* financial changes
* contributor approval
* administrative changes
* retention actions

Audit logs must be append-only from normal application workflows.

---

# 30. SQL Injection

All database operations must use:

* parameterized queries
* safe ORM methods
* safe query builders

Never concatenate untrusted user input into SQL.

Search queries must also be safely parameterized.

---

# 31. Input Validation

All external input must be validated.

Validate:

* request bodies
* path parameters
* query parameters
* headers where relevant
* webhook payloads
* file metadata
* identifiers
* pagination
* filters
* sort parameters

Use Zod or another approved schema-validation mechanism.

---

# 32. Unknown Fields

API endpoints must define how unexpected fields are handled.

For sensitive operations, unexpected fields should normally be rejected.

Never allow clients to submit arbitrary fields that can accidentally modify:

* roles
* permissions
* ownership
* prices
* payment state
* verification
* publication state
* entitlement state

---

# 33. Mass Assignment Protection

Never bind arbitrary request-body fields directly to database records.

Explicitly define writable fields.

For example, a normal user must never be able to submit:

```json
{
  "role": "ADMIN",
  "isVerified": true
}
```

and have those fields accepted by a generic update handler.

---

# 34. CSRF Protection

Because the platform uses cookie-based sessions, CSRF protection must be implemented appropriately for state-changing requests.

Apply protection to operations such as:

* profile updates
* saved resources
* calendar changes
* purchases
* administrative changes
* contributor actions

The exact mechanism must be selected consistently across the application.

Do not disable CSRF protection merely to make development easier.

---

# 35. CORS

CORS must be explicitly configured.

Do not use:

```text
Access-Control-Allow-Origin: *
```

for authenticated sensitive APIs.

Allowed origins must come from configuration.

Development, staging and production origins must be separately configurable.

---

# 36. Security Headers

The web application should implement appropriate security headers, including where applicable:

* Content-Security-Policy
* X-Content-Type-Options
* Referrer-Policy
* frame-ancestors / clickjacking protection
* Strict-Transport-Security in production
* appropriate permissions policy

Headers must be configured based on actual application requirements rather than copied blindly.

---

# 37. XSS Protection

Treat user-generated content as untrusted.

Potentially dangerous content includes:

* contributor descriptions
* resource descriptions
* update articles
* comments if ever introduced
* collection descriptions
* school descriptions
* support messages
* imported metadata

HTML must be sanitized if HTML is intentionally allowed.

Prefer safe text rendering where rich HTML is unnecessary.

---

# 38. Markdown/Rich Text

If the platform eventually permits Markdown or rich text:

* use a trusted parser
* sanitize output
* remove dangerous scripts
* remove dangerous event handlers
* control allowed HTML elements
* test malicious payloads

Do not render raw user-provided HTML directly.

---

# 39. File Upload Security

Uploaded files are untrusted.

The platform must validate:

* extension
* MIME type
* file signature where appropriate
* file size
* processing status
* malware scan
* checksum

Do not trust the filename extension alone.

---

# 40. File Quarantine

New uploads must initially be treated as untrusted/quarantined.

A file must not become publicly downloadable merely because it has been uploaded.

Publication requires successful processing and required checks.

---

# 41. Malware Scanning

Uploaded files should pass through a malware/security scanning stage before public availability.

The storage pipeline must support:

```text
UPLOAD
→ QUARANTINE
→ SCAN
→ VALIDATE
→ PROCESS
→ APPROVE
→ PUBLISH
```

If scanning fails or cannot be completed, the file must not become publicly downloadable.

---

# 42. File Type Restrictions

Allowed file types must be explicitly configured.

Initial platform formats may include:

* PDF
* DOCX
* PPTX
* XLSX
* CSV
* supported images
* ZIP where genuinely required

Do not allow arbitrary executable files.

File-size limits must be configurable.

---

# 43. Filename Security

User-supplied filenames must never be used directly as filesystem paths.

Prevent:

* path traversal
* directory traversal
* overwriting unrelated files
* executable path injection

Storage keys should use controlled internal identifiers.

---

# 44. File Storage

Original files must be stored in object storage.

PostgreSQL stores metadata.

Do not store large binary files directly in ordinary relational tables unless an explicit architectural decision changes this.

---

# 45. Download Security

Files must not have uncontrolled permanent public URLs.

Download authorization should use:

* backend authorization
* short-lived signed URLs or equivalent controlled access
* CDN/storage restrictions

Premium files require entitlement verification.

---

# 46. Premium Protection

Premium access must never depend on:

* hidden frontend buttons
* frontend route protection
* JavaScript checks
* obscured URLs
* filenames
* client-side price checks

The server must verify entitlement before providing access.

---

# 47. Premium Preview Protection

Premium previews must be intentionally limited.

Do not accidentally expose:

* original file
* unrestricted file URL
* full-resolution protected content
* downloadable preview assets that reconstruct the original

Preview and download authorization are separate concepts.

---

# 48. Signed URL Security

Signed URLs must:

* expire
* identify the intended object
* use appropriate permissions
* avoid excessive lifetime
* not expose signing secrets
* be generated server-side

Never expose object-storage credentials to browsers.

---

# 49. Range and Resumable Downloads

Where range/resumable downloads are implemented, authorization must still apply.

Do not allow an expired or unauthorized user to continue retrieving protected content merely because an earlier download began.

---

# 50. Payment Security

Payment state is server-authoritative.

Never trust:

```text
paymentSuccessful=true
```

from the frontend.

The server must verify payment through the configured payment provider.

---

# 51. Payment Amount Protection

The amount used for payment must come from the server-side order/offer.

Do not trust a client-submitted price.

Example:

The frontend must not be able to change:

```text
KES 500
```

to:

```text
KES 1
```

by modifying a request payload.

---

# 52. Currency Protection

Currency must also be server-authoritative.

Validate:

* currency
* amount
* offer
* product
* order
* provider transaction

before granting entitlement.

---

# 53. Payment Idempotency

Payment initiation and callbacks must be idempotent.

Duplicate callbacks must not create:

* duplicate payments
* duplicate orders
* duplicate entitlements
* duplicate contributor earnings

---

# 54. Payment Replay Protection

The system must protect against replayed provider callbacks.

Verify:

* provider transaction identity
* order identity
* amount
* currency
* expected payment state
* callback authenticity where supported

Previously processed transactions must not be processed as new successful payments.

---

# 55. M-Pesa Security

M-Pesa integration must operate through:

```text
PaymentProvider
```

Never place provider credentials in frontend code.

Never trust frontend confirmation.

Validate provider callbacks according to the provider's supported security mechanisms.

Protect:

* consumer key
* consumer secret
* passkey
* callback configuration
* access tokens
* transaction identifiers

Credentials must be stored securely as deployment secrets.

---

# 56. Entitlement Security

Entitlements must only be created by authorized server-side commerce workflows.

Valid flow:

```text
Order
→ Validated Payment
→ Payment Success
→ Entitlement
```

Invalid flow:

```text
Frontend says paid
→ Entitlement
```

---

# 57. Entitlement Version Rules

Entitlements must resolve against resource identity/version according to the approved commerce rules.

Changing a frontend URL must never remove legitimate ownership.

A new resource version must not accidentally invalidate valid purchases unless the documented commercial policy explicitly requires it.

---

# 58. Webhook Security

Payment webhooks must:

* validate authenticity/signatures where supported
* validate payload schema
* validate provider
* validate transaction
* validate order
* validate amount
* validate currency
* be idempotent
* be logged safely
* return appropriate responses

Never execute arbitrary commands from webhook payloads.

---

# 59. Webhook Availability

Webhook endpoints should be lightweight.

Long-running work should move to background jobs after the callback is safely validated and recorded.

This prevents provider retries caused by unnecessarily slow processing.

---

# 60. Commerce Fraud Signals

The platform should record suspicious patterns such as:

* repeated failed payments
* repeated callbacks
* abnormal order creation
* excessive download attempts
* unusual entitlement activity

These signals should support review and protection.

Do not automatically accuse users of fraud based on a single signal.

---

# 61. Contributor Security

Contributor accounts must not automatically receive administrative authority.

Contributor permissions must be separate from:

* resource verification
* resource publication
* financial administration
* user administration

Contributors must not publish their own resources directly unless an explicit future policy authorizes it.

---

# 62. Contributor File Security

Contributor submissions must enter the same controlled file-processing pipeline.

A contributor must not bypass:

* security scanning
* file validation
* duplicate detection
* metadata validation
* rights declaration
* review
* publication controls

---

# 63. Contributor Financial Security

Contributor financial information requires strict access control.

Only authorized users/services may access:

* earnings
* payout information
* revenue rules
* payment-related contributor information

Financial changes must be audited.

---

# 64. Calendar Security

Calendar data must respect ownership.

### Official

No user ownership.

### School

Associated with an authorized school.

### Authenticated user

Owned by the authenticated user.

### Anonymous session

Owned by the current anonymous session.

The platform must never allow a client to change ownership simply by changing an ID.

---

# 65. Calendar Event Isolation

A user must not be able to:

* edit another user's event
* delete another user's event
* read another user's private calendar
* alter official events
* alter another anonymous session's events

---

# 66. Anonymous Calendar Expiry

Anonymous calendar data must have an expiry.

Expired data must not remain indefinitely.

The cleanup process must be auditable where appropriate.

---

# 67. Calendar Export Security

Generated calendar exports may contain private events.

Therefore:

* export requests require appropriate authorization
* generated files must be private
* export URLs must expire
* exports must not be publicly indexed
* another user must not access the export

---

# 68. API Rate Limiting

Rate limits must be applied to high-risk or expensive operations.

At minimum consider:

```text
Authentication
Password recovery
Search
Autocomplete
File upload
Downloads
Feedback
Requests
Upvotes
Payments
Analytics
PDF generation
Admin operations
```

Limits should be configurable.

---

# 69. Abuse Protection

The platform should protect against:

* automated scraping
* excessive downloads
* spam requests
* repeated upvotes
* fake feedback
* malicious file uploads
* automated account creation
* payment abuse

Use appropriate combinations of:

* rate limiting
* quotas
* CAPTCHA/challenge mechanisms where justified
* anomaly detection
* moderation
* temporary restrictions

Do not make the normal public education experience unnecessarily difficult.

---

# 70. Search Abuse

Search must be protected against:

* extremely expensive queries
* oversized input
* wildcard abuse
* repeated automated requests
* pagination abuse

Search must remain usable for legitimate low-bandwidth users.

---

# 71. Pagination Security

Every public collection endpoint must enforce maximum page sizes.

Never permit:

```text
?pageSize=10000000
```

to trigger a huge database operation.

---

# 72. Expensive Operations

Operations such as:

* PDF generation
* large file processing
* full search reindexing
* analytics aggregation
* recommendation rebuilding

must be controlled.

Use:

* queues
* quotas
* cooldowns
* authorization
* rate limits
* job monitoring

where appropriate.

---

# 73. Administrative Security

Administrative functions are high-risk.

Admin interfaces must require:

* authentication
* appropriate role
* appropriate permission
* stronger authentication controls
* audit logging
* secure sessions

The admin API must remain protected even if someone bypasses the admin frontend.

---

# 74. Administrative Publishing Safety

Publishing must require deliberate authorized action.

The platform should support:

```text
Draft
→ Preview
→ Review
→ Approval
→ Publish
```

Do not automatically publish uploaded content.

---

# 75. Verification Security

Only authorized reviewers may:

* verify resources
* revoke verification
* alter quality-check results

Contributor status must not automatically equal resource verification.

---

# 76. Rights and Copyright Security

Resource rights information must be protected against unauthorized modification.

Changes to:

* ownership
* distribution permission
* licensing
* rights status
* restrictions

must be authorized and audited.

A disputed resource may be temporarily restricted without destroying its historical identity.

---

# 77. SEO Security

SEO metadata must not create:

* XSS
* arbitrary redirects
* malicious canonical URLs
* open redirects
* unsafe social-preview injection

Admin-entered URLs must be validated.

---

# 78. Open Redirect Protection

Do not allow arbitrary user-controlled redirects.

Redirect destinations must be:

* internal
* explicitly allowed
* validated

Avoid endpoints such as:

```text
/redirect?url=<arbitrary-url>
```

unless there is a controlled and justified implementation.

---

# 79. SSR/Frontend Security

The frontend must:

* escape user-generated content
* avoid unsafe HTML
* protect authenticated routes
* avoid embedding secrets
* avoid exposing private API data
* avoid storing sensitive tokens insecurely

Never place:

* database credentials
* payment secrets
* storage credentials
* private API keys

in frontend source code.

---

# 80. Environment Secrets

Secrets must come from environment/deployment secret management.

Examples:

```text
DATABASE_URL
SESSION_SECRET
PAYMENT_PROVIDER_SECRET
M_PESA_CONSUMER_SECRET
M_PESA_PASSKEY
STORAGE_SECRET
EMAIL_API_KEY
SMS_API_KEY
AI_API_KEY
```

Never commit secrets to Git.

Never place real production credentials in `.env.example`.

---

# 81. Secret Rotation

The architecture must allow secrets to be rotated without rewriting application code.

Provider credentials should be centrally configured.

When a secret is suspected to be exposed:

1. revoke/rotate it
2. inspect logs
3. assess impact
4. invalidate affected sessions/tokens where necessary
5. document the incident
6. test recovery

---

# 82. Dependency Security

Dependencies must be:

* intentionally selected
* reasonably maintained
* kept updated
* scanned for known vulnerabilities
* removed when unnecessary

Do not install large packages merely to solve trivial problems.

---

# 83. AI Provider Security

AI providers must be treated as external processors.

Do not send unnecessary personal or sensitive data to AI services.

Do not send:

* passwords
* session tokens
* payment secrets
* private authentication information

AI outputs are untrusted suggestions.

They must not directly control:

* publication
* verification
* payment
* entitlement
* permissions
* security decisions

---

# 84. AI Data Minimization

If AI is eventually used for content assistance:

Only send the minimum content required.

Do not automatically transmit an entire private database to an AI provider.

Provider usage must remain behind `AiProvider`.

---

# 85. Analytics Privacy

Analytics must minimize personal data.

Use:

* anonymous identifiers where possible
* authenticated user IDs only when necessary
* event context
* resource/entity IDs

Do not collect unnecessary sensitive information.

---

# 86. Analytics Integrity

Clients must not be able to create arbitrary event types.

Example:

Invalid:

```json
{
  "eventType": "user_is_admin"
}
```

unless that event type exists in the approved event registry.

Analytics must not become a mechanism for modifying business state.

---

# 87. Data Retention

Data retention must be configurable by category.

Potential categories include:

* authentication/security data
* analytics
* anonymous activity
* financial records
* audit logs
* support requests
* calendar sessions
* uploaded files
* retired resources

Legal and financial requirements may require longer retention.

---

# 88. Data Deletion

Deletion must respect:

* legal requirements
* financial records
* audit requirements
* resource identity
* historical attribution
* retention policies

Do not casually hard-delete important records.

Use soft deletion, anonymization, archival, or tombstones where appropriate.

---

# 89. User Privacy Controls

Where applicable, users should be able to:

* update account information
* change preferences
* clear eligible activity
* remove saved resources
* manage follows
* manage sessions
* manage notification preferences

The system must not delete information that must legally or operationally be retained.

---

# 90. Account Deactivation

Account deactivation must be distinct from immediate destruction of all related historical records.

Historical:

* purchases
* financial records
* audit records
* necessary attribution

may require retention.

Personal data should be minimized or anonymized where appropriate.

---

# 91. Backups

Backups must:

* be automated
* be separate from the primary database
* use appropriate access controls
* support restoration
* have defined retention
* be tested

Backups must not become an uncontrolled source of data exposure.

---

# 92. Restore Security

Database restoration must preserve:

* UUID identity
* relational integrity
* permissions
* entitlements
* audit history
* important timestamps

Restoration must be performed through controlled procedures.

---

# 93. Production Separation

Development, staging and production must have separate:

* databases
* storage
* credentials
* payment environments
* secrets
* relevant provider configurations

Do not accidentally point local development to production.

---

# 94. Test Data

Do not use real production personal or financial data in ordinary development/testing.

Use synthetic or appropriately anonymized data.

Payment testing must use provider sandbox/test mechanisms where available.

---

# 95. Error Handling

Production errors must be safe.

Users should receive useful messages such as:

```text
Something went wrong. Please try again.
```

rather than:

```text
PostgresError: relation commerce.entitlements does not exist...
```

Internal details belong in controlled logs.

---

# 96. Security Monitoring

Monitor for:

* repeated authentication failures
* suspicious administrative activity
* excessive API usage
* repeated payment failures
* webhook anomalies
* file-processing failures
* unauthorized access attempts
* unusual download patterns
* privilege changes
* unexpected provider behaviour

Monitoring thresholds should be configurable.

---

# 97. Security Alerts

High-risk events should be capable of generating alerts.

Examples:

* repeated admin login failures
* unexpected role escalation
* payment anomalies
* mass download abuse
* malware upload
* repeated authorization failures
* suspicious webhook behaviour

---

# 98. Security Testing

The project must include security tests for:

### Authentication

* invalid login
* expired reset token
* reused reset token
* session expiration
* revoked session
* session fixation

### Authorization

* unauthorized access
* insufficient permission
* wrong scope
* inactive role
* expired role
* IDOR attempts

### Files

* invalid MIME
* malicious filename
* oversized file
* unauthorized download
* expired signed URL

### Commerce

* modified price
* modified currency
* duplicate callback
* replayed callback
* invalid transaction
* unauthorized entitlement

### Calendar

* cross-user access
* cross-session access
* official-event modification
* unauthorized export

---

# 99. Security Audit Before Launch

Before production launch, perform a dedicated security audit covering:

* authentication
* password security
* sessions
* CSRF
* CORS
* RBAC
* IDOR
* input validation
* SQL injection
* XSS
* file uploads
* storage
* downloads
* premium protection
* payment
* M-Pesa
* webhooks
* admin access
* secrets
* logs
* rate limiting
* anonymous sessions
* calendar
* analytics
* privacy
* backups
* dependency vulnerabilities

The audit must classify findings:

```text
Critical
High
Medium
Low
```

Critical findings must be resolved before launch.

High-risk findings must be mitigated before launch unless explicitly accepted and documented.

---

# 100. Security Change Rules

The coding agent must not weaken an existing security control merely to make implementation easier.

Examples of prohibited shortcuts:

* disabling authorization
* removing validation
* making files public
* trusting frontend payment status
* storing plaintext passwords
* storing secrets in source code
* disabling CSRF without architectural justification
* making all APIs public
* bypassing RBAC
* exposing database errors
* disabling malware scanning for convenience
* creating fake payment success
* bypassing entitlement checks

If a security control blocks development, the agent must report the problem rather than silently remove the control.

---

# 101. Development Security

Development environments may use simplified infrastructure only when explicitly approved.

Examples:

* mock payment provider
* local storage adapter
* test email provider
* test SMS provider
* development PDF provider

Development substitutes must preserve the same important security boundaries as production.

---

# 102. No Security Through Obscurity

Do not treat the following as security:

* hidden URLs
* obscure filenames
* hidden buttons
* unlinked admin pages
* frontend-only checks
* encoded IDs
* private-looking routes

Use actual:

* authentication
* authorization
* validation
* cryptographic controls
* access policies

---

# 103. UUIDs

UUIDs are used as permanent internal identifiers.

UUIDs are not authorization mechanisms.

Knowing:

```text
resource_id
```

must not automatically provide access to a private resource.

---

# 104. Public-by-Default Security

Public content is intentionally public.

However, the system must distinguish clearly between:

```text
Public
Authenticated
Authorized
Premium
Administrative
Private
```

A resource being discoverable does not mean every associated file, version, metadata field, or administrative record is public.

---

# 105. Security and SEO

Security must never be weakened for SEO.

Indexable content should be intentionally public.

Private information must never be exposed merely because a page is indexable.

Do not generate public pages containing:

* private user activity
* private calendars
* purchase history
* private contributor information
* internal moderation data

---

# 106. Security and Performance

Security controls should be efficient.

Do not bypass security because an operation is slow.

Instead consider:

* caching safe public data
* indexed authorization queries
* appropriate database indexes
* background jobs
* efficient signed URLs
* rate limiting
* batching

---

# 107. Security and Accessibility

Security controls must not unnecessarily prevent accessibility.

Examples:

* CAPTCHA should have accessible alternatives where possible
* authentication errors should be understandable
* session expiry should be communicated clearly
* download errors should be recoverable

Security and accessibility must coexist.

---

# 108. Security and Low-Bandwidth Users

The platform targets users who may have:

* slower connections
* mobile devices
* limited data bundles

Security controls should not unnecessarily create large payloads or excessive requests.

---

# 109. Incident Response

The project must eventually maintain a lightweight incident-response process.

At minimum:

1. Identify incident.
2. Contain affected system.
3. Preserve relevant evidence.
4. Rotate compromised credentials if necessary.
5. Assess affected data.
6. Restore safe service.
7. Document incident.
8. Implement corrective controls.
9. Test corrective controls.

---

# 110. Security Documentation

Security-sensitive architecture must be documented.

Documentation should include:

* authentication model
* session model
* RBAC model
* provider credentials
* storage access model
* payment security
* webhook handling
* retention
* incident response
* backup/restore
* deployment security

Do not document actual secrets.

---

# 111. Coding-Agent Security Rules

Before implementing any security-sensitive feature, the coding agent must:

1. Read this document.
2. Read `AI_DEVELOPER_RULES.md`.
3. Read relevant API specification.
4. Inspect existing implementation.
5. Identify the trust boundary.
6. Identify the assets being protected.
7. Identify authorization requirements.
8. Identify validation requirements.
9. Identify audit requirements.
10. Identify test requirements.
11. Implement only the requested scope.
12. Run tests.
13. Run typecheck.
14. Run build.
15. Report security implications.
16. Update `IMPLEMENTATION_STATUS.md`.
17. Stop.

---

# 112. Prohibited Shortcuts

The coding agent must never:

* store plaintext passwords
* expose session tokens
* expose provider secrets
* trust frontend roles
* trust frontend prices
* trust frontend payment status
* expose private files
* bypass entitlement checks
* disable authorization
* create unrestricted admin endpoints
* directly expose PostgreSQL
* allow arbitrary file types
* ignore malware/security scanning
* accept arbitrary object fields
* create insecure redirects
* leak stack traces in production
* commit secrets
* use production credentials in development
* silently disable security controls

---

# 113. Security Definition of Done

A security-sensitive feature is complete only when:

* authentication requirements are defined
* authorization requirements are defined
* input validation exists
* sensitive data is minimized
* secrets are protected
* errors are safe
* audit requirements are implemented
* abuse controls are considered
* tests exist
* security tests pass
* typecheck passes
* build passes
* documentation is updated
* implementation status is updated

---

# 114. Final Security Principle

The platform must be:

**Public where intended.**

**Private where required.**

**Authenticated where identity matters.**

**Authorized where access matters.**

**Server-authoritative where trust matters.**

**Audited where accountability matters.**

**Validated where user input matters.**

**Protected where money or private data is involved.**

**Simple enough to maintain.**

Security must support the platform's educational mission without making legitimate discovery and use unnecessarily difficult.
