import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db as defaultDb, closeDatabase, type AppDatabase } from '../index.js';
import {
  roles,
  permissions,
  rolePermissions,
} from '../schemas.js';

export interface SeedRoleDefinition {
  name: string;
  slug: string;
  roleType: 'SYSTEM' | 'ORGANIZATIONAL' | 'CUSTOM';
  description: string;
}

export interface SeedPermissionDefinition {
  name: string;
  resource: string;
  action: string;
  scopeType: 'GLOBAL' | 'SCOPED' | 'ANY';
  description: string;
}

export const CANONICAL_ROLES: SeedRoleDefinition[] = [
  {
    name: 'System Administrator',
    slug: 'system_admin',
    roleType: 'SYSTEM',
    description: 'Full administrative control across the platform.',
  },
  {
    name: 'Content Manager',
    slug: 'content_manager',
    roleType: 'SYSTEM',
    description: 'Full management over curriculum content and resource publishing lifecycle.',
  },
  {
    name: 'Content Reviewer',
    slug: 'content_reviewer',
    roleType: 'SYSTEM',
    description: 'Evaluates submitted educational materials and approves or rejects candidate versions.',
  },
  {
    name: 'Verified Teacher',
    slug: 'verified_teacher',
    roleType: 'ORGANIZATIONAL',
    description: 'Verified educator permitted to create, author, and submit materials for publication review.',
  },
  {
    name: 'Standard User',
    slug: 'standard_user',
    roleType: 'SYSTEM',
    description: 'Baseline public learner or registered member; access to personal library and public materials.',
  },
  {
    name: 'Educational Contributor',
    slug: 'contributor',
    roleType: 'ORGANIZATIONAL',
    description: 'Approved educator or author permitted to submit educational resources for editorial review.',
  },
];

