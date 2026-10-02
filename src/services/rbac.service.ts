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

export interface RbacService {
  getUserPermissions(userId: string): Promise<string[]>;
  getUserRoles(userId: string): Promise<UserRoleWithDetails[]>;
  hasPermission(
    userId: string,
    permissionName: string,
    scope?: ScopeFilter,
  ): Promise<boolean>;
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
   * Evaluates whether a user holds a permission, respecting GLOBAL vs Scoped semantics:
   * 1. If user holds the permission globally (scopeType IS NULL), return true (global satisfies any scope).
   * 2. If a specific scope is requested (scopeType + scopeId) and user has a matching scoped role, return true.
   * 3. Otherwise, return false.
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

    // 1. Any GLOBAL grant (scopeType is null) satisfies the permission everywhere
    const hasGlobalGrant = matchingGrants.some((g) => g.scopeType === null || g.scopeType === undefined);
    if (hasGlobalGrant) {
      return true;
    }

    // 2. If scope is requested, check if a matching scoped grant exists
    if (scope?.scopeType && scope?.scopeId) {
      const hasMatchingScope = matchingGrants.some(
        (g) => g.scopeType === scope.scopeType && g.scopeId === scope.scopeId,
      );
      if (hasMatchingScope) {
        return true;
      }
    }

    return false;
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
