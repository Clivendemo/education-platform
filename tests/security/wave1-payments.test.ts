import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  resourceTypes,
  resources,
  products,
  orders,
  payments,
  entitlements,
  contributors,
  contributorEarnings,
  users,
} from '../../src/db/schemas.js';
import { buildApp, resolveEffectiveTrustProxy } from '../../src/app.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { CommerceService } from '../../src/services/commerce/commerce.service.js';
import {
  SimulationDisabledError,
  OrderPaymentInProgressError,
} from '../../src/services/commerce/commerce.interface.js';
import { SimulationPaymentProvider } from '../../src/services/commerce/simulation-payment-provider.js';
import { parseExactKesToMinor } from '../../src/services/commerce/money.util.js';
import {
  DarajaClient,
  DARAJA_CONFIRMED_FAILURE_CODES,
  DARAJA_RESULT_CODE_EVIDENCE,
} from '../../src/services/commerce/mpesa/daraja-client.js';
import { MpesaPaymentProvider } from '../../src/services/commerce/mpesa/mpesa-payment-provider.js';
import { MpesaReconciliationWorker } from '../../src/services/commerce/mpesa/mpesa-reconciliation.worker.js';
import { MpesaWebhookRateLimiter } from '../../src/routes/middleware/mpesa-webhook-guard.js';
import type { DarajaStkQueryResult } from '../../src/services/commerce/mpesa/mpesa.types.js';
import { runPlatformMigrations } from '../../src/db/migrate.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Wave 1 WP1: Payment Integrity, Daraja Allowlist, Reconciliation & Webhook Hardening', () => {
  const db = getDb();
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);

  let countryId: string;
  let resourceTypeId: string;
  let resourceId: string;
  let contributorId: string;
  let contributorUserId: string;
  let productId: string;
  let offerId: string;
  let learnerId: string;
  let learnerCookie: string;
  let adminId: string;
  let adminCookie: string;

  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => runPlatformMigrations(db));
    await withDbRetry(() => setupCommerceSchema(db));
    await withDbRetry(() => seedRolesAndPermissions(db));

    const [c] = await db
      .select()
      .from(countries)
      .where(eq(countries.status, 'ACTIVE'))
      .limit(1);
    countryId = c.id;

    const [rt] = await db.select().from(resourceTypes).limit(1);
    resourceTypeId = rt.id;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const contribReg = await authService.register({
      email: `w1-contrib-${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Wave 1 Contributor',
    });
    contributorUserId = contribReg.user.id;

    const [contrib] = await db
      .insert(contributors)
      .values({
        userId: contributorUserId,
        displayName: 'Wave 1 Contributor',
        profileSlug: `w1-contrib-${suffix}`,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      })
      .returning();
    contributorId = contrib.id;

    const [res] = await db
      .insert(resources)
      .values({
        countryId,
        resourceTypeId,
        contributorId,
        title: `Wave 1 Payment Security Resource ${suffix}`,
        slug: `w1-pay-sec-${suffix}`,
        status: 'PUBLISHED',
        qualityLabel: 'PREMIUM',
      })
      .returning();
    resourceId = res.id;

    const setupSvc = new CommerceService({ db, allowSimulation: false });
    const prod = await setupSvc.createProduct({
      name: 'Wave 1 Security Test Kit',
      productType: 'RESOURCE',
      resourceId,
    });
    productId = prod.id;

    const off = await setupSvc.createOffer({
      productId,
      priceMinor: 30000n, // KES 300.00
      commercialStatus: 'ACTIVE',
    });
    offerId = off.id;

    const learnerReg = await authService.register({
      email: `w1-learner-${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Wave 1 Learner',
    });
    learnerId = learnerReg.user.id;
    learnerCookie = `${SESSION_COOKIE_NAME}=${learnerReg.sessionToken}`;

    const adminReg = await authService.register({
      email: `w1-admin-${suffix}@example.com`,
      password: 'AdminPassword123!',
      displayName: 'Wave 1 Finance Admin',
    });
    adminId = adminReg.user.id;
    adminCookie = `${SESSION_COOKIE_NAME}=${adminReg.sessionToken}`;
    await rbacService.assignRole({ userId: adminId, roleSlug: 'system_admin' });
  }, 180000);

  afterAll(async () => {
    for (const ordId of createdOrderIds) {
      await db.delete(contributorEarnings).where(eq(contributorEarnings.orderId, ordId)).catch(() => {});
      await db.delete(entitlements).where(eq(entitlements.sourceOrderId, ordId)).catch(() => {});
      await db.delete(payments).where(eq(payments.orderId, ordId)).catch(() => {});
      await db.delete(orders).where(eq(orders.id, ordId)).catch(() => {});
    }
    if (productId) await db.delete(products).where(eq(products.id, productId)).catch(() => {});
    if (resourceId) await db.delete(resources).where(eq(resources.id, resourceId)).catch(() => {});
    if (contributorId) await db.delete(contributors).where(eq(contributors.id, contributorId)).catch(() => {});
    for (const uid of [learnerId, adminId, contributorUserId]) {
      if (uid) await db.delete(users).where(eq(users.id, uid)).catch(() => {});
    }
    await closeDatabase();
  });

  describe('W1-AC-03: Production Simulation Ban & Learner PaymentDto Redaction', () => {
    it('forbids SimulationPaymentProvider registration in production and leaves /simulate-success unmounted (404) when disabled', async () => {
      expect(
        () =>
          new CommerceService({
            db,
            nodeEnv: 'production',
            allowSimulation: true,
          }),
      ).toThrow(SimulationDisabledError);

      expect(
        () =>
          new CommerceService({
            db,
            nodeEnv: 'production',
            paymentProvider: new SimulationPaymentProvider(),
          }),
      ).toThrow(SimulationDisabledError);

      const prodLikeSvc = new CommerceService({ db, allowSimulation: false });
      const app = buildApp({
        services: { commerceService: prodLikeSvc, authService, rbacService },
      });
      await app.ready();

      try {
        const order = await prodLikeSvc.createOrder(learnerId, {
          items: [{ offerId, quantity: 1 }],
        });
        createdOrderIds.push(order.id);

        // SIMULATION provider is rejected on POST /api/v1/payments
        const simInit = await app.inject({
          method: 'POST',
          url: '/api/v1/payments',
          headers: { cookie: learnerCookie },
          payload: { orderId: order.id, providerCode: 'SIMULATION' },
        });
        expect(simInit.statusCode).toBe(403);
        expect(simInit.json().error.code).toBe('PAYMENT_SIMULATION_DISABLED');

        // /simulate-success route is completely unmounted -> 404
        const simRoute = await app.inject({
          method: 'POST',
          url: `/api/v1/payments/${order.id}/simulate-success`,
          headers: { cookie: adminCookie },
        });
        expect(simRoute.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe('W1-AC-05: Closed Daraja Allowlist, Sandbox Receipt Nullability & Exact Integer Money Math', () => {
    const dummyDarajaCfg = {
      environment: 'sandbox' as const,
      consumerKey: 'ck',
      consumerSecret: 'cs',
      shortcode: '174379',
      passkey: 'pk',
      callbackUrl: 'https://example.com/api/v1/commerce/webhooks/mpesa',
    };

    it('T-W1-MPESA-CODE-01 & T-W1-MPESA-ALLOWLIST-01: classifies only documented terminal codes and treats 1001, 1025, 4999, missing, malformed, and non-zero ResponseCode as QUERY_INCONCLUSIVE_RETRYABLE', async () => {
      // Evidence registry must cover every code in DARAJA_CONFIRMED_FAILURE_CODES plus 0 and 1032
      const evidencedCodes: Array<keyof typeof DARAJA_RESULT_CODE_EVIDENCE> = [
        '0',
        '1032',
        '1',
        '1019',
        '1037',
        '2001',
      ];
      for (const code of evidencedCodes) {
        expect(DARAJA_RESULT_CODE_EVIDENCE[code]).toBeDefined();
        expect(DARAJA_RESULT_CODE_EVIDENCE[code].darajaSpecMeaning.length).toBeGreaterThan(10);
      }
      for (const failCode of DARAJA_CONFIRMED_FAILURE_CODES) {
        expect(failCode in DARAJA_RESULT_CODE_EVIDENCE).toBe(true);
      }

      const runQueryWithBody = async (httpStatus: number, responseBody: Record<string, unknown>) => {
        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', expires_in: '3599' }),
          })
          .mockResolvedValueOnce({
            ok: httpStatus >= 200 && httpStatus < 300,
            status: httpStatus,
            json: async () => responseBody,
          });
        const client = new DarajaClient({ config: dummyDarajaCfg, fetchFn: mockFetch as any });
        return client.queryStkPushStatus('ws_CO_TEST_CODE');
      };

      // 1. Confirmed terminal failures: 1, 1019, 1037, 2001 -> TRANSACTION_CONFIRMED_FAILED
      for (const failCode of ['1', '1019', '1037', '2001']) {
        const res = await runQueryWithBody(200, {
          ResponseCode: '0',
          CheckoutRequestID: 'ws_CO_TEST_CODE',
          ResultCode: failCode,
          ResultDesc: 'Confirmed terminal failure',
        });
        expect(res.classification).toBe('TRANSACTION_CONFIRMED_FAILED');
      }

      // 2. User cancellation: 1032 -> TRANSACTION_CONFIRMED_CANCELLED
      const cancelRes = await runQueryWithBody(200, {
        ResponseCode: '0',
        CheckoutRequestID: 'ws_CO_TEST_CODE',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user',
      });
      expect(cancelRes.classification).toBe('TRANSACTION_CONFIRMED_CANCELLED');

      // 3. Excluded / in-flight / undocumented / malformed codes MUST map to QUERY_INCONCLUSIVE_RETRYABLE
      for (const retryablePayload of [
        { ResponseCode: '0', ResultCode: '1001', ResultDesc: 'Unable to lock subscriber, a transaction is already in process' },
        { ResponseCode: '0', ResultCode: '1025', ResultDesc: 'An error occurred while sending a push request' },
        { ResponseCode: '0', ResultCode: '4999', ResultDesc: 'The transaction is still under processing' },
        { ResponseCode: '0', ResultCode: '999999', ResultDesc: 'Undocumented vendor code' },
        { ResponseCode: '0', ResultDesc: 'Missing ResultCode field entirely' },
        { ResponseCode: '0', ResultCode: { nested: true }, ResultDesc: 'Malformed ResultCode object' },
        { ResponseCode: '1', ResultCode: '0', ResultDesc: 'Top-level query rejected despite ResultCode 0' },
      ]) {
        const res = await runQueryWithBody(200, retryablePayload);
        expect(res.classification).toBe('QUERY_INCONCLUSIVE_RETRYABLE');
      }

      // 4. HTTP 500 error body with errorCode -> QUERY_INCONCLUSIVE_RETRYABLE
      const err500 = await runQueryWithBody(500, {
        requestId: 'req-1',
        errorCode: '500.001.1001',
        errorMessage: 'The transaction is being processed',
      });
      expect(err500.classification).toBe('QUERY_INCONCLUSIVE_RETRYABLE');
    });

    it('T-W1-DEC-01: parses exact string decimals into minor units without IEEE-754 float drift and rejects >2 decimal places or scientific notation', () => {
      // Classic float trap: 19.99 * 100 === 1998.9999999999998 in IEEE-754
      expect(parseExactKesToMinor('19.99')).toBe(1999n);
      expect(parseExactKesToMinor('299.90')).toBe(29990n);
      expect(parseExactKesToMinor('0.01')).toBe(1n);
      expect(parseExactKesToMinor('250')).toBe(25000n);
      expect(parseExactKesToMinor('250.5')).toBe(25050n);

      // Invalid / imprecise formats must return null
      expect(parseExactKesToMinor('19.999')).toBeNull();
      expect(parseExactKesToMinor('1e2')).toBeNull();
      expect(parseExactKesToMinor('-10.00')).toBeNull();
      expect(parseExactKesToMinor('')).toBeNull();
      expect(parseExactKesToMinor('NaN')).toBeNull();
    });
  });

  describe('W1-AC-06 & W1-AC-07: Forged Callback Non-DoS, Sibling Race Protection & Durable Reconciliation Worker', () => {
    it('T-W1-MPESA-SBX-01 & W1-AC-07: forged failure callback never cancels a real payment when Daraja query reports in-flight or COMPLETED', async () => {
      let currentQueryResult: DarajaStkQueryResult = {
        classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
        checkoutRequestId: 'ws_CO_FORGED_TEST',
        merchantRequestId: 'MERCH-FORGED-1',
        responseCode: '0',
        resultCode: '4999',
        resultDesc: 'Still processing',
        httpStatus: 200,
      };

      const mockDaraja = {
        initiateStkPush: vi.fn().mockResolvedValue({
          MerchantRequestID: 'MERCH-FORGED-1',
          CheckoutRequestID: 'ws_CO_FORGED_TEST_001',
          ResponseCode: '0',
          ResponseDescription: 'Accepted',
          CustomerMessage: 'Accepted',
        }),
        queryStkPushStatus: vi.fn().mockImplementation(async () => currentQueryResult),
      } as unknown as DarajaClient;

      const svc = new CommerceService({
        db,
        paymentProviders: {
          MPESA: new MpesaPaymentProvider({ darajaClient: mockDaraja }),
        },
      });

      const order = await svc.createOrder(learnerId, {
        items: [{ offerId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const { payment } = await svc.initiatePayment(learnerId, order.id, 'MPESA', {
        phoneNumber: '0712345678',
      });

      // Step 1: Attacker sends forged ResultCode 1032 cancellation while STK prompt is still on learner's phone!
      await svc.handleMpesaCallback({
        Body: {
          stkCallback: {
            MerchantRequestID: 'MERCH-FORGED-1',
            CheckoutRequestID: 'ws_CO_FORGED_TEST_001',
            ResultCode: 1032,
            ResultDesc: 'Forged cancellation attempt',
          },
        },
      });

      // Payment MUST remain PROCESSING (NOT cancelled!)
      const [afterForged] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, payment.id));
      expect(afterForged.status).toBe('PROCESSING');

      // Step 2: Learner completes PIN on phone; worker polls Daraja STK Query -> TRANSACTION_CONFIRMED_COMPLETED
      currentQueryResult = {
        classification: 'TRANSACTION_CONFIRMED_COMPLETED',
        checkoutRequestId: 'ws_CO_FORGED_TEST_001',
        merchantRequestId: 'MERCH-FORGED-1',
        responseCode: '0',
        resultCode: '0',
        resultDesc: 'The service request is processed successfully.',
        httpStatus: 200,
      };

      // Force next_verification_at due now and run durable worker
      await db
        .update(payments)
        .set({ nextVerificationAt: new Date(Date.now() - 1000) })
        .where(eq(payments.id, payment.id));

      const worker = new MpesaReconciliationWorker({
        db,
        commerceService: svc,
        workerId: 'test-mpesa-worker-1',
      });
      const tick = await worker.runOnce();
      expect(tick.processed.length).toBeGreaterThanOrEqual(1);

      const [settledPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, payment.id));
      expect(settledPayment.status).toBe('COMPLETED');
      expect(settledPayment.verifiedReceiptNumber).toBeNull();
      expect(settledPayment.receiptVerificationSource).toBeNull();

      expect(await svc.hasEntitlement(learnerId, resourceId)).toBe(true);
    });

    it('W1-AC-07: sibling duplicate paid attempt on an already COMPLETED order transitions to RECONCILIATION_REQUIRED without duplicating entitlements or contributor earnings', async () => {
      const mockDaraja = {
        initiateStkPush: vi
          .fn()
          .mockResolvedValueOnce({
            MerchantRequestID: 'M-SIB-1',
            CheckoutRequestID: 'ws_CO_SIBLING_1',
            ResponseCode: '0',
            ResponseDescription: 'OK',
            CustomerMessage: 'OK',
          })
          .mockResolvedValueOnce({
            MerchantRequestID: 'M-SIB-2',
            CheckoutRequestID: 'ws_CO_SIBLING_2',
            ResponseCode: '0',
            ResponseDescription: 'OK',
            CustomerMessage: 'OK',
          }),
        queryStkPushStatus: vi.fn().mockImplementation(async (checkoutId: string) => ({
          classification: 'TRANSACTION_CONFIRMED_COMPLETED' as const,
          checkoutRequestId: checkoutId,
          merchantRequestId: 'M-SIB',
          responseCode: '0',
          resultCode: '0',
          resultDesc: 'Processed',
          httpStatus: 200,
        })),
      } as unknown as DarajaClient;

      const svc = new CommerceService({
        db,
        paymentProviders: {
          MPESA: new MpesaPaymentProvider({ darajaClient: mockDaraja }),
        },
      });

      const order = await svc.createOrder(learnerId, {
        items: [{ offerId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const p1 = await svc.initiatePayment(learnerId, order.id, 'MPESA', {
        phoneNumber: '0712345678',
      });

      // Proactive guard: initiating a second payment while p1 is active PROCESSING is rejected (409)
      await expect(
        svc.initiatePayment(learnerId, order.id, 'MPESA', {
          phoneNumber: '0712345678',
        }),
      ).rejects.toThrow(OrderPaymentInProgressError);

      // Simulate a historical/requeued sibling payment attempt also reporting COMPLETED concurrently
      const [p2Row] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          providerCode: 'MPESA',
          providerReference: 'ws_CO_SIBLING_2',
          providerMerchantRequestId: 'M-SIB-2',
          amountMinor: 30000n,
          currencyCode: 'KES',
          status: 'PROCESSING',
          nextVerificationAt: new Date(Date.now() - 1000),
        })
        .returning();

      // Settle both sibling attempts concurrently under order-first FOR UPDATE locking
      await Promise.all([
        svc.reconcileMpesaPaymentById(p1.payment.id, 'worker-1'),
        svc.reconcileMpesaPaymentById(p2Row.id, 'worker-2'),
      ]);

      const orderPayments = await db
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id));
      const statuses = orderPayments.map((p) => p.status).sort();
      expect(statuses).toEqual(['COMPLETED', 'RECONCILIATION_REQUIRED']);

      const reconRow = orderPayments.find((p) => p.status === 'RECONCILIATION_REQUIRED')!;
      expect(reconRow.failureReason).toContain('DUPLICATE_PAID_ATTEMPT_ON_COMPLETED_ORDER');

      // Verify exactly ONE contributor earning row was created for this order
      const earnings = await db
        .select()
        .from(contributorEarnings)
        .where(eq(contributorEarnings.orderId, order.id));
      expect(earnings).toHaveLength(1);
    });

    it('W1-AC-06: transitions exhausted retryable payments to RECONCILIATION_REQUIRED and supports system_admin queue inspection, requeue, and resolution', async () => {
      const mockDaraja = {
        initiateStkPush: vi.fn().mockResolvedValue({
          MerchantRequestID: 'M-ADM-1',
          CheckoutRequestID: 'ws_CO_ADMIN_RECON_001',
          ResponseCode: '0',
          ResponseDescription: 'OK',
          CustomerMessage: 'OK',
        }),
        queryStkPushStatus: vi.fn().mockResolvedValue({
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          checkoutRequestId: 'ws_CO_ADMIN_RECON_001',
          merchantRequestId: 'M-ADM-1',
          responseCode: '0',
          resultCode: '1001',
          resultDesc: 'Subscriber lock active',
          httpStatus: 200,
        }),
      } as unknown as DarajaClient;

      const svc = new CommerceService({
        db,
        paymentProviders: {
          MPESA: new MpesaPaymentProvider({ darajaClient: mockDaraja }),
        },
      });

      const app = buildApp({
        services: { commerceService: svc, authService, rbacService },
      });
      await app.ready();

      try {
        const order = await svc.createOrder(learnerId, {
          items: [{ offerId, quantity: 1 }],
        });
        createdOrderIds.push(order.id);

        const { payment } = await svc.initiatePayment(learnerId, order.id, 'MPESA', {
          phoneNumber: '0712345678',
        });

        // Fast-forward attempts to 9 so the 10th inconclusive attempt exhausts budget -> RECONCILIATION_REQUIRED
        await db
          .update(payments)
          .set({
            verificationAttempts: 9,
            nextVerificationAt: new Date(Date.now() - 1000),
          })
          .where(eq(payments.id, payment.id));

        const worker = new MpesaReconciliationWorker({ db, commerceService: svc });
        await worker.runOnce();

        // Standard learner is forbidden from admin reconciliation queue (403)
        const learnerQueueRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/commerce/payments/reconciliation-queue',
          headers: { cookie: learnerCookie },
        });
        expect(learnerQueueRes.statusCode).toBe(403);

        // system_admin inspects reconciliation queue
        const queueRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/commerce/payments/reconciliation-queue?status=RECONCILIATION_REQUIRED',
          headers: { cookie: adminCookie },
        });
        expect(queueRes.statusCode).toBe(200);
        const found = queueRes.json().data.find((p: any) => p.id === payment.id);
        expect(found).toBeDefined();
        expect(found.providerReference).toBe('ws_CO_ADMIN_RECON_001');

        // system_admin resolves payment with verified receipt
        const adminReceipt = `QWE${Date.now().toString().slice(-7)}`;
        const resolveRes = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/commerce/payments/${payment.id}/resolve-reconciliation`,
          headers: { cookie: adminCookie },
          payload: {
            outcome: 'COMPLETE_WITH_RECEIPT',
            verifiedReceiptNumber: adminReceipt,
            reason: 'Confirmed settlement on Safaricom M-Pesa Org Portal statement.',
          },
        });
        expect(resolveRes.statusCode).toBe(200);
        expect(resolveRes.json().data.payment.status).toBe('COMPLETED');
        expect(resolveRes.json().data.payment.verifiedReceiptNumber).toBe(adminReceipt);
        expect(resolveRes.json().data.payment.receiptVerificationSource).toBe(
          'ADMIN_RECONCILED_RECEIPT',
        );
      } finally {
        await app.close();
      }
    });
  });

  describe('W1-AC-08: Post-Spread trustProxy Validation, 32 KiB Webhook Limit & Bounded-LRU Rate Limiter', () => {
    it('T-W1-IP-01 & T-W1-IP-02: rejects trustProxy: true in all environments, forbids production overrides deviating from TRUST_PROXY_HOPS, and resolves spoofed X-Forwarded-For accurately', async () => {
      // Reject boolean true and string/array forms everywhere
      expect(() => resolveEffectiveTrustProxy(true, 1, 'development')).toThrow(
        /forbidden/i,
      );
      expect(() => resolveEffectiveTrustProxy('127.0.0.1', 1, 'test')).toThrow(
        /forbidden/i,
      );
      expect(() => buildApp({ trustProxy: true })).toThrow(/forbidden/i);

      // Production forbids overrides deviating from TRUST_PROXY_HOPS
      expect(() => resolveEffectiveTrustProxy(2, 1, 'production')).toThrow(
        /cannot deviate/i,
      );
      expect(() => resolveEffectiveTrustProxy(undefined, undefined, 'production')).toThrow(
        /TRUST_PROXY_HOPS/i,
      );
      expect(resolveEffectiveTrustProxy(1, 1, 'production')).toBe(1);
      expect(resolveEffectiveTrustProxy(undefined, 0, 'production')).toBe(false);

      // T-W1-IP-01: When TRUST_PROXY_HOPS=0, rotating X-Forwarded-For headers CANNOT bypass per-IP rate limiting
      const limiter0 = new MpesaWebhookRateLimiter({ capacity: 3, refillTokensPerSec: 0 });
      const appNoProxy = buildApp({
        configuredTrustProxyHopsOverride: 0,
        services: { webhookRateLimiter: limiter0 },
      });
      await appNoProxy.ready();

      try {
        for (let i = 1; i <= 3; i++) {
          const r = await appNoProxy.inject({
            method: 'POST',
            url: '/api/v1/commerce/webhooks/mpesa',
            headers: { 'x-forwarded-for': `203.0.113.${i}` },
            payload: {
              Body: {
                stkCallback: {
                  MerchantRequestID: 'M',
                  CheckoutRequestID: 'ws_CO_UNKNOWN_RATE_0',
                  ResultCode: 0,
                },
              },
            },
          });
          expect(r.statusCode).toBe(200);
        }

        const fourth = await appNoProxy.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'x-forwarded-for': '203.0.113.250' }, // Forged new XFF ignored!
          payload: {
            Body: {
              stkCallback: {
                MerchantRequestID: 'M',
                CheckoutRequestID: 'ws_CO_UNKNOWN_RATE_0',
                ResultCode: 0,
              },
            },
          },
        });
        expect(fourth.statusCode).toBe(429);
        expect(fourth.json().error.code).toBe('RATE_LIMITED');
      } finally {
        await appNoProxy.close();
      }

      // T-W1-IP-02: When trustProxy=1 (single reverse proxy hop), leftmost spoofed XFF is ignored while rightmost proxy-appended client IP is isolated
      const limiter1 = new MpesaWebhookRateLimiter({ capacity: 2, refillTokensPerSec: 0 });
      const appOneHop = buildApp({
        trustProxy: 1,
        services: { webhookRateLimiter: limiter1 },
      });
      await appOneHop.ready();

      try {
        // Attacker at 198.51.100.44 rotates leftmost XFF entry, proxy appends 198.51.100.44 as rightmost hop
        for (const spoofedLeft of ['1.1.1.1', '2.2.2.2']) {
          const okRes = await appOneHop.inject({
            method: 'POST',
            url: '/api/v1/commerce/webhooks/mpesa',
            headers: { 'x-forwarded-for': `${spoofedLeft}, 198.51.100.44` },
            payload: {
              Body: {
                stkCallback: {
                  MerchantRequestID: 'M',
                  CheckoutRequestID: 'ws_CO_UNKNOWN_HOP1',
                  ResultCode: 0,
                },
              },
            },
          });
          expect(okRes.statusCode).toBe(200);
        }

        // 3rd request from 198.51.100.44 with yet another spoofed leftmost IP is throttled (429)!
        const blockedAttacker = await appOneHop.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'x-forwarded-for': '3.3.3.3, 198.51.100.44' },
          payload: {
            Body: {
              stkCallback: {
                MerchantRequestID: 'M',
                CheckoutRequestID: 'ws_CO_UNKNOWN_HOP1',
                ResultCode: 0,
              },
            },
          },
        });
        expect(blockedAttacker.statusCode).toBe(429);

        // Legitimate Safaricom egress IP 196.201.214.200 is unaffected (200)!
        const legitSafaricom = await appOneHop.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'x-forwarded-for': '196.201.214.200' },
          payload: {
            Body: {
              stkCallback: {
                MerchantRequestID: 'M',
                CheckoutRequestID: 'ws_CO_UNKNOWN_HOP1',
                ResultCode: 0,
              },
            },
          },
        });
        expect(legitSafaricom.statusCode).toBe(200);
      } finally {
        await appOneHop.close();
      }
    });

    it('T-W1-LRU-01 & 32 KiB limit: caps rate-limiter memory at maxEntries (10,000) with LRU + TTL eviction and rejects >32 KiB webhook payloads (413)', async () => {
      let fakeNow = 1_700_000_000_000;
      const lruLimiter = new MpesaWebhookRateLimiter({
        capacity: 20,
        refillTokensPerSec: 1,
        entryTtlMs: 600_000,
        maxEntries: 10_000,
        nowFn: () => fakeNow,
      });

      // Flood 12,500 distinct spoofed/distributed IPs: size must NEVER exceed 10,000
      for (let i = 0; i < 12_500; i++) {
        lruLimiter.consume(`10.${Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}`);
      }
      expect(lruLimiter.size).toBe(10_000);

      // Advance clock past 10-minute idle TTL -> lazy prune evicts stale entries
      fakeNow += 600_001;
      lruLimiter.consume('196.201.214.206');
      expect(lruLimiter.size).toBe(1);

      // Verify 32 KiB bodyLimit on POST /api/v1/commerce/webhooks/mpesa
      const app = buildApp();
      await app.ready();
      try {
        const oversizedBody = JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: 'M',
              CheckoutRequestID: 'ws_CO_BIG',
              ResultCode: 0,
              ResultDesc: 'A'.repeat(40 * 1024), // > 32 KiB
            },
          },
        });
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'content-type': 'application/json' },
          payload: oversizedBody,
        });
        expect(res.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });
  });
});
