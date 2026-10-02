import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultRbacService, type RbacService } from '../../src/services/rbac.service.js';

describe('DefaultRbacService Unit Tests', () => {
  let mockDb: any;
  let service: RbacService;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    };
    service = new DefaultRbacService(mockDb);
  });

  describe('Scope validation on assignRole', () => {
    it('throws error if scopeType is provided without scopeId', async () => {
      await expect(
        service.assignRole({
          userId: '11111111-1111-1111-1111-111111111111',
          roleSlug: 'content_reviewer',
          scopeType: 'SCHOOL',
          scopeId: null,
        }),
      ).rejects.toThrow(/Invalid scope parameters/);
    });

    it('throws error if scopeId is provided without scopeType', async () => {
      await expect(
        service.assignRole({
          userId: '11111111-1111-1111-1111-111111111111',
          roleSlug: 'content_reviewer',
          scopeType: null,
          scopeId: '22222222-2222-2222-2222-222222222222',
        }),
      ).rejects.toThrow(/Invalid scope parameters/);
    });

    it('throws error if endsAt is before or equal to startsAt', async () => {
      const start = new Date('2026-01-02');
      const end = new Date('2026-01-01');

      await expect(
        service.assignRole({
          userId: '11111111-1111-1111-1111-111111111111',
          roleSlug: 'content_reviewer',
          startsAt: start,
          endsAt: end,
        }),
      ).rejects.toThrow(/Invalid dates/);
    });
  });

  describe('Permission evaluation semantics (GLOBAL vs Scoped)', () => {
    it('returns false when user has no matching grants for the permission', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.publish',
      );

      expect(hasPerm).toBe(false);
    });

    it('returns true when user has a GLOBAL grant (scopeType is null), even without scope filter', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { scopeType: null, scopeId: null },
        ]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.publish',
      );

      expect(hasPerm).toBe(true);
    });

    it('returns true when user has a GLOBAL grant, even when checking a specific scope (hierarchical satisfaction)', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { scopeType: null, scopeId: null },
        ]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.publish',
        { scopeType: 'SCHOOL', scopeId: 'school-uuid' },
      );

      expect(hasPerm).toBe(true);
    });

    it('returns true when user has a matching scoped grant', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { scopeType: 'SCHOOL', scopeId: 'school-uuid' },
        ]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.update',
        { scopeType: 'SCHOOL', scopeId: 'school-uuid' },
      );

      expect(hasPerm).toBe(true);
    });

    it('returns false when user only has a scoped grant for a different scopeId', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { scopeType: 'SCHOOL', scopeId: 'different-school-uuid' },
        ]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.update',
        { scopeType: 'SCHOOL', scopeId: 'target-school-uuid' },
      );

      expect(hasPerm).toBe(false);
    });

    it('returns false when user only has a scoped grant but operation requires global access', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { scopeType: 'SCHOOL', scopeId: 'school-uuid' },
        ]),
      });

      const hasPerm = await service.hasPermission(
        '11111111-1111-1111-1111-111111111111',
        'resource.update', // No scope provided -> requires global
      );

      expect(hasPerm).toBe(false);
    });
  });

  describe('getUserPermissions distinct resolution', () => {
    it('aggregates distinct active permissions from multiple roles', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { permissionName: 'resource.read' },
          { permissionName: 'resource.create' },
          { permissionName: 'resource.read' }, // duplicate from another role
          { permissionName: 'resource.submit' },
        ]),
      });

      const perms = await service.getUserPermissions('user-uuid');
      expect(perms).toEqual(['resource.read', 'resource.create', 'resource.submit']);
    });
  });
});
