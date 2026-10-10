import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DefaultContributorFinanceService,
  InvalidRevenueRuleError,
  OverlappingRevenueRuleError,
} from '../../src/services/contributor-finance.service.js';

describe('ContributorFinanceService Unit Tests', () => {
  describe('Integer Split Calculations & Basis Points', () => {
    it('correctly calculates 70/30 split on standard amounts', () => {
      // 500 KES = 50,000 cents
      const gross = 50000n;
      const { contributorAmountMinor, platformAmountMinor } =
        DefaultContributorFinanceService.calculateSplit(gross, 7000);

      expect(contributorAmountMinor).toBe(35000n);
      expect(platformAmountMinor).toBe(15000n);
      expect(contributorAmountMinor + platformAmountMinor).toBe(gross);
    });

    it('handles small amounts and enforces zero-sum invariant', () => {
      // 1 cent
      const gross1 = 1n;
      const split1 = DefaultContributorFinanceService.calculateSplit(gross1, 7000);
      expect(split1.contributorAmountMinor).toBe(0n);
      expect(split1.platformAmountMinor).toBe(1n);
      expect(split1.contributorAmountMinor + split1.platformAmountMinor).toBe(gross1);

      // 2 cents
      const gross2 = 2n;
      const split2 = DefaultContributorFinanceService.calculateSplit(gross2, 7000);
      expect(split2.contributorAmountMinor).toBe(1n);
      expect(split2.platformAmountMinor).toBe(1n);
      expect(split2.contributorAmountMinor + split2.platformAmountMinor).toBe(gross2);

      // 3 cents
      const gross3 = 3n;
      const split3 = DefaultContributorFinanceService.calculateSplit(gross3, 7000);
      expect(split3.contributorAmountMinor).toBe(2n);
      expect(split3.platformAmountMinor).toBe(1n);
      expect(split3.contributorAmountMinor + split3.platformAmountMinor).toBe(gross3);

      // 0 cents
      const gross0 = 0n;
      const split0 = DefaultContributorFinanceService.calculateSplit(gross0, 7000);
      expect(split0.contributorAmountMinor).toBe(0n);
      expect(split0.platformAmountMinor).toBe(0n);
      expect(split0.contributorAmountMinor + split0.platformAmountMinor).toBe(0n);
    });

    it('enforces exact zero-sum on odd/prime amounts with fractional cents', () => {
      const oddAmounts = [999n, 1001n, 7777n, 1234567n, 89n, 333n];
      for (const gross of oddAmounts) {
        const split = DefaultContributorFinanceService.calculateSplit(gross, 7000);
        expect(split.contributorAmountMinor + split.platformAmountMinor).toBe(gross);
        expect(split.contributorAmountMinor).toBeGreaterThanOrEqual(0n);
        expect(split.platformAmountMinor).toBeGreaterThanOrEqual(0n);
      }
    });

    it('rejects negative gross amounts', () => {
      expect(() => {
        DefaultContributorFinanceService.calculateSplit(-100n, 7000);
      }).toThrow(InvalidRevenueRuleError);
    });

    it('rejects basis points outside [0, 10000]', () => {
      expect(() => {
        DefaultContributorFinanceService.calculateSplit(1000n, -1);
      }).toThrow(InvalidRevenueRuleError);

      expect(() => {
        DefaultContributorFinanceService.calculateSplit(1000n, 10001);
      }).toThrow(InvalidRevenueRuleError);
    });
  });

  describe('Effective Revenue Rule & Overlapping Validation', () => {
    let mockDb: any;
    let service: DefaultContributorFinanceService;

    beforeEach(() => {
      mockDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(async (cb: any) => cb(mockDb)),
      };
      service = new DefaultContributorFinanceService(mockDb);
    });

    it('rejects creating an active revenue rule that overlaps with an existing active rule', async () => {
      const existingActiveRule = {
        id: 'rule-1',
        name: 'Active Rule 1',
        effectiveFrom: new Date('2025-01-01T00:00:00Z'),
        effectiveTo: new Date('2025-12-31T23:59:59Z'),
        status: 'ACTIVE',
      };

      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([existingActiveRule]),
      };
      mockDb.select.mockReturnValue(selectChain);

      // Overlapping period: starts in mid-2025
      await expect(
        service.createRevenueRule({
          name: 'Overlapping Rule',
          contributorShareBasisPoints: 7500,
          effectiveFrom: new Date('2025-06-01T00:00:00Z'),
          effectiveTo: new Date('2026-06-01T00:00:00Z'),
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(OverlappingRevenueRuleError);
    });

    it('rejects rule with empty name or invalid basis points', async () => {
      await expect(
        service.createRevenueRule({
          name: '   ',
          contributorShareBasisPoints: 7000,
        }),
      ).rejects.toThrow(InvalidRevenueRuleError);

      await expect(
        service.createRevenueRule({
          name: 'Invalid BPS',
          contributorShareBasisPoints: 12000,
        }),
      ).rejects.toThrow(InvalidRevenueRuleError);

      await expect(
        service.createRevenueRule({
          name: 'Invalid Dates',
          effectiveFrom: new Date('2026-05-01'),
          effectiveTo: new Date('2026-04-01'),
        }),
      ).rejects.toThrow(InvalidRevenueRuleError);
    });
  });

  describe('Order Earnings Attribution Logic', () => {
    let mockDb: any;
    let service: DefaultContributorFinanceService;

    beforeEach(() => {
      mockDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(async (cb: any) => cb(mockDb)),
      };
      service = new DefaultContributorFinanceService(mockDb);
    });

    it('creates 0 earnings when order items have no contributor attribution', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            orderItem: { id: 'item-1', totalMinor: 50000n },
            product: { id: 'prod-1' },
            resource: { id: 'res-1', contributorId: null }, // Unattributed resource
          },
        ]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const result = await service.recordOrderEarnings(mockDb, 'order-1', new Date());
      expect(result.earningsCreated).toBe(0);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('creates earnings record for contributor-attributed resources', async () => {
      const completionTime = new Date('2026-10-10T10:00:00Z');
      const selectItemsChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            orderItem: { id: 'item-1', totalMinor: 50000n },
            product: { id: 'prod-1' },
            resource: { id: 'res-1', contributorId: 'contributor-123' },
          },
        ]),
      };

      const selectRuleChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: 'rule-default',
            name: 'Standard Contributor Revenue Share (70/30)',
            contributorShareBasisPoints: 7000,
            status: 'ACTIVE',
          },
        ]),
      };

      mockDb.select
        .mockReturnValueOnce(selectItemsChain)
        .mockReturnValueOnce(selectRuleChain);

      const insertChain = {
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'earning-1' }]),
      };
      mockDb.insert.mockReturnValue(insertChain);

      const result = await service.recordOrderEarnings(mockDb, 'order-1', completionTime);
      expect(result.earningsCreated).toBe(1);

      // Verify values passed to insert
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          contributorId: 'contributor-123',
          orderId: 'order-1',
          orderItemId: 'item-1',
          resourceId: 'res-1',
          revenueRuleId: 'rule-default',
          grossAmountMinor: 50000n,
          contributorAmountMinor: 35000n,
          platformAmountMinor: 15000n,
          status: 'PENDING',
          // Exactly 7 days later
          maturesAt: new Date(completionTime.getTime() + 7 * 24 * 60 * 60 * 1000),
        }),
      );
    });
  });
});
