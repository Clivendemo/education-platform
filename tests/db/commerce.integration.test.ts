import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  products,
  offers,
  orders,
  orderItems,
  payments,
  entitlements,
  resources,
  countries,
  resourceTypes,
  users,
} from '../../src/db/schemas.js';
import { withDbRetry } from '../helpers/db-retry.js';
import { setupCommerceSchema } from '../../src/db/seeds/commerce-setup.js';

describe('Commerce Database Integration Tests', () => {
  const db = getDb();
  let testCountryId: string;
  let testResourceTypeId: string;
  let testResourceId: string;
  let testUserId: string;
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEntitlementIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => setupCommerceSchema(db));

    // 1. Resolve or create active country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    testCountryId = c.id;

    // 2. Resolve or create resource type
    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    testResourceTypeId = rt.id;

    // 3. Resolve or create test resource
    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId: testCountryId,
          resourceTypeId: testResourceTypeId,
          title: `Commerce Test Resource ${Date.now()}`,
          slug: `comm-test-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'PREMIUM',
        })
        .returning(),
    );
    testResourceId = r.id;

    // 4. Resolve or create test user
    const [u] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `comm-db-user-${Date.now()}@example.com`,
          displayName: 'Commerce DB Test User',
        })
        .returning(),
    );
    testUserId = u.id;
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
    if (testUserId) {
      await withDbRetry(async () => {
        await db.delete(users).where(eq(users.id, testUserId));
      }).catch(() => {});
    }
    await closeDatabase();
  });

  describe('1. Products & Offers Constraints', () => {
    it('creates a valid RESOURCE product and associates with content.resources', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'Form 4 Mathematics Past Papers Pack',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      expect(p.id).toBeDefined();
      expect(p.productType).toBe('RESOURCE');
      expect(p.resourceId).toBe(testResourceId);
    });

    it('rejects a product with invalid product_type (SUBSCRIPTION rejected per Correction 1)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(products).values({
            name: 'Pro Subscription',
            productType: 'SUBSCRIPTION' as any, // Disallowed!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects a RESOURCE product missing resource_id (chk_products_resource_ref)', async () => {
      await expect(
        withDbRetry(async () =>
          db.insert(products).values({
            name: 'Orphaned Resource Product',
            productType: 'RESOURCE',
            resourceId: null, // Disallowed!
            status: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('creates a valid offer in KES integer minor units (chk_offers_currency)', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'KCSE Revision Guide',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      // Price: KES 250.00 = 25000 minor units
      const [o] = await withDbRetry(async () =>
        db
          .insert(offers)
          .values({
            productId: p.id,
            currencyCode: 'KES',
            priceMinor: 25000n,
            commercialStatus: 'ACTIVE',
          })
          .returning(),
      );

      expect(o.currencyCode).toBe('KES');
      expect(o.priceMinor).toBe(25000n);
    });

    it('rejects an offer with negative price (chk_offers_price)', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'Negative Price Product',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      await expect(
        withDbRetry(async () =>
          db.insert(offers).values({
            productId: p.id,
            currencyCode: 'KES',
            priceMinor: -500n, // Invalid negative price!
            commercialStatus: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects an offer with currency other than KES (chk_offers_currency)', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'USD Product',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      await expect(
        withDbRetry(async () =>
          db.insert(offers).values({
            productId: p.id,
            currencyCode: 'USD' as any, // Only KES allowed!
            priceMinor: 1000n,
            commercialStatus: 'ACTIVE',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('2. Orders & Order Items Invariants', () => {
    it('creates an order with snapshots of quantity, unit_price_minor, and total_minor', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'Chemistry Topicals',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      const [o] = await withDbRetry(async () =>
        db
          .insert(offers)
          .values({
            productId: p.id,
            currencyCode: 'KES',
            priceMinor: 15000n, // KES 150.00
            commercialStatus: 'ACTIVE',
          })
          .returning(),
      );

      // Order for 2 items: Total = 30000n
      const [ord] = await withDbRetry(async () =>
        db
          .insert(orders)
          .values({
            userId: testUserId,
            currencyCode: 'KES',
            totalMinor: 30000n,
            status: 'PENDING',
          })
          .returning(),
      );
      createdOrderIds.push(ord.id);

      const [item] = await withDbRetry(async () =>
        db
          .insert(orderItems)
          .values({
            orderId: ord.id,
            productId: p.id,
            offerId: o.id,
            quantity: 2,
            unitPriceMinor: 15000n,
            totalMinor: 30000n,
          })
          .returning(),
      );

      expect(item.quantity).toBe(2);
      expect(item.unitPriceMinor).toBe(15000n);
      expect(item.totalMinor).toBe(30000n);
    });

    it('rejects an order item where total_minor does not equal quantity * unit_price_minor (chk_order_items_total)', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'Math Topic Pack',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      const [o] = await withDbRetry(async () =>
        db
          .insert(offers)
          .values({
            productId: p.id,
            currencyCode: 'KES',
            priceMinor: 10000n,
            commercialStatus: 'ACTIVE',
          })
          .returning(),
      );

      const [ord] = await withDbRetry(async () =>
        db
          .insert(orders)
          .values({
            userId: testUserId,
            currencyCode: 'KES',
            totalMinor: 10000n,
            status: 'PENDING',
          })
          .returning(),
      );
      createdOrderIds.push(ord.id);

      await expect(
        withDbRetry(async () =>
          db.insert(orderItems).values({
            orderId: ord.id,
            productId: p.id,
            offerId: o.id,
            quantity: 2,
            unitPriceMinor: 10000n,
            totalMinor: 99999n, // Tampered mismatch!
          }),
        ),
      ).rejects.toThrow();
    });

    it('enforces cascade deletion: deleting an order deletes its order_items', async () => {
      const [p] = await withDbRetry(async () =>
        db
          .insert(products)
          .values({
            name: 'Cascade Product',
            productType: 'RESOURCE',
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdProductIds.push(p.id);

      const [o] = await withDbRetry(async () =>
        db
          .insert(offers)
          .values({
            productId: p.id,
            currencyCode: 'KES',
            priceMinor: 5000n,
            commercialStatus: 'ACTIVE',
          })
          .returning(),
      );

      const [ord] = await withDbRetry(async () =>
        db
          .insert(orders)
          .values({
            userId: testUserId,
            currencyCode: 'KES',
            totalMinor: 5000n,
            status: 'PENDING',
          })
          .returning(),
      );

      const [item] = await withDbRetry(async () =>
        db
          .insert(orderItems)
          .values({
            orderId: ord.id,
            productId: p.id,
            offerId: o.id,
            quantity: 1,
            unitPriceMinor: 5000n,
            totalMinor: 5000n,
          })
          .returning(),
      );

      // Delete order
      await withDbRetry(async () => {
        await db.delete(orders).where(eq(orders.id, ord.id));
      });

      // Verify order item was cascade deleted
      const [remaining] = await withDbRetry(async () =>
        db.select().from(orderItems).where(eq(orderItems.id, item.id)),
      );
      expect(remaining).toBeUndefined();
    });
  });

  describe('3. Payments & Provider Reference Uniqueness', () => {
    it('enforces uniqueness of provider reference per provider_code (uq_payments_provider_ref)', async () => {
      const [ord] = await withDbRetry(async () =>
        db
          .insert(orders)
          .values({
            userId: testUserId,
            currencyCode: 'KES',
            totalMinor: 10000n,
            status: 'PENDING',
          })
          .returning(),
      );
      createdOrderIds.push(ord.id);

      const uniqueRef = `REF-TEST-${Date.now()}`;

      await withDbRetry(async () =>
        db.insert(payments).values({
          orderId: ord.id,
          providerCode: 'SIMULATION',
          providerReference: uniqueRef,
          amountMinor: 10000n,
          currencyCode: 'KES',
          status: 'PENDING',
        }),
      );

      // Attempt duplicate provider reference with same providerCode
      await expect(
        withDbRetry(async () =>
          db.insert(payments).values({
            orderId: ord.id,
            providerCode: 'SIMULATION',
            providerReference: uniqueRef, // Duplicate!
            amountMinor: 10000n,
            currencyCode: 'KES',
            status: 'PENDING',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('4. Entitlements Invariants & Partial Unique Index', () => {
    it('creates an entitlement linked to a resource and user without is_paid flag', async () => {
      const [ent] = await withDbRetry(async () =>
        db
          .insert(entitlements)
          .values({
            userId: testUserId,
            resourceId: testResourceId,
            status: 'ACTIVE',
          })
          .returning(),
      );
      createdEntitlementIds.push(ent.id);

      expect(ent.id).toBeDefined();
      expect(ent.status).toBe('ACTIVE');
      expect(ent.userId).toBe(testUserId);
      expect(ent.resourceId).toBe(testResourceId);
    });

    it('enforces partial unique index uq_user_resource_active_entitlement: blocks duplicate active entitlement for same user and resource', async () => {
      // testUserId already has an active entitlement for testResourceId
      await expect(
        withDbRetry(async () =>
          db.insert(entitlements).values({
            userId: testUserId,
            resourceId: testResourceId,
            status: 'ACTIVE', // Duplicate active entitlement!
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
