import { eq, and, sql, or, isNull } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  type Role,
  type Permission,
  type UserRole,
} from '../db/schemas.js';

export interface ScopeFilter {
  scopeType?: string | null;
  scopeId?: string | null;
}

export interface AssignRoleParams {
  userId: string;
  roleSlug: string;
  scopeType?: string | null;
  scopeId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  createdBy?: string | null;
}

export interface UserRoleWithDetails extends UserRole {
  roleSlug: string;
  roleName: string;
  roleType: string;
}

export interface PermissionAccessResolution {
  granted: boolean;
  hasGlobalGrant: boolean;
  countryIds: string[];
}

export interface RbacService {
  getUserPermissions(userId: string): Promise<string[]>;
  getUserRoles(userId: string): Promise<UserRoleWithDetails[]>;
  hasPermission(
    userId: string,
    permissionName: string,
    scope?: ScopeFilter,
  ): Promise<boolean>;
  resolvePermissionAccess(
    userId: string,
    permissionName: string,
  ): Promise<PermissionAccessResolution>;
  assignRole(params: AssignRoleParams): Promise<UserRole>;
  revokeRole(userRoleId: string): Promise<void>;
  listRoles(): Promise<Role[]>;
  listPermissions(): Promise<Permission[]>;
  getRoleBySlug(slug: string): Promise<Role | null>;
}

export class DefaultRbacService implements RbacService {
  private db: AppDatabase;

  constructor(db: AppDatabase = defaultDb) {
    this.db = db;
  }

  /**
   * Retrieves all unique, active permission names granted to a user.
   * Only includes permissions from active, non-expired, non-revoked role assignments
   * for non-deleted, active user accounts.
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    const now = new Date();

    const activeAssignments = await this.db
      .select({
        permissionName: permissions.name,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.status, 'ACTIVE'),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
          eq(roles.status, 'ACTIVE'),
          eq(permissions.status, 'ACTIVE'),
          or(isNull(userRoles.startsAt), sql`${userRoles.startsAt} <= ${now}`),
          or(isNull(userRoles.endsAt), sql`${userRoles.endsAt} > ${now}`),
        ),
      );

    const permissionSet = new Set<string>();
    for (const row of activeAssignments) {
      permissionSet.add(row.permissionName);
    }

    return Array.from(permissionSet);
  }

  /**
   * Retrieves all active role assignments for a user, including role metadata.
   */
  async getUserRoles(userId: string): Promise<UserRoleWithDetails[]> {
    const now = new Date();

    const rows = await this.db
      .select({
        userRole: userRoles,
        roleSlug: roles.slug,
        roleName: roles.name,
        roleType: roles.roleType,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(users, eq(userRoles.userId, users.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.status, 'ACTIVE'),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
          eq(roles.status, 'ACTIVE'),
          or(isNull(userRoles.startsAt), sql`${userRoles.startsAt} <= ${now}`),
          or(isNull(userRoles.endsAt), sql`${userRoles.endsAt} > ${now}`),
        ),
      );

    return rows.map((r) => ({
      ...r.userRole,
      roleSlug: r.roleSlug,
      roleName: r.roleName,
      roleType: r.roleType,
    }));
  }

  /**
   * Evaluates whether a user holds a permission, respecting canonical permission scopeType
   * ('GLOBAL' | 'SCOPED' | 'ANY') and user_roles grant scope:
   * - 'GLOBAL': ONLY an unscoped grant (userRoles.scopeType IS NULL) satisfies it, regardless of requested scope.
   * - 'SCOPED': Requires an explicit requested scope and an exact matching scoped grant.
   * - 'ANY': Satisfied by an unscoped grant everywhere, or by an exact matching scoped grant when scope is provided.
   */
  async hasPermission(
    userId: string,
    permissionName: string,
    scope?: ScopeFilter,
  ): Promise<boolean> {
    const now = new Date();

    // Query all active grants for this specific permission on this user
    const matchingGrants = await this.db
      .select({
        scopeType: userRoles.scopeType,
        scopeId: userRoles.scopeId,
        permissionScopeType: permissions.scopeType,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(permissions.name, permissionName),
          eq(userRoles.status, 'ACTIVE'),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
          eq(roles.status, 'ACTIVE'),
          eq(permissions.status, 'ACTIVE'),
          or(isNull(userRoles.startsAt), sql`${userRoles.startsAt} <= ${now}`),
          or(isNull(userRoles.endsAt), sql`${userRoles.endsAt} > ${now}`),
        ),
      );

    if (matchingGrants.length === 0) {
      return false;
    }

    const permScopeType = matchingGrants[0].permissionScopeType ?? 'ANY';
    const hasGlobalGrant = matchingGrants.some(
      (g) => g.scopeType === null || g.scopeType === undefined,
    );

    if (permScopeType === 'GLOBAL') {
      return hasGlobalGrant;
    }

    if (permScopeType === 'ANY' && hasGlobalGrant) {
      return true;
    }

    if (scope?.scopeType && scope?.scopeId) {
      return matchingGrants.some(
        (g) => g.scopeType === scope.scopeType && g.scopeId === scope.scopeId,
      );
    }

    return false;
  }

  /**
   * Resolves effective global vs country-scoped access for a specific permission.
   * - Enforces permissions.scopeType ('GLOBAL' requires unscoped userRoles grant; 'ANY'/'SCOPED' accepts COUNTRY grants).
   * - Fails closed (granted: false) for SCHOOL/RESOURCE-only grants when evaluating country/global administrative surfaces.
   */
  async resolvePermissionAccess(
    userId: string,
    permissionName: string,
  ): Promise<PermissionAccessResolution> {
    const now = new Date();

    const matchingGrants = await this.db
      .select({
        roleScopeType: userRoles.scopeType,
        roleScopeId: userRoles.scopeId,
        permissionScopeType: permissions.scopeType,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(permissions.name, permissionName),
          eq(userRoles.status, 'ACTIVE'),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
          eq(roles.status, 'ACTIVE'),
          eq(permissions.status, 'ACTIVE'),
          or(isNull(userRoles.startsAt), sql`${userRoles.startsAt} <= ${now}`),
          or(isNull(userRoles.endsAt), sql`${userRoles.endsAt} > ${now}`),
        ),
      );

    if (matchingGrants.length === 0) {
      return { granted: false, hasGlobalGrant: false, countryIds: [] };
    }

    const permScopeType = matchingGrants[0].permissionScopeType;
    const hasUnscopedRoleGrant = matchingGrants.some(
      (g) => g.roleScopeType === null || g.roleScopeType === undefined,
    );

    if (permScopeType === 'GLOBAL') {
      return {
        granted: hasUnscopedRoleGrant,
        hasGlobalGrant: hasUnscopedRoleGrant,
        countryIds: [],
      };
    }

    const hasGlobalGrant = permScopeType === 'ANY' && hasUnscopedRoleGrant;
    const countryIdSet = new Set<string>();
    for (const grant of matchingGrants) {
      if (grant.roleScopeType === 'COUNTRY' && grant.roleScopeId) {
        countryIdSet.add(grant.roleScopeId);
      }
    }

    const countryIds = Array.from(countryIdSet);
    return {
      granted: hasGlobalGrant || countryIds.length > 0,
      hasGlobalGrant,
      countryIds,
    };
  }

  /**
   * Assigns a role to a user.
   */
  async assignRole(params: AssignRoleParams): Promise<UserRole> {
    // Validate scope consistency: both or neither
    const hasScopeType = Boolean(params.scopeType);
    const hasScopeId = Boolean(params.scopeId);
    if ((hasScopeType && !hasScopeId) || (!hasScopeType && hasScopeId)) {
      throw new Error(
        'Invalid scope parameters: scopeType and scopeId must either both be provided or both be omitted.',
      );
    }

    // Validate dates if both provided
    if (params.startsAt && params.endsAt && params.endsAt <= params.startsAt) {
      throw new Error('Invalid dates: endsAt must be greater than startsAt.');
    }

    // Resolve role by slug
    const targetRole = await this.getRoleBySlug(params.roleSlug);
    if (!targetRole) {
      throw new Error(`Role not found: ${params.roleSlug}`);
    }

    // Verify user exists and is not deleted
    const [targetUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, params.userId), isNull(users.deletedAt)))
      .limit(1);

