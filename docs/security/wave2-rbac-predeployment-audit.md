# Wave 2 RBAC Pre-Deployment Audit & Seed Governance Runbook

**Workpackage:** WP5 — RBAC Scope Reclassification & Country Boundary Enforcement  
**Baseline:** Prompt 33 Wave 2 Plan (Revision 3.0)  
**Canonical Seed Module:** `src/db/seeds/roles-permissions.ts`

---

## 1. Purpose & Zero-Waiver Governance Model

Wave 2 reclassifies **11 country-editorial permissions** from `'GLOBAL'` to `'ANY'` so that `COUNTRY`-scoped `content_manager` and `content_reviewer` staff can operate within their assigned country boundaries without holding unscoped platform-wide privileges, while **19 platform-wide permissions** remain strictly `'GLOBAL'`.

### Canonical Inventory Targets
- **Canonical Roles:** `6` (`system_admin` [`SYSTEM`], `content_manager` [`SYSTEM`], `content_reviewer` [`SYSTEM`], `verified_teacher` [`ORGANIZATIONAL`], `standard_user` [`SYSTEM`], `contributor` [`ORGANIZATIONAL`])
- **Canonical Permissions:** `48` total (`29 ANY` + `19 GLOBAL`, `0 SCOPED`)
- **Canonical Role-Permission Mappings:** `106` total (`48` + `34` + `13` + `4` + `5` + `2`)
- **Exact 11 Legacy `'GLOBAL' -> 'ANY'` Reclassifications:**
  1. `update.create`
  2. `update.edit`
  3. `update.publish`
  4. `update.archive`
  5. `update.read`
  6. `quality.check.create`
  7. `quality.verify`
  8. `quality.revoke`
  9. `quality.read`
  10. `feedback.read`
  11. `feedback.manage`

### Binding Zero-Waiver Rules
1. **No audit-log attestation waivers:** Because `identity.user_roles` permits in-place mutation and `governance.audit_logs.occurred_at` can be caller-supplied, historical administrator authority is never inferred from audit rows.
2. **No active unscoped editorial or verified-teacher grants at seed time:** Active (`status = 'ACTIVE'` and non-expired) unscoped (`scope_type IS NULL`) assignments for `content_manager`, `content_reviewer`, or `verified_teacher` are strictly prohibited.
3. **Country-scoped editorial assignments supported:** `content_manager` and `content_reviewer` must use `scope_type = 'COUNTRY'` referencing an `ACTIVE` row in `platform.countries`. `verified_teacher` must use `COUNTRY` or `SCHOOL` referencing an `ACTIVE` target.
4. **Global roles remain unscoped:** `system_admin`, `contributor`, and `standard_user` must have `scope_type IS NULL`.
5. **Zero custom RBAC inventory or drift:** Custom roles, custom permissions, unexpected `role_permissions` rows, metadata/status drift, or missing canonical inventory (once `identity.role_permissions` is initialized) abort seeding before any fast-path return or database write.

---

## 2. Partial-Bootstrap Policy Matrix (`PB-1` – `PB-4`)

`Query B` determines `mappings_initialized` via `EXISTS (SELECT 1 FROM identity.role_permissions)`:

| State ID | Database State Before `seedRolesAndPermissions` | `mappings_initialized` | `Query B` Outcome | Seed Action |
| :--- | :--- | :--- | :--- | :--- |
| **PB-1** | Empty RBAC tables (`0` roles, `0` permissions, `0` `role_permissions`) | `false` | `0` rows (PASS) | Acquires `pg_advisory_xact_lock(20263302, 1)`, inserts all `6` roles, `48` permissions (`29 ANY` + `19 GLOBAL`), and `106` mappings. |
| **PB-2** | Partial or complete canonical roles/permissions present with clean metadata, `0` `role_permissions` | `false` | `0` rows (PASS) | Branches 1, 2, 4, 5 validate all existing rows; Branches 3, 6, 7 defer until mappings exist; seed converges full `6 / 48 / 106` inventory. |
| **PB-3** | `0` `role_permissions`, but an unexpected role/permission or drifted metadata/scope (`NULL`, `'SCOPED'`, or non-allowlisted `'GLOBAL'`) exists | `false` | `>= 1` rows (FAIL) | Aborts immediately with `Wave2RbacPreconditionError` before any writes. |
| **PB-4** | `>= 1` rows in `identity.role_permissions` with missing canonical role, missing canonical permission, missing canonical mapping, or unexpected mapping | `true` | `>= 1` rows (FAIL) | All 8 branches of `Query B` are active; aborts immediately with `Wave2RbacPreconditionError`. |

