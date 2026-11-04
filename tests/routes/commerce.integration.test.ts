import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, closeDatabase } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';
import { enableTestCsrfAutoInject } from '../helpers/build-test-app.js';
import {
  products,
  orders,
  payments,
  entitlements,
  resources,
  countries,
  resourceTypes,
  users,
} from '../../src/db/schemas.js';
import { defaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { CommerceService } from '../../src/services/commerce/commerce.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('Commerce HTTP Route Integration Tests', () => {
  const db = getDb();
  const rbacService = new DefaultRbacService(db);
  let testCommerceService: CommerceService;
  let app: FastifyInstance;
  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let testProductId: string;
  let testOfferId: string;

  let userAToken: string;
  let userAId: string;
  let userBToken: string;
  let userBId: string;
  let adminToken: string;
  let adminId: string;

  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));
    await withDbRetry(() => seedRolesAndPermissions(db));

    testCommerceService = new CommerceService({
      db,
      allowSimulation: true,
    });

    app = enableTestCsrfAutoInject(
      buildApp({
        services: {
          commerceService: testCommerceService,
          rbacService,
        },
      }),
    );
    await app.ready();

    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    testResourceTypeId = rt.id;

    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testResourceTypeId,
          title: `Commerce Route Premium Resource ${Date.now()}`,
          slug: `comm-route-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    testResourceId = r.id;

    const prod = await testCommerceService.createProduct({
      name: 'Kenya Primary School Assessment Model Papers',
      productType: 'RESOURCE',
      resourceId: testResourceId,
    });
    testProductId = prod.id;
    createdProductIds.push(prod.id);

    const off = await testCommerceService.createOffer({
      productId: testProductId,
      priceMinor: 20000n, // KES 200.00
      commercialStatus: 'ACTIVE',
    });
    testOfferId = off.id;

    const regA = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-usera-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Commerce Route User A',
      }),
    );
    userAToken = regA.sessionToken;
    userAId = regA.user.id;

    const regB = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-userb-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Commerce Route User B',
      }),
    );
    userBToken = regB.sessionToken;
    userBId = regB.user.id;

    const regAdmin = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-admin-${Date.now()}@example.com`,
        password: 'AdminPassword123!',
        displayName: 'Commerce System Admin',
      }),
    );
    adminToken = regAdmin.sessionToken;
    adminId = regAdmin.user.id;
    await withDbRetry(() =>
      rbacService.assignRole({ userId: adminId, roleSlug: 'system_admin' }),
    );
  }, 180000);

  afterAll(async () => {
    for (const entId of createdEntitlementIds) {
      await withDbRetry(async () => {
        await db.delete(entitlements).where(eq(entitlements.id, entId));
      }).catch(() => {});
    }
    for (const ordId of createdOrderIds) {
      await withDbRetry(async () => {
        await db.delete(entitlements).where(eq(entitlements.sourceOrderId, ordId));
        await db.delete(payments).where(eq(payments.orderId, ordId));
        await db.delete(orders).where(eq(orders.id, ordId));
      }).catch(() => {});
    }
    for (const prodId of createdProductIds) {
      await withDbRetry(async () => {
        await db.delete(products).where(eq(products.id, prodId));
      }).catch(() => {});
    }
    if (testResourceId) {
      await withDbRetry(async () => {
        await db.delete(resources).where(eq(resources.id, testResourceId));
      }).catch(() => {});
    }
    for (const uid of [userAId, userBId, adminId]) {
      if (uid) {
        await withDbRetry(async () => {
          await db.delete(users).where(eq(users.id, uid));
        }).catch(() => {});
      }
    }
    await app.close();
    await closeDatabase();
  });

  const getCookieA = () => `${SESSION_COOKIE_NAME}=${userAToken}`;
  const getCookieB = () => `${SESSION_COOKIE_NAME}=${userBToken}`;
  const getAdminCookie = () => `${SESSION_COOKIE_NAME}=${adminToken}`;

  describe('1. Public Product Discovery', () => {
    it('GET /api/v1/products returns product catalog with active offers without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toBeInstanceOf(Array);
      const found = json.data.find((p: any) => p.id === testProductId);
      expect(found).toBeDefined();
      expect(found.activeOffers.length).toBeGreaterThanOrEqual(1);
      expect(found.activeOffers[0].priceMinor).toBe('20000');
    });

    it('GET /api/v1/products/:id returns specific product details with active offers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/products/${testProductId}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.id).toBe(testProductId);
      expect(json.data.activeOffers[0].id).toBe(testOfferId);
    });
  });

  describe('2. Unauthenticated Route Protection (401 UNAUTHENTICATED)', () => {
    it('rejects unauthenticated checkout requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout',
        payload: {
          items: [{ offerId: testOfferId, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects unauthenticated requests to orders and entitlements', async () => {
      const ordersRes = await app.inject({ method: 'GET', url: '/api/v1/me/orders' });
      expect(ordersRes.statusCode).toBe(401);

      const entRes = await app.inject({ method: 'GET', url: '/api/v1/me/entitlements' });
      expect(entRes.statusCode).toBe(401);
    });
  });

  describe('3. Authenticated Checkout, Payment & Admin-Guarded Simulation Flow', () => {
    let createdOrderId: string;
    let createdPaymentId: string;

    it('POST /api/v1/checkout creates order with server-calculated totals', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout',
        headers: { cookie: getCookieA() },
        payload: {
          items: [{ offerId: testOfferId, quantity: 2 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.id).toBeDefined();
      expect(json.data.currencyCode).toBe('KES');
      expect(json.data.totalMinor).toBe('40000');
      expect(json.data.status).toBe('PENDING');
      expect(json.data.items.length).toBe(1);
      expect(json.data.items[0].unitPriceMinor).toBe('20000');
      expect(json.data.items[0].totalMinor).toBe('40000');

      createdOrderId = json.data.id;
      createdOrderIds.push(createdOrderId);
    });

    it('GET /api/v1/orders/:id retrieves order and snapshot items for owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${createdOrderId}`,
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.id).toBe(createdOrderId);
      expect(json.data.totalMinor).toBe('40000');
    });

    it('GET /api/v1/me/orders lists orders for authenticated user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/orders',
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.some((o: any) => o.id === createdOrderId)).toBe(true);
    });

    it('POST /api/v1/payments initiates non-prod SIMULATION payment when explicitly enabled', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { cookie: getCookieA() },
        payload: {
          orderId: createdOrderId,
          providerCode: 'SIMULATION',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.payment.id).toBeDefined();
      expect(json.data.payment.amountMinor).toBe('40000');
      expect(json.data.payment.status).toBe('PENDING');
      expect(json.data.payment.providerReference).toBeNull();
      expect(json.data.order.status).toBe('PROCESSING');

      createdPaymentId = json.data.payment.id;
    });

    it('GET /api/v1/payments/:id returns redacted payment status for authorized owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/payments/${createdPaymentId}`,
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.id).toBe(createdPaymentId);
      expect(json.data.amountMinor).toBe('40000');
      expect(json.data.providerReference).toBeNull();
    });

    it('POST /api/v1/payments/:id/simulate-success rejects standard learner with 403 FORBIDDEN and requires system_admin (W1-AC-03)', async () => {
      const learnerAttempt = await app.inject({
        method: 'POST',
        url: `/api/v1/payments/${createdPaymentId}/simulate-success`,
        headers: { cookie: getCookieA() },
      });
      expect(learnerAttempt.statusCode).toBe(403);
      expect(learnerAttempt.json().error.code).toBe('FORBIDDEN');

      const adminRes = await app.inject({
        method: 'POST',
        url: `/api/v1/payments/${createdPaymentId}/simulate-success`,
        headers: { cookie: getAdminCookie() },
      });

      expect(adminRes.statusCode).toBe(200);
      const json = adminRes.json();
      expect(json.data.payment.status).toBe('COMPLETED');
      expect(json.data.order.status).toBe('COMPLETED');
      expect(json.data.entitlementsGranted).toBe(1);
    });

    it('GET /api/v1/me/entitlements exposes active entitlement for purchased resource', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/entitlements',
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      const ent = json.data.find((e: any) => e.resourceId === testResourceId);
      expect(ent).toBeDefined();
      expect(ent.status).toBe('ACTIVE');
    });
  });

  describe('4. Cross-User Isolation & Security Invariants', () => {
    it('prevents User B from accessing User A order (403 FORBIDDEN)', async () => {
      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout',
        headers: { cookie: getCookieA() },
        payload: {
          items: [{ offerId: testOfferId, quantity: 1 }],
        },
      });
      const orderAId = orderRes.json().data.id;
      createdOrderIds.push(orderAId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderAId}`,
        headers: { cookie: getCookieB() },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('UNAUTHORIZED_COMMERCE_ACCESS');
    });

    it('isolates entitlements: User B has no active entitlement for resource purchased by User A', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/entitlements',
        headers: { cookie: getCookieB() },
      });

      expect(res.statusCode).toBe(200);
      const userBEntitlements = res.json().data;
      const found = userBEntitlements.find((e: any) => e.resourceId === testResourceId);
      expect(found).toBeUndefined();
    });
  });
});
