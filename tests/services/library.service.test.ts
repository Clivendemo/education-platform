import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DefaultLibraryService,
  ResourceVersionNotFoundError,
  ResourceVersionNotEligibleError,
} from '../../src/services/library.service.js';

describe('LibraryService Unit Tests', () => {
  let mockDb: any;
  let service: DefaultLibraryService;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      execute: vi.fn(),
    };
    service = new DefaultLibraryService(mockDb);
  });

  describe('Validation & Eligibility Checks', () => {
    it('throws ResourceVersionNotFoundError when resourceVersionId is not a valid UUID', async () => {
      await expect(
        service.saveResourceVersion('00000000-0000-0000-0000-000000000001', 'invalid-uuid'),
      ).rejects.toThrow(ResourceVersionNotFoundError);
    });

    it('throws ResourceVersionNotFoundError when version does not exist in database', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.saveResourceVersion(
          '00000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ResourceVersionNotFoundError);
    });

    it('throws ResourceVersionNotEligibleError when parent resource is REJECTED', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            versionId: '11111111-1111-1111-1111-111111111111',
            versionStatus: 'PUBLISHED',
            resourceId: '22222222-2222-2222-2222-222222222222',
            resourceStatus: 'REJECTED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.saveResourceVersion(
          '00000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ResourceVersionNotEligibleError);
    });

    it('throws ResourceVersionNotEligibleError when version is DRAFT', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            versionId: '11111111-1111-1111-1111-111111111111',
            versionStatus: 'DRAFT',
            resourceId: '22222222-2222-2222-2222-222222222222',
            resourceStatus: 'PUBLISHED',
            deletedAt: null,
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.saveResourceVersion(
          '00000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ResourceVersionNotEligibleError);
    });

    it('throws ResourceVersionNotEligibleError when version is IN_REVIEW', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            versionId: '11111111-1111-1111-1111-111111111111',
            versionStatus: 'IN_REVIEW',
            resourceId: '22222222-2222-2222-2222-222222222222',
            resourceStatus: 'IN_REVIEW',
            deletedAt: null,
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.saveResourceVersion(
          '00000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ResourceVersionNotEligibleError);
    });

    it('throws ResourceVersionNotEligibleError when version is ARCHIVED or parent is ARCHIVED', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            versionId: '11111111-1111-1111-1111-111111111111',
            versionStatus: 'PUBLISHED',
            resourceId: '22222222-2222-2222-2222-222222222222',
            resourceStatus: 'ARCHIVED',
            deletedAt: null,
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.saveResourceVersion(
          '00000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ResourceVersionNotEligibleError);
    });
  });

  describe('Check Saved Status', () => {
    it('returns isSaved: false for invalid UUID format', async () => {
      const res = await service.isResourceVersionSaved(
        '00000000-0000-0000-0000-000000000001',
        'not-a-uuid',
      );
      expect(res.isSaved).toBe(false);
      expect(res.resourceVersionId).toBe('not-a-uuid');
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('returns true when resource version is present in user array', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            savedIds: ['11111111-1111-1111-1111-111111111111'],
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const res = await service.isResourceVersionSaved(
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
      );
      expect(res.isSaved).toBe(true);
      expect(res.resourceVersionId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('returns false when resource version is not present in user array', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            savedIds: ['22222222-2222-2222-2222-222222222222'],
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const res = await service.isResourceVersionSaved(
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
      );
      expect(res.isSaved).toBe(false);
    });
  });

  describe('Remove Saved Status (Idempotency)', () => {
    it('returns removed: true for invalid UUID without failing', async () => {
      const res = await service.removeResourceVersion(
        '00000000-0000-0000-0000-000000000001',
        'not-a-uuid',
      );
      expect(res.removed).toBe(true);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('executes atomic array_remove query on valid UUID', async () => {
      mockDb.execute.mockResolvedValueOnce([]);
      const res = await service.removeResourceVersion(
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
      );
      expect(res.removed).toBe(true);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('Listing Saved Resources', () => {
    it('returns empty list when user has empty savedResourceVersionIds array', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            savedIds: [],
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const res = await service.listSavedResources('00000000-0000-0000-0000-000000000001');
      expect(res.data).toEqual([]);
      expect(res.pagination.total).toBe(0);
      expect(res.pagination.hasMore).toBe(false);
    });

    it('returns empty list when user is not found', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const res = await service.listSavedResources('00000000-0000-0000-0000-000000000001');
      expect(res.data).toEqual([]);
      expect(res.pagination.total).toBe(0);
    });
  });
});
