# DATABASE SPECIFICATION

## 1. Purpose

This document defines the authoritative database design for the education-resource platform.

The database is a first-class architectural component.

It must support:

* Kenya-first operation
* Future African country expansion
* Multiple curricula
* Immutable curriculum versions
* Structured educational taxonomy
* Resource identity and versioning
* File metadata and processing
* Collections
* Users and authentication
* RBAC
* Schools
* Personalization
* Activity
* Resource requests
* Feedback
* Notifications
* Commerce
* Payments
* Entitlements
* Contributors
* Education Updates
* Academic Calendar
* Analytics
* Quality governance
* Audit
* Retention
* Search

The database must be implemented using PostgreSQL.

---

# 2. Database Technology

## 2.1 Database

Use managed PostgreSQL.

Do not assume that PostgreSQL must be installed locally during the initial project setup.

The development database may be introduced when database implementation begins.

---

## 2.2 PostgreSQL Extension

The database should use:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

UUID generation should use:

```sql
gen_random_uuid()
```

---

# 3. Database Design Principles

The database must follow these principles:

1. Major entities use UUID primary keys.
2. PostgreSQL foreign keys must enforce relationships.
3. Important business rules should have database constraints where practical.
4. Referential integrity must not depend entirely on frontend validation.
5. Destructive deletion should be restricted.
6. Soft deletion should be used where historical preservation matters.
7. Timestamps use `TIMESTAMPTZ` unless a date-only or time-only value is appropriate.
8. Date-only educational dates use `DATE`.
9. Time-only values use `TIME`.
10. Flexible structured configuration may use `JSONB`.
11. Binary files are stored in object storage, not PostgreSQL.
12. File metadata remains in PostgreSQL.
13. Search initially uses PostgreSQL FTS behind an abstraction.
14. Analytics tables must be designed for future partitioning.
15. Multi-record critical operations use PostgreSQL transactions.
16. Critical operations use idempotency protection.
17. Database migrations are explicit and version-controlled.
18. The ORM must not silently redesign the database.

---

# 4. Database Schemas

The database uses these logical PostgreSQL schemas:

```text
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
```

---

# 5. Standard Audit Columns

Major mutable entities should generally contain:

```text
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
created_by       UUID NULL
updated_by       UUID NULL
```

Where appropriate, entities also support:

```text
deleted_at       TIMESTAMPTZ NULL
deleted_by       UUID NULL
```

Do not add these columns blindly to immutable or purely event-oriented tables where they do not make semantic sense.

---

# 6. Standard UUID Rule

Major entities use:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

UUIDs are permanent internal identities.

A public slug must never replace the UUID as the authoritative identity.

---

# 7. PLATFORM SCHEMA

## 7.1 platform.countries

Purpose:

Defines supported countries.

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
iso_code VARCHAR NOT NULL
url_prefix VARCHAR NOT NULL
default_language_code VARCHAR NOT NULL
currency_code VARCHAR NOT NULL
education_terminology_config JSONB
payment_config JSONB
policy_config JSONB
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Rules:

* ISO code must be unique case-insensitively.
* URL prefix must be unique case-insensitively.
* Country can be ACTIVE or INACTIVE.
* Inactive countries should not receive new public content unless explicitly permitted.
* Country is never physically deleted where historical data depends on it.

---

## 7.2 platform.administrative_area_types

Purpose:

Defines configurable administrative hierarchy types.

Fields:

```text
id UUID PK
country_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
hierarchy_level INTEGER NOT NULL
parent_type_id UUID NULL FK
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Examples for Kenya:

* County
* Sub-County
* Ward
* Location
* Sub-Location

These must be seed/configuration data, not hardcoded application logic.

---

## 7.3 platform.administrative_areas

Fields:

```text
id UUID PK
country_id UUID FK
type_id UUID FK
parent_id UUID NULL FK
name VARCHAR NOT NULL
code VARCHAR NULL
slug VARCHAR NOT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Rules:

* Top-level areas have no parent.
* Every non-top-level area has exactly one parent.
* Parent must belong to the same country.
* Parent hierarchy must follow the configured area-type hierarchy.

---

## 7.4 platform.school_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Initial categories may include:

* Public
* Private
* International
* Faith-based
* Community
* Special-needs
* Other

These are configurable data.

---

## 7.5 platform.schools

Fields:

```text
id UUID PK
country_id UUID FK
administrative_area_id UUID NULL FK
government_code VARCHAR NULL
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
school_type_id UUID FK
description TEXT NULL
address TEXT NULL
latitude NUMERIC(9,6) NULL
longitude NUMERIC(9,6) NULL
phone VARCHAR NULL
email VARCHAR NULL
website VARCHAR NULL
logo_file_id UUID NULL
photo_file_id UUID NULL
status VARCHAR NOT NULL
verification_status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
deleted_at TIMESTAMPTZ NULL
deleted_by UUID NULL
```

Rules:

* Every school belongs to exactly one country.
* Administrative area is optional.
* Government/institutional code is optional.
* UUID is the permanent school identity.
* Schools are not physically deleted.
* School status supports ACTIVE, INACTIVE and ARCHIVED.
* School profile verification is separate from contributor/resource verification.

---

# 8. TAXONOMY SCHEMA

## 8.1 taxonomy.curricula

Fields:

```text
id UUID PK
country_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

A curriculum belongs to exactly one country.

---

## 8.2 taxonomy.curriculum_versions

Fields:

```text
id UUID PK
curriculum_id UUID FK
version_name VARCHAR NOT NULL
version_code VARCHAR NULL
effective_from DATE NULL
effective_to DATE NULL
status VARCHAR NOT NULL
description TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Allowed statuses:

```text
DRAFT
PLANNED
CURRENT
HISTORICAL
```

Curriculum versions are immutable historical structures once published.

Historical and current versions may coexist.

---

## 8.3 taxonomy.education_levels

Fields:

```text
id UUID PK
curriculum_version_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
display_order INTEGER NOT NULL
status VARCHAR NOT NULL
```