---

## 3. Pre-Deployment Audit Queries (100% Programmatic SQL Parity)

Operators MUST run both `Query A` and `Query B` against the target environment before running Wave 2 deployment seeds. **Both queries MUST return `0` rows.** `seedRolesAndPermissions()` executes these exact queries inside a single transaction under `SELECT pg_advisory_xact_lock(20263302, 1)` prior to its fast-path check and prior to any `INSERT`/`UPDATE`.

### 3.1 Query A — Active User-Role Assignment Governance Audit

<!-- WAVE2_QUERY_A_START -->
```sql
WITH active_grants AS (
  SELECT
    ur.id AS user_role_id,
    ur.user_id,
    ur.role_id,
    r.slug AS role_slug,
    ur.scope_type,
    ur.scope_id,
    ur.status,
    ur.starts_at,
    ur.ends_at
  FROM identity.user_roles ur
  LEFT JOIN identity.roles r
    ON r.id = ur.role_id
  WHERE ur.status = 'ACTIVE'
    AND (ur.ends_at IS NULL OR ur.ends_at > now())
)
-- Branch A1: Any user_roles row referencing a missing or non-canonical role slug
SELECT
  'NON_CANONICAL_USER_ROLE'::text AS violation_code,
  COALESCE(ur.id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ur.user_id::text, '<NULL>')
    || ', role_id=' || COALESCE(ur.role_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(r.slug, '<NULL>')
    || ', status=' || COALESCE(ur.status, '<NULL>') AS details
FROM identity.user_roles ur
LEFT JOIN identity.roles r
  ON r.id = ur.role_id
WHERE r.slug IS NULL
   OR r.slug NOT IN (
     'system_admin',
     'content_manager',
     'content_reviewer',
     'verified_teacher',
     'contributor',
     'standard_user'
   )

UNION ALL

-- Branch A2: Active scoped assignment on global-only roles (system_admin, contributor, standard_user)
SELECT
  'SCOPED_GLOBAL_ROLE_ASSIGNMENT'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(ag.role_slug, '<NULL>')
    || ', scope_type=' || COALESCE(ag.scope_type, '<NULL>')
    || ', scope_id=' || COALESCE(ag.scope_id::text, '<NULL>') AS details
FROM active_grants ag
WHERE ag.role_slug IN ('system_admin', 'contributor', 'standard_user')
  AND ag.scope_type IS NOT NULL

UNION ALL

-- Branch A3: Active unscoped editorial role assignment (zero-waiver prohibition on content_manager, content_reviewer)
SELECT
  'UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(ag.role_slug, '<NULL>')
    || ', scope_type=<NULL> (country scope required)' AS details
FROM active_grants ag
WHERE ag.role_slug IN ('content_manager', 'content_reviewer')
  AND ag.scope_type IS NULL

UNION ALL

-- Branch A4: Active non-COUNTRY scope on editorial roles (SCHOOL/RESOURCE unsupported for editorial roles)
SELECT
  'UNSUPPORTED_EDITORIAL_SCOPE_ASSIGNMENT'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(ag.role_slug, '<NULL>')
    || ', scope_type=' || COALESCE(ag.scope_type, '<NULL>')
    || ', scope_id=' || COALESCE(ag.scope_id::text, '<NULL>') AS details
FROM active_grants ag
WHERE ag.role_slug IN ('content_manager', 'content_reviewer')
  AND ag.scope_type IS NOT NULL
  AND ag.scope_type <> 'COUNTRY'

UNION ALL

-- Branch A5: Active unscoped verified_teacher assignment (zero-waiver prohibition)
SELECT
  'UNSCOPED_VERIFIED_TEACHER_ASSIGNMENT'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=verified_teacher, scope_type=<NULL> (COUNTRY or SCHOOL scope required)' AS details
FROM active_grants ag
WHERE ag.role_slug = 'verified_teacher'
  AND ag.scope_type IS NULL

UNION ALL

-- Branch A6: Active unsupported RESOURCE scope on verified_teacher
SELECT
  'UNSUPPORTED_VERIFIED_TEACHER_SCOPE_ASSIGNMENT'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=verified_teacher'
    || ', scope_type=' || COALESCE(ag.scope_type, '<NULL>')
    || ', scope_id=' || COALESCE(ag.scope_id::text, '<NULL>') AS details
FROM active_grants ag
WHERE ag.role_slug = 'verified_teacher'
  AND ag.scope_type IS NOT NULL
  AND ag.scope_type NOT IN ('COUNTRY', 'SCHOOL')

UNION ALL

-- Branch A7: Active COUNTRY-scoped grant referencing missing or INACTIVE country
SELECT
  'INVALID_COUNTRY_SCOPE_TARGET'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(ag.role_slug, '<NULL>')
    || ', scope_id=' || COALESCE(ag.scope_id::text, '<NULL>') AS details
FROM active_grants ag
WHERE ag.scope_type = 'COUNTRY'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.countries c
    WHERE c.id = ag.scope_id
      AND c.status = 'ACTIVE'
  )

UNION ALL

-- Branch A8: Active SCHOOL-scoped grant referencing missing or INACTIVE school
SELECT
  'INVALID_SCHOOL_SCOPE_TARGET'::text AS violation_code,
  COALESCE(ag.user_role_id::text, '<NULL>') AS subject_key,
  'user_id=' || COALESCE(ag.user_id::text, '<NULL>')
    || ', role_slug=' || COALESCE(ag.role_slug, '<NULL>')
    || ', scope_id=' || COALESCE(ag.scope_id::text, '<NULL>') AS details
FROM active_grants ag
WHERE ag.scope_type = 'SCHOOL'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.schools s
    WHERE s.id = ag.scope_id
      AND s.status = 'ACTIVE'
  )
ORDER BY violation_code ASC, subject_key ASC;
```
<!-- WAVE2_QUERY_A_END -->

