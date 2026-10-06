import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DefaultDownloadService,
  ResourceNotFoundError,
  PremiumResourceLockedError,
  NoAvailableFilesError,
  FileNotFoundDownloadError,
  FileNotAvailableError,
  DownloadError,
} from '../../src/services/download.service.js';
import type { StorageProvider } from '../../src/services/storage/storage-provider.interface.js';

describe('DownloadService Unit Tests', () => {
  let mockDb: any;
  let mockStorageProvider: StorageProvider;
  let service: DefaultDownloadService;

  const validResourceId = '11111111-1111-4111-a111-111111111111';
  const validVersionId = '22222222-2222-4222-a222-222222222222';
  const validFileId = '33333333-3333-4333-a333-333333333333';

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
    };

    mockStorageProvider = {
      getProviderName: vi.fn().mockReturnValue('MOCK_STORAGE'),
      getBucketName: vi.fn().mockReturnValue('mock-bucket'),
      putObject: vi.fn(),
      headObject: vi.fn(),
      getObject: vi.fn(),
      deleteObject: vi.fn(),
      objectExists: vi.fn(),
      getSignedDownloadUrl: vi
        .fn()
        .mockResolvedValue('https://mock-storage.local/signed-download-token'),
    };

    service = new DefaultDownloadService(mockDb as any, mockStorageProvider, 300);
  });

  describe('Identifier & Format Validation', () => {
    it('throws ResourceNotFoundError when resourceId is not a valid UUID', async () => {
      await expect(
        service.generateDownloadUrl({ resourceId: 'invalid-id' }),
      ).rejects.toThrow(ResourceNotFoundError);

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws DownloadError VALIDATION_ERROR when fileId is not a valid UUID', async () => {
      await expect(
        service.generateDownloadUrl({
          resourceId: validResourceId,
          fileId: 'not-a-uuid',
        }),
      ).rejects.toThrow(DownloadError);

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('Resource & Publication Eligibility Checks (Zero Storage Calls on Rejection)', () => {
    it('throws ResourceNotFoundError when resource does not exist in database', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.generateDownloadUrl({ resourceId: validResourceId }),
      ).rejects.toThrow(ResourceNotFoundError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws ResourceNotFoundError when resource status is DRAFT', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'DRAFT',
            qualityLabel: 'STANDARD',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.generateDownloadUrl({ resourceId: validResourceId }),
      ).rejects.toThrow(ResourceNotFoundError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws PremiumResourceLockedError (403) when resource qualityLabel is PREMIUM', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'PREMIUM',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const error = await service
        .generateDownloadUrl({ resourceId: validResourceId })
        .catch((err) => err);

      expect(error).toBeInstanceOf(PremiumResourceLockedError);
      expect(error.code).toBe('PREMIUM_RESOURCE_LOCKED');
      expect(error.statusCode).toBe(403);
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws ResourceNotFoundError when resource has no active PUBLISHED version', async () => {
      // 1. Resource query succeeds
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'VERIFIED',
          },
        ]),
      };

      // 2. Version query returns empty
      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain);

      await expect(
        service.generateDownloadUrl({ resourceId: validResourceId }),
      ).rejects.toThrow(ResourceNotFoundError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('File Selection & Cross-Version Isolation', () => {
    it('throws NoAvailableFilesError when published version has zero available files', async () => {
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          },
        ]),
      };

      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validVersionId,
            status: 'PUBLISHED',
          },
        ]),
      };

      const filesChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain)
        .mockReturnValueOnce(filesChain);

      await expect(
        service.generateDownloadUrl({ resourceId: validResourceId }),
      ).rejects.toThrow(NoAvailableFilesError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws FileNotFoundDownloadError when explicit fileId does not exist', async () => {
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          },
        ]),
      };

      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validVersionId,
            status: 'PUBLISHED',
          },
        ]),
      };

      const fileChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain)
        .mockReturnValueOnce(fileChain);

      await expect(
        service.generateDownloadUrl({
          resourceId: validResourceId,
          fileId: validFileId,
        }),
      ).rejects.toThrow(FileNotFoundDownloadError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('blocks cross-version access: throws FileNotFoundDownloadError when file belongs to another version', async () => {
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          },
        ]),
      };

      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validVersionId,
            status: 'PUBLISHED',
          },
        ]),
      };

      // File has a DIFFERENT resourceVersionId
      const fileChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validFileId,
            resourceVersionId: '99999999-9999-4999-a999-999999999999',
            objectKey: 'other/key.pdf',
            originalFilename: 'other.pdf',
            status: 'AVAILABLE',
          },
        ]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain)
        .mockReturnValueOnce(fileChain);

      await expect(
        service.generateDownloadUrl({
          resourceId: validResourceId,
          fileId: validFileId,
        }),
      ).rejects.toThrow(FileNotFoundDownloadError);

      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws FileNotAvailableError when requested file is QUARANTINED or PENDING', async () => {
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          },
        ]),
      };

      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validVersionId,
            status: 'PUBLISHED',
          },
        ]),
      };

      const fileChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validFileId,
            resourceVersionId: validVersionId,
            objectKey: 'resources/test/quarantine.pdf',
            originalFilename: 'quarantine.pdf',
            status: 'QUARANTINED',
          },
        ]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain)
        .mockReturnValueOnce(fileChain);

      const error = await service
        .generateDownloadUrl({
          resourceId: validResourceId,
          fileId: validFileId,
        })
        .catch((err) => err);

      expect(error).toBeInstanceOf(FileNotAvailableError);
      expect(error.code).toBe('FILE_NOT_AVAILABLE');
      expect(error.statusCode).toBe(400);
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('Successful Download & Output Sanitization (Correction 1 & 2)', () => {
    it('generates short-lived presigned URL with deterministic primary file and no storage internals leak', async () => {
      const resourceChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validResourceId,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          },
        ]),
      };

      const versionChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: validVersionId,
            status: 'PUBLISHED',
          },
        ]),
      };

      const fileItem = {
        id: validFileId,
        resourceVersionId: validVersionId,
        objectKey: 'internal/storage/path/worksheet.pdf',
        originalFilename: 'worksheet.pdf',
        fileExtension: 'pdf',
        fileType: 'MAIN_DOCUMENT',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        checksumSha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        isPrimary: true,
        sequenceOrder: 1,
        createdAt: new Date(),
      };

      const filesChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([fileItem]),
      };

      mockDb.select
        .mockReturnValueOnce(resourceChain)
        .mockReturnValueOnce(versionChain)
        .mockReturnValueOnce(filesChain);

      const result = await service.generateDownloadUrl({
        resourceId: validResourceId,
      });

      // Storage provider was invoked with exact object key and short-lived TTL
      expect(mockStorageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
        'internal/storage/path/worksheet.pdf',
        expect.objectContaining({
          expiresInSeconds: 300,
          responseContentType: 'application/pdf',
        }),
      );

      // Verify response structure
      expect(result.downloadUrl).toBe(
        'https://mock-storage.local/signed-download-token',
      );
      expect(result.expiresInSeconds).toBe(300);
      expect(typeof result.expiresAt).toBe('string');
      expect(result.file).toEqual({
        id: validFileId,
        originalFilename: 'worksheet.pdf',
        fileType: 'MAIN_DOCUMENT',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        checksumSha256: 'a'.repeat(64),
      });

      // Strict security: ensure no storage fields leak in result or result.file
      const resultObj = result as any;
      expect(resultObj.objectKey).toBeUndefined();
      expect(resultObj.storageBucket).toBeUndefined();
      expect(resultObj.storageProvider).toBeUndefined();
      expect(resultObj.storageMetadata).toBeUndefined();
      expect(resultObj.file.objectKey).toBeUndefined();
      expect(resultObj.file.storageBucket).toBeUndefined();
      expect(resultObj.file.storageProvider).toBeUndefined();
    });
  });
});
