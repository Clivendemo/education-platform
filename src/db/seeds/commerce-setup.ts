import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb, closeDatabase } from '../index.js';
import * as schemas from '../schemas.js';

export async function setupCommerceSchema(db: NodePgDatabase<typeof schemas>): Promise<void> {
  // 1. Create commerce logical schema
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "commerce"`);

  // 2. Create commerce.products
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."products" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(200) NOT NULL,
      "product_type" VARCHAR(50) NOT NULL,
      "resource_id" UUID REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
      "bundle_id" UUID,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_products_type" CHECK ("product_type" IN ('RESOURCE', 'BUNDLE')),
      CONSTRAINT "chk_products_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
      CONSTRAINT "chk_products_resource_ref" CHECK ("product_type" != 'RESOURCE' OR "resource_id" IS NOT NULL)
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_products_status" ON "commerce"."products" ("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_products_resource_id" ON "commerce"."products" ("resource_id")`);

  // 3. Create commerce.offers
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."offers" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" UUID NOT NULL REFERENCES "commerce"."products"("id") ON DELETE RESTRICT,
      "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
      "price_minor" BIGINT NOT NULL,
      "commercial_status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "starts_at" TIMESTAMPTZ,
      "ends_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_offers_currency" CHECK ("currency_code" = 'KES'),
      CONSTRAINT "chk_offers_price" CHECK ("price_minor" >= 0),
      CONSTRAINT "chk_offers_status" CHECK ("commercial_status" IN ('ACTIVE', 'INACTIVE')),
      CONSTRAINT "chk_offers_dates" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" >= "starts_at")
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_offers_product_status" ON "commerce"."offers" ("product_id", "commercial_status")`);

  // 4. Create commerce.orders
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."orders" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
      "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
      "total_minor" BIGINT NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      "idempotency_key" VARCHAR(100),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_orders_status" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED')),
      CONSTRAINT "chk_orders_currency" CHECK ("currency_code" = 'KES'),
      CONSTRAINT "chk_orders_total" CHECK ("total_minor" >= 0)
    )
  `);

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_idempotency_key" ON "commerce"."orders" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_orders_user_status" ON "commerce"."orders" ("user_id", "status")`);

  // 5. Create commerce.order_items
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."order_items" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" UUID NOT NULL REFERENCES "commerce"."orders"("id") ON DELETE CASCADE,
      "product_id" UUID NOT NULL REFERENCES "commerce"."products"("id") ON DELETE RESTRICT,
      "offer_id" UUID NOT NULL REFERENCES "commerce"."offers"("id") ON DELETE RESTRICT,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "unit_price_minor" BIGINT NOT NULL,
      "total_minor" BIGINT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_order_items_qty" CHECK ("quantity" > 0),
      CONSTRAINT "chk_order_items_unit_price" CHECK ("unit_price_minor" >= 0),
      CONSTRAINT "chk_order_items_total" CHECK ("total_minor" = ("quantity" * "unit_price_minor"))
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON "commerce"."order_items" ("order_id")`);

  // 6. Create commerce.payments (no payment_provider_id per Correction 4)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."payments" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" UUID NOT NULL REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
      "provider_code" VARCHAR(50) NOT NULL,
      "provider_reference" VARCHAR(100),
      "provider_transaction_id" VARCHAR(100),
      "amount_minor" BIGINT NOT NULL,
      "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "completed_at" TIMESTAMPTZ,
      "failed_at" TIMESTAMPTZ,
      "failure_reason" TEXT,
      "provider_payload" JSONB,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_payments_status" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
      CONSTRAINT "chk_payments_currency" CHECK ("currency_code" = 'KES'),
      CONSTRAINT "chk_payments_amount" CHECK ("amount_minor" >= 0)
    )
  `);

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_provider_ref" ON "commerce"."payments" ("provider_code", "provider_reference") WHERE "provider_reference" IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_payments_order_id" ON "commerce"."payments" ("order_id")`);

  // 7. Create commerce.entitlements
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "commerce"."entitlements" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
      "resource_id" UUID NOT NULL REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
      "source_order_id" UUID REFERENCES "commerce"."orders"("id") ON DELETE SET NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "starts_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ends_at" TIMESTAMPTZ,
      "revoked_at" TIMESTAMPTZ,
      "revoked_by" UUID REFERENCES "identity"."users"("id"),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "chk_entitlements_status" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
      CONSTRAINT "chk_entitlements_dates" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at")
    )
  `);

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_resource_active_entitlement" ON "commerce"."entitlements" ("user_id", "resource_id") WHERE "status" = 'ACTIVE'`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_entitlements_user_status" ON "commerce"."entitlements" ("user_id", "status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_entitlements_resource_id" ON "commerce"."entitlements" ("resource_id")`);
}

// Allow direct execution via tsx
if (process.argv[1]?.endsWith('commerce-setup.ts')) {
  const db = getDb();
  setupCommerceSchema(db)
    .then(async () => {
      console.log('Commerce schema initialized successfully.');
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Error setting up commerce schema:', err);
      await closeDatabase();
      process.exit(1);
    });
}