export const CANONICAL_PERMISSIONS: SeedPermissionDefinition[] = [
  {
    name: 'resource.read',
    resource: 'resource',
    action: 'read',
    scopeType: 'ANY',
    description: 'View accessible resources and metadata.',
  },
  {
    name: 'resource.create',
    resource: 'resource',
    action: 'create',
    scopeType: 'ANY',
    description: 'Create draft educational resources.',
  },
  {
    name: 'resource.update',
    resource: 'resource',
    action: 'update',
    scopeType: 'ANY',
    description: 'Edit owned or permitted resource drafts and metadata.',
  },
  {
    name: 'resource.submit',
    resource: 'resource',
    action: 'submit',
    scopeType: 'ANY',
    description: 'Submit candidate resource drafts for editorial review.',
  },
  {
    name: 'resource.review',
    resource: 'resource',
    action: 'review',
    scopeType: 'ANY',
    description: 'Inspect candidate resources under review.',
  },
  {
    name: 'resource.approve',
    resource: 'resource',
    action: 'approve',
    scopeType: 'ANY',
    description: 'Mark candidate resources as approved for publication.',
  },
  {
    name: 'resource.reject',
    resource: 'resource',
    action: 'reject',
    scopeType: 'ANY',
    description: 'Reject candidate resources with mandatory reason.',
  },
  {
    name: 'resource.publish',
    resource: 'resource',
    action: 'publish',
    scopeType: 'ANY',
    description: 'Release approved resources and versions to the public catalogue.',
  },
  {
    name: 'resource.archive',
    resource: 'resource',
    action: 'archive',
    scopeType: 'ANY',
    description: 'Transition published resources to terminal archived state.',
  },
  {
    name: 'user.read',
    resource: 'user',
    action: 'read',
    scopeType: 'GLOBAL',
    description: 'View user account information.',
  },
  {
    name: 'user.manage_roles',
    resource: 'user',
    action: 'manage_roles',
    scopeType: 'GLOBAL',
    description: 'Assign or revoke roles and scopes on user accounts.',
  },
  {
    name: 'contributor.apply',
    resource: 'contributor',
    action: 'apply',
    scopeType: 'GLOBAL',
    description: 'Submit an application to become an educational contributor.',
  },
  {
    name: 'contributor.profile.read',
    resource: 'contributor',
    action: 'profile_read',
    scopeType: 'GLOBAL',
    description: 'View private contributor profile and workspace dashboard.',
  },
  {
    name: 'contributor.profile.update',
    resource: 'contributor',
    action: 'profile_update',
    scopeType: 'GLOBAL',
    description: 'Update own contributor public bio and display name.',
  },
  {
    name: 'contributor.submit',
    resource: 'contributor',
    action: 'submit',
    scopeType: 'GLOBAL',
    description: 'Create and submit candidate resources for editorial review.',
  },
  {
    name: 'contributor.application.review',
    resource: 'contributor',
    action: 'application_review',
    scopeType: 'GLOBAL',
    description: 'Review, approve, or reject contributor applications and candidate submissions.',
  },
  {
    name: 'contributor.manage',
    resource: 'contributor',
    action: 'manage',
    scopeType: 'GLOBAL',
    description: 'Manage contributor verification, lifecycle suspension, and administrative oversight.',
  },
  {
    name: 'contributor.earnings.view',
    resource: 'contributor',
    action: 'earnings_view',
    scopeType: 'GLOBAL',
    description: 'View private contributor earnings and financial ledger.',
  },
  {
    name: 'contributor.finance.manage',
    resource: 'contributor',
    action: 'finance_manage',
    scopeType: 'GLOBAL',
    description: 'Manage contributor revenue rules, audit earnings, and administrative financial oversight.',
  },
  {
    name: 'update.create',
    resource: 'update',
    action: 'create',
    scopeType: 'ANY',
    description: 'Create draft education updates and circulars.',
  },
  {
    name: 'update.edit',
    resource: 'update',
    action: 'edit',
    scopeType: 'ANY',
    description: 'Modify draft or published education updates.',
  },
  {
    name: 'update.publish',
    resource: 'update',
    action: 'publish',
    scopeType: 'ANY',
    description: 'Release education updates to the public portal.',
  },
  {
    name: 'update.archive',
    resource: 'update',
    action: 'archive',
    scopeType: 'ANY',
    description: 'Archive education updates, removing them from public access.',
  },
  {
    name: 'update.read',
    resource: 'update',
    action: 'read',
    scopeType: 'ANY',
    description: 'View drafts and administrative details of education updates.',
  },
  {
    name: 'quality.check.create',
    resource: 'quality',
    action: 'check_create',
    scopeType: 'ANY',
    description: 'Record evaluations for resource quality criteria.',
  },
  {
    name: 'quality.verify',
    resource: 'quality',
    action: 'verify',
    scopeType: 'ANY',
    description: 'Grant official pedagogical verification to a resource version.',
  },
  {
    name: 'quality.revoke',
    resource: 'quality',
    action: 'revoke',
    scopeType: 'ANY',
    description: 'Revoke verification from a previously verified resource version.',
  },
  {
    name: 'quality.check_types.manage',
    resource: 'quality',
    action: 'manage_types',
    scopeType: 'GLOBAL',
    description: 'Manage quality check types and rubrics.',
  },
  {
    name: 'quality.read',
    resource: 'quality',
    action: 'read',
    scopeType: 'ANY',
    description: 'View quality checks, verifications, and audit history.',
  },
  {
    name: 'feedback.read',
    resource: 'feedback',
    action: 'read',
    scopeType: 'ANY',
    description: 'View resource feedback entries, summary metrics, and audit history.',
  },
  {
    name: 'feedback.manage',
    resource: 'feedback',
    action: 'manage',
    scopeType: 'ANY',
    description: 'Triage, update status, and manage resource feedback.',
  },
  {
    name: 'notification.admin.read',
    resource: 'notification',
    action: 'admin_read',
    scopeType: 'GLOBAL',
    description: 'View administrative notification delivery logs, retry queues, and dispatch statistics.',
  },
  {
    name: 'notification.admin.manage',
    resource: 'notification',
    action: 'admin_manage',
    scopeType: 'GLOBAL',
    description: 'Trigger outbox processing sweeps and manage notification delivery operations.',
  },
  {
    name: 'analytics.read',
    resource: 'analytics',
    action: 'read',
    scopeType: 'GLOBAL',
    description: 'View aggregate platform analytics, operational metrics, and reporting dashboards.',
  },
  {
    name: 'analytics.manage',
    resource: 'analytics',
    action: 'manage',
    scopeType: 'GLOBAL',
    description: 'Configure analytics event types, retention rules, and telemetry controls.',
  },
  {
    name: 'audit.read',
    resource: 'audit',
    action: 'read',
    scopeType: 'GLOBAL',
    description: 'View system audit logs and change histories.',
  },
  {
    name: 'retention.read',
    resource: 'retention',
    action: 'read',
    scopeType: 'GLOBAL',
    description: 'View retention policies, execution logs, and point-in-time dry-run previews.',
  },
  {
    name: 'retention.manage',
    resource: 'retention',
    action: 'manage',
    scopeType: 'GLOBAL',
    description: 'Create, update, activate, and deactivate data retention policies.',
  },
  {
    name: 'retention.execute',
    resource: 'retention',
    action: 'execute',
    scopeType: 'GLOBAL',
    description: 'Trigger and recover manual or asynchronous data retention sweep executions.',
  },
  {
    name: 'recommendation.read',
    resource: 'recommendation',
    action: 'read',
    scopeType: 'ANY',
    description: 'View editorial recommendation rules and curation state.',
  },
  {
    name: 'recommendation.manage',
    resource: 'recommendation',
    action: 'manage',
    scopeType: 'ANY',
    description: 'Create, deactivate, and reactivate editorial recommendation rules.',
  },
  {
    name: 'admin.dashboard.read',
    resource: 'admin',
    action: 'dashboard_read',
    scopeType: 'ANY',
    description: 'View centralized operational dashboard summaries and administrative KPIs.',
  },
  {
    name: 'resource.admin.read',
    resource: 'resource',
    action: 'admin_read',
    scopeType: 'ANY',
    description: 'Inspect resources across all lifecycle states, versions, and publication events.',
  },
  {
    name: 'file.admin.read',
    resource: 'file',
    action: 'admin_read',
    scopeType: 'ANY',
    description: 'Inspect controlled file storage metadata, checksums, and status across versions.',
  },
  {
    name: 'file.admin.verify',
    resource: 'file',
    action: 'admin_verify',
    scopeType: 'ANY',
    description: 'Trigger controlled storage integrity verification checks on file records.',
  },
  {
    name: 'homepage.read',
    resource: 'homepage',
    action: 'read',
    scopeType: 'ANY',
    description: 'View administrative homepage configurations, schedules, previews, and history.',
  },
  {
    name: 'homepage.manage',
    resource: 'homepage',
    action: 'manage',
    scopeType: 'ANY',
    description: 'Create, edit, pin items in, and discard homepage draft configurations.',
  },
  {
    name: 'homepage.publish',
    resource: 'homepage',
    action: 'publish',
    scopeType: 'ANY',
    description: 'Schedule, unschedule, cancel schedules, publish, and roll back homepage configurations.',
  },
];

