import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ADMIN_ATTENTION_FLAGS,
  AdminDashboardError,
  DefaultAdminDashboardService,
  resolveEffectiveCountryScope,
} from '../../src/services/admin-dashboard.service.js';
import { mapAttentionFlagsFromRow } from '../../src/services/admin-attention.js';
import { FileStorageError } from '../../src/services/file-storage.service.js';

describe('Prompt 31: AdminDashboardService Unit Tests', () => {
  describe('Canonical ADMIN_ATTENTION_FLAGS contract', () => {
    it('defines the exact 6 canonical operational attention flags in stable order', () => {
      expect(ADMIN_ATTENTION_FLAGS).toEqual([
        'PENDING_REVIEW',
        'APPROVED_AWAITING_PUBLISH',
        'PUBLISHED_WITHOUT_AVAILABLE_FILE',
        'IN_REVIEW_WITHOUT_CANDIDATE_VERSION',
        'HAS_PROBLEMATIC_FILES',
        'HAS_OPEN_DEFECT_FEEDBACK',
      ]);
      expect(ADMIN_ATTENTION_FLAGS).toHaveLength(6);
      expect(ADMIN_ATTENTION_FLAGS).not.toContain('NO_VERSIONS');
    });

    it('maps overlapping boolean columns to ordered attention flags accurately', () => {
      const flags = mapAttentionFlagsFromRow({
        flagPendingReview: true,
        flagApprovedAwaitingPublish: false,
        flagPublishedWithoutAvailableFile: false,
        flagInReviewWithoutCandidateVersion: true,
        flagHasProblematicFiles: true,
        flagHasOpenDefectFeedback: true,
      });

      expect(flags).toEqual([
        'PENDING_REVIEW',
        'IN_REVIEW_WITHOUT_CANDIDATE_VERSION',
        'HAS_PROBLEMATIC_FILES',
        'HAS_OPEN_DEFECT_FEEDBACK',
      ]);
    });
  });

  describe('resolveEffectiveCountryScope', () => {
    it('throws 403 FORBIDDEN when access is not granted', () => {
      expect(() =>
        resolveEffectiveCountryScope({
          granted: false,
          hasGlobalGrant: false,
          countryIds: [],
        }),
      ).toThrowError(AdminDashboardError);
    });

    it('returns GLOBAL mode for unscoped global grant when no countryId filter is passed', () => {
      const scope = resolveEffectiveCountryScope({
        granted: true,
        hasGlobalGrant: true,
        countryIds: [],
      });
      expect(scope).toEqual({ mode: 'GLOBAL' });
    });

    it('narrows global grant to SINGLE country mode when countryId filter is passed', () => {
      const scope = resolveEffectiveCountryScope(
        {
          granted: true,
          hasGlobalGrant: true,
          countryIds: [],
        },
        'ke-uuid',
      );
      expect(scope).toEqual({ mode: 'SINGLE', countryId: 'ke-uuid' });
    });

    it('returns SINGLE mode when country-scoped admin has 1 country grant', () => {
      const scope = resolveEffectiveCountryScope({
        granted: true,
        hasGlobalGrant: false,
        countryIds: ['ke-uuid'],
      });
      expect(scope).toEqual({ mode: 'SINGLE', countryId: 'ke-uuid' });
    });

    it('returns MULTI mode when country-scoped admin has multiple country grants', () => {
      const scope = resolveEffectiveCountryScope({
        granted: true,
        hasGlobalGrant: false,
        countryIds: ['ke-uuid', 'ug-uuid'],
      });
      expect(scope).toEqual({ mode: 'MULTI', countryIds: ['ke-uuid', 'ug-uuid'] });
    });

    it('throws 403 FORBIDDEN with targetCountryId metadata when country-scoped admin requests unauthorized country', () => {
      try {
        resolveEffectiveCountryScope(
          {
            granted: true,
            hasGlobalGrant: false,
            countryIds: ['ke-uuid'],
          },
          'tz-uuid',
        );
        expect.fail('Expected AdminDashboardError');
      } catch (err) {
        expect(err).toBeInstanceOf(AdminDashboardError);
        const adErr = err as AdminDashboardError;
        expect(adErr.statusCode).toBe(403);
        expect(adErr.code).toBe('FORBIDDEN');
        expect(adErr.metadata?.targetCountryId).toBe('tz-uuid');
      }
    });
  });

  describe('verifyFileIntegrity rate limiting, storage error handling, and audit logging', () => {
    let mockDb: any;
    let mockRbac: any;
    let mockFileStorage: any;
    let mockAudit: any;
    let currentNow: number;

    const fileLookupRow = {
      fileId: '11111111-1111-4111-8111-111111111111',
      storageProvider: 'CLOUDFLARE_R2',
      fileStatus: 'AVAILABLE',
      resourceVersionId: '22222222-2222-4222-8222-222222222222',
      versionStatus: 'PUBLISHED',
      resourceId: '33333333-3333-4333-8333-333333333333',
      countryId: '44444444-4444-4444-8444-444444444444',
    };

    const actorContext = {
      actorUserId: '99999999-9999-4999-8999-999999999999',
      actorSnapshot: {
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'system_admin',
        emailDomain: 'example.com',
      },
      requestId: 'req-unit-1',
    };

    beforeEach(() => {
      currentNow = 1_700_000_000_000;
      mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([fileLookupRow]),
        }),
      };
      mockRbac = {
        resolvePermissionAccess: vi.fn(),
        hasPermission: vi.fn(),
      };
      mockFileStorage = {
        verifyFileIntegrity: vi.fn().mockResolvedValue({
          fileId: fileLookupRow.fileId,
          status: 'VALID',
          existsInStorage: true,
          sizeMatches: true,
          checksumMatches: true,
        }),
      };
      mockAudit = {
        logEvent: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      };
    });

    it('delegates to FileStorageService.verifyFileIntegrity without mutating DB, redacts storage internals, and writes SUCCESS audit log', async () => {
      const service = new DefaultAdminDashboardService(
        mockDb,
        mockRbac,
        mockFileStorage,
        mockAudit,
        { maxRequestsPerWindow: 20, windowMs: 60_000, nowFn: () => currentNow },
      );

      const res = await service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, {
        granted: true,
        hasGlobalGrant: true,
        countryIds: [],
      });

      expect(res).toMatchObject({
        fileId: fileLookupRow.fileId,
        resourceId: fileLookupRow.resourceId,
        resourceVersionId: fileLookupRow.resourceVersionId,
        countryId: fileLookupRow.countryId,
        storageProvider: 'CLOUDFLARE_R2',
        recordedStatus: 'AVAILABLE',
        immutableUnderPublishedVersion: true,
        integrity: {
          status: 'VALID',
          existsInStorage: true,
          sizeMatches: true,
          checksumMatches: true,
        },
      });
      expect(res).not.toHaveProperty('storageBucket');
      expect(res).not.toHaveProperty('objectKey');
      expect(res).not.toHaveProperty('storageMetadata');

      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_FILE_INTEGRITY_VERIFIED',
          entityType: 'RESOURCE_FILE',
          entityId: fileLookupRow.fileId,
          outcome: 'SUCCESS',
          actorUserId: actorContext.actorUserId,
          countryId: fileLookupRow.countryId,
        }),
      );
    });

    it('enforces 20 req/min/actor sliding-window rate limit before invoking storage HEAD and resets after window expires', async () => {
      const service = new DefaultAdminDashboardService(
        mockDb,
        mockRbac,
        mockFileStorage,
        mockAudit,
        { maxRequestsPerWindow: 20, windowMs: 60_000, nowFn: () => currentNow },
      );

      const access = { granted: true, hasGlobalGrant: true, countryIds: [] };

      for (let i = 0; i < 20; i++) {
        await service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, access);
      }
      expect(mockFileStorage.verifyFileIntegrity).toHaveBeenCalledTimes(20);

      // 21st request within 60s window must fail with 429 RATE_LIMIT_EXCEEDED without calling storage
      await expect(
        service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, access),
      ).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429,
      });
      expect(mockFileStorage.verifyFileIntegrity).toHaveBeenCalledTimes(20);

      // Different actor has independent bucket
      await service.verifyFileIntegrity(
        fileLookupRow.fileId,
        { ...actorContext, actorUserId: '88888888-8888-4888-8888-888888888888' },
        access,
      );
      expect(mockFileStorage.verifyFileIntegrity).toHaveBeenCalledTimes(21);

      // Advance clock past 60s window -> original actor allowed again
      currentNow += 60_001;
      await service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, access);
      expect(mockFileStorage.verifyFileIntegrity).toHaveBeenCalledTimes(22);
    });

    it('enforces COUNTRY scope before calling storage HEAD on out-of-country file', async () => {
      const service = new DefaultAdminDashboardService(
        mockDb,
        mockRbac,
        mockFileStorage,
        mockAudit,
      );

      await expect(
        service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, {
          granted: true,
          hasGlobalGrant: false,
          countryIds: ['different-country-uuid'],
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });

      expect(mockFileStorage.verifyFileIntegrity).not.toHaveBeenCalled();
    });

    it('maps storage provider failure to safe 502 STORAGE_VERIFICATION_ERROR and writes FAILED audit log without leaking internals', async () => {
      mockFileStorage.verifyFileIntegrity.mockRejectedValueOnce(
        new FileStorageError(
          'S3_HEAD_TIMEOUT',
          'Internal R2 bucket secret-bucket-xyz endpoint timeout on key kcse/2025/secret.pdf',
          500,
        ),
      );

      const service = new DefaultAdminDashboardService(
        mockDb,
        mockRbac,
        mockFileStorage,
        mockAudit,
      );

      try {
        await service.verifyFileIntegrity(fileLookupRow.fileId, actorContext, {
          granted: true,
          hasGlobalGrant: true,
          countryIds: [],
        });
        expect.fail('Expected 502 AdminDashboardError');
      } catch (err) {
        expect(err).toBeInstanceOf(AdminDashboardError);
        const adErr = err as AdminDashboardError;
        expect(adErr.statusCode).toBe(502);
        expect(adErr.code).toBe('STORAGE_VERIFICATION_ERROR');
        expect(adErr.message).not.toContain('secret-bucket-xyz');
        expect(adErr.message).not.toContain('secret.pdf');
      }

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_FILE_INTEGRITY_VERIFIED',
          outcome: 'FAILED',
          entityId: fileLookupRow.fileId,
        }),
      );
    });
  });
});