Education levels are database entities.

They must not be hardcoded into application logic.

---

## 8.4 taxonomy.grade_levels

Fields:

```text
id UUID PK
curriculum_version_id UUID FK
education_level_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
display_order INTEGER NOT NULL
status VARCHAR NOT NULL
```

A grade/form belongs to a specific curriculum version and education level.

---

## 8.5 taxonomy.pathways

Fields:

```text
id UUID PK
curriculum_version_id UUID FK
education_level_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
```

Pathways are optional.

Not every curriculum or education level must have pathways.

---

## 8.6 taxonomy.subjects

Fields:

```text
id UUID PK
curriculum_version_id UUID FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
code VARCHAR NULL
description TEXT NULL
status VARCHAR NOT NULL
```

Subjects are curriculum-specific.

Do not assume that subjects are globally identical across curricula.

---

## 8.7 taxonomy.topics

Fields:

```text
id UUID PK
parent_id UUID NULL FK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Topics have stable identities and hierarchical relationships.

Topics may be reused across curricula.

Their actual curriculum placement is represented by mappings.

---

## 8.8 taxonomy.curriculum_topic_mappings

Fields:

```text
id UUID PK
curriculum_version_id UUID FK
subject_id UUID FK
topic_id UUID FK
grade_level_id UUID NULL FK
pathway_id UUID NULL FK
display_order INTEGER NULL
mapping_status VARCHAR NOT NULL
```

Purpose:

Defines where a topic occurs within a curriculum.

---

## 8.9 taxonomy.taxonomy_mappings

Fields:

```text
id UUID PK
source_entity_type VARCHAR NOT NULL
source_entity_id UUID NOT NULL
target_entity_type VARCHAR NOT NULL
target_entity_id UUID NOT NULL
mapping_type VARCHAR NOT NULL
confidence NUMERIC NULL
notes TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Purpose:

Supports relationships between educational structures.

Examples:

* Equivalent subjects
* Equivalent topics
* Curriculum migration
* Different grade structures
* Cross-country mappings

---

# 9. CONTENT SCHEMA

## 9.1 content.resource_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Resource types are configurable.

Do not hardcode the resource-type registry into application logic.

---

# 10. content.resources

Fields:

```text
id UUID PK
title VARCHAR NOT NULL
slug VARCHAR NOT NULL
short_description TEXT NULL
seo_description TEXT NULL
primary_resource_type_id UUID NULL FK
lifecycle_status VARCHAR NOT NULL
visibility_status VARCHAR NOT NULL
publication_date TIMESTAMPTZ NULL
academic_year VARCHAR NULL
academic_period VARCHAR NULL
provenance_type_id UUID NULL
source_reference TEXT NULL
rights_status_id UUID NULL
contributor_id UUID NULL
quality_label_id UUID NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
deleted_at TIMESTAMPTZ NULL
deleted_by UUID NULL
```

Rules:

* UUID is permanent resource identity.
* Title is not globally unique.
* Slug is separate from identity.
* Slugs can change.
* Slug changes create redirect history.
* Resource visibility is separate from lifecycle.
* Resource may have multiple classifications.
* One primary resource type.
* One primary curriculum classification.
* Resource may exist without curriculum classification.
* Resource identity persists across versions.

---

# 11. content.resource_versions

Fields:

```text
id UUID PK
resource_id UUID FK
version_number INTEGER NOT NULL
version_label VARCHAR NULL
lifecycle_status VARCHAR NOT NULL
published_at TIMESTAMPTZ NULL
retired_at TIMESTAMPTZ NULL
metadata_snapshot JSONB NULL
change_summary TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Constraint:

```text
UNIQUE(resource_id, version_number)
```

Version lifecycle:

```text
DRAFT
REVIEW
APPROVED
PUBLISHED
RETIRED
```

Rules:

* Published versions are immutable.
* Significant changes create a new version.
* Previous versions remain historically identifiable.
* Resource UUID remains unchanged.

---

# 12. RESOURCE CLASSIFICATION

## 12.1 content.resource_curriculum_versions

Fields:

```text
resource_id UUID FK
curriculum_version_id UUID FK
is_primary BOOLEAN NOT NULL DEFAULT false
created_at TIMESTAMPTZ
created_by UUID NULL
```

Primary key:

```text
(resource_id, curriculum_version_id)
```

Constraint:

Only one primary curriculum classification per resource.

---

## 12.2 content.resource_grade_levels

Fields:

```text
resource_id UUID FK
grade_level_id UUID FK
created_at TIMESTAMPTZ
created_by UUID NULL
```

Primary key:

```text
(resource_id, grade_level_id)
```

A resource may belong to multiple grades/forms.

---

## 12.3 content.resource_resource_types

Fields:

```text
resource_id UUID FK
resource_type_id UUID FK
is_primary BOOLEAN NOT NULL DEFAULT false
created_at TIMESTAMPTZ
created_by UUID NULL
```

Primary key:

```text
(resource_id, resource_type_id)
```

Only one resource type may be primary.

---

## 12.4 content.resource_subject

Fields:

```text
resource_id UUID PK FK
subject_id UUID FK
created_at TIMESTAMPTZ
created_by UUID NULL
```

A resource belongs to exactly one subject in the core model.

---

## 12.5 content.resource_topic

Fields:

```text
resource_id UUID PK FK
topic_id UUID FK
created_at TIMESTAMPTZ
created_by UUID NULL
```

A resource belongs to exactly one topic in the core model.

---

## 12.6 content.resource_version_classifications

Fields:

```text
id UUID PK
resource_version_id UUID FK
classification_type VARCHAR NOT NULL
classification_entity_id UUID NOT NULL
action VARCHAR NOT NULL
created_at TIMESTAMPTZ
created_by UUID NULL
```

Purpose:

Allows version-specific classification overrides while preserving resource-level classification.

---

## 12.7 content.resource_slug_history

Fields:

```text
id UUID PK
resource_id UUID FK
old_slug VARCHAR NOT NULL
new_slug VARCHAR NOT NULL
redirect_status VARCHAR NOT NULL
changed_at TIMESTAMPTZ NOT NULL
changed_by UUID NULL
```

Purpose:

Preserves old resource URLs after slug changes.

---

# 13. FILES SCHEMA

## 13.1 files.files

Fields:

```text
id UUID PK
resource_version_id UUID FK
original_filename VARCHAR NOT NULL
storage_provider VARCHAR NOT NULL
storage_key TEXT NOT NULL
mime_type VARCHAR NOT NULL
file_size_bytes BIGINT NOT NULL
checksum_algorithm VARCHAR NOT NULL DEFAULT 'SHA-256'
checksum VARCHAR NOT NULL
page_count INTEGER NULL
width INTEGER NULL
height INTEGER NULL
processing_status VARCHAR NOT NULL
uploaded_at TIMESTAMPTZ NOT NULL
processed_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Rules:

