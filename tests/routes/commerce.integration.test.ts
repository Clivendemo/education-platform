import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, closeDatabase } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';
import {
  products,
  orders,
  entitlements,
  resources,
  countries,
  resourceTypes,
  users,
} from '../../src/db/schemas.js';
import { defaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { defaultCommerceService } from '../../src/services/commerce/commerce.service.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('Commerce HTTP Route Integration Tests', () => {
  const db = getDb();
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

  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));
    app = buildApp();
    await app.ready();

    // 1. Resolve country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    // 2. Resolve resource type
    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    testResourceTypeId = rt.id;

    // 3. Create test premium resource
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

    // 4. Create product & offer
    const prod = await defaultCommerceService.createProduct({
      name: 'Kenya Primary School Assessment Model Papers',
      productType: 'RESOURCE',
      resourceId: testResourceId,
    });
    testProductId = prod.id;
    createdProductIds.push(prod.id);

    const off = await defaultCommerceService.createOffer({
      productId: testProductId,
      priceMinor: 20000n, // KES 200.00
      commercialStatus: 'ACTIVE',
    });
    testOfferId = off.id;

    // 5. Register User A
    const regA = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-usera-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Commerce Route User A',
      }),
    );
    userAToken = regA.sessionToken;
    userAId = regA.user.id;

    // 6. Register User B
    const regB = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-userb-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Commerce Route User B',
      }),
    );
    userBToken = regB.sessionToken;
    userBId = regB.user.id;
  }, 120000);

  afterAll(async () => {
    for (const entId of createdEntitlementIds) {
      await withDbRetry(async () => {
        await db.delete(entitlements).where(eq(entitlements.id, entId));
      }).catch(() => {});
    }
    for (const ordId of createdOrderIds) {
      await withDbRetry(async () => {
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
    if (userAId) {
      await withDbRetry(async () => {
        await db.delete(users).where(eq(users.id, userAId));
      }).catch(() => {});
    }
    if (userBId) {
      await withDbRetry(async () => {
        await db.delete(users).where(eq(users.id, userBId));
      }).catch(() => {});
    }
    await app.close();
    await closeDatabase();
  });

  const getCookieA = () => `${SESSION_COOKIE_NAME}=${userAToken}`;
  const getCookieB = () => `${SESSION_COOKIE_NAME}=${userBToken}`;

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

  describe('3. Authenticated Checkout, Payment & Entitlement Flow', () => {
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
      expect(json.data.totalMinor).toBe('40000'); // 2 * 20000
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

    it('POST /api/v1/payments initiates payment and transitions order to PROCESSING', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { cookie: getCookieA() },
        payload: {
          orderId: createdOrderId,
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.data.payment.id).toBeDefined();
      expect(json.data.payment.amountMinor).toBe('40000');
      expect(json.data.payment.status).toBe('PENDING');
      expect(json.data.order.status).toBe('PROCESSING');

      createdPaymentId = json.data.payment.id;
    });

    it('GET /api/v1/payments/:id returns payment status for authorized owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/payments/${createdPaymentId}`,
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.id).toBe(createdPaymentId);
      expect(json.data.amountMinor).toBe('40000');
    });

    it('POST /api/v1/payments/:id/simulate-success completes payment and provisions entitlement (Correction 8)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/payments/${createdPaymentId}/simulate-success`,
        headers: { cookie: getCookieA() },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
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
      // User A creates order
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

      // User B attempts to access User A's order
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
