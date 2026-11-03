import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
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
import { CommerceService } from '../../src/services/commerce/commerce.service.js';
import { MpesaPaymentProvider } from '../../src/services/commerce/mpesa/mpesa-payment-provider.js';
import { DarajaClient } from '../../src/services/commerce/mpesa/daraja-client.js';
import type { DarajaStkQueryResult } from '../../src/services/commerce/mpesa/mpesa.types.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('CommerceService M-Pesa Integration Tests', () => {
  const db = getDb();
  let commerceService: CommerceService;
  let mockDarajaClient: DarajaClient;
  const queryStatusByCheckoutId = new Map<string, DarajaStkQueryResult>();

  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let testOfferId: string;
  let userAId: string;

  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));

    mockDarajaClient = {
      initiateStkPush: vi.fn().mockImplementation(async (_params: any) => ({
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: `ws_CO_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'Success. Request accepted for processing',
      })),
      queryStkPushStatus: vi.fn().mockImplementation(async (checkoutRequestId: string) => {
        return (
          queryStatusByCheckoutId.get(checkoutRequestId) ?? {
            classification: 'TRANSACTION_CONFIRMED_COMPLETED' as const,
            checkoutRequestId,
            merchantRequestId: 'MERCHANT-VERIFIED',
            responseCode: '0',
            resultCode: '0',
            resultDesc: 'The service request is processed successfully.',
            httpStatus: 200,
          }
        );
      }),
      getAccessToken: vi.fn().mockResolvedValue('test_token'),
    } as unknown as DarajaClient;

    const mpesaProvider = new MpesaPaymentProvider({
      darajaClient: mockDarajaClient,
    });

    commerceService = new CommerceService({
      db,
      paymentProviders: {
        MPESA: mpesaProvider,
      },
    });

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
          title: `M-Pesa Integration Test Resource ${Date.now()}`,
          slug: `mpesa-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    testResourceId = r.id;

    const [uA] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `mpesa-user-${Date.now()}@example.com`,
          displayName: 'Mpesa Test User',
        })
        .returning(),
    );
    userAId = uA.id;

    const prod = await commerceService.createProduct({
      name: 'Kenya Secondary Mathematics Past Papers',
      productType: 'RESOURCE',
      resourceId: testResourceId,
    });
    createdProductIds.push(prod.id);

    const off = await commerceService.createOffer({
      productId: prod.id,
      priceMinor: 20000n, // 200 KES
      commercialStatus: 'ACTIVE',
    });
    testOfferId = off.id;
  }, 120000);

  afterAll(async () => {
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

  async function getInternalCheckoutId(paymentId: string): Promise<string> {
    const [row] = await db
      .select({ providerReference: payments.providerReference })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    return row.providerReference!;
  }

  describe('1. M-Pesa STK Push Initiation', () => {
    it('initiates STK push, redacts providerReference from learner DTO (W1-AC-03), and schedules reconciliation', async () => {
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await commerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      expect(initResult.payment.providerCode).toBe('MPESA');
      expect(initResult.payment.status).toBe('PROCESSING');
      expect(initResult.payment.amountMinor).toBe('20000');
      expect(initResult.payment.providerReference).toBeNull();
      expect(initResult.order.status).toBe('PROCESSING');

      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id))
        .limit(1);

      expect(dbPayment).toBeDefined();
      expect(dbPayment.status).toBe('PROCESSING');
      expect(dbPayment.providerCode).toBe('MPESA');
      expect(dbPayment.providerReference).toMatch(/^ws_CO_/);
      expect(dbPayment.nextVerificationAt).not.toBeNull();
    });
  });

  describe('2. M-Pesa Callback Wake-Up + Authoritative Daraja Query Verification', () => {
    it('verifies via Daraja STK Query, marks order COMPLETED, and provisions entitlement', async () => {
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await commerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      const checkoutRequestId = await getInternalCheckoutId(initResult.payment.id);
      const mpesaReceipt = `NLJ${Date.now().toString().slice(-7)}`;

      queryStatusByCheckoutId.set(checkoutRequestId, {
        classification: 'TRANSACTION_CONFIRMED_COMPLETED',
        checkoutRequestId,
        merchantRequestId: '29115-34620561-1',
        responseCode: '0',
        resultCode: '0',
        resultDesc: 'The service request is processed successfully.',
        httpStatus: 200,
      });

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 200.0 },
                { Name: 'MpesaReceiptNumber', Value: mpesaReceipt },
                { Name: 'TransactionDate', Value: 20261008120000 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          },
        },
      };

      const callbackResponse = await commerceService.handleMpesaCallback(callbackPayload);

      expect(callbackResponse.ack).toEqual({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });
      expect(callbackResponse.result?.status).toBe('COMPLETED');
      expect(callbackResponse.result?.entitlementsGranted).toBe(1);

      const [updatedPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(updatedPayment.status).toBe('COMPLETED');
      // Unverified callback receipt stays in callback_receipt_candidate (W1-AC-04 / W1-AC-07)
      expect(updatedPayment.callbackReceiptCandidate).toBe(mpesaReceipt);
      expect(updatedPayment.verifiedReceiptNumber).toBeNull();
      expect(updatedPayment.receiptVerificationSource).toBeNull();
      expect(updatedPayment.completedAt).toBeDefined();

      const [updatedOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(updatedOrder.status).toBe('COMPLETED');

      const hasEnt = await commerceService.hasEntitlement(userAId, testResourceId);
      expect(hasEnt).toBe(true);

      const [ent] = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, userAId),
            eq(entitlements.resourceId, testResourceId),
            eq(entitlements.status, 'ACTIVE'),
          ),
        );
      expect(ent).toBeDefined();
      createdEntitlementIds.push(ent.id);
    });

    it('ensures callback idempotency: duplicate successful callback does not re-grant entitlements or mutate records', async () => {
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await commerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      const checkoutRequestId = await getInternalCheckoutId(initResult.payment.id);
      const mpesaReceipt = `NLJ${Date.now().toString().slice(-7)}`;

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 200.0 },
                { Name: 'MpesaReceiptNumber', Value: mpesaReceipt },
              ],
            },
          },
        },
      };

      const res1 = await commerceService.handleMpesaCallback(callbackPayload);
      expect(res1.result?.status).toBe('COMPLETED');

      const res2 = await commerceService.handleMpesaCallback(callbackPayload);
      expect(res2.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(res2.result?.status).toBe('COMPLETED');
      expect(res2.result?.entitlementsGranted).toBe(0);

      const paymentCount = await db
        .select()
        .from(payments)
        .where(eq(payments.providerReference, checkoutRequestId));
      expect(paymentCount.length).toBe(1);
    });

    it('marks payment CANCELLED only when authoritative Daraja query confirms ResultCode 1032', async () => {
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await commerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      const checkoutRequestId = await getInternalCheckoutId(initResult.payment.id);
      queryStatusByCheckoutId.set(checkoutRequestId, {
        classification: 'TRANSACTION_CONFIRMED_CANCELLED',
        checkoutRequestId,
        merchantRequestId: '29115-34620561-1',
        responseCode: '0',
        resultCode: '1032',
        resultDesc: 'Request cancelled by user.',
        httpStatus: 200,
      });

      const cancelPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user.',
          },
        },
      };

      const res = await commerceService.handleMpesaCallback(cancelPayload);
      expect(res.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(res.result?.status).toBe('CANCELLED');
      expect(res.result?.entitlementsGranted).toBe(0);

      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(dbPayment.status).toBe('CANCELLED');
      expect(dbPayment.failureReason).toContain('cancelled by user');

      const [dbOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(dbOrder.status).toBe('CANCELLED');
    });

    it('prevents untrusted callback Amount tampering from DoS-blocking Daraja-verified settlement while parking authoritative DB amount mismatches in RECONCILIATION_REQUIRED (W1-AC-05 / W1-AC-07)', async () => {
      // Case A: Untrusted callback claims 150.0 on a 200.00 KES order, but Daraja confirms COMPLETED and DB amounts match
      const [freshBuyer] = await db
        .insert(users)
        .values({
          email: `mpesa-nondos-${Date.now()}@example.com`,
          displayName: 'Mpesa Non-DoS Buyer',
        })
        .returning();

      try {
        const orderOk = await commerceService.createOrder(freshBuyer.id, {
          items: [{ offerId: testOfferId, quantity: 1 }],
        });
        createdOrderIds.push(orderOk.id);

        const initOk = await commerceService.initiatePayment(
          freshBuyer.id,
          orderOk.id,
          'MPESA',
          { phoneNumber: '0712345678' },
        );
        const checkoutOk = await getInternalCheckoutId(initOk.payment.id);

        const spoofedUnderpayCallback = {
          Body: {
            stkCallback: {
              MerchantRequestID: '29115-34620561-1',
              CheckoutRequestID: checkoutOk,
              ResultCode: 0,
              ResultDesc: 'The service request is processed successfully.',
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 150.0 },
                  { Name: 'MpesaReceiptNumber', Value: 'NLJNON_DOS1' },
                ],
              },
            },
          },
        };

        const resOk = await commerceService.handleMpesaCallback(spoofedUnderpayCallback);
        expect(resOk.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        expect(resOk.result?.status).toBe('COMPLETED');
        expect(resOk.result?.entitlementsGranted).toBe(1);

        const [settledRow] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, initOk.payment.id));
        expect(settledRow.status).toBe('COMPLETED');
        expect((settledRow.providerPayload as any)?.callbackAmountAnomaly).toMatchObject({
          claimedMinor: '15000',
          expectedMinor: '20000',
        });

        await db.delete(entitlements).where(eq(entitlements.userId, freshBuyer.id));
        await db.delete(payments).where(eq(payments.orderId, orderOk.id));
        await db.delete(orders).where(eq(orders.id, orderOk.id));
      } finally {
        await db.delete(users).where(eq(users.id, freshBuyer.id)).catch(() => {});
      }

      // Case B: Authoritative DB order/payment amount mismatch parks in RECONCILIATION_REQUIRED with 0 entitlements
      const orderMismatch = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(orderMismatch.id);

      const initMismatch = await commerceService.initiatePayment(
        userAId,
        orderMismatch.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );
      const checkoutMismatch = await getInternalCheckoutId(initMismatch.payment.id);

      await db
        .update(orders)
        .set({ totalMinor: 15000n })
        .where(eq(orders.id, orderMismatch.id));

      const resMismatch = await commerceService.handleMpesaCallback({
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutMismatch,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
          },
        },
      });
      expect(resMismatch.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(resMismatch.result?.status).toBe('RECONCILIATION_REQUIRED');
      expect(resMismatch.result?.entitlementsGranted).toBe(0);

      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initMismatch.payment.id));
      expect(dbPayment.status).toBe('RECONCILIATION_REQUIRED');
      expect(dbPayment.failureReason).toContain('Order/payment amount mismatch');
    });

    it('safely handles unknown checkoutRequestId without leaking record presence or querying Daraja', async () => {
      const unknownPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '99999-99999999-1',
            CheckoutRequestID: 'ws_CO_NON_EXISTENT_REFERENCE_999',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [{ Name: 'Amount', Value: 200.0 }],
            },
          },
        },
      };

      const res = await commerceService.handleMpesaCallback(unknownPayload);
      expect(res.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(res.result).toBeUndefined();
    });

    it('is race-safe when concurrent duplicate callbacks arrive simultaneously', async () => {
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: testOfferId, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      const initResult = await commerceService.initiatePayment(
        userAId,
        order.id,
        'MPESA',
        { phoneNumber: '0712345678' },
      );

      const checkoutRequestId = await getInternalCheckoutId(initResult.payment.id);
      const mpesaReceipt = `NLJRACE${Date.now().toString().slice(-6)}`;

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 200.0 },
                { Name: 'MpesaReceiptNumber', Value: mpesaReceipt },
              ],
            },
          },
        },
      };

      const results = await Promise.all([
        commerceService.handleMpesaCallback(callbackPayload),
        commerceService.handleMpesaCallback(callbackPayload),
        commerceService.handleMpesaCallback(callbackPayload),
      ]);

      for (const r of results) {
        expect(r.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      }

      const totalGranted = results.reduce(
        (sum, r) => sum + (r.result?.entitlementsGranted || 0),
        0,
      );
      expect(totalGranted).toBeLessThanOrEqual(1);

      const [finalPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(finalPayment.status).toBe('COMPLETED');
    });
  });
});
