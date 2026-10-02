import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  roles,
  userRoles,
} from '../../src/db/schemas.js';
import { DefaultAuthService } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('RBAC Service Neon PostgreSQL Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // Ensure canonical roles and permissions are seeded in database
    await withDbRetry(() => seedRolesAndPermissions(db));
  }, 60000);

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        await withDbRetry(async () => {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }).catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 60000);

  describe('1. Automatic standard_user Role Assignment (Prompt 14 Correction 3)', () => {
    it('atomically assigns standard_user role during user registration', async () => {
      const email = `test-rbac-${Date.now()}@example.com`;
      const regResult = await withDbRetry(() =>
        authService.register({
          email,
          password: 'SecurePassword123!',
          displayName: 'Test Learner',
        }),
      );

      const userId = regResult.user.id;
      createdUserIds.push(userId);

      // Verify user_roles has standard_user assigned
      const assignedRoles = await withDbRetry(() =>
        rbacService.getUserRoles(userId),
      );

      expect(assignedRoles.length).toBe(1);
      expect(assignedRoles[0].roleSlug).toBe('standard_user');
      expect(assignedRoles[0].status).toBe('ACTIVE');
      expect(assignedRoles[0].scopeType).toBeNull();
      expect(assignedRoles[0].scopeId).toBeNull();

      // Verify permissions: standard_user has resource.read
      const perms = await withDbRetry(() =>
        rbacService.getUserPermissions(userId),
      );
      expect(perms).toContain('resource.read');
      expect(perms).not.toContain('resource.publish');
    });
  });

  describe('2. Multiple Roles & Permission Accumulation (Locked Decision 32)', () => {
    it('allows assigning multiple roles to a user and accumulates permissions', async () => {
      const email = `test-multi-${Date.now()}@example.com`;
      const regResult = await withDbRetry(() =>
        authService.register({
          email,
          password: 'SecurePassword123!',
          displayName: 'Teacher User',
        }),
      );

      const userId = regResult.user.id;
      createdUserIds.push(userId);

      // Assign verified_teacher role
      await withDbRetry(() =>
        rbacService.assignRole({
          userId,
          roleSlug: 'verified_teacher',
        }),
      );

      const userRolesList = await withDbRetry(() =>
        rbacService.getUserRoles(userId),
      );
      const slugs = userRolesList.map((r) => r.roleSlug);
      expect(slugs).toContain('standard_user');
      expect(slugs).toContain('verified_teacher');

      // Verify accumulated permissions
      const perms = await withDbRetry(() =>
        rbacService.getUserPermissions(userId),
      );
      expect(perms).toContain('resource.read');
      expect(perms).toContain('resource.create');
      expect(perms).toContain('resource.update');
      expect(perms).toContain('resource.submit');
      expect(perms).not.toContain('resource.publish');
    });
  });

  describe('3. GLOBAL vs Scoped Permissions Semantics (Prompt 14 Correction 1)', () => {
    it('demonstrates scope isolation and hierarchical global satisfaction', async () => {
      const email = `test-scoped-${Date.now()}@example.com`;
      const regResult = await withDbRetry(() =>
        authService.register({
          email,
          password: 'SecurePassword123!',
          displayName: 'School Reviewer',
        }),
      );

      const userId = regResult.user.id;
      createdUserIds.push(userId);

      const schoolAId = '00000000-0000-0000-0000-000000000001';
      const schoolBId = '00000000-0000-0000-0000-000000000002';

      // Assign content_reviewer scoped to school A
      await withDbRetry(() =>
        rbacService.assignRole({
          userId,
          roleSlug: 'content_reviewer',
          scopeType: 'SCHOOL',
          scopeId: schoolAId,
        }),
      );

      // 1. User has resource.review on School A
      const canReviewA = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.review', {
          scopeType: 'SCHOOL',
          scopeId: schoolAId,
        }),
      );
      expect(canReviewA).toBe(true);

      // 2. User CANNOT review on School B (strict isolation)
      const canReviewB = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.review', {
          scopeType: 'SCHOOL',
          scopeId: schoolBId,
        }),
      );
      expect(canReviewB).toBe(false);

      // 3. User CANNOT review globally without scope
      const canReviewGlobal = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.review'),
      );
      expect(canReviewGlobal).toBe(false);

      // 4. Now assign content_manager globally -> global grant satisfies any scope
      await withDbRetry(() =>
        rbacService.assignRole({
          userId,
          roleSlug: 'content_manager',
        }),
      );

      const canPublishGlobal = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.publish'),
      );
      expect(canPublishGlobal).toBe(true);

      const canPublishSchoolB = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.publish', {
          scopeType: 'SCHOOL',
          scopeId: schoolBId,
        }),
      );
      expect(canPublishSchoolB).toBe(true);
    });
  });

  describe('4. Role Revocation and Expiration', () => {
    it('revokes a role and strips associated permissions immediately', async () => {
      const email = `test-revoke-${Date.now()}@example.com`;
      const regResult = await withDbRetry(() =>
        authService.register({
          email,
          password: 'SecurePassword123!',
          displayName: 'Revocable User',
        }),
      );

      const userId = regResult.user.id;
      createdUserIds.push(userId);

      const assignment = await withDbRetry(() =>
        rbacService.assignRole({
          userId,
          roleSlug: 'content_reviewer',
        }),
      );

      // Verify granted
      expect(
        await withDbRetry(() =>
          rbacService.hasPermission(userId, 'resource.approve'),
        ),
      ).toBe(true);

      // Revoke assignment
      await withDbRetry(() => rbacService.revokeRole(assignment.id));

      // Verify revoked
      expect(
        await withDbRetry(() =>
          rbacService.hasPermission(userId, 'resource.approve'),
        ),
      ).toBe(false);
    });

    it('denies permissions when role assignment ends_at is in the past', async () => {
      const email = `test-expire-${Date.now()}@example.com`;
      const regResult = await withDbRetry(() =>
        authService.register({
          email,
          password: 'SecurePassword123!',
          displayName: 'Expired Role User',
        }),
      );

      const userId = regResult.user.id;
      createdUserIds.push(userId);

      // Assign role that already expired 1 hour ago
      const pastStart = new Date(Date.now() - 2 * 3600 * 1000);
      const pastEnd = new Date(Date.now() - 1 * 3600 * 1000);

      await withDbRetry(() =>
        rbacService.assignRole({
          userId,
          roleSlug: 'content_reviewer',
          startsAt: pastStart,
          endsAt: pastEnd,
        }),
      );

      const canApprove = await withDbRetry(() =>
        rbacService.hasPermission(userId, 'resource.approve'),
      );
      expect(canApprove).toBe(false);
    });
  });

  describe('5. Database Integrity Constraints (Correction 5)', () => {
    it('enforces chk_user_roles_scope_consistency in PostgreSQL', async () => {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .limit(1);
      const [r] = await db
        .select({ id: roles.id })
        .from(roles)
        .limit(1);

      // Inserting scope_type without scope_id should fail at DB level
      await expect(
        db.insert(userRoles).values({
          userId: u.id,
          roleId: r.id,
          scopeType: 'SCHOOL',
          scopeId: null,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();

      // Inserting scope_id without scope_type should fail at DB level
      await expect(
        db.insert(userRoles).values({
          userId: u.id,
          roleId: r.id,
          scopeType: null,
          scopeId: '00000000-0000-0000-0000-000000000001',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('enforces chk_user_roles_dates when ends_at <= starts_at', async () => {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .limit(1);
      const [r] = await db
        .select({ id: roles.id })
        .from(roles)
        .limit(1);

      const now = new Date();
      await expect(
        db.insert(userRoles).values({
          userId: u.id,
          roleId: r.id,
          status: 'ACTIVE',
          startsAt: now,
          endsAt: now, // ends_at must be strictly greater than starts_at
        }),
      ).rejects.toThrow();
    });
  });
});