export const ROLE_PERMISSION_MATRIX: Record<string, string[]> = {
  system_admin: [
    'resource.read',
    'resource.create',
    'resource.update',
    'resource.submit',
    'resource.review',
    'resource.approve',
    'resource.reject',
    'resource.publish',
    'resource.archive',
    'user.read',
    'user.manage_roles',
    'contributor.apply',
    'contributor.profile.read',
    'contributor.profile.update',
    'contributor.submit',
    'contributor.application.review',
    'contributor.manage',
    'contributor.earnings.view',
    'contributor.finance.manage',
    'update.create',
    'update.edit',
    'update.publish',
    'update.archive',
    'update.read',
    'quality.check.create',
    'quality.verify',
    'quality.revoke',
    'quality.check_types.manage',
    'quality.read',
    'feedback.read',
    'feedback.manage',
    'notification.admin.read',
    'notification.admin.manage',
    'analytics.read',
    'analytics.manage',
    'audit.read',
    'retention.read',
    'retention.manage',
    'retention.execute',
    'recommendation.read',
    'recommendation.manage',
    'admin.dashboard.read',
    'resource.admin.read',
    'file.admin.read',
    'file.admin.verify',
    'homepage.read',
    'homepage.manage',
    'homepage.publish',
  ],
  content_manager: [
    'resource.read',
    'resource.create',
    'resource.update',
    'resource.submit',
    'resource.review',
    'resource.approve',
    'resource.reject',
    'resource.publish',
    'resource.archive',
    'contributor.application.review',
    'contributor.manage',
    'update.create',
    'update.edit',
    'update.publish',
    'update.archive',
    'update.read',
    'quality.check.create',
    'quality.verify',
    'quality.revoke',
    'quality.read',
    'feedback.read',
    'feedback.manage',
    'notification.admin.read',
    'analytics.read',
    'retention.read',
    'recommendation.read',
    'recommendation.manage',
    'admin.dashboard.read',
    'resource.admin.read',
    'file.admin.read',
    'file.admin.verify',
    'homepage.read',
    'homepage.manage',
    'homepage.publish',
  ],
  content_reviewer: [
    'resource.read',
    'resource.review',
    'resource.approve',
    'resource.reject',
    'contributor.application.review',
    'quality.check.create',
    'quality.read',
    'feedback.read',
    'recommendation.read',
    'admin.dashboard.read',
    'resource.admin.read',
    'file.admin.read',
    'homepage.read',
  ],
  verified_teacher: [
    'resource.read',
    'resource.create',
    'resource.update',
    'resource.submit',
  ],
  contributor: [
    'resource.read',
    'contributor.profile.read',
    'contributor.profile.update',
    'contributor.submit',
    'contributor.earnings.view',
  ],
  standard_user: [
    'resource.read',
    'contributor.apply',
  ],
};

