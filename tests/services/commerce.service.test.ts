import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  products,
  offers,
  orders,
  entitlements,
  resources,
  countries,
  resourceTypes,
  users,
} from '../../src/db/schemas.js';
import { CommerceService } from '../../src/services/commerce/commerce.service.js';
import { SimulationPaymentProvider } from '../../src/services/commerce/simulation-payment-provider.js';
import {
  ProductTypeNotSupportedError,
  OfferNotValidError,
  UnauthorizedCommerceAccessError,
  PaymentAmountMismatchError,
} from '../../src/services/commerce/commerce.interface.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('Commerce Service Unit & Functional Tests', () => {
  const db = getDb();
  let commerceService: CommerceService;
  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let userAId: string;
  let userBId: string;
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));
    commerceService = new CommerceService({
      db,
      paymentProvider: new SimulationPaymentProvider(),
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
          title: `Commerce Service Resource ${Date.now()}`,
          slug: `comm-srv-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    testResourceId = r.id;

    // Create User A
    const [uA] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `comm-srv-usera-${Date.now()}@example.com`,
          displayName: 'Commerce User A',
        })
        .returning(),
    );
    userAId = uA.id;

    // Create User B
    const [uB] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `comm-srv-userb-${Date.now()}@example.com`,
          displayName: 'Commerce User B',
        })
        .returning(),
    );
    userBId = uB.id;
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
    await closeDatabase();
  });

  describe('1. Offer Validity & Product Types', () => {
    it('evaluates offer validity against current time: rejects expired offers (Correction 6)', async () => {
      const prod = await commerceService.createProduct({
        name: 'Expired Offer Book',
        productType: 'RESOURCE',
        resourceId: testResourceId,
      });
      createdProductIds.push(prod.id);

      // Offer expired yesterday
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      const pastOffer = await commerceService.createOffer({
        productId: prod.id,
        priceMinor: 10000n,
        commercialStatus: 'ACTIVE',
        endsAt: yesterday,
      });

      await expect(
        commerceService.createOrder(userAId, {
          items: [{ offerId: pastOffer.id, quantity: 1 }],
        }),
      ).rejects.toThrow(OfferNotValidError);
    });

    it('rejects BUNDLE checkout expansion in Prompt 18 (Correction 5)', async () => {
      const bundle = await commerceService.createProduct({
        name: 'Bundle of Revision Books',
        productType: 'BUNDLE',
      });
      createdProductIds.push(bundle.id);

      const bundleOffer = await commerceService.createOffer({
        productId: bundle.id,
        priceMinor: 50000n,
        commercialStatus: 'ACTIVE',
      });

      await expect(
        commerceService.createOrder(userAId, {
          items: [{ offerId: bundleOffer.id, quantity: 1 }],
        }),
      ).rejects.toThrow(ProductTypeNotSupportedError);
    });
  });

  describe('2. Server-Authoritative Totals & Historical Price Immutability', () => {
    it('calculates order total server-side and preserves historical snapshot if offer later changes (Correction 7)', async () => {
      const prod = await commerceService.createProduct({
        name: 'Physics Complete Notes',
        productType: 'RESOURCE',
        resourceId: testResourceId,
      });
      createdProductIds.push(prod.id);

      // Initial price: KES 200.00 = 20000n
      const offer = await commerceService.createOffer({
        productId: prod.id,
        priceMinor: 20000n,
        commercialStatus: 'ACTIVE',
      });

      // User places order for 2 copies: 2 * 20000 = 40000n
      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: offer.id, quantity: 2 }],
      });
      createdOrderIds.push(order.id);

      expect(order.totalMinor).toBe('40000');
      expect(order.items![0].unitPriceMinor).toBe('20000');
      expect(order.items![0].totalMinor).toBe('40000');

      // Now update the offer price to KES 350.00 = 35000n
      await withDbRetry(async () =>
        db
          .update(offers)
          .set({ priceMinor: 35000n })
          .where(eq(offers.id, offer.id)),
      );

      // Verify the preexisting order's historical snapshots remain completely unchanged
      const retrievedOrder = await commerceService.getOrderById(userAId, order.id);
      expect(retrievedOrder.totalMinor).toBe('40000');
      expect(retrievedOrder.items![0].unitPriceMinor).toBe('20000');
      expect(retrievedOrder.items![0].totalMinor).toBe('40000');
    });

    it('enforces order idempotency via idempotencyKey', async () => {
      const prod = await commerceService.createProduct({
        name: 'Idempotent Product',
        productType: 'RESOURCE',
        resourceId: testResourceId,
      });
      createdProductIds.push(prod.id);

      const offer = await commerceService.createOffer({
        productId: prod.id,
        priceMinor: 10000n,
        commercialStatus: 'ACTIVE',
      });

      const idempotencyKey = `idem-key-${Date.now()}`;

      const order1 = await commerceService.createOrder(userAId, {
        items: [{ offerId: offer.id, quantity: 1 }],
        idempotencyKey,
      });
      createdOrderIds.push(order1.id);

      const order2 = await commerceService.createOrder(userAId, {
        items: [{ offerId: offer.id, quantity: 1 }],
        idempotencyKey,
      });

      expect(order2.id).toBe(order1.id);
      expect(order2.totalMinor).toBe(order1.totalMinor);
    });
  });

  describe('3. Ownership Isolation', () => {
    it('prevents User B from accessing User A order', async () => {
      const prod = await commerceService.createProduct({
        name: 'Private Access Product',
        productType: 'RESOURCE',
        resourceId: testResourceId,
      });
      createdProductIds.push(prod.id);

      const offer = await commerceService.createOffer({
        productId: prod.id,
        priceMinor: 12000n,
        commercialStatus: 'ACTIVE',
      });

      const orderA = await commerceService.createOrder(userAId, {
        items: [{ offerId: offer.id, quantity: 1 }],
      });
      createdOrderIds.push(orderA.id);

      await expect(
        commerceService.getOrderById(userBId, orderA.id),
      ).rejects.toThrow(UnauthorizedCommerceAccessError);
    });
  });

  describe('4. Payment Completion & Atomic Entitlement Flow', () => {
    it('verifies exact payment amount & currency before completing order and provisioning entitlement (Correction 2)', async () => {
      const prod = await commerceService.createProduct({
        name: 'Premium Biology Handbook',
        productType: 'RESOURCE',
        resourceId: testResourceId,
      });
      createdProductIds.push(prod.id);

      const offer = await commerceService.createOffer({
        productId: prod.id,
        priceMinor: 18000n, // KES 180.00
        commercialStatus: 'ACTIVE',
      });

      const order = await commerceService.createOrder(userAId, {
        items: [{ offerId: offer.id, quantity: 1 }],
      });
      createdOrderIds.push(order.id);

      // Initiate payment
      const { payment } = await commerceService.initiatePayment(userAId, order.id);

      // Case A: Amount mismatch check (tampered payment amount)
      await withDbRetry(async () =>
        db
          .update(orders)
          .set({ totalMinor: 99999n }) // Total changed out of sync
          .where(eq(orders.id, order.id)),
      );

      await expect(
        commerceService.processPaymentSuccess({ paymentId: payment.id }),
      ).rejects.toThrow(PaymentAmountMismatchError);

      // Restore correct amount
      await withDbRetry(async () =>
        db
          .update(orders)
          .set({ totalMinor: 18000n })
          .where(eq(orders.id, order.id)),
      );

      // Case B: Successful payment completion
      const result = await commerceService.processPaymentSuccess({
        paymentId: payment.id,
        providerTransactionId: `TXN-OK-${Date.now()}`,
      });

      expect(result.payment.status).toBe('COMPLETED');
      expect(result.order.status).toBe('COMPLETED');
      expect(result.entitlementsGranted).toBe(1);

      // Case C: Authoritative access verification (hasEntitlement)
      const userAHasAccess = await commerceService.hasEntitlement(userAId, testResourceId);
      expect(userAHasAccess).toBe(true);

      const userBHasAccess = await commerceService.hasEntitlement(userBId, testResourceId);
      expect(userBHasAccess).toBe(false);

      // Case D: Idempotency (Correction 3): Calling processPaymentSuccess again does not duplicate entitlements
      const idempotentResult = await commerceService.processPaymentSuccess({
        paymentId: payment.id,
      });
      expect(idempotentResult.entitlementsGranted).toBe(0);
      expect(idempotentResult.order.status).toBe('COMPLETED');
    });
  });
});
