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
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('CommerceService M-Pesa Integration Tests', () => {
  const db = getDb();
  let commerceService: CommerceService;
  let mockDarajaClient: DarajaClient;

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

    // Create product & offer: KES 200.00 = 20000n
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

  describe('1. M-Pesa STK Push Initiation', () => {
    it('initiates STK push and transitions order to PROCESSING', async () => {
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
      expect(initResult.payment.status).toBe('PENDING');
      expect(initResult.payment.amountMinor).toBe('20000');
      expect(initResult.payment.providerReference).toMatch(/^ws_CO_/);
      expect(initResult.order.status).toBe('PROCESSING');

      // Verify payment in database
      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id))
        .limit(1);

      expect(dbPayment).toBeDefined();
      expect(dbPayment.status).toBe('PENDING');
      expect(dbPayment.providerCode).toBe('MPESA');
      expect(dbPayment.providerReference).toBe(initResult.payment.providerReference);
    });
  });

  describe('2. M-Pesa Callback Handling & Entitlement Provisioning', () => {
    it('confirms payment, marks order COMPLETED, and provisions resource entitlement on successful callback', async () => {
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

      const checkoutRequestId = initResult.payment.providerReference!;
      const mpesaReceipt = `NLJ${Date.now().toString().slice(-7)}`;

      // Construct Daraja successful callback
      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 200.0 }, // Exact KES 200.00
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

      // Verify payment row updated in database
      const [updatedPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(updatedPayment.status).toBe('COMPLETED');
      expect(updatedPayment.providerTransactionId).toBe(mpesaReceipt);
      expect(updatedPayment.completedAt).toBeDefined();

      // Verify order row updated in database
      const [updatedOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(updatedOrder.status).toBe('COMPLETED');

      // Verify user now holds active entitlement
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

      const checkoutRequestId = initResult.payment.providerReference!;
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

      // First callback execution
      const res1 = await commerceService.handleMpesaCallback(callbackPayload);
      expect(res1.result?.status).toBe('COMPLETED');

      // Second identical callback execution (e.g. Daraja retry)
      const res2 = await commerceService.handleMpesaCallback(callbackPayload);
      expect(res2.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(res2.result?.status).toBe('COMPLETED');
      expect(res2.result?.entitlementsGranted).toBe(0);

      // Verify payment was not duplicated
      const paymentCount = await db
        .select()
        .from(payments)
        .where(eq(payments.providerReference, checkoutRequestId));
      expect(paymentCount.length).toBe(1);
    });

    it('handles user cancellation (ResultCode 1032) by marking payment and order CANCELLED', async () => {
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

      const checkoutRequestId = initResult.payment.providerReference!;

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

    it('rejects amount mismatch: underpayment or overpayment transitions payment to FAILED without granting entitlements', async () => {
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

      const checkoutRequestId = initResult.payment.providerReference!;

      // Order total is 200 KES. Callback supplies 150.00 (underpayment)
      const underpayPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 150.0 }, // Mismatch!
                { Name: 'MpesaReceiptNumber', Value: 'NLJMISMATCH1' },
              ],
            },
          },
        },
      };

      const res = await commerceService.handleMpesaCallback(underpayPayload);
      expect(res.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      expect(res.result?.status).toBe('FAILED');
      expect(res.result?.entitlementsGranted).toBe(0);

      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(dbPayment.status).toBe('FAILED');
      expect(dbPayment.failureReason).toContain('Payment amount or currency mismatch');
    });

    it('safely handles unknown checkoutRequestId without leaking record presence', async () => {
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

      const checkoutRequestId = initResult.payment.providerReference!;
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

      // Dispatch 3 concurrent callback requests simultaneously
      const results = await Promise.all([
        commerceService.handleMpesaCallback(callbackPayload),
        commerceService.handleMpesaCallback(callbackPayload),
        commerceService.handleMpesaCallback(callbackPayload),
      ]);

      // All must acknowledge with standard Daraja response
      for (const r of results) {
        expect(r.ack).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
      }

      // Sum of entitlements granted across all parallel calls must not exceed 1
      const totalGranted = results.reduce(
        (sum, r) => sum + (r.result?.entitlementsGranted || 0),
        0,
      );
      expect(totalGranted).toBeLessThanOrEqual(1);

      // Payment in DB is COMPLETED
      const [finalPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, initResult.payment.id));
      expect(finalPayment.status).toBe('COMPLETED');
    });
  });
});