* Original uploaded file is immutable.
* File has permanent UUID.
* SHA-256 checksum is required.
* File binary is stored in object storage.
* Storage key is metadata, not public authorization.
* Files are never exposed through unrestricted permanent URLs.

---

## 13.2 files.file_processing_jobs

Fields:

```text
id UUID PK
file_id UUID FK
job_type VARCHAR NOT NULL
status VARCHAR NOT NULL
attempt_count INTEGER NOT NULL DEFAULT 0
started_at TIMESTAMPTZ NULL
completed_at TIMESTAMPTZ NULL
error_code VARCHAR NULL
error_message TEXT NULL
worker_reference VARCHAR NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 13.3 files.file_processing_history

Fields:

```text
id UUID PK
file_id UUID FK
job_id UUID NULL FK
previous_status VARCHAR NULL
new_status VARCHAR NOT NULL
message TEXT NULL
created_at TIMESTAMPTZ NOT NULL
```

Purpose:

Maintains complete processing history.

---

## 13.4 files.file_derivatives

Fields:

```text
id UUID PK
file_id UUID FK
derivative_type VARCHAR NOT NULL
storage_provider VARCHAR NOT NULL
storage_key TEXT NOT NULL
mime_type VARCHAR NULL
file_size_bytes BIGINT NULL
checksum VARCHAR NULL
created_at TIMESTAMPTZ
```

Examples:

* Thumbnail
* Preview
* Branded cover
* Page image

---

## 13.5 files.file_text_extractions

Fields:

```text
id UUID PK
file_id UUID FK
extraction_method VARCHAR NOT NULL
language_code VARCHAR NULL
text_content TEXT NULL
page_count INTEGER NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Extracted text is stored for search and processing purposes.

---

# 14. COLLECTIONS

## 14.1 content.collection_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
```

---

## 14.2 content.collections

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
collection_type_id UUID FK
owner_user_id UUID NULL FK
visibility VARCHAR NOT NULL
moderation_status VARCHAR NOT NULL
status VARCHAR NOT NULL
featured BOOLEAN NOT NULL DEFAULT false
seo_title VARCHAR NULL
seo_description TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
deleted_at TIMESTAMPTZ NULL
deleted_by UUID NULL
```

Collections may be:

* Controlled/admin
* Public
* Private

---

## 14.3 content.collection_resources

Fields:

```text
collection_id UUID FK
resource_id UUID FK
display_order INTEGER NOT NULL
created_at TIMESTAMPTZ
created_by UUID NULL
```

Primary key:

```text
(collection_id, resource_id)
```

Ordering must be preserved.

---

# 15. IDENTITY SCHEMA

## 15.1 identity.users

Purpose:

Central user profile.

Fields should include:

```text
id UUID PK
display_name VARCHAR NULL
email VARCHAR NULL
phone VARCHAR NULL
status VARCHAR NOT NULL
profile_data JSONB NULL
saved_resource_version_ids UUID[] NOT NULL DEFAULT '{}'
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

Rules:

* UUID is permanent.
* Email is not the permanent identity.
* Phone is changeable.
* Users may have multiple roles.
* Users may belong to multiple schools.
* Saved resources use the locked array model.
* Saved resources are version-specific.
* Saved resources are flat.
* Saved resources are not organized through private collections.

---

# 16. AUTHENTICATION

## 16.1 identity.auth_identities

Fields:

```text
id UUID PK
user_id UUID FK
provider VARCHAR NOT NULL
provider_subject VARCHAR NOT NULL
email VARCHAR NULL
password_hash TEXT NULL
email_verified_at TIMESTAMPTZ NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Authentication identity is separate from user profile.

---

## 16.2 identity.user_sessions

Fields:

```text
id UUID PK
user_id UUID FK
token_hash TEXT NOT NULL
created_at TIMESTAMPTZ
expires_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ NULL
last_seen_at TIMESTAMPTZ NULL
device_metadata JSONB NULL
```

Raw session tokens must not be stored.

---

# 17. RBAC

## 17.1 identity.roles

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
role_type VARCHAR NOT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 17.2 identity.permissions

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
resource VARCHAR NOT NULL
action VARCHAR NOT NULL
scope_type VARCHAR NULL
description TEXT NULL
status VARCHAR NOT NULL
```

---

## 17.3 identity.role_permissions

Fields:

```text
role_id UUID FK
permission_id UUID FK
created_at TIMESTAMPTZ
```

Primary key:

```text
(role_id, permission_id)
```

---

## 17.4 identity.user_roles

Fields:

```text
id UUID PK
user_id UUID FK
role_id UUID FK
scope_type VARCHAR NULL
scope_id UUID NULL
status VARCHAR NOT NULL
starts_at TIMESTAMPTZ NULL
ends_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
```

Rules:

* Multiple roles allowed.
* Role assignments may be scoped.
* Role assignments may expire.
* Permission changes must be audited.

---

# 18. SCHOOL RELATIONSHIPS

## 18.1 identity.user_school_relationships

Fields:

```text
id UUID PK
user_id UUID FK
school_id UUID FK
relationship_role VARCHAR NOT NULL
status VARCHAR NOT NULL
starts_at DATE NULL
ends_at DATE NULL
verification_status VARCHAR NOT NULL
verification_metadata JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
```

Rules:

* User may belong to multiple schools.
* User may have multiple roles at one school.
* Historical relationships remain retained.
* Verification evidence/status is preserved.

---

# 19. USER PREFERENCES

## 19.1 identity.user_preferences

Fields:

```text
user_id UUID PK FK
preferred_country_id UUID NULL FK
preferred_curriculum_id UUID NULL FK
preferred_language_code VARCHAR NULL
preference_data JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 19.2 identity.user_preferred_subjects