### 3.2 Query B — RBAC Inventory, Metadata, Scope & Mapping Drift Audit (Revision 3.0)

<!-- WAVE2_QUERY_B_START -->
```sql
WITH canonical_roles(slug, name, role_type, description) AS (
  VALUES
    ('system_admin', 'System Administrator', 'SYSTEM', 'Full administrative control across the platform.'),
    ('content_manager', 'Content Manager', 'SYSTEM', 'Full management over curriculum content and resource publishing lifecycle.'),
    ('content_reviewer', 'Content Reviewer', 'SYSTEM', 'Evaluates submitted educational materials and approves or rejects candidate versions.'),
    ('verified_teacher', 'Verified Teacher', 'ORGANIZATIONAL', 'Verified educator permitted to create, author, and submit materials for publication review.'),
    ('standard_user', 'Standard User', 'SYSTEM', 'Baseline public learner or registered member; access to personal library and public materials.'),
    ('contributor', 'Educational Contributor', 'ORGANIZATIONAL', 'Approved educator or author permitted to submit educational resources for editorial review.')
),
canonical_permissions(name, resource, action, target_scope_type, allow_legacy_global, description) AS (
  VALUES
    ('resource.read', 'resource', 'read', 'ANY', false, 'View accessible resources and metadata.'),
    ('resource.create', 'resource', 'create', 'ANY', false, 'Create draft educational resources.'),
    ('resource.update', 'resource', 'update', 'ANY', false, 'Edit owned or permitted resource drafts and metadata.'),
    ('resource.submit', 'resource', 'submit', 'ANY', false, 'Submit candidate resource drafts for editorial review.'),
    ('resource.review', 'resource', 'review', 'ANY', false, 'Inspect candidate resources under review.'),
    ('resource.approve', 'resource', 'approve', 'ANY', false, 'Mark candidate resources as approved for publication.'),
    ('resource.reject', 'resource', 'reject', 'ANY', false, 'Reject candidate resources with mandatory reason.'),
    ('resource.publish', 'resource', 'publish', 'ANY', false, 'Release approved resources and versions to the public catalogue.'),
    ('resource.archive', 'resource', 'archive', 'ANY', false, 'Transition published resources to terminal archived state.'),
    ('user.read', 'user', 'read', 'GLOBAL', false, 'View user account information.'),
    ('user.manage_roles', 'user', 'manage_roles', 'GLOBAL', false, 'Assign or revoke roles and scopes on user accounts.'),
    ('contributor.apply', 'contributor', 'apply', 'GLOBAL', false, 'Submit an application to become an educational contributor.'),
    ('contributor.profile.read', 'contributor', 'profile_read', 'GLOBAL', false, 'View private contributor profile and workspace dashboard.'),
    ('contributor.profile.update', 'contributor', 'profile_update', 'GLOBAL', false, 'Update own contributor public bio and display name.'),
    ('contributor.submit', 'contributor', 'submit', 'GLOBAL', false, 'Create and submit candidate resources for editorial review.'),
    ('contributor.application.review', 'contributor', 'application_review', 'GLOBAL', false, 'Review, approve, or reject contributor applications and candidate submissions.'),
    ('contributor.manage', 'contributor', 'manage', 'GLOBAL', false, 'Manage contributor verification, lifecycle suspension, and administrative oversight.'),
    ('contributor.earnings.view', 'contributor', 'earnings_view', 'GLOBAL', false, 'View private contributor earnings and financial ledger.'),
    ('contributor.finance.manage', 'contributor', 'finance_manage', 'GLOBAL', false, 'Manage contributor revenue rules, audit earnings, and administrative financial oversight.'),
    ('update.create', 'update', 'create', 'ANY', true, 'Create draft education updates and circulars.'),
    ('update.edit', 'update', 'edit', 'ANY', true, 'Modify draft or published education updates.'),
    ('update.publish', 'update', 'publish', 'ANY', true, 'Release education updates to the public portal.'),
    ('update.archive', 'update', 'archive', 'ANY', true, 'Archive education updates, removing them from public access.'),
    ('update.read', 'update', 'read', 'ANY', true, 'View drafts and administrative details of education updates.'),
    ('quality.check.create', 'quality', 'check_create', 'ANY', true, 'Record evaluations for resource quality criteria.'),
    ('quality.verify', 'quality', 'verify', 'ANY', true, 'Grant official pedagogical verification to a resource version.'),
    ('quality.revoke', 'quality', 'revoke', 'ANY', true, 'Revoke verification from a previously verified resource version.'),
    ('quality.check_types.manage', 'quality', 'manage_types', 'GLOBAL', false, 'Manage quality check types and rubrics.'),
    ('quality.read', 'quality', 'read', 'ANY', true, 'View quality checks, verifications, and audit history.'),
    ('feedback.read', 'feedback', 'read', 'ANY', true, 'View resource feedback entries, summary metrics, and audit history.'),
    ('feedback.manage', 'feedback', 'manage', 'ANY', true, 'Triage, update status, and manage resource feedback.'),
    ('notification.admin.read', 'notification', 'admin_read', 'GLOBAL', false, 'View administrative notification delivery logs, retry queues, and dispatch statistics.'),
    ('notification.admin.manage', 'notification', 'admin_manage', 'GLOBAL', false, 'Trigger outbox processing sweeps and manage notification delivery operations.'),
    ('analytics.read', 'analytics', 'read', 'GLOBAL', false, 'View aggregate platform analytics, operational metrics, and reporting dashboards.'),
    ('analytics.manage', 'analytics', 'manage', 'GLOBAL', false, 'Configure analytics event types, retention rules, and telemetry controls.'),
    ('audit.read', 'audit', 'read', 'GLOBAL', false, 'View system audit logs and change histories.'),
    ('retention.read', 'retention', 'read', 'GLOBAL', false, 'View retention policies, execution logs, and point-in-time dry-run previews.'),
    ('retention.manage', 'retention', 'manage', 'GLOBAL', false, 'Create, update, activate, and deactivate data retention policies.'),
    ('retention.execute', 'retention', 'execute', 'GLOBAL', false, 'Trigger and recover manual or asynchronous data retention sweep executions.'),
    ('recommendation.read', 'recommendation', 'read', 'ANY', false, 'View editorial recommendation rules and curation state.'),
    ('recommendation.manage', 'recommendation', 'manage', 'ANY', false, 'Create, deactivate, and reactivate editorial recommendation rules.'),
    ('admin.dashboard.read', 'admin', 'dashboard_read', 'ANY', false, 'View centralized operational dashboard summaries and administrative KPIs.'),
    ('resource.admin.read', 'resource', 'admin_read', 'ANY', false, 'Inspect resources across all lifecycle states, versions, and publication events.'),
    ('file.admin.read', 'file', 'admin_read', 'ANY', false, 'Inspect controlled file storage metadata, checksums, and status across versions.'),
    ('file.admin.verify', 'file', 'admin_verify', 'ANY', false, 'Trigger controlled storage integrity verification checks on file records.'),
    ('homepage.read', 'homepage', 'read', 'ANY', false, 'View administrative homepage configurations, schedules, previews, and history.'),
    ('homepage.manage', 'homepage', 'manage', 'ANY', false, 'Create, edit, pin items in, and discard homepage draft configurations.'),
    ('homepage.publish', 'homepage', 'publish', 'ANY', false, 'Schedule, unschedule, cancel schedules, publish, and roll back homepage configurations.')
),
canonical_role_permissions(role_slug, permission_name) AS (
  VALUES
    ('system_admin', 'resource.read'),
    ('system_admin', 'resource.create'),
    ('system_admin', 'resource.update'),
    ('system_admin', 'resource.submit'),
    ('system_admin', 'resource.review'),
    ('system_admin', 'resource.approve'),
    ('system_admin', 'resource.reject'),
    ('system_admin', 'resource.publish'),
    ('system_admin', 'resource.archive'),
    ('system_admin', 'user.read'),
    ('system_admin', 'user.manage_roles'),
    ('system_admin', 'contributor.apply'),
    ('system_admin', 'contributor.profile.read'),
    ('system_admin', 'contributor.profile.update'),
    ('system_admin', 'contributor.submit'),
    ('system_admin', 'contributor.application.review'),
    ('system_admin', 'contributor.manage'),
    ('system_admin', 'contributor.earnings.view'),
    ('system_admin', 'contributor.finance.manage'),
    ('system_admin', 'update.create'),
    ('system_admin', 'update.edit'),
    ('system_admin', 'update.publish'),
    ('system_admin', 'update.archive'),
    ('system_admin', 'update.read'),
    ('system_admin', 'quality.check.create'),
    ('system_admin', 'quality.verify'),
    ('system_admin', 'quality.revoke'),
    ('system_admin', 'quality.check_types.manage'),
    ('system_admin', 'quality.read'),
    ('system_admin', 'feedback.read'),
    ('system_admin', 'feedback.manage'),
    ('system_admin', 'notification.admin.read'),
    ('system_admin', 'notification.admin.manage'),
    ('system_admin', 'analytics.read'),
    ('system_admin', 'analytics.manage'),
    ('system_admin', 'audit.read'),
    ('system_admin', 'retention.read'),
    ('system_admin', 'retention.manage'),
    ('system_admin', 'retention.execute'),
    ('system_admin', 'recommendation.read'),
    ('system_admin', 'recommendation.manage'),
    ('system_admin', 'admin.dashboard.read'),
    ('system_admin', 'resource.admin.read'),
    ('system_admin', 'file.admin.read'),
    ('system_admin', 'file.admin.verify'),
    ('system_admin', 'homepage.read'),
    ('system_admin', 'homepage.manage'),
    ('system_admin', 'homepage.publish'),
    ('content_manager', 'resource.read'),
    ('content_manager', 'resource.create'),
    ('content_manager', 'resource.update'),
    ('content_manager', 'resource.submit'),
    ('content_manager', 'resource.review'),
    ('content_manager', 'resource.approve'),
    ('content_manager', 'resource.reject'),
    ('content_manager', 'resource.publish'),
    ('content_manager', 'resource.archive'),
    ('content_manager', 'contributor.application.review'),
    ('content_manager', 'contributor.manage'),
    ('content_manager', 'update.create'),
    ('content_manager', 'update.edit'),
    ('content_manager', 'update.publish'),
    ('content_manager', 'update.archive'),
    ('content_manager', 'update.read'),
    ('content_manager', 'quality.check.create'),
    ('content_manager', 'quality.verify'),
    ('content_manager', 'quality.revoke'),
    ('content_manager', 'quality.read'),
    ('content_manager', 'feedback.read'),
    ('content_manager', 'feedback.manage'),
    ('content_manager', 'notification.admin.read'),
    ('content_manager', 'analytics.read'),
    ('content_manager', 'retention.read'),
    ('content_manager', 'recommendation.read'),
    ('content_manager', 'recommendation.manage'),
    ('content_manager', 'admin.dashboard.read'),
    ('content_manager', 'resource.admin.read'),
    ('content_manager', 'file.admin.read'),
    ('content_manager', 'file.admin.verify'),
    ('content_manager', 'homepage.read'),
    ('content_manager', 'homepage.manage'),
    ('content_manager', 'homepage.publish'),
    ('content_reviewer', 'resource.read'),
    ('content_reviewer', 'resource.review'),
    ('content_reviewer', 'resource.approve'),
    ('content_reviewer', 'resource.reject'),
    ('content_reviewer', 'contributor.application.review'),
    ('content_reviewer', 'quality.check.create'),
    ('content_reviewer', 'quality.read'),
    ('content_reviewer', 'feedback.read'),
    ('content_reviewer', 'recommendation.read'),
    ('content_reviewer', 'admin.dashboard.read'),
    ('content_reviewer', 'resource.admin.read'),
    ('content_reviewer', 'file.admin.read'),
    ('content_reviewer', 'homepage.read'),
    ('verified_teacher', 'resource.read'),
    ('verified_teacher', 'resource.create'),
    ('verified_teacher', 'resource.update'),
    ('verified_teacher', 'resource.submit'),
    ('contributor', 'resource.read'),
    ('contributor', 'contributor.profile.read'),
    ('contributor', 'contributor.profile.update'),
    ('contributor', 'contributor.submit'),
    ('contributor', 'contributor.earnings.view'),
    ('standard_user', 'resource.read'),
    ('standard_user', 'contributor.apply')
),
db_state AS (
  SELECT EXISTS (SELECT 1 FROM identity.role_permissions) AS mappings_initialized
)
-- Branch 1: Unexpected / non-canonical roles
SELECT
  'NON_CANONICAL_ROLE'::text AS violation_code,
  COALESCE(r.slug, '<NULL>') AS subject_key,
  'role_id=' || COALESCE(r.id::text, '<NULL>')
    || ', role_type=' || COALESCE(r.role_type, '<NULL>')
    || ', status=' || COALESCE(r.status, '<NULL>') AS details
FROM identity.roles r
LEFT JOIN canonical_roles cr
  ON cr.slug = r.slug
WHERE cr.slug IS NULL

UNION ALL

-- Branch 2: Canonical role metadata or status drift
SELECT
  'ROLE_METADATA_DRIFT'::text AS violation_code,
  cr.slug AS subject_key,
  'name=' || COALESCE(r.name, '<NULL>')
    || ' (expected ' || cr.name || ')'
    || ', role_type=' || COALESCE(r.role_type, '<NULL>')
    || ' (expected ' || cr.role_type || ')'
    || ', status=' || COALESCE(r.status, '<NULL>')
    || ' (expected ACTIVE)'
    || ', description=' || COALESCE(r.description, '<NULL>') AS details
FROM identity.roles r
INNER JOIN canonical_roles cr
  ON cr.slug = r.slug
WHERE r.name IS DISTINCT FROM cr.name
   OR r.role_type IS DISTINCT FROM cr.role_type
   OR r.description IS DISTINCT FROM cr.description
   OR r.status IS DISTINCT FROM 'ACTIVE'

UNION ALL

-- Branch 3: Missing canonical roles once role_permissions mappings are initialized
SELECT
  'MISSING_CANONICAL_ROLE'::text AS violation_code,
  cr.slug AS subject_key,
  'Canonical role is missing from identity.roles while role_permissions is initialized.' AS details
FROM canonical_roles cr
CROSS JOIN db_state s
LEFT JOIN identity.roles r
  ON r.slug = cr.slug
WHERE s.mappings_initialized = true
  AND r.id IS NULL

UNION ALL

-- Branch 4: Unexpected / non-canonical permissions
SELECT
  'NON_CANONICAL_PERMISSION'::text AS violation_code,
  COALESCE(p.name, '<NULL>') AS subject_key,
  'permission_id=' || COALESCE(p.id::text, '<NULL>')
    || ', scope_type=' || COALESCE(p.scope_type, '<NULL>')
    || ', status=' || COALESCE(p.status, '<NULL>') AS details
FROM identity.permissions p
LEFT JOIN canonical_permissions cp
  ON cp.name = p.name
WHERE cp.name IS NULL

UNION ALL

-- Branch 5: Canonical permission metadata, status, or NULL-safe scope drift
SELECT
  'PERMISSION_METADATA_DRIFT'::text AS violation_code,
  cp.name AS subject_key,
  'resource=' || COALESCE(p.resource, '<NULL>')
    || ' (expected ' || cp.resource || ')'
    || ', action=' || COALESCE(p.action, '<NULL>')
    || ' (expected ' || cp.action || ')'
    || ', scope_type=' || COALESCE(p.scope_type, '<NULL>')
    || ' (expected ' || cp.target_scope_type
    || CASE WHEN cp.allow_legacy_global THEN ' or legacy GLOBAL' ELSE '' END || ')'
    || ', status=' || COALESCE(p.status, '<NULL>')
    || ' (expected ACTIVE)'
    || ', description=' || COALESCE(p.description, '<NULL>') AS details
FROM identity.permissions p
INNER JOIN canonical_permissions cp
  ON cp.name = p.name
WHERE p.resource IS DISTINCT FROM cp.resource
   OR p.action IS DISTINCT FROM cp.action
   OR p.description IS DISTINCT FROM cp.description
   OR p.status IS DISTINCT FROM 'ACTIVE'
   OR (
     p.scope_type = cp.target_scope_type
     OR (cp.allow_legacy_global = true AND p.scope_type = 'GLOBAL')
   ) IS NOT TRUE

UNION ALL

-- Branch 6: Missing canonical permissions once role_permissions mappings are initialized
SELECT
  'MISSING_CANONICAL_PERMISSION'::text AS violation_code,
  cp.name AS subject_key,
  'Canonical permission is missing from identity.permissions while role_permissions is initialized.' AS details
FROM canonical_permissions cp
CROSS JOIN db_state s
LEFT JOIN identity.permissions p
  ON p.name = cp.name
WHERE s.mappings_initialized = true
  AND p.id IS NULL

UNION ALL

-- Branch 7: Missing canonical role_permissions mappings once role_permissions mappings are initialized
SELECT
  'MISSING_CANONICAL_ROLE_PERMISSION'::text AS violation_code,
  crp.role_slug || ':' || crp.permission_name AS subject_key,
  'Canonical role-permission mapping is missing from identity.role_permissions.' AS details
FROM canonical_role_permissions crp
CROSS JOIN db_state s
LEFT JOIN identity.roles r
  ON r.slug = crp.role_slug
LEFT JOIN identity.permissions p
  ON p.name = crp.permission_name
LEFT JOIN identity.role_permissions rp
  ON rp.role_id = r.id
 AND rp.permission_id = p.id
WHERE s.mappings_initialized = true
  AND rp.role_id IS NULL

UNION ALL

-- Branch 8: Unexpected / custom role_permissions mappings (always active)
SELECT
  'UNEXPECTED_ROLE_PERMISSION'::text AS violation_code,
  COALESCE(r.slug, '<NULL>') || ':' || COALESCE(p.name, '<NULL>') AS subject_key,
  'role_id=' || COALESCE(rp.role_id::text, '<NULL>')
    || ', permission_id=' || COALESCE(rp.permission_id::text, '<NULL>') AS details
FROM identity.role_permissions rp
LEFT JOIN identity.roles r
  ON r.id = rp.role_id
LEFT JOIN identity.permissions p
  ON p.id = rp.permission_id
LEFT JOIN canonical_role_permissions crp
  ON crp.role_slug = r.slug
 AND crp.permission_name = p.name
WHERE crp.role_slug IS NULL
ORDER BY violation_code ASC, subject_key ASC;
```
<!-- WAVE2_QUERY_B_END -->

