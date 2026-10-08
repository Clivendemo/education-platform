import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, closeDatabase } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';
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
import { CommerceService } from '../../src/services/commerce/commerce.service.js';
import { MpesaPaymentProvider } from '../../src/services/commerce/mpesa/mpesa-payment-provider.js';
import { DarajaClient } from '../../src/services/commerce/mpesa/daraja-client.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('Commerce HTTP Route M-Pesa Integration Tests', () => {
  const db = getDb();
  let app: FastifyInstance;
  let testCommerceService: CommerceService;
  let mockDarajaClient: DarajaClient;

  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let testOfferId: string;

  let userAToken: string;
  let userAId: string;

  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));

    mockDarajaClient = {
      initiateStkPush: vi.fn().mockImplementation(async (_params: any) => ({
        MerchantRequestID: `MERCHANT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        CheckoutRequestID: `ws_CO_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'Success. Request accepted for processing',
      })),
      getAccessToken: vi.fn().mockResolvedValue('test_token'),
    } as unknown as DarajaClient;

    const mpesaProvider = new MpesaPaymentProvider({
      darajaClient: mockDarajaClient,
    });

    testCommerceService = new CommerceService({
      db,
      paymentProviders: {
        MPESA: mpesaProvider,
      },
    });

    app = buildApp({
      services: {
        commerceService: testCommerceService,
      },
    });
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
          title: `Route M-Pesa Premium Resource ${Date.now()}`,
          slug: `route-mpesa-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    testResourceId = r.id;

    // 4. Create product & offer
    const prod = await testCommerceService.createProduct({
      name: 'Kenya Primary Assessment M-Pesa Revision Kit',
      productType: 'RESOURCE',
      resourceId: testResourceId,
    });
    createdProductIds.push(prod.id);

    const off = await testCommerceService.createOffer({
      productId: prod.id,
      priceMinor: 25000n, // KES 250.00
      commercialStatus: 'ACTIVE',
    });
    testOfferId = off.id;

    // 5. Create user
    const regA = await withDbRetry(async () =>
      defaultAuthService.register({
        email: `comm-route-mpesa-${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Mpesa Route User',
      }),
    );
    userAId = regA.user.id;
    userAToken = regA.sessionToken;
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    for (const entId of createdEntitlementIds) {
      await withDbRetry(async () => {
        await db.delete(entitlements).where(eq(entitlements.id, entId));
      }).catch(() => {});
    }
    for (const ordId of createdOrderIds) {
      await withDbRetry(async () => {
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
    if (userAId) {
      await withDbRetry(async () => {
        await db.delete(users).where(eq(users.id, userAId));
      }).catch(() => {});
    }
    await closeDatabase();
  });

  describe('1. POST /api/v1/payments (M-Pesa STK Push Initiation)', () => {
    it('initiates M-Pesa STK push for valid order and normalized phone number', async () => {
      // Create order
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${userAToken}` },
        payload: {
          items: [{ offerId: testOfferId, quantity: 1 }],
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const order = checkoutRes.json().data;
      createdOrderIds.push(order.id);

      // Initiate M-Pesa payment
      const payRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${userAToken}` },
        payload: {
          orderId: order.id,
          providerCode: 'MPESA',
          phoneNumber: '0712345678',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const payData = payRes.json().data;
      expect(payData.payment.providerCode).toBe('MPESA');
      expect(payData.payment.status).toBe('PENDING');
      expect(payData.payment.amountMinor).toBe('25000');
      expect(payData.payment.providerReference).toMatch(/^ws_CO_/);
      expect(payData.order.status).toBe('PROCESSING');
    });

    it('rejects invalid Kenyan phone number with 400 MPESA_PHONE_INVALID', async () => {
      const order = await testCommerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const payRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${userAToken}` },
        payload: {
          orderId: order.id,
          providerCode: 'MPESA',
          phoneNumber: '0201234567', // landline
        },
      });

      expect(payRes.statusCode).toBe(400);
      const body = payRes.json();
      expect(body.error.code).toBe('MPESA_PHONE_INVALID');
    });
  });

  describe('2. POST /api/v1/payments/mpesa/callback (Daraja Callback Endpoint)', () => {
    it('processes successful callback without session cookie and provisions user entitlement', async () => {
      const order = await testCommerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await testCommerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      const checkoutRequestId = initResult.payment.providerReference!;
      const mpesaReceipt = `NLJROUTE${Date.now().toString().slice(-6)}`;

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 250.0 }, // Exact KES 250.00
                { Name: 'MpesaReceiptNumber', Value: mpesaReceipt },
                { Name: 'TransactionDate', Value: 20261008123000 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          },
        },
      };

      // Unauthenticated POST (no cookie)
      const callbackRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/mpesa/callback',
        payload: callbackPayload,
      });

      expect(callbackRes.statusCode).toBe(200);
      expect(callbackRes.json()).toEqual({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });

      // Verify user now has active entitlement via GET /api/v1/me/entitlements
      const entRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/entitlements',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${userAToken}` },
      });

      expect(entRes.statusCode).toBe(200);
      const entitlementsList = entRes.json().data;
      const matchingEnt = entitlementsList.find(
        (e: any) => e.resourceId === testResourceId && e.status === 'ACTIVE',
      );
      expect(matchingEnt).toBeDefined();
      createdEntitlementIds.push(matchingEnt.id);
    });

    it('rejects malformed callback payload with 400 INVALID_CALLBACK_PAYLOAD', async () => {
      const badRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/mpesa/callback',
        payload: {
          invalid: 'payload without Body.stkCallback',
        },
      });

      expect(badRes.statusCode).toBe(400);
      expect(badRes.json().error.code).toBe('INVALID_CALLBACK_PAYLOAD');
    });

    it('supports alternative endpoint alias POST /api/v1/mpesa/callback', async () => {
      const unknownPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_UNKNOWN_ALIAS_TEST',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [{ Name: 'Amount', Value: 250.0 }],
            },
          },
        },
      };

      const aliasRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mpesa/callback',
        payload: unknownPayload,
      });

      expect(aliasRes.statusCode).toBe(200);
      expect(aliasRes.json()).toEqual({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });
    });
  });
});