Fields:

```text
user_id UUID FK
subject_id UUID FK
created_at TIMESTAMPTZ
```

Primary key:

```text
(user_id, subject_id)
```

---

## 19.3 identity.user_preferred_grades

Fields:

```text
user_id UUID FK
grade_level_id UUID FK
created_at TIMESTAMPTZ
```

---

## 19.4 identity.user_preferred_pathways

Fields:

```text
user_id UUID FK
pathway_id UUID FK
created_at TIMESTAMPTZ
```

---

# 20. SAVED RESOURCES

The following database decision is locked:

```text
saved_resource_version_ids UUID[] 
```

Rules:

1. Saved resources are stored directly on `identity.users`.
2. Each saved value represents a resource version ID.
3. Saved resources are flat.
4. Saved resources are not organized through private collections.
5. Do not redesign this into a junction table unless a future explicit architectural decision changes it.
6. The application must validate that referenced resource versions exist.
7. The UI must handle deleted/retired/inaccessible versions gracefully.

---

# 21. identity.follows

Fields:

```text
id UUID PK
user_id UUID FK
followed_entity_type VARCHAR NOT NULL
followed_entity_id UUID NOT NULL
created_at TIMESTAMPTZ
```

Supported targets may include:

* Subject
* Grade
* Curriculum
* Contributor
* School
* Collection
* Education Update
* Other approved entities

---

# 22. identity.activity_events

Fields:

```text
id UUID PK
user_id UUID NULL FK
session_id VARCHAR NULL
event_type VARCHAR NOT NULL
entity_type VARCHAR NULL
entity_id UUID NULL
context JSONB NULL
occurred_at TIMESTAMPTZ NOT NULL
```

Supports:

* Anonymous activity
* Authenticated activity
* Cross-device activity

---

# 23. RESOURCE REQUESTS

## 23.1 content.resource_requests

Fields:

```text
id UUID PK
user_id UUID NULL FK
session_id VARCHAR NULL
request_text TEXT NOT NULL
status VARCHAR NOT NULL
fulfilled_resource_id UUID NULL FK
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
fulfilled_at TIMESTAMPTZ NULL
```

Requests may be anonymous.

---

## 23.2 content.resource_request_upvotes

Fields:

```text
id UUID PK
request_id UUID FK
user_id UUID NULL FK
session_id VARCHAR NULL
created_at TIMESTAMPTZ
```

Rules:

One upvote per user/session/request.

---

# 24. RESOURCE FEEDBACK

## 24.1 content.resource_feedback

Fields:

```text
id UUID PK
resource_id UUID FK
resource_version_id UUID NULL FK
user_id UUID NULL FK
session_id VARCHAR NULL
feedback_type VARCHAR NOT NULL
details TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Feedback categories include:

```text
HELPFUL
OUTDATED
INCORRECT
MISSING_INFORMATION
POOR_FORMATTING
WRONG_CLASSIFICATION
FILE_PROBLEM
```

No numerical/star rating is required.

---

## 24.2 content.resource_reports

Fields:

```text
id UUID PK
resource_id UUID FK
resource_version_id UUID NULL FK
user_id UUID NULL FK
session_id VARCHAR NULL
report_type VARCHAR NOT NULL
details TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ NULL
resolved_by UUID NULL
```

Serious reports are separate from ordinary feedback.

---

# 25. NOTIFICATIONS

## 25.1 identity.notifications

Fields:

```text
id UUID PK
user_id UUID FK
notification_type VARCHAR NOT NULL
title VARCHAR NOT NULL
message TEXT NOT NULL
entity_type VARCHAR NULL
entity_id UUID NULL
priority VARCHAR NOT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
read_at TIMESTAMPTZ NULL
```

---

## 25.2 identity.notification_deliveries

Fields:

```text
id UUID PK
notification_id UUID FK
channel VARCHAR NOT NULL
status VARCHAR NOT NULL
provider VARCHAR NULL
provider_reference VARCHAR NULL
attempt_count INTEGER NOT NULL DEFAULT 0
sent_at TIMESTAMPTZ NULL
delivered_at TIMESTAMPTZ NULL
failed_at TIMESTAMPTZ NULL
error_message TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Channels:

```text
IN_APP
EMAIL
SMS
```

---

# 26. COMMERCE SCHEMA

## 26.1 commerce.payment_providers

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
provider_code VARCHAR NOT NULL
country_id UUID NULL FK
status VARCHAR NOT NULL
configuration JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Credentials must not be stored directly in ordinary database records unless securely designed and encrypted.

---

## 26.2 commerce.products

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
product_type VARCHAR NOT NULL
resource_id UUID NULL FK
bundle_id UUID NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 26.3 commerce.offers

Fields:

```text
id UUID PK
product_id UUID FK
currency_code VARCHAR NOT NULL
price_minor BIGINT NOT NULL
commercial_status VARCHAR NOT NULL
starts_at TIMESTAMPTZ NULL
ends_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Pricing is separate from resource identity.

Use integer minor currency units rather than floating-point monetary values.

---

# 27. ORDERS

## 27.1 commerce.orders

Fields:

```text
id UUID PK
user_id UUID FK
currency_code VARCHAR NOT NULL
total_minor BIGINT NOT NULL
status VARCHAR NOT NULL
idempotency_key VARCHAR NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 27.2 commerce.order_items

Fields:

```text
id UUID PK
order_id UUID FK
product_id UUID FK
offer_id UUID FK
quantity INTEGER NOT NULL
unit_price_minor BIGINT NOT NULL
total_minor BIGINT NOT NULL
created_at TIMESTAMPTZ
```

Historical order prices must remain unchanged even if the current offer later changes.

---

# 28. PAYMENTS

## 28.1 commerce.payments

Fields:

```text
id UUID PK
order_id UUID FK
payment_provider_id UUID FK
provider_reference VARCHAR NULL
provider_transaction_id VARCHAR NULL
amount_minor BIGINT NOT NULL
currency_code VARCHAR NOT NULL
status VARCHAR NOT NULL
requested_at TIMESTAMPTZ
completed_at TIMESTAMPTZ NULL
failed_at TIMESTAMPTZ NULL
failure_reason TEXT NULL
provider_payload JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Payment history is retained.

Provider references are separate from internal payment UUIDs.

---

# 29. ENTITLEMENTS

## 29.1 commerce.entitlements

Fields:

```text
id UUID PK
user_id UUID FK
resource_id UUID FK
source_order_id UUID NULL FK
status VARCHAR NOT NULL
starts_at TIMESTAMPTZ NOT NULL
ends_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
revoked_at TIMESTAMPTZ NULL
revoked_by UUID NULL
```

Rules:

* Entitlement follows permanent resource identity.
* Resource version changes do not automatically invalidate ownership.
* Revocation must be auditable.
* Download authorization must verify entitlement server-side.

---

# 30. CONTRIBUTOR SCHEMA

## 30.1 community.contributors

Fields:

```text
id UUID PK
user_id UUID FK
display_name VARCHAR NOT NULL
bio TEXT NULL
profile_slug VARCHAR NOT NULL
verification_status VARCHAR NOT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
suspended_at TIMESTAMPTZ NULL
suspended_by UUID NULL
```

Contributor profile is separate from user profile.

---

## 30.2 community.contributor_applications

Fields:

```text
id UUID PK
user_id UUID FK
application_text TEXT NULL
status VARCHAR NOT NULL
review_notes TEXT NULL
submitted_at TIMESTAMPTZ
reviewed_at TIMESTAMPTZ NULL
reviewed_by UUID NULL
```

---

## 30.3 community.contributor_submissions

Fields:

```text
id UUID PK
contributor_id UUID FK
title VARCHAR NOT NULL
description TEXT NULL
proposed_price_minor BIGINT NULL
proposed_currency_code VARCHAR NULL
status VARCHAR NOT NULL
resource_id UUID NULL FK
submitted_at TIMESTAMPTZ
reviewed_at TIMESTAMPTZ NULL
reviewed_by UUID NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Workflow:

```text
DRAFT
SUBMITTED
PROCESSING
REVIEW
APPROVED
REJECTED
PUBLISHED
```

---

## 30.4 community.contributor_submission_files

Fields:

```text
id UUID PK
submission_id UUID FK
file_id UUID FK
created_at TIMESTAMPTZ
```

---

## 30.5 community.contributor_verifications

Fields:

```text
id UUID PK
contributor_id UUID FK
verification_type VARCHAR NOT NULL
status VARCHAR NOT NULL
evidence JSONB NULL
notes TEXT NULL
created_at TIMESTAMPTZ
reviewed_by UUID NULL
```

Contributor verification is separate from resource verification.

---

## 30.6 community.contributor_revenue_rules

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
percentage NUMERIC(7,4) NULL
fixed_amount_minor BIGINT NULL
currency_code VARCHAR NULL
effective_from TIMESTAMPTZ NOT NULL
effective_to TIMESTAMPTZ NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
```

Revenue rules are historical.

---

## 30.7 community.contributor_earnings

Fields:

```text
id UUID PK
contributor_id UUID FK
order_id UUID NULL FK
resource_id UUID NULL FK
gross_amount_minor BIGINT NOT NULL
platform_amount_minor BIGINT NOT NULL
contributor_amount_minor BIGINT NOT NULL
currency_code VARCHAR NOT NULL
revenue_rule_id UUID NULL FK
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
```

Historical financial values must remain unchanged.

---

## 30.8 community.contributor_payouts

Fields:

```text
id UUID PK
contributor_id UUID FK
amount_minor BIGINT NOT NULL
currency_code VARCHAR NOT NULL
status VARCHAR NOT NULL
provider_reference VARCHAR NULL
requested_at TIMESTAMPTZ
completed_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Financial information must be protected.

---

# 31. EDUCATION UPDATES

## 31.1 content.education_updates

Fields:

```text
id UUID PK
title VARCHAR NOT NULL
slug VARCHAR NOT NULL
summary TEXT NULL
body TEXT NOT NULL
seo_title VARCHAR NULL
seo_description TEXT NULL
publication_status VARCHAR NOT NULL
published_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
```

Education Updates are independent from Resources.

---

## 31.2 content.education_update_categories

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
```

---

## 31.3 content.education_update_curricula

Fields:

```text
update_id UUID FK
curriculum_id UUID FK
```

---

## 31.4 content.education_update_resources

Fields:

```text
update_id UUID FK
resource_id UUID FK
display_order INTEGER NULL
```

---

# 32. CALENDAR SCHEMA

## 32.1 calendar.calendars

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
calendar_scope VARCHAR NOT NULL
country_id UUID NULL FK
curriculum_id UUID NULL FK
education_level_id UUID NULL FK
school_id UUID NULL FK
user_id UUID NULL FK
session_id VARCHAR NULL
academic_year VARCHAR NULL
description TEXT NULL
status VARCHAR NOT NULL
expires_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
```

Calendar scopes:

```text
OFFICIAL
SCHOOL
USER
ANONYMOUS_SESSION
```

Ownership rules:

### OFFICIAL

* No user_id
* No session_id

### SCHOOL

* Requires school_id

### USER

* Requires user_id

### ANONYMOUS_SESSION

* Requires session_id
* Requires expires_at

---

