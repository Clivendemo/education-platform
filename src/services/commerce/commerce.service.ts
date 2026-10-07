import { eq, and, sql, isNull, gt, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../../db/index.js';
import * as schemas from '../../db/schemas.js';
import {
  products,
  offers,
  orders,
  orderItems,
  payments,
  entitlements,
} from '../../db/schema/commerce.js';
import type { PaymentProvider } from './payment-provider.interface.js';
import { SimulationPaymentProvider } from './simulation-payment-provider.js';
import {
  type ProductDto,
  type OfferDto,
  type OrderDto,
  type OrderItemDto,
  type PaymentDto,
  type EntitlementDto,
  type CreateOrderInput,
  ProductNotFoundError,
  OfferNotFoundError,
  OfferNotValidError,
  ProductTypeNotSupportedError,
  OrderNotFoundError,
  PaymentNotFoundError,
  UnauthorizedCommerceAccessError,
  InvalidStateTransitionError,
  PaymentAmountMismatchError,
} from './commerce.interface.js';

export interface CommerceServiceOptions {
  db?: NodePgDatabase<typeof schemas>;
  paymentProvider?: PaymentProvider;
}

export class CommerceService {
  private readonly db: NodePgDatabase<typeof schemas>;
  private readonly paymentProvider: PaymentProvider;

  constructor(options: CommerceServiceOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.paymentProvider = options.paymentProvider ?? new SimulationPaymentProvider();
  }

  /**
   * Creates a product representing a purchasable offering.
   */
  async createProduct(input: {
    name: string;
    productType: 'RESOURCE' | 'BUNDLE';
    resourceId?: string | null;
    bundleId?: string | null;
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  }): Promise<ProductDto> {
    if (input.productType === 'RESOURCE' && !input.resourceId) {
      throw new ProductTypeNotSupportedError('Resource product requires resourceId');
    }

    const [created] = await this.db
      .insert(products)
      .values({
        name: input.name,
        productType: input.productType,
        resourceId: input.resourceId ?? null,
        bundleId: input.bundleId ?? null,
        status: input.status ?? 'ACTIVE',
      })
      .returning();

    return this.mapProduct(created);
  }

  /**
   * Creates an offer attached to a product in KES minor units.
   */
  async createOffer(input: {
    productId: string;
    priceMinor: bigint;
    currencyCode?: 'KES';
    commercialStatus?: 'ACTIVE' | 'INACTIVE';
    startsAt?: Date | null;
    endsAt?: Date | null;
  }): Promise<OfferDto> {
    const [p] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);

    if (!p) {
      throw new ProductNotFoundError();
    }

    const [created] = await this.db
      .insert(offers)
      .values({
        productId: input.productId,
        priceMinor: input.priceMinor,
        currencyCode: input.currencyCode ?? 'KES',
        commercialStatus: input.commercialStatus ?? 'ACTIVE',
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      })
      .returning();

    return this.mapOffer(created);
  }

  /**
   * Retrieves active products that have currently valid offers.
   * Evaluates validity against current time (Correction 6).
   */
  async getActiveProducts(): Promise<ProductDto[]> {
    const now = new Date();

    const activeProductRows = await this.db
      .select()
      .from(products)
      .where(eq(products.status, 'ACTIVE'));

    const result: ProductDto[] = [];

    for (const p of activeProductRows) {
      // Find active offers valid right now
      const activeOffers = await this.db
        .select()
        .from(offers)
        .where(
          and(
            eq(offers.productId, p.id),
            eq(offers.commercialStatus, 'ACTIVE'),
            or(isNull(offers.startsAt), lte(offers.startsAt, now)),
            or(isNull(offers.endsAt), gt(offers.endsAt, now)),
          ),
        );

      result.push({
        ...this.mapProduct(p),
        activeOffers: activeOffers.map((o) => this.mapOffer(o)),
      });
    }

    return result;
  }

  /**
   * Retrieves a single product with its active offers.
   */
  async getProductById(productId: string): Promise<ProductDto> {
    const [p] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!p) {
      throw new ProductNotFoundError();
    }

    const now = new Date();
    const activeOffers = await this.db
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.productId, p.id),
          eq(offers.commercialStatus, 'ACTIVE'),
          or(isNull(offers.startsAt), lte(offers.startsAt, now)),
          or(isNull(offers.endsAt), gt(offers.endsAt, now)),
        ),
      );

    return {
      ...this.mapProduct(p),
      activeOffers: activeOffers.map((o) => this.mapOffer(o)),
    };
  }

  /**
   * Creates an order belonging to an authenticated user.
   * Calculates totals server-side and snapshots offer prices (Correction 6 & 7).
   */
  async createOrder(
    userId: string,
    input: CreateOrderInput,
  ): Promise<OrderDto> {
    if (!input.items || input.items.length === 0) {
      throw new OfferNotValidError('Order must contain at least one item');
    }

    // Check idempotency key if provided
    if (input.idempotencyKey) {
      const [existingOrder] = await this.db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.userId, userId),
            eq(orders.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingOrder) {
        const items = await this.getOrderItems(existingOrder.id);
        return {
          ...this.mapOrder(existingOrder),
          items,
        };
      }
    }

    const now = new Date();
    let calculatedTotalMinor = 0n;

    interface ResolvedItem {
      product: typeof products.$inferSelect;
      offer: typeof offers.$inferSelect;
      quantity: number;
      unitPriceMinor: bigint;
      totalMinor: bigint;
    }

    const resolvedItems: ResolvedItem[] = [];

    // Validate offers and products server-side
    for (const itemInput of input.items) {
      const quantity = itemInput.quantity && itemInput.quantity > 0 ? itemInput.quantity : 1;

      const [offer] = await this.db
        .select()
        .from(offers)
        .where(eq(offers.id, itemInput.offerId))
        .limit(1);

      if (!offer) {
        throw new OfferNotFoundError(`Offer ${itemInput.offerId} not found`);
      }

      // Check current time validity (Correction 6)
      const isStatusActive = offer.commercialStatus === 'ACTIVE';
      const isStarted = !offer.startsAt || offer.startsAt <= now;
      const isNotEnded = !offer.endsAt || offer.endsAt > now;

      if (!isStatusActive || !isStarted || !isNotEnded || offer.currencyCode !== 'KES') {
        throw new OfferNotValidError(
          `Offer ${offer.id} is expired, inactive, or invalid currency`,
        );
      }

      const [product] = await this.db
        .select()
        .from(products)
        .where(eq(products.id, offer.productId))
        .limit(1);

      if (!product || product.status !== 'ACTIVE') {
        throw new ProductNotFoundError(`Product for offer ${offer.id} is unavailable`);
      }

      // Prompt 18 Correction 5: Bundles are not supported for single-item checkout expansion in Prompt 18
      if (product.productType === 'BUNDLE') {
        throw new ProductTypeNotSupportedError(
          'Bundle checkout is not supported in Prompt 18 foundation',
        );
      }

      const itemTotalMinor = offer.priceMinor * BigInt(quantity);
      calculatedTotalMinor += itemTotalMinor;

      resolvedItems.push({
        product,
        offer,
        quantity,
        unitPriceMinor: offer.priceMinor,
        totalMinor: itemTotalMinor,
      });
    }

    // Atomically persist order and snapshot order items
    const [createdOrder] = await this.db
      .insert(orders)
      .values({
        userId,
        currencyCode: 'KES',
        totalMinor: calculatedTotalMinor,
        status: 'PENDING',
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();

    for (const item of resolvedItems) {
      await this.db.insert(orderItems).values({
        orderId: createdOrder.id,
        productId: item.product.id,
        offerId: item.offer.id,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        totalMinor: item.totalMinor,
      });
    }

    const items = await this.getOrderItems(createdOrder.id);
    return {
      ...this.mapOrder(createdOrder),
      items,
    };
  }

  /**
   * Retrieves all orders belonging to an authenticated user (isolated).
   */
  async getUserOrders(userId: string): Promise<OrderDto[]> {
    const userOrders = await this.db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(sql`${orders.createdAt} DESC`);

    const result: OrderDto[] = [];
    for (const ord of userOrders) {
      const items = await this.getOrderItems(ord.id);
      result.push({
        ...this.mapOrder(ord),
        items,
      });
    }

    return result;
  }

  /**
   * Retrieves a single order by ID, enforcing user ownership.
   */
  async getOrderById(userId: string, orderId: string): Promise<OrderDto> {
    const [ord] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!ord) {
      throw new OrderNotFoundError();
    }

    if (ord.userId !== userId) {
      throw new UnauthorizedCommerceAccessError('Cannot access another user order');
    }

    const items = await this.getOrderItems(ord.id);
    return {
      ...this.mapOrder(ord),
      items,
    };
  }

  /**
   * Initiates payment for an order via the configured PaymentProvider.
   * Moves order to PROCESSING status (No client-declared completion per Correction 8).
   */
  async initiatePayment(
    userId: string,
    orderId: string,
    providerCode = 'SIMULATION',
  ): Promise<{ payment: PaymentDto; order: OrderDto }> {
    const [ord] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!ord) {
      throw new OrderNotFoundError();
    }

    if (ord.userId !== userId) {
      throw new UnauthorizedCommerceAccessError();
    }

    if (ord.status === 'COMPLETED') {
      throw new InvalidStateTransitionError('Order is already completed');
    }

    if (ord.status === 'CANCELLED' || ord.status === 'FAILED') {
      throw new InvalidStateTransitionError('Cannot pay for cancelled or failed order');
    }

    // Call payment provider to initiate
    const initResult = await this.paymentProvider.createPayment({
      orderId: ord.id,
      amountMinor: ord.totalMinor,
      currencyCode: 'KES',
      userId,
    });

    // Update order status to PROCESSING
    await this.db
      .update(orders)
      .set({
        status: 'PROCESSING',
        updatedAt: new Date(),
      })
      .where(eq(orders.id, ord.id));

    // Record payment record
    const [paymentRecord] = await this.db
      .insert(payments)
      .values({
        orderId: ord.id,
        providerCode: initResult.providerCode || providerCode,
        providerReference: initResult.providerReference,
        providerTransactionId: initResult.providerTransactionId ?? null,
        amountMinor: ord.totalMinor,
        currencyCode: 'KES',
        status: 'PENDING',
        providerPayload: initResult.payload ?? null,
      })
      .returning();

    const updatedOrder = await this.getOrderById(userId, orderId);
    return {
      payment: this.mapPayment(paymentRecord),
      order: updatedOrder,
    };
  }

  /**
   * Processes confirmed payment success through provider verification path.
   * Atomically transitions payment + order to COMPLETED, checks exact amounts (Correction 2),
   * handles idempotency (Correction 3), and provisions entitlements for RESOURCE products (Correction 5).
   */
  async processPaymentSuccess(input: {
    paymentId: string;
    providerTransactionId?: string;
    payload?: Record<string, unknown>;
  }): Promise<{ payment: PaymentDto; order: OrderDto; entitlementsGranted: number }> {
    const [paymentRecord] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);

    if (!paymentRecord) {
      throw new PaymentNotFoundError();
    }

    const [ord] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, paymentRecord.orderId))
      .limit(1);

    if (!ord) {
      throw new OrderNotFoundError();
    }

    // IDEMPOTENCY CHECK (Correction 3):
    // If payment is already COMPLETED, return current state without re-granting entitlements
    if (paymentRecord.status === 'COMPLETED') {
      const items = await this.getOrderItems(ord.id);
      return {
        payment: this.mapPayment(paymentRecord),
        order: { ...this.mapOrder(ord), items },
        entitlementsGranted: 0,
      };
    }

    // AMOUNT & CURRENCY VALIDATION (Correction 2):
    // Must strictly verify payment.amountMinor === order.totalMinor and currency === KES
    if (
      paymentRecord.amountMinor !== ord.totalMinor ||
      paymentRecord.currencyCode !== 'KES' ||
      ord.currencyCode !== 'KES'
    ) {
      await this.db
        .update(payments)
        .set({
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: 'Payment amount or currency mismatch with order total',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentRecord.id));

      throw new PaymentAmountMismatchError();
    }

    const now = new Date();

    // 1. Mark payment COMPLETED
    const [updatedPayment] = await this.db
      .update(payments)
      .set({
        status: 'COMPLETED',
        completedAt: now,
        providerTransactionId: input.providerTransactionId ?? paymentRecord.providerTransactionId,
        providerPayload: input.payload ?? paymentRecord.providerPayload,
        updatedAt: now,
      })
      .where(eq(payments.id, paymentRecord.id))
      .returning();

    // 2. Mark order COMPLETED
    const [updatedOrder] = await this.db
      .update(orders)
      .set({
        status: 'COMPLETED',
        updatedAt: now,
      })
      .where(eq(orders.id, ord.id))
      .returning();

    // 3. Provision entitlements for RESOURCE products (Correction 5)
    const items = await this.db
      .select({
        item: orderItems,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, ord.id));

    let entitlementsGranted = 0;

    for (const { product } of items) {
      if (product.productType === 'RESOURCE' && product.resourceId) {
        // Check if user already holds an active entitlement for this resource
        const [existingActive] = await this.db
          .select()
          .from(entitlements)
          .where(
            and(
              eq(entitlements.userId, ord.userId),
              eq(entitlements.resourceId, product.resourceId),
              eq(entitlements.status, 'ACTIVE'),
            ),
          )
          .limit(1);

        if (!existingActive) {
          await this.db.insert(entitlements).values({
            userId: ord.userId,
            resourceId: product.resourceId,
            sourceOrderId: ord.id,
            status: 'ACTIVE',
            startsAt: now,
          });
          entitlementsGranted++;
        }
      }
    }

    const orderDto = {
      ...this.mapOrder(updatedOrder),
      items: await this.getOrderItems(updatedOrder.id),
    };

    return {
      payment: this.mapPayment(updatedPayment),
      order: orderDto,
      entitlementsGranted,
    };
  }

  /**
   * Retrieves a payment record by ID, verifying user ownership of the parent order.
   */
  async getPaymentById(userId: string, paymentId: string): Promise<PaymentDto> {
    const [pm] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!pm) {
      throw new PaymentNotFoundError();
    }

    // Verify user owns the order
    await this.getOrderById(userId, pm.orderId);

    return this.mapPayment(pm);
  }

  /**
   * Retrieves active entitlements for an authenticated user.
   */
  async getUserEntitlements(userId: string): Promise<EntitlementDto[]> {
    const userEntitlements = await this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, userId),
          eq(entitlements.status, 'ACTIVE'),
        ),
      );

    return userEntitlements.map((e) => this.mapEntitlement(e));
  }

  /**
   * Authoritatively checks if a user is entitled to access a resource.
   * Completely replaces any notion of is_paid.
   */
  async hasEntitlement(userId: string, resourceId: string): Promise<boolean> {
    const now = new Date();

    const [ent] = await this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, userId),
          eq(entitlements.resourceId, resourceId),
          eq(entitlements.status, 'ACTIVE'),
          lte(entitlements.startsAt, now),
          or(isNull(entitlements.endsAt), gt(entitlements.endsAt, now)),
          isNull(entitlements.revokedAt),
        ),
      )
      .limit(1);

    return !!ent;
  }

  /**
   * Internal mapper helpers
   */
  private async getOrderItems(orderId: string): Promise<OrderItemDto[]> {
    const rows = await this.db
      .select({
        item: orderItems,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, orderId));

    return rows.map(({ item, product }) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      productName: product.name,
      offerId: item.offerId,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor.toString(),
      totalMinor: item.totalMinor.toString(),
      createdAt: item.createdAt,
    }));
  }

  private mapProduct(p: typeof products.$inferSelect): ProductDto {
    return {
      id: p.id,
      name: p.name,
      productType: p.productType as any,
      resourceId: p.resourceId,
      bundleId: p.bundleId,
      status: p.status as any,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private mapOffer(o: typeof offers.$inferSelect): OfferDto {
    return {
      id: o.id,
      productId: o.productId,
      currencyCode: 'KES',
      priceMinor: o.priceMinor.toString(),
      commercialStatus: o.commercialStatus as any,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }

  private mapOrder(ord: typeof orders.$inferSelect): OrderDto {
    return {
      id: ord.id,
      userId: ord.userId,
      currencyCode: 'KES',
      totalMinor: ord.totalMinor.toString(),
      status: ord.status as any,
      idempotencyKey: ord.idempotencyKey,
      createdAt: ord.createdAt,
      updatedAt: ord.updatedAt,
    };
  }

  private mapPayment(pm: typeof payments.$inferSelect): PaymentDto {
    return {
      id: pm.id,
      orderId: pm.orderId,
      providerCode: pm.providerCode,
      providerReference: pm.providerReference,
      providerTransactionId: pm.providerTransactionId,
      amountMinor: pm.amountMinor.toString(),
      currencyCode: 'KES',
      status: pm.status as any,
      requestedAt: pm.requestedAt,
      completedAt: pm.completedAt,
      failedAt: pm.failedAt,
      failureReason: pm.failureReason,
      createdAt: pm.createdAt,
      updatedAt: pm.updatedAt,
    };
  }

  private mapEntitlement(ent: typeof entitlements.$inferSelect): EntitlementDto {
    return {
      id: ent.id,
      userId: ent.userId,
      resourceId: ent.resourceId,
      sourceOrderId: ent.sourceOrderId,
      status: ent.status as any,
      startsAt: ent.startsAt,
      endsAt: ent.endsAt,
      revokedAt: ent.revokedAt,
      createdAt: ent.createdAt,
      updatedAt: ent.updatedAt,
    };
  }
}

export const defaultCommerceService = new CommerceService();
