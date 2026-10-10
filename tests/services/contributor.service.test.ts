import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DefaultContributorService,
  NotAContributorError,
  ContributorSuspendedError,
  ApplicationNotFoundError,
  ApplicationAlreadyReviewedError,
  SubmissionNotFoundError,
  SubmissionNotEditableError,
  ContributorValidationError,
} from '../../src/services/contributor.service.js';

describe('ContributorService Unit Tests', () => {
  let mockDb: any;
  let mockRbac: any;
  let service: DefaultContributorService;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(async (cb: any) => cb(mockDb)),
    };
    mockRbac = {
      assignRole: vi.fn().mockResolvedValue({}),
      getUserRoles: vi.fn().mockResolvedValue([]),
    };
    service = new DefaultContributorService(mockDb, mockRbac);
  });

  describe('Validation & Slug Generation', () => {
    it('rejects empty application text', async () => {
      await expect(
        service.submitApplication('00000000-0000-0000-0000-000000000001', '   '),
      ).rejects.toThrow(ContributorValidationError);
    });

    it('rejects empty submission title', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contributor-1',
            userId: 'user-1',
            status: 'ACTIVE',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.createSubmission('user-1', {
          title: '  ',
        }),
      ).rejects.toThrow(ContributorValidationError);
    });

    it('rejects negative proposed price minor in submission', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contributor-1',
            userId: 'user-1',
            status: 'ACTIVE',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.createSubmission('user-1', {
          title: 'Grade 7 CBC Revision Guide',
          proposedPriceMinor: -500,
        }),
      ).rejects.toThrow(ContributorValidationError);
    });

    it('rejects non-KES proposed currency code', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contributor-1',
            userId: 'user-1',
            status: 'ACTIVE',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.createSubmission('user-1', {
          title: 'Grade 7 CBC Revision Guide',
          proposedPriceMinor: 10000,
          proposedCurrencyCode: 'USD',
        }),
      ).rejects.toThrow(ContributorValidationError);
    });
  });

  describe('Contributor Lifecycle & Access Rules', () => {
    it('throws NotAContributorError when user has no contributor profile', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(service.getMyProfile('non-contributor-id')).rejects.toThrow(
        NotAContributorError,
      );
    });

    it('throws ContributorSuspendedError when suspended contributor attempts profile update', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contrib-1',
            userId: 'user-1',
            status: 'SUSPENDED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.updateMyProfile('user-1', { displayName: 'Updated Name' }),
      ).rejects.toThrow(ContributorSuspendedError);
    });

    it('throws ContributorSuspendedError when suspended contributor attempts to create submission', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contrib-1',
            userId: 'user-1',
            status: 'SUSPENDED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.createSubmission('user-1', { title: 'NewCBCDraft' }),
      ).rejects.toThrow(ContributorSuspendedError);
    });

    it('throws ContributorSuspendedError when suspended contributor attempts to update submission', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contrib-1',
            userId: 'user-1',
            status: 'SUSPENDED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.updateSubmission('user-1', 'sub-1', { title: 'Updated CBC Draft' }),
      ).rejects.toThrow(ContributorSuspendedError);
    });

    it('throws ContributorSuspendedError when suspended contributor attempts to submit draft', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contrib-1',
            userId: 'user-1',
            status: 'SUSPENDED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(service.submitSubmission('user-1', 'sub-1')).rejects.toThrow(
        ContributorSuspendedError,
      );
    });

    it('throws SubmissionNotEditableError when modifying a non-DRAFT submission', async () => {
      // Contributor is active
      const selectContribChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'contrib-1',
            userId: 'user-1',
            status: 'ACTIVE',
          },
        ]),
      };
      // Submission is SUBMITTED
      const selectSubChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'sub-1',
            contributorId: 'contrib-1',
            status: 'SUBMITTED',
          },
        ]),
      };

      mockDb.select
        .mockReturnValueOnce(selectContribChain)
        .mockReturnValueOnce(selectSubChain);

      await expect(
        service.updateSubmission('user-1', 'sub-1', { title: 'Updated' }),
      ).rejects.toThrow(SubmissionNotEditableError);
    });
  });

  describe('Application Review Logic', () => {
    it('requires review notes when rejecting an application', async () => {
      await expect(
        service.reviewApplication('admin-1', 'app-1', 'REJECT', '   '),
      ).rejects.toThrow(ContributorValidationError);
    });

    it('throws ApplicationNotFoundError when application does not exist', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.reviewApplication('admin-1', 'nonexistent-app', 'APPROVE'),
      ).rejects.toThrow(ApplicationNotFoundError);
    });

    it('throws ApplicationAlreadyReviewedError if application is already approved or rejected', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'app-1',
            userId: 'user-1',
            status: 'APPROVED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.reviewApplication('admin-1', 'app-1', 'APPROVE'),
      ).rejects.toThrow(ApplicationAlreadyReviewedError);
    });
  });

  describe('Editorial Submission Review Logic', () => {
    it('requires review notes when rejecting a submission', async () => {
      await expect(
        service.reviewSubmission('admin-1', 'sub-1', 'REJECT', '   '),
      ).rejects.toThrow(ContributorValidationError);
    });

    it('throws SubmissionNotFoundError when candidate submission does not exist', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.reviewSubmission('admin-1', 'nonexistent-sub', 'APPROVE'),
      ).rejects.toThrow(SubmissionNotFoundError);
    });

    it('rejects reviewing a submission already in terminal or approved status', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'sub-1',
            status: 'APPROVED',
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        service.reviewSubmission('admin-1', 'sub-1', 'APPROVE'),
      ).rejects.toThrow(ContributorValidationError);
    });
  });
});