export const WAVE2_LEGACY_GLOBAL_TO_ANY_PERMISSIONS = [
  'update.create',
  'update.edit',
  'update.publish',
  'update.archive',
  'update.read',
  'quality.check.create',
  'quality.verify',
  'quality.revoke',
  'quality.read',
  'feedback.read',
  'feedback.manage',
] as const;

export const CANONICAL_ROLE_COUNT = CANONICAL_ROLES.length; // 6
export const CANONICAL_PERMISSION_COUNT = CANONICAL_PERMISSIONS.length; // 48 (29 ANY + 19 GLOBAL)
export const CANONICAL_MAPPING_COUNT = Object.values(ROLE_PERMISSION_MATRIX).reduce(
  (sum, perms) => sum + perms.length,
  0,
); // 106 canonical mappings (48 + 34 + 13 + 4 + 5 + 2)

export interface Wave2RbacAuditViolation {
  querySource: 'QUERY_A' | 'QUERY_B';
  violationCode: string;
  subjectKey: string;
  details: string;
}

export class Wave2RbacPreconditionError extends Error {
  public readonly code = 'WAVE2_RBAC_PRECONDITION_FAILED';

  constructor(
    message: string,
    public readonly violations: readonly Wave2RbacAuditViolation[],
  ) {
    super(message);
    this.name = 'Wave2RbacPreconditionError';
  }
}

export type SqlExecutor = Pick<AppDatabase, 'execute'>;