---

## 4. Operator Remediation Steps Before Seeding

If `Query A` or `Query B` returns one or more rows:

1. **Unscoped Editorial or Verified Teacher Grants (`UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT`, `UNSCOPED_VERIFIED_TEACHER_ASSIGNMENT`):**
   - Revoke the unscoped grant (`UPDATE identity.user_roles SET status = 'REVOKED', updated_at = now() WHERE id = <subject_key>`) and, where the staff member has an approved country assignment, issue a new `COUNTRY`-scoped grant referencing an `ACTIVE` `platform.countries.id` (or `SCHOOL` for `verified_teacher`).
2. **Unsupported or Invalid Scope Targets (`SCOPED_GLOBAL_ROLE_ASSIGNMENT`, `UNSUPPORTED_EDITORIAL_SCOPE_ASSIGNMENT`, `INVALID_COUNTRY_SCOPE_TARGET`, `INVALID_SCHOOL_SCOPE_TARGET`):**
   - Revoke the invalid `user_roles` row and re-issue with the canonical scope (`NULL` for global roles; active `COUNTRY` UUID for `content_manager` / `content_reviewer`).
3. **Custom Roles, Custom Permissions, or Custom Mappings (`NON_CANONICAL_ROLE`, `NON_CANONICAL_PERMISSION`, `UNEXPECTED_ROLE_PERMISSION`):**
   - Remove unapproved custom RBAC rows inside a controlled maintenance transaction after recording change-management approval.
4. **Metadata Drift or Missing Canonical Inventory (`ROLE_METADATA_DRIFT`, `PERMISSION_METADATA_DRIFT`, `MISSING_CANONICAL_*`):**
   - Investigate out-of-band DDL/DML changes, restore canonical rows or clear partial manual edits, and re-run `Query A` and `Query B` until both return `0` rows.

---

## 5. Post-Seed Verification SQL

After `npm run db:seed:rbac` (or `seedRolesAndPermissions()`) completes, verify the converged post-Wave-2 target state:

```sql
SELECT
  COUNT(*)::int AS total_permissions,
  COUNT(*) FILTER (WHERE scope_type = 'ANY')::int AS any_permissions,
  COUNT(*) FILTER (WHERE scope_type = 'GLOBAL')::int AS global_permissions,
  COUNT(*) FILTER (WHERE scope_type = 'SCOPED')::int AS scoped_permissions,
  COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_permissions
FROM identity.permissions;
-- Expected: total_permissions = 48, any_permissions = 29, global_permissions = 19, scoped_permissions = 0, active_permissions = 48
```
