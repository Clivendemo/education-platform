import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  contributors,
  orders,
  orderItems,
  products,
  offers,
  contributorRevenueRules,
  contributorEarnings,
} from '../../src/db/schemas.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Contributor Finance Database & Schema Integration Tests', () => {
  let testUserId: string;
  let testContributorId: string;
  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let testProductId: string;
  let testOfferId: string;
  let testOrderId: string;
  let testOrderItemId: string;
  let testRevenueRuleId: string;

  const createdUserIds: string[] = [];
  const cleanupResourceIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupOrderIds: string[] = [];
  const cleanupRuleIds: string[] = [];

  beforeAll(async () => {
    // 1. Ensure test user
    const [testUser] = await withDbRetry(() =>
      db
        .insert(users)
        .values({
          email: `contrib-fin-db-${Date.now()}@example.com`,
          displayName: 'Finance DB User',
          status: 'ACTIVE',
        })
        .returning(),
    );
    testUserId = testUser.id;
    createdUserIds.push(testUserId);

    // 2. Ensure test contributor
    const [testContrib] = await withDbRetry(() =>
      db
        .insert(contributors)
        .values({
          userId: testUserId,
          displayName: 'Finance DB Contributor',
          profileSlug: `fin-contrib-db-${Date.now()}`,
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
        })
        .returning(),
    );
    testContributorId = testContrib.id;

    // 3. Resolve country & resource type
    const [c] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    const [rt] = await withDbRetry(() =>
      db.select().from(resourceTypes).limit(1),
    );
    testResourceTypeId = rt.id;

    // 4. Create resource owned by contributor
    const [res] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testResourceTypeId,
          title: 'Finance Test Resource',
          slug: `fin-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
          contributorId: testContributorId,
        })
        .returning(),
    );
    testResourceId = res.id;
    cleanupResourceIds.push(testResourceId);

    // 5. Create product and offer
    const [prod] = await withDbRetry(() =>
      db
        .insert(products)
        .values({
          name: 'Finance Test Product',
          productType: 'RESOURCE',
          resourceId: testResourceId,
          status: 'ACTIVE',
        })
        .returning(),
    );
    testProductId = prod.id;
    cleanupProductIds.push(testProductId);

    const [off] = await withDbRetry(() =>
      db
        .insert(offers)
        .values({
          productId: testProductId,
          priceMinor: 50000n,
          currencyCode: 'KES',
          commercialStatus: 'ACTIVE',
        })
        .returning(),
    );
    testOfferId = off.id;

    // 6. Create order and order item
    const [ord] = await withDbRetry(() =>
      db
        .insert(orders)
        .values({
          userId: testUserId,
          currencyCode: 'KES',
          totalMinor: 50000n,
          status: 'COMPLETED',
        })
        .returning(),
    );
    testOrderId = ord.id;
    cleanupOrderIds.push(testOrderId);

    const [oi] = await withDbRetry(() =>
      db
        .insert(orderItems)
        .values({
          orderId: testOrderId,
          productId: testProductId,
          offerId: testOfferId,
          quantity: 1,
          unitPriceMinor: 50000n,
          totalMinor: 50000n,
        })
        .returning(),
    );
    testOrderItemId = oi.id;

    // 7. Ensure canonical revenue rule
    const [rule] = await withDbRetry(() =>
      db
        .insert(contributorRevenueRules)
        .values({
          name: `Finance DB Test Rule ${Date.now()}`,
          contributorShareBasisPoints: 7000,
          percentage: '70.0000',
          currencyCode: 'KES',
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          status: 'ACTIVE',
        })
        .returning(),
    );
    testRevenueRuleId = rule.id;
    cleanupRuleIds.push(testRevenueRuleId);
  });

  afterAll(async () => {
    try {
      if (cleanupOrderIds.length > 0) {
        // Delete earnings first so orderItems / orders can be cleaned up
        await db
          .delete(contributorEarnings)
          .where(inArray(contributorEarnings.orderId, cleanupOrderIds))
          .catch(() => {});
        await db
          .delete(orderItems)
          .where(inArray(orderItems.orderId, cleanupOrderIds))
          .catch(() => {});
        await db
          .delete(orders)
          .where(inArray(orders.id, cleanupOrderIds))
          .catch(() => {});
      }
      if (cleanupProductIds.length > 0) {
        await db
          .delete(offers)
          .where(inArray(offers.productId, cleanupProductIds))
          .catch(() => {});
        await db
          .delete(products)
          .where(inArray(products.id, cleanupProductIds))
          .catch(() => {});
      }
      if (cleanupResourceIds.length > 0) {
        await db
          .delete(resources)
          .where(inArray(resources.id, cleanupResourceIds))
          .catch(() => {});
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(contributors)
          .where(inArray(contributors.userId, createdUserIds))
          .catch(() => {});
        await db
          .delete(users)
          .where(inArray(users.id, createdUserIds))
          .catch(() => {});
      }
      if (cleanupRuleIds.length > 0) {
        await db
          .delete(contributorRevenueRules)
          .where(inArray(contributorRevenueRules.id, cleanupRuleIds))
          .catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  });

  async function expectDbError(
    operation: Promise<any> | (() => Promise<any>),
    pattern?: RegExp,
  ) {
    try {
      if (typeof operation === 'function') {
        await operation();
      } else {
        await operation;
      }
      expect.unreachable('Expected database operation to fail but it succeeded');
    } catch (err: any) {
      const fullMessage = `${err.message || ''} ${err.cause?.message || ''} ${err.cause?.detail || ''} ${err.cause?.code || ''} ${err.code || ''}`;
      if (pattern) {
        expect(fullMessage).toMatch(pattern);
      }
    }
  }

  describe('Database Schema Constraints', () => {
    it('enforces non-negative amounts check constraint', async () => {
      await expectDbError(
        () =>
          db.insert(contributorEarnings).values({
            contributorId: testContributorId,
            orderId: testOrderId,
            orderItemId: testOrderItemId,
            resourceId: testResourceId,
            revenueRuleId: testRevenueRuleId,
            grossAmountMinor: -50000n,
            platformAmountMinor: 15000n,
            contributorAmountMinor: 35000n,
            currencyCode: 'KES',
            status: 'PENDING',
            maturesAt: new Date(),
          }),
        /chk_earnings_amounts_positive/,
      );
    });

    it('enforces exact zero-sum allocation (gross = platform + contributor)', async () => {
      await expectDbError(
        () =>
          db.insert(contributorEarnings).values({
            contributorId: testContributorId,
            orderId: testOrderId,
            orderItemId: testOrderItemId,
            resourceId: testResourceId,
            revenueRuleId: testRevenueRuleId,
            grossAmountMinor: 50000n,
            platformAmountMinor: 15000n,
            contributorAmountMinor: 30000n, // Unbalanced: 15,000 + 30,000 = 45,000 != 50,000
            currencyCode: 'KES',
            status: 'PENDING',
            maturesAt: new Date(),
          }),
        /chk_earnings_zero_sum/,
      );
    });

    it('enforces KES currency constraint', async () => {
      await expectDbError(
        () =>
          db.insert(contributorEarnings).values({
            contributorId: testContributorId,
            orderId: testOrderId,
            orderItemId: testOrderItemId,
            resourceId: testResourceId,
            revenueRuleId: testRevenueRuleId,
            grossAmountMinor: 50000n,
            platformAmountMinor: 15000n,
            contributorAmountMinor: 35000n,
            currencyCode: 'USD',
            status: 'PENDING',
            maturesAt: new Date(),
          }),
        /chk_earnings_currency/,
      );
    });

    it('enforces unique (order_item_id, contributor_id) constraint', async () => {
      const now = new Date();
      // 1. Insert first valid earning
      const [earning] = await db
        .insert(contributorEarnings)
        .values({
          contributorId: testContributorId,
          orderId: testOrderId,
          orderItemId: testOrderItemId,
          resourceId: testResourceId,
          revenueRuleId: testRevenueRuleId,
          grossAmountMinor: 50000n,
          platformAmountMinor: 15000n,
          contributorAmountMinor: 35000n,
          currencyCode: 'KES',
          status: 'PENDING',
          maturesAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning();

      expect(earning.id).toBeDefined();

      // 2. Duplicate insertion for same order item & contributor must fail
      await expectDbError(
        () =>
          db.insert(contributorEarnings).values({
            contributorId: testContributorId,
            orderId: testOrderId,
            orderItemId: testOrderItemId,
            resourceId: testResourceId,
            revenueRuleId: testRevenueRuleId,
            grossAmountMinor: 50000n,
            platformAmountMinor: 15000n,
            contributorAmountMinor: 35000n,
            currencyCode: 'KES',
            status: 'PENDING',
            maturesAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          }),
        /uq_earnings_order_item_contributor/,
      );
    });
  });

  describe('PostgreSQL Trigger Append-Only Protections', () => {
    it('blocks direct DELETE on contributor_earnings records', async () => {
      const [earning] = await db
        .select()
        .from(contributorEarnings)
        .where(eq(contributorEarnings.orderItemId, testOrderItemId))
        .limit(1);

      expect(earning).toBeDefined();

      await expectDbError(
        () => db.delete(contributorEarnings).where(eq(contributorEarnings.id, earning.id)),
        /append-only ledger: deletions are strictly forbidden/,
      );
    });

    it('blocks UPDATE tampering with financial facts (gross, platform, contributor amounts)', async () => {
      const [earning] = await db
        .select()
        .from(contributorEarnings)
        .where(eq(contributorEarnings.orderItemId, testOrderItemId))
        .limit(1);

      await expectDbError(
        () =>
          db
            .update(contributorEarnings)
            .set({
              contributorAmountMinor: 40000n,
            })
            .where(eq(contributorEarnings.id, earning.id)),
        /Financial facts in community.contributor_earnings are immutable/,
      );
    });

    it('blocks invalid status transitions (e.g. from PENDING directly to PAID)', async () => {
      const [earning] = await db
        .select()
        .from(contributorEarnings)
        .where(eq(contributorEarnings.orderItemId, testOrderItemId))
        .limit(1);

      await expectDbError(
        () =>
          db
            .update(contributorEarnings)
            .set({
              status: 'PAID',
            })
            .where(eq(contributorEarnings.id, earning.id)),
        /Invalid status transition/,
      );
    });

    it('permits valid maturity status transition (PENDING -> AVAILABLE)', async () => {
      const [earning] = await db
        .select()
        .from(contributorEarnings)
        .where(eq(contributorEarnings.orderItemId, testOrderItemId))
        .limit(1);

      const maturedAt = new Date();
      const [updated] = await db
        .update(contributorEarnings)
        .set({
          status: 'AVAILABLE',
          maturedAt,
          updatedAt: maturedAt,
        })
        .where(eq(contributorEarnings.id, earning.id))
        .returning();

      expect(updated.status).toBe('AVAILABLE');
      expect(updated.maturedAt).toBeDefined();
    });
  });
});
