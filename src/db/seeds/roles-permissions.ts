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
  ],
  content_reviewer: [
    'resource.read',
    'resource.review',
    'resource.approve',
    'resource.reject',
  ],
  verified_teacher: [
    'resource.read',
    'resource.create',
    'resource.update',
    'resource.submit',
  ],
  standard_user: [
    'resource.read',
  ],
};

/**
 * Idempotently seeds canonical roles, permissions, and role_permissions mappings.
 * Uses fast-path check and batch operations to avoid multiple network round-trips.
 */
export async function seedRolesAndPermissions(dbInstance: AppDatabase = defaultDb): Promise<{
  rolesCount: number;
  permissionsCount: number;
  mappingsCount: number;
}> {
  // Fast-path: if canonical role_permissions are already seeded, return immediately
  const [existing] = await dbInstance
    .select({ count: sql<string>`count(*)` })
    .from(rolePermissions);

  if (Number(existing?.count) >= 29) {
    return {
      rolesCount: CANONICAL_ROLES.length,
      permissionsCount: CANONICAL_PERMISSIONS.length,
      mappingsCount: Number(existing.count),
    };
  }

  // 1. Batch insert Permissions
  await dbInstance
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
    .onConflictDoNothing();

  // 2. Batch insert Roles
  await dbInstance
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
    .onConflictDoNothing();

  // Query all roles and permissions to resolve IDs
  const allRoles = await dbInstance.select().from(roles);
  const allPermissions = await dbInstance.select().from(permissions);

  const roleMap = new Map<string, string>(allRoles.map((r) => [r.slug, r.id]));
  const permMap = new Map<string, string>(allPermissions.map((p) => [p.name, p.id]));

  // 3. Batch insert Role Permissions mappings
  const mappingRows: { roleId: string; permissionId: string }[] = [];
  for (const [roleSlug, permNames] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    const roleId = roleMap.get(roleSlug);
    if (!roleId) continue;

    for (const permName of permNames) {
      const permissionId = permMap.get(permName);
      if (!permissionId) continue;

      mappingRows.push({ roleId, permissionId });
    }
  }

  if (mappingRows.length > 0) {
    await dbInstance
      .insert(rolePermissions)
      .values(mappingRows)
      .onConflictDoNothing();
  }

  return {
    rolesCount: allRoles.length,
    permissionsCount: allPermissions.length,
    mappingsCount: mappingRows.length,
  };
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