# 33. calendar.calendar_event_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
slug VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
display_order INTEGER NULL
```

Initial categories may include:

* Examination
* Holiday
* School Opening
* Meeting
* Sports
* Academic
* Deadline
* Trip
* Training
* Personal
* Other

---

# 34. calendar.calendar_events

Fields:

```text
id UUID PK
calendar_id UUID FK
event_type_id UUID FK
title VARCHAR NOT NULL
description TEXT NULL
start_date DATE NOT NULL
end_date DATE NULL
start_time TIME NULL
end_time TIME NULL
all_day BOOLEAN NOT NULL DEFAULT true
location TEXT NULL
source_type VARCHAR NOT NULL
source_id UUID NULL
visibility VARCHAR NOT NULL
status VARCHAR NOT NULL
recurrence_rule_id UUID NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
created_by UUID NULL
updated_by UUID NULL
```

Rules:

* `end_date >= start_date`.
* Where both times are present, end time must not precede start time for the same event.
* Official events cannot be created under user/session ownership.
* Personal events cannot modify official events.
* Rendering may combine official and personal events without merging ownership.

Source types:

```text
OFFICIAL
SCHOOL
USER
IMPORTED
SYSTEM
```

---

# 35. calendar.calendar_recurrence_rules

Fields:

```text
id UUID PK
frequency VARCHAR NOT NULL
interval_value INTEGER NOT NULL
days_of_week JSONB NULL
day_of_month INTEGER NULL
month_of_year INTEGER NULL
start_date DATE NOT NULL
end_date DATE NULL
rule_definition JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Recurrence must be represented structurally rather than by duplicating potentially unlimited future events.

---

# 36. calendar.calendar_exports

Fields:

```text
id UUID PK
calendar_id UUID FK
export_type VARCHAR NOT NULL
status VARCHAR NOT NULL
storage_key TEXT NULL
file_id UUID NULL FK
requested_at TIMESTAMPTZ NOT NULL
completed_at TIMESTAMPTZ NULL
expires_at TIMESTAMPTZ NULL
error_message TEXT NULL
```

Initial export:

```text
PDF
```

Future exports may include:

```text
ICS
XLSX
CSV
```

Generated files should use private/temporary storage and controlled access.

---

# 37. calendar.calendar_templates

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
description TEXT NULL
template_type VARCHAR NOT NULL
layout_config JSONB NOT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

# 38. ANALYTICS SCHEMA

## 38.1 analytics.analytics_event_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
event_code VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
configuration JSONB NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Tracked event types are configurable.

---

## 38.2 analytics.analytics_events

Fields:

```text
id UUID PK
event_type_id UUID FK
user_id UUID NULL FK
session_id VARCHAR NULL
country_id UUID NULL FK
entity_type VARCHAR NULL
entity_id UUID NULL
context JSONB NULL
occurred_at TIMESTAMPTZ NOT NULL
```

Requirements:

* Anonymous events supported.
* Authenticated events supported.
* User linkage optional.
* Sensitive information minimized.
* Table should be designed for future partitioning.
* Analytics should not overload transactional queries.

---

# 39. GOVERNANCE SCHEMA

## 39.1 governance.quality_labels

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
code VARCHAR NOT NULL
description TEXT NULL
display_symbol VARCHAR NULL
status VARCHAR NOT NULL
```

Initial labels:

```text
STANDARD
VERIFIED
PREMIUM
```

---

## 39.2 governance.quality_check_types

Fields:

```text
id UUID PK
name VARCHAR NOT NULL
code VARCHAR NOT NULL
description TEXT NULL
required_for_publication BOOLEAN NOT NULL DEFAULT false
status VARCHAR NOT NULL
```

Possible checks:

* Curriculum alignment
* Factual accuracy
* Completeness
* Level/difficulty
* Formatting/readability
* Classification
* Provenance
* Rights
* Exam relevance

---

## 39.3 governance.resource_quality_checks

Fields:

```text
id UUID PK
resource_id UUID FK
resource_version_id UUID NULL FK
check_type_id UUID FK
status VARCHAR NOT NULL
notes TEXT NULL
checked_by UUID NULL
checked_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 39.4 governance.resource_verifications

Fields:

```text
id UUID PK
resource_id UUID FK
resource_version_id UUID NULL FK
verification_status VARCHAR NOT NULL
reason TEXT NULL
verified_by UUID NULL
verified_at TIMESTAMPTZ NULL
revoked_at TIMESTAMPTZ NULL
revoked_by UUID NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Verification is revocable and auditable.

---

# 40. AUDIT

## 40.1 governance.audit_logs

Fields:

```text
id UUID PK
actor_user_id UUID NULL FK
action VARCHAR NOT NULL
entity_type VARCHAR NOT NULL
entity_id UUID NULL
before_data JSONB NULL
after_data JSONB NULL
context JSONB NULL
occurred_at TIMESTAMPTZ NOT NULL
```

Audit logs are append-only.

Important actions must create audit records.

Do not casually update or delete audit history.

---

# 41. RETENTION

## 41.1 governance.retention_policies

Fields:

```text
id UUID PK
data_category VARCHAR NOT NULL
retention_period_days INTEGER NULL
action VARCHAR NOT NULL
description TEXT NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 41.2 governance.data_retention_actions

Fields:

```text
id UUID PK
policy_id UUID FK
data_category VARCHAR NOT NULL
action VARCHAR NOT NULL
records_affected BIGINT NULL
started_at TIMESTAMPTZ NOT NULL
completed_at TIMESTAMPTZ NULL
status VARCHAR NOT NULL
details JSONB NULL
```

Actions may include:

```text
DELETE
ANONYMIZE
ARCHIVE
EXPIRE
```

Retention actions must be auditable.

---

# 42. SYSTEM SCHEMA

The system schema may contain infrastructure-level configuration and migration-support tables where required.

Examples may include:

* Migration metadata
* Job configuration
* System settings
* Feature configuration
* Idempotency records
* Other infrastructure-level data

System tables must not become a dumping ground for ordinary business entities.

---

# 43. SEARCH DATABASE DESIGN

