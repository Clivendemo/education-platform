import { sql } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { commerceSchema } from '../logical-schemas.js';
import { resources } from './resource.js';
import { users } from './identity.js';

/**
 * 26.2 commerce.products
 * Defines purchasable platform offerings (RESOURCE or BUNDLE).
 * Subscriptions are explicitly excluded in Prompt 18.
 */
export const products = commerceSchema.table(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    productType: varchar('product_type', { length: 50 }).notNull(),
    resourceId: uuid('resource_id').references(() => resources.id, {
      onDelete: 'restrict',
    }),
    bundleId: uuid('bundle_id'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('chk_products_type', sql`${table.productType} IN ('RESOURCE', 'BUNDLE')`),
    check('chk_products_status', sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`),
    check(
      'chk_products_resource_ref',
      sql`${table.productType} != 'RESOURCE' OR ${table.resourceId} IS NOT NULL`,
    ),
    index('idx_products_status').on(table.status),
    index('idx_products_resource_id').on(table.resourceId),
  ],
);

/**
 * 26.3 commerce.offers
 * Defines purchasable pricing in integer minor units (KES).
 */
export const offers = commerceSchema.table(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    priceMinor: bigint('price_minor', { mode: 'bigint' }).notNull(),
    commercialStatus: varchar('commercial_status', { length: 20 })
      .notNull()
      .default('ACTIVE'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('chk_offers_currency', sql`${table.currencyCode} = 'KES'`),
    check('chk_offers_price', sql`${table.priceMinor} >= 0`),
    check('chk_offers_status', sql`${table.commercialStatus} IN ('ACTIVE', 'INACTIVE')`),
    check(
      'chk_offers_dates',
      sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`,
    ),
    index('idx_offers_product_status').on(table.productId, table.commercialStatus),
  ],
);

/**
 * 27.1 commerce.orders
 * Tracks purchasing transactions belonging to authenticated users.
 */
export const orders = commerceSchema.table(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    idempotencyKey: varchar('idempotency_key', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_orders_status',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED')`,
    ),
    check('chk_orders_currency', sql`${table.currencyCode} = 'KES'`),
    check('chk_orders_total', sql`${table.totalMinor} >= 0`),
    uniqueIndex('uq_orders_idempotency_key').on(table.idempotencyKey),
    index('idx_orders_user_status').on(table.userId, table.status),
  ],
);

/**
 * 27.2 commerce.order_items
 * Historical snapshot of purchased items and prices.
 */
export const orderItems = commerceSchema.table(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('chk_order_items_qty', sql`${table.quantity} > 0`),
    check('chk_order_items_unit_price', sql`${table.unitPriceMinor} >= 0`),
    check('chk_order_items_total', sql`${table.totalMinor} = (${table.quantity} * ${table.unitPriceMinor})`),
    index('idx_order_items_order_id').on(table.orderId),
  ],
);

/**
 * 28.1 commerce.payments
 * Tracks payment records linked to orders.
 * Note: payment_provider_id removed per Prompt 18 Correction 4.
 */
export const payments = commerceSchema.table(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    providerCode: varchar('provider_code', { length: 50 }).notNull(),
    providerReference: varchar('provider_reference', { length: 100 }),
    providerTransactionId: varchar('provider_transaction_id', { length: 100 }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    providerPayload: jsonb('provider_payload'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_payments_status',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
    check('chk_payments_currency', sql`${table.currencyCode} = 'KES'`),
    check('chk_payments_amount', sql`${table.amountMinor} >= 0`),
    uniqueIndex('uq_payments_provider_ref')
      .on(table.providerCode, table.providerReference)
      .where(sql`${table.providerReference} IS NOT NULL`),
    index('idx_payments_order_id').on(table.orderId),
  ],
);

/**
 * 29.1 commerce.entitlements
 * The authoritative representation of purchased access.
 * Replaces any concept of is_paid.
 */
export const entitlements = commerceSchema.table(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    sourceOrderId: uuid('source_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    startsAt: timestamp('starts_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('chk_entitlements_status', sql`${table.status} IN ('ACTIVE', 'EXPIRED', 'REVOKED')`),
    check('chk_entitlements_dates', sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`),
    uniqueIndex('uq_user_resource_active_entitlement')
      .on(table.userId, table.resourceId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('idx_entitlements_user_status').on(table.userId, table.status),
    index('idx_entitlements_resource_id').on(table.resourceId),
  ],
);