/**
 * Verbatim Query A (Zero-Waiver Active User-Role Governance Precondition Audit).
 * Must remain 100% SQL-identical to Query A in docs/security/wave2-rbac-predeployment-audit.md.
 * Expected result before seeding: 0 rows.
 */
export const WAVE2_RBAC_QUERY_A_SQL = `WITH active_grants AS (
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
ORDER BY violation_code ASC, subject_key ASC;`;

/**
 * Verbatim Revision 3.0 Query B (RBAC Inventory, Metadata, Scope & Mapping Drift Audit).
 * Must remain 100% SQL-identical to Query B in docs/security/wave2-rbac-predeployment-audit.md.
 * Canonical inventory: 6 roles, 48 permissions (29 ANY + 19 GLOBAL; 11 legacy GLOBAL->ANY allowed pre-seed), 106 mappings.
 * Expected result before seeding: 0 rows.
 */
export const WAVE2_RBAC_QUERY_B_SQL = `WITH canonical_roles(slug, name, role_type, description) AS (
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
ORDER BY violation_code ASC, subject_key ASC;`;

/**
 * Exact target-state verification query (used by post-precondition fast path).
 * Returns true ONLY when the database already holds the exact post-Wave-2 target state:
 * - Exactly 6 canonical roles with zero metadata/status drift
 * - Exactly 48 canonical permissions with target_scope_type (all 11 reclassified to 'ANY', NOT legacy 'GLOBAL')
 * - Exactly 106 canonical role_permissions mappings
 */
export async function isCanonicalTargetStateReached(executor: SqlExecutor): Promise<boolean> {
  const roleValuesSql = sql.join(
    CANONICAL_ROLES.map(
      (r) => sql`(${r.slug}::text, ${r.name}::text, ${r.roleType}::text, ${r.description}::text)`,
    ),
    sql`, `,
  );

  const permValuesSql = sql.join(
    CANONICAL_PERMISSIONS.map(
      (p) =>
        sql`(${p.name}::text, ${p.resource}::text, ${p.action}::text, ${p.scopeType}::text, ${p.description}::text)`,
    ),
    sql`, `,
  );

  const mappingPairs: ReturnType<typeof sql>[] = [];
  for (const [roleSlug, permNames] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    for (const permName of permNames) {
      mappingPairs.push(sql`(${roleSlug}::text, ${permName}::text)`);
    }
  }
  const mappingValuesSql = sql.join(mappingPairs, sql`, `);

  const res = await executor.execute(sql`
    WITH canonical_roles(slug, name, role_type, description) AS (
      VALUES ${roleValuesSql}
    ),
    canonical_permissions(name, resource, action, scope_type, description) AS (
      VALUES ${permValuesSql}
    ),
    canonical_role_permissions(role_slug, permission_name) AS (
      VALUES ${mappingValuesSql}
    )
    SELECT
      (SELECT COUNT(*)::int FROM identity.roles) = ${CANONICAL_ROLE_COUNT} AS total_roles_exact,
      (
        SELECT COUNT(*)::int
        FROM identity.roles r
        INNER JOIN canonical_roles cr ON cr.slug = r.slug
        WHERE r.name IS NOT DISTINCT FROM cr.name
          AND r.role_type IS NOT DISTINCT FROM cr.role_type
          AND r.description IS NOT DISTINCT FROM cr.description
          AND r.status IS NOT DISTINCT FROM 'ACTIVE'
      ) = ${CANONICAL_ROLE_COUNT} AS canonical_roles_exact,
      (SELECT COUNT(*)::int FROM identity.permissions) = ${CANONICAL_PERMISSION_COUNT} AS total_perms_exact,
      (
        SELECT COUNT(*)::int
        FROM identity.permissions p
        INNER JOIN canonical_permissions cp ON cp.name = p.name
        WHERE p.resource IS NOT DISTINCT FROM cp.resource
          AND p.action IS NOT DISTINCT FROM cp.action
          AND p.scope_type IS NOT DISTINCT FROM cp.scope_type
          AND p.description IS NOT DISTINCT FROM cp.description
          AND p.status IS NOT DISTINCT FROM 'ACTIVE'
      ) = ${CANONICAL_PERMISSION_COUNT} AS canonical_perms_exact,
      (SELECT COUNT(*)::int FROM identity.role_permissions) = ${CANONICAL_MAPPING_COUNT} AS total_mappings_exact,
      (
        SELECT COUNT(*)::int
        FROM identity.role_permissions rp
        INNER JOIN identity.roles r ON r.id = rp.role_id
        INNER JOIN identity.permissions p ON p.id = rp.permission_id
        INNER JOIN canonical_role_permissions crp
          ON crp.role_slug = r.slug
         AND crp.permission_name = p.name
      ) = ${CANONICAL_MAPPING_COUNT} AS canonical_mappings_exact
  `);

  const row = res.rows[0] as
    | {
        total_roles_exact?: boolean;
        canonical_roles_exact?: boolean;
        total_perms_exact?: boolean;
        canonical_perms_exact?: boolean;
        total_mappings_exact?: boolean;
        canonical_mappings_exact?: boolean;
      }
    | undefined;

  return Boolean(
    row?.total_roles_exact &&
      row?.canonical_roles_exact &&
      row?.total_perms_exact &&
      row?.canonical_perms_exact &&
      row?.total_mappings_exact &&
      row?.canonical_mappings_exact,
  );
}