PostgreSQL FTS is the initial search implementation.

The database should support a search document/index structure where appropriate.

Searchable information may include:

* Resource title
* Short description
* SEO description
* Extracted text
* Curriculum
* Grade/Form
* Subject
* Topic
* Resource type
* Other approved structured metadata

The implementation should allow future replacement with a dedicated search engine.

---

# 44. SEARCH ABSTRACTION

The application must not directly expose PostgreSQL FTS implementation details to the frontend.

Use:

```text
SearchProvider
```

The initial implementation may use PostgreSQL.

A future implementation may use another search engine without changing the public API contract.

---

# 45. INDEXING PRINCIPLES

Indexes should exist on:

* Foreign keys
* Frequently filtered columns
* Frequently joined columns
* Important unique identifiers
* Search-related structures
* Publication/status fields where beneficial
* Timestamps where query patterns justify them

Do not create indexes indiscriminately.

Indexes should be justified by query patterns and tested.

---

# 46. UNIQUE CONSTRAINTS

Important business identifiers should use database-level uniqueness.

Examples include:

* Country ISO code
* Country URL prefix
* Scoped slugs
* Curriculum codes where defined
* Resource version number per resource
* Role slugs
* Permission identifiers
* Provider codes
* Other identifiers that must be unique

Global uniqueness must not be assumed where the business meaning is scoped.

---

# 47. SLUG UNIQUENESS

Slugs are scoped.

Examples:

* Resource slugs may be unique within the appropriate resource namespace.
* Curriculum slugs may be unique within country.
* School slugs may be unique within country.
* Update slugs may be unique within their namespace.

Never make all platform slugs globally unique unless there is a clear requirement.

---

# 48. FOREIGN KEYS

Foreign keys must be used for relational integrity.

Examples:

```text
resource_version.resource_id
school.country_id
grade_level.curriculum_version_id
resource_grade_levels.grade_level_id
order_items.order_id
payments.order_id
entitlements.resource_id
calendar_events.calendar_id
```

Do not rely solely on application code for important referential integrity.

---

# 49. DELETE POLICY

Physical deletion must be restricted.

Use soft deletion or deactivation where historical relationships matter.

Examples:

* Schools
* Resources
* Users
* Collections
* Contributors
* Important governance records

Critical financial records must not be casually deleted.

Audit records are append-only.

---

# 50. RESOURCE DELETION

Deleting a resource should normally mean:

* Remove from public discovery
* Preserve UUID
* Preserve versions
* Preserve historical relationships
* Preserve analytics references
* Preserve purchase/entitlement history
* Preserve audit history

Legal requirements may require permanent deletion in specific cases.

---

# 51. RESOURCE VERSION INTEGRITY

A resource version must always belong to exactly one resource.

Version numbers are unique within a resource.

Published versions must be immutable.

Changes requiring substantive modification create a new version.

---

# 52. PUBLISHED DATA INTEGRITY

Published resource metadata must not be silently changed in ways that invalidate the historical publication state.

Where historical accuracy matters, preserve an immutable metadata snapshot.

---

# 53. TRANSACTION RULES

Use PostgreSQL transactions for operations that must succeed or fail together.

Examples:

### Purchase

```text
Order
+
Order Items
+
Payment state
```

### Successful payment

```text
Payment confirmation
+
Order update
+
Entitlement
```

### Publication

```text
Resource/version state
+
Quality state
+
Search indexing trigger/state
+
Audit record
```

---

# 54. IDEMPOTENCY

Critical operations must be idempotent.

Examples:

* Payment callback
* Payment verification
* Order creation where required
* Entitlement creation
* File-processing jobs
* Notification delivery
* Scheduled jobs
* Other operations where duplicate execution causes incorrect state

Duplicate callbacks must not create duplicate entitlements.

---

# 55. MONEY

Never use floating-point values for monetary amounts.

Use integer minor units:

```text
BIGINT
```

Examples:

```text
KSh 2.00 → 200 minor units
```

The exact minor-unit interpretation must follow the currency configuration.

Historical transaction amounts must remain unchanged.

---

# 56. TIME AND DATES

Use:

```text
TIMESTAMPTZ
```

for timestamps representing real points in time.

Use:

```text
DATE
```

for date-only educational dates.

Use:

```text
TIME
```

for time-only event fields.

Do not store dates as arbitrary text when structured date types are appropriate.

---

# 57. JSONB USAGE

JSONB may be used for:

* Configuration
* Provider payloads
* Flexible metadata
* Contextual analytics
* Taxonomy mappings
* Layout configuration
* Country configuration
* Other intentionally flexible structures

Do not use JSONB to avoid designing relational structures that are clearly required.

Core relationships must remain relational.

---

# 58. ANALYTICS PARTITIONING

Analytics events should be designed so that partitioning can be introduced later.

Do not over-engineer partitioning before it is needed.

The initial implementation must nevertheless avoid schema decisions that make later partitioning unnecessarily difficult.

---

# 59. CALENDAR OWNERSHIP INTEGRITY

The database/application must enforce these ownership rules:

```text
OFFICIAL
→ country/curriculum/education context
→ no user ownership

SCHOOL
→ school ownership

USER
→ authenticated user ownership

ANONYMOUS_SESSION
→ session ownership
→ expiration required
```

A UUID alone is never considered proof of ownership.

---

# 60. ANONYMOUS SESSION DATA

Anonymous calendar/activity data may use a session identifier.

Anonymous records should have appropriate expiration where applicable.

Users must not be able to access another user's anonymous data merely by knowing a UUID.

Authorization must be enforced at the application layer.

---

# 61. STUDENT DATA

The database should minimize student-related personal information.

Do not introduce unnecessary student identity fields merely because future student features may exist.

Future student functionality must follow data-minimization principles.

---

# 62. DATA RETENTION

Retention requirements should be configurable by category.

Examples:

* Financial records
* Audit records
* User activity
* Anonymous activity
* Temporary calendar sessions
* Processing data
* Analytics

Legal or financial records may require longer retention.