    if (!targetUser) {
      throw new Error(`User not found or deleted: ${params.userId}`);
    }

    const scopeType = params.scopeType ?? null;
    const scopeId = params.scopeId ?? null;

    const scopeTypeCondition = scopeType
      ? eq(userRoles.scopeType, scopeType)
      : isNull(userRoles.scopeType);
    const scopeIdCondition = scopeId
      ? eq(userRoles.scopeId, scopeId)
      : isNull(userRoles.scopeId);

    // Check if active assignment exists for this exact user, role, and scope
    const [existingAssignment] = await this.db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, params.userId),
          eq(userRoles.roleId, targetRole.id),
          scopeTypeCondition,
          scopeIdCondition,
          eq(userRoles.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    if (existingAssignment) {
      const [updated] = await this.db
        .update(userRoles)
        .set({
          startsAt: params.startsAt ?? null,
          endsAt: params.endsAt ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(userRoles.id, existingAssignment.id))
        .returning();
      return updated;
    }

    // Insert new assignment
    const [assigned] = await this.db
      .insert(userRoles)
      .values({
        userId: params.userId,
        roleId: targetRole.id,
        scopeType,
        scopeId,
        status: 'ACTIVE',
        startsAt: params.startsAt ?? null,
        endsAt: params.endsAt ?? null,
        createdBy: params.createdBy ?? null,
      })
      .returning();

    return assigned;
  }

  /**
   * Revokes a user role assignment (soft status change to preserve audit trail).
   */
  async revokeRole(userRoleId: string): Promise<void> {
    await this.db
      .update(userRoles)
      .set({
        status: 'REVOKED',
        updatedAt: sql`now()`,
      })
      .where(eq(userRoles.id, userRoleId));
  }

  async listRoles(): Promise<Role[]> {
    return this.db.select().from(roles).where(eq(roles.status, 'ACTIVE'));
  }

  async listPermissions(): Promise<Permission[]> {
    return this.db.select().from(permissions).where(eq(permissions.status, 'ACTIVE'));
  }

  async getRoleBySlug(slug: string): Promise<Role | null> {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.slug, slug))
      .limit(1);
    return role ?? null;
  }
}

export const defaultRbacService = new DefaultRbacService();