/**
 * Executes Query A (active user_roles governance audit) and Revision 3.0 Query B (RBAC drift audit).
 */
export async function runWave2RbacAuditQueries(
  executor: SqlExecutor,
): Promise<Wave2RbacAuditViolation[]> {
  const [queryARes, queryBRes] = await Promise.all([
    executor.execute(sql.raw(WAVE2_RBAC_QUERY_A_SQL)),
    executor.execute(sql.raw(WAVE2_RBAC_QUERY_B_SQL)),
  ]);

  const violations: Wave2RbacAuditViolation[] = [];

  for (const raw of queryARes.rows as Array<Record<string, unknown>>) {
    violations.push({
      querySource: 'QUERY_A',
      violationCode: String(raw.violation_code ?? 'UNKNOWN_QUERY_A_VIOLATION'),
      subjectKey: String(raw.subject_key ?? '<NULL>'),
      details: String(raw.details ?? '<NULL>'),
    });
  }

  for (const raw of queryBRes.rows as Array<Record<string, unknown>>) {
    violations.push({
      querySource: 'QUERY_B',
      violationCode: String(raw.violation_code ?? 'UNKNOWN_QUERY_B_VIOLATION'),
      subjectKey: String(raw.subject_key ?? '<NULL>'),
      details: String(raw.details ?? '<NULL>'),
    });
  }

  return violations;
}

/**
 * Enforces the Wave 2 zero-waiver RBAC precondition gate before any fast-path return or write.
 */
export async function assertWave2RbacPreconditions(executor: SqlExecutor): Promise<void> {
  const violations = await runWave2RbacAuditQueries(executor);
  if (violations.length > 0) {
    const summary = violations
      .slice(0, 10)
      .map((v) => `[${v.querySource}:${v.violationCode}] ${v.subjectKey} (${v.details})`)
      .join('; ');
    throw new Wave2RbacPreconditionError(
      `Wave 2 RBAC precondition gate failed with ${violations.length} violation(s): ${summary}`,
      violations,
    );
  }
}

/**
 * Transactional, advisory-locked canonical RBAC seed with mandatory Wave 2 precondition gate.
 * Order of operations inside single PostgreSQL transaction:
 *   1. Acquire transaction-scoped advisory lock pg_advisory_xact_lock(20263302, 1)
 *   2. Execute assertWave2RbacPreconditions(tx) (Query A + Revision 3.0 Query B) BEFORE fast-path or writes
 *   3. Check exact NULL-safe target state fast-path isCanonicalTargetStateReached(tx)
 *   4. Upsert all 48 canonical permissions (converging resource, action, scope_type, description, status)
 *   5. Upsert all 6 canonical roles (converging name, role_type, description, status, updated_at)
 *   6. Insert missing canonical role_permissions mappings (106 total)
 */
