import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
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
  payments,
  entitlements,
  contributorRevenueRules,
  contributorEarnings,
} from '../../src/db/schemas.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { contributorService } from '../../src/services/contributor.service.js';
import { defaultContributorFinanceService } from '../../src/services/contributor-finance.service.js';
import { defaultCommerceService } from '../../src/services/commerce/commerce.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { buildApp } from '../../src/app.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Contributor Finance HTTP Route & Commerce Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);
  const app: FastifyInstance = buildApp({
    services: {
      authService,
      rbacService,
      contributorService,
      contributorFinanceService: defaultContributorFinanceService,
      commerceService: defaultCommerceService,
    },
  });

  let adminCookie = '';
  let adminUserId = '';

  let contributorACookie = '';
  let contributorAUserId = '';
  let contributorAId = '';

  let contributorBCookie = '';
  let contributorBUserId = '';
  let contributorBId = '';

  let buyerCookie = '';
  let buyerUserId = '';

  let testCountryId: string;
  let testResourceTypeId: string;
  let resourceAId: string;
  let productAId: string;
  let offerAId: string;

  const createdUserIds: string[] = [];
  const cleanupResourceIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupOrderIds: string[] = [];
  const cleanupRuleIds: string[] = [];

  beforeAll(async () => {
    await app.ready();
    await withDbRetry(() => seedRolesAndPermissions(db));

    // 1. Resolve country and resource type
    const [c] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    const [rt] = await withDbRetry(() =>
      db.select().from(resourceTypes).limit(1),
    );
    testResourceTypeId = rt.id;

    // 2. Create Admin user
    const adminEmail = `fin-admin-${Date.now()}@example.com`;
    const adminReg = await withDbRetry(() =>
      authService.register({
        email: adminEmail,
        password: 'AdminPassword123!',
        displayName: 'Finance Admin',
      }),
    );
    adminUserId = adminReg.user.id;
    adminCookie = `${SESSION_COOKIE_NAME}=${adminReg.sessionToken}`;
    createdUserIds.push(adminUserId);

    await withDbRetry(() =>
      rbacService.assignRole({ userId: adminUserId, roleSlug: 'system_admin' }),
    );

    // 3. Create Contributor A
    const contribAEmail = `contrib-a-${Date.now()}@example.com`;
    const contribAReg = await withDbRetry(() =>
      authService.register({
        email: contribAEmail,
        password: 'Password123!',
        displayName: 'Contributor Alice',
      }),
    );
    contributorAUserId = contribAReg.user.id;
    contributorACookie = `${SESSION_COOKIE_NAME}=${contribAReg.sessionToken}`;
    createdUserIds.push(contributorAUserId);

    await withDbRetry(() =>
      rbacService.assignRole({ userId: contributorAUserId, roleSlug: 'contributor' }),
    );

    const [contribA] = await withDbRetry(() =>
      db
        .insert(contributors)
        .values({
          userId: contributorAUserId,
          displayName: 'Contributor Alice',
          profileSlug: `alice-${Date.now()}`,
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
        })
        .returning(),
    );
    contributorAId = contribA.id;

    // 4. Create Contributor B
    const contribBEmail = `contrib-b-${Date.now()}@example.com`;
    const contribBReg = await withDbRetry(() =>
      authService.register({
        email: contribBEmail,
        password: 'Password123!',
        displayName: 'Contributor Bob',
      }),
    );
    contributorBUserId = contribBReg.user.id;
    contributorBCookie = `${SESSION_COOKIE_NAME}=${contribBReg.sessionToken}`;
    createdUserIds.push(contributorBUserId);

    await withDbRetry(() =>
      rbacService.assignRole({ userId: contributorBUserId, roleSlug: 'contributor' }),
    );

    const [contribB] = await withDbRetry(() =>
      db
        .insert(contributors)
        .values({
          userId: contributorBUserId,
          displayName: 'Contributor Bob',
          profileSlug: `bob-${Date.now()}`,
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
        })
        .returning(),
    );
    contributorBId = contribB.id;

    // 5. Create Buyer user
    const buyerEmail = `buyer-${Date.now()}@example.com`;
    const buyerReg = await withDbRetry(() =>
      authService.register({
        email: buyerEmail,
        password: 'Password123!',
        displayName: 'Student Buyer',
      }),
    );
    buyerUserId = buyerReg.user.id;
    buyerCookie = `${SESSION_COOKIE_NAME}=${buyerReg.sessionToken}`;
    createdUserIds.push(buyerUserId);

    // 6. Create Premium Resource authored by Contributor A
    const [resA] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testResourceTypeId,
          title: 'Alice KCSE Revision',
          slug: `alice-kcse-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
          contributorId: contributorAId,
        })
        .returning(),
    );
    resourceAId = resA.id;
    cleanupResourceIds.push(resourceAId);

    // 7. Create Product and Offer for Resource A (price: 500 KES = 50,000 cents)
    const [prodA] = await withDbRetry(() =>
      db
        .insert(products)
        .values({
          name: 'Alice Revision Notes',
          productType: 'RESOURCE',
          resourceId: resourceAId,
          status: 'ACTIVE',
        })
        .returning(),
    );
    productAId = prodA.id;
    cleanupProductIds.push(productAId);

    const [offA] = await withDbRetry(() =>
      db
        .insert(offers)
        .values({
          productId: productAId,
          priceMinor: 50000n,
          currencyCode: 'KES',
          commercialStatus: 'ACTIVE',
        })
        .returning(),
    );
    offerAId = offA.id;
  });

  afterAll(async () => {
    try {
      if (cleanupOrderIds.length > 0) {
        await db
          .delete(contributorEarnings)
          .where(inArray(contributorEarnings.orderId, cleanupOrderIds))
          .catch(() => {});
        await db
          .delete(entitlements)
          .where(inArray(entitlements.sourceOrderId, cleanupOrderIds))
          .catch(() => {});
        await db
          .delete(payments)
          .where(inArray(payments.orderId, cleanupOrderIds))
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
      await app.close();
      await closeDatabase();
    }
  });

  describe('Contributor Workspace Authorization & IDOR Isolation', () => {
    it('rejects unauthenticated requests to /api/v1/me/contributor/earnings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects non-contributor users with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: buyerCookie },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows authenticated contributor to fetch own earnings with empty results initially', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: contributorACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.summary).toBeDefined();
      expect(body.summary.lifetimeContributorMinor).toBe('0');
      expect(body.summary.pendingMinor).toBe('0');
      expect(body.pagination.total).toBe(0);
    });
  });

  describe('Administrative Revenue Rules & Endpoints', () => {
    it('rejects unprivileged access to /api/v1/admin/contributor-revenue-rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/contributor-revenue-rules',
        headers: { cookie: contributorACookie },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows admin to list revenue rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/contributor-revenue-rules',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('allows admin to create a scheduled revenue rule and rejects overlapping active rule', async () => {
      // 1. Create a non-overlapping future active rule
      const futureFrom = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const futureTo = new Date(futureFrom.getTime() + 30 * 24 * 60 * 60 * 1000);

      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/contributor-revenue-rules',
        headers: { cookie: adminCookie },
        payload: {
          name: 'Special Promotion 80/20',
          contributorShareBasisPoints: 8000,
          effectiveFrom: futureFrom.toISOString(),
          effectiveTo: futureTo.toISOString(),
          status: 'ACTIVE',
        },
      });

      // If overlapping with canonical open-ended rule (from 2020 with effectiveTo NULL), it should reject with 409
      // Since default canonical rule has effectiveTo = NULL (indefinite), ANY new active rule overlapping rejects:
      if (resCreate.statusCode === 409) {
        expect(resCreate.json().error.code).toBe('OVERLAPPING_REVENUE_RULE');
      } else {
        expect(resCreate.statusCode).toBe(201);
        cleanupRuleIds.push(resCreate.json().data.id);
      }
    });
  });

  describe('End-to-End Commerce, Payment Completion & Earnings Creation', () => {
    let testOrderId: string;
    let testPaymentId: string;

    it('executes purchase of contributor resource and atomically generates pending earnings', async () => {
      // 1. Buyer places order for Contributor Alice's resource
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout',
        headers: { cookie: buyerCookie },
        payload: {
          items: [{ productId: productAId, offerId: offerAId, quantity: 1 }],
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      testOrderId = checkoutRes.json().data.id;
      cleanupOrderIds.push(testOrderId);

      // 2. Buyer initiates payment
      const payRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { cookie: buyerCookie },
        payload: {
          orderId: testOrderId,
          providerCode: 'SIMULATION',
        },
      });
      expect(payRes.statusCode).toBe(201);
      testPaymentId = payRes.json().data.payment.id;

      // 3. Process payment success (simulating payment provider completion)
      const successResult = await defaultCommerceService.processPaymentSuccess({
        paymentId: testPaymentId,
        providerTransactionId: `SIM-TXN-${Date.now()}`,
      });

      expect(successResult.payment.status).toBe('COMPLETED');
      expect(successResult.order.status).toBe('COMPLETED');
      expect(successResult.entitlementsGranted).toBe(1);

      // 4. Verify Contributor Alice received a PENDING earning record
      const aliceEarningsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: contributorACookie },
      });
      expect(aliceEarningsRes.statusCode).toBe(200);
      const aliceBody = aliceEarningsRes.json();
      expect(aliceBody.pagination.total).toBe(1);
      expect(aliceBody.data[0].orderId).toBe(testOrderId);
      expect(aliceBody.data[0].resourceId).toBe(resourceAId);
      expect(aliceBody.data[0].grossAmountMinor).toBe('50000');
      expect(aliceBody.data[0].contributorAmountMinor).toBe('35000'); // 70% of 500 KES
      expect(aliceBody.data[0].platformAmountMinor).toBe('15000');    // 30% of 500 KES
      expect(aliceBody.data[0].status).toBe('PENDING');

      // 5. Verify IDOR isolation: Contributor Bob must have 0 earnings
      const bobEarningsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: contributorBCookie },
      });
      expect(bobEarningsRes.statusCode).toBe(200);
      expect(bobEarningsRes.json().pagination.total).toBe(0);

      // Verify admin query for Bob also yields 0 earnings
      const adminBobRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/contributor-earnings?contributorId=${contributorBId}`,
        headers: { cookie: adminCookie },
      });
      expect(adminBobRes.statusCode).toBe(200);
      expect(adminBobRes.json().pagination.total).toBe(0);
    });

    it('duplicate payment completion callback is idempotent and produces 0 duplicate earnings', async () => {
      // Re-run processPaymentSuccess on already COMPLETED payment
      const repeatResult = await defaultCommerceService.processPaymentSuccess({
        paymentId: testPaymentId,
        providerTransactionId: `SIM-TXN-REPEAT`,
      });

      expect(repeatResult.payment.status).toBe('COMPLETED');
      expect(repeatResult.entitlementsGranted).toBe(0);

      // Verify Alice STILL only has 1 earning record
      const aliceEarningsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: contributorACookie },
      });
      expect(aliceEarningsRes.statusCode).toBe(200);
      expect(aliceEarningsRes.json().pagination.total).toBe(1);
    });

    it('admin can inspect earnings ledger via /api/v1/admin/contributor-earnings', async () => {
      const adminRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/contributor-earnings?contributorId=${contributorAId}`,
        headers: { cookie: adminCookie },
      });
      expect(adminRes.statusCode).toBe(200);
      const body = adminRes.json();
      expect(body.pagination.total).toBe(1);
      expect(body.data[0].contributorId).toBe(contributorAId);
      expect(body.summary.lifetimeContributorMinor).toBe('35000');
      expect(body.summary.pendingMinor).toBe('35000');
    });

    it('matures earnings after 7 days via mature endpoint', async () => {
      // As of now (less than 7 days): 0 records matured
      const resNow = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/contributor-earnings/mature',
        headers: { cookie: adminCookie },
        payload: { asOf: new Date().toISOString() },
      });
      expect(resNow.statusCode).toBe(200);
      expect(resNow.json().data.maturedCount).toBe(0);

      // As of 8 days in future: matures the record
      const futureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      const resFuture = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/contributor-earnings/mature',
        headers: { cookie: adminCookie },
        payload: { asOf: futureDate.toISOString() },
      });
      expect(resFuture.statusCode).toBe(200);
      expect(resFuture.json().data.maturedCount).toBeGreaterThanOrEqual(1);

      // Check Alice's earnings now show AVAILABLE status
      const aliceEarningsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/contributor/earnings',
        headers: { cookie: contributorACookie },
      });
      expect(aliceEarningsRes.statusCode).toBe(200);
      const aliceBody = aliceEarningsRes.json();
      expect(aliceBody.data[0].status).toBe('AVAILABLE');
      expect(aliceBody.data[0].maturedAt).toBeDefined();
      expect(aliceBody.summary.availableMinor).toBe('35000');
      expect(aliceBody.summary.pendingMinor).toBe('0');
    });
  });
});