---

# 63. FUTURE MIGRATION

The schema should support future:

* Countries
* Curricula
* Curriculum versions
* Payment providers
* Storage providers
* Search providers
* Languages
* Educational structures

Avoid country-specific table redesigns.

---

# 64. DATABASE MIGRATION ORDER

The implementation should use explicit migrations in this order:

```text
001_extensions.sql
002_schemas.sql
003_system_functions.sql
004_platform.sql
005_geography.sql
006_schools.sql
007_curricula.sql
008_curriculum_versions.sql
009_levels_grades_pathways.sql
010_subjects_topics.sql
011_curriculum_mappings.sql
012_resource_types.sql
013_resources.sql
014_resource_versions.sql
015_resource_classifications.sql
016_resource_slug_history.sql
017_files.sql
018_file_processing.sql
019_file_derivatives.sql
020_file_extractions.sql
021_collections.sql
022_bundles_products_offers.sql
023_users.sql
024_authentication.sql
025_rbac.sql
026_school_relationships.sql
027_preferences_activity.sql
028_requests_feedback_reports.sql
029_notifications.sql
030_commerce.sql
031_contributors.sql
032_contributor_financials.sql
033_education_updates.sql
034_calendars.sql
035_calendar_events.sql
036_calendar_exports.sql
037_analytics.sql
038_quality_governance.sql
039_audit_retention.sql
040_search.sql
041_indexes.sql
042_triggers.sql
043_constraints.sql
```

The exact contents of each migration may be adjusted if dependency ordering requires it, but the architectural dependency order must be preserved.

---

# 65. SEED DATA

Seed data should be separated from schema migrations.

Expected seed files:

```text
database/seeds/
├── countries.sql
├── kenya_geography_types.sql
├── school_types.sql
├── curriculum.sql
├── resource_types.sql
├── quality_labels.sql
├── roles.sql
├── permissions.sql
├── calendar_event_types.sql
└── payment_providers.sql
```

Business/configuration data should not be hardcoded into application source code.

---

# 66. DATABASE TESTS

Database tests should verify:

* UUID generation
* Foreign keys
* Country uniqueness
* Country status
* Geography hierarchy
* School integrity
* Curriculum hierarchy
* Curriculum version coexistence
* Resource identity
* Resource version uniqueness
* Resource classification
* File integrity
* Collections
* User relationships
* Saved-resource model
* RBAC
* Commerce
* Entitlements
* Contributor relationships
* Calendar ownership
* Calendar event validation
* Analytics records
* Governance
* Audit
* Retention

---

# 67. CRITICAL LOCKED DECISIONS

The following database decisions are locked and must not be silently changed:

1. Every major entity uses UUID identity.
2. Every school belongs to exactly one country.
3. Users can belong to multiple schools.
4. Curriculum belongs to one country.
5. Curriculum versions are immutable historical structures.
6. Levels are database entities.
7. Grade/Form belongs to curriculum version + level.
8. Pathways are optional database entities.
9. Subjects are curriculum-specific.
10. Topics have stable identities.
11. Curriculum mappings define topic placement.
12. Resources have permanent UUID identity.
13. Resource titles are not globally unique.
14. SEO slugs are separate from identity.
15. Resources support multiple curriculum versions.
16. Resources support multiple grades/forms.
17. Resources have exactly one core subject.
18. Resources have exactly one core topic.
19. Resources support multiple resource types.
20. One primary resource type exists.
21. One primary curriculum classification exists.
22. Resource versions preserve resource identity.
23. Published versions are immutable.
24. Files belong to resource versions.
25. Original files are immutable.
26. Files live in object storage.
27. SHA-256 checksums are required.
28. File processing is asynchronous.
29. Collections are separate from bundles.
30. Bundles cannot contain bundles.
31. Authentication identity is separate from user profile.
32. Users can have multiple roles.
33. Permissions are separate from roles.
34. Permissions can be scoped.
35. Saved resources are stored directly on the user record.
36. Saved resources refer to specific resource versions.
37. Saved resources are flat.
38. Saved resources are not organized through private collections.
39. Anonymous activity is supported.
40. Authenticated activity syncs across devices.
41. Requests may be anonymous.
42. Feedback may be anonymous.
43. Serious reports are separate from ordinary feedback.
44. Notifications are centralized.
45. Commerce is separate from resource identity.
46. Pricing is separate from resource identity.
47. Payment providers are abstracted.
48. Entitlements follow permanent resource identity.
49. Contributor identity is separate from resource verification.
50. Contributor financial records are historical.
51. Education Updates are separate from Resources.
52. Academic Calendar is a dedicated subsystem.
53. Official and personal calendar data are separate.
54. Anonymous calendars require session ownership and expiration.
55. Analytics use a centralized event model.
56. Analytics are designed for future partitioning.
57. Audit logs are append-only.
58. Retention is configurable.
59. PostgreSQL FTS is the initial search implementation.
60. Search remains behind an abstraction.
61. PostgreSQL foreign keys are mandatory for important relationships.
62. Critical operations use transactions.
63. Critical operations use idempotency protection.
64. The ORM must not silently redesign the database.

---

# 68. ORM RULE

The application may use Drizzle ORM for type-safe database access.

However:

> Explicit SQL migrations are authoritative.

The ORM must not automatically:

* Drop production tables
* Rename production columns
* Remove constraints
* Change relationships
* Redesign the schema
* Delete historical data

Any structural change requires an explicit migration.

---

# 69. DATABASE SOURCE OF TRUTH

The database specification, SQL migrations and approved architectural decisions form the database source of truth.

If the coding agent finds a conflict:

1. Stop.
2. Identify the conflict.
3. Report it.
4. Do not silently redesign the database.

---

# 70. FINAL DATABASE PRINCIPLE

The database must preserve:

* Identity
* History
* Relationships
* Trust
* Security
* Financial integrity
* Educational structure
* Auditability
* Future flexibility

The database is not merely storage for the frontend.

It is the authoritative structured foundation of the entire education platform.