export async function seedRolesAndPermissions(dbInstance: AppDatabase = defaultDb): Promise<{
  rolesCount: number;
  permissionsCount: number;
  mappingsCount: number;
}> {
  return await dbInstance.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20263302, 1)`);

    // 1. Mandatory Precondition Gate (runs unconditionally before fast-path and before any writes)
    await assertWave2RbacPreconditions(tx);

    // 2. Strict NULL-safe target-state fast-path (only succeeds once all 11 legacy GLOBAL scopes are 'ANY')
    if (await isCanonicalTargetStateReached(tx)) {
      return {
        rolesCount: CANONICAL_ROLE_COUNT,
        permissionsCount: CANONICAL_PERMISSION_COUNT,
        mappingsCount: CANONICAL_MAPPING_COUNT,
      };
    }

    // 3. Upsert all 48 canonical permissions, converging metadata and scope_type ('GLOBAL' -> 'ANY' for the 11)
    await tx
      .insert(permissions)
      .values(
        CANONICAL_PERMISSIONS.map((perm) => ({
          name: perm.name,
          resource: perm.resource,
          action: perm.action,
          scopeType: perm.scopeType,
          description: perm.description,
          status: 'ACTIVE' as const,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.name,
        set: {
          resource: sql`excluded.resource`,
          action: sql`excluded.action`,
          scopeType: sql`excluded.scope_type`,
          description: sql`excluded.description`,
          status: 'ACTIVE',
        },
      });

    // 4. Upsert all 6 canonical roles, converging metadata and status
    await tx
      .insert(roles)
      .values(
        CANONICAL_ROLES.map((r) => ({
          name: r.name,
          slug: r.slug,
          roleType: r.roleType,
          description: r.description,
          status: 'ACTIVE' as const,
        })),
      )
      .onConflictDoUpdate({
        target: roles.slug,
        set: {
          name: sql`excluded.name`,
          roleType: sql`excluded.role_type`,
          description: sql`excluded.description`,
          status: 'ACTIVE',
          updatedAt: sql`now()`,
        },
      });

    // 5. Resolve canonical role and permission IDs and converge 106 canonical mappings
    const allRoles = await tx.select().from(roles);
    const allPermissions = await tx.select().from(permissions);

    const roleMap = new Map<string, string>(allRoles.map((r) => [r.slug, r.id]));
    const permMap = new Map<string, string>(allPermissions.map((p) => [p.name, p.id]));

    const mappingRows: { roleId: string; permissionId: string }[] = [];
    for (const [roleSlug, permNames] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      const roleId = roleMap.get(roleSlug);
      if (!roleId) {
        throw new Error(`Canonical role '${roleSlug}' missing after upsert.`);
      }

      for (const permName of permNames) {
        const permissionId = permMap.get(permName);
        if (!permissionId) {
          throw new Error(`Canonical permission '${permName}' missing after upsert.`);
        }
        mappingRows.push({ roleId, permissionId });
      }
    }

    if (mappingRows.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(mappingRows)
        .onConflictDoNothing();
    }

    return {
      rolesCount: allRoles.length,
      permissionsCount: allPermissions.length,
      mappingsCount: mappingRows.length,
    };
  });
}

// Standalone execution support
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('roles-permissions.ts'));

if (isDirectExecution) {
  seedRolesAndPermissions()
    .then((result) => {
      console.log('Successfully seeded RBAC roles and permissions:', result);
      return closeDatabase();
    })
    .catch((err) => {
      console.error('Failed to seed RBAC roles and permissions:', err);
      process.exit(1);
    });
}
