import { eq, and, sql, isNull, gt, lte, or, inArray, desc } from 'drizzle-orm';
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
  MpesaPaymentProvider,
  type MpesaInitiationResult,
} from './mpesa/mpesa-payment-provider.js';
import type {
  DarajaStkQueryResult,
  NormalizedMpesaCallback,
} from './mpesa/mpesa.types.js';
import {
  type ContributorFinanceService,
  defaultContributorFinanceService,
} from '../contributor-finance.service.js';
import { env } from '../../config/env.js';
import {
  type ProductDto,
  type OfferDto,
  type OrderDto,
  type OrderItemDto,
  type PaymentDto,
  type AdminPaymentDto,
  type EntitlementDto,
  type CreateOrderInput,
  type ReceiptVerificationSource,
  type ResolveReconciliationInput,
  ProductNotFoundError,
  OfferNotFoundError,
  OfferNotValidError,
  ProductTypeNotSupportedError,
  OrderNotFoundError,
  PaymentNotFoundError,
  UnauthorizedCommerceAccessError,
  InvalidStateTransitionError,
  OrderPaymentInProgressError,
  SimulationDisabledError,
  PaymentAmountMismatchError,
  DuplicatePaymentReferenceError,
  PaymentProviderNotFoundError,
} from './commerce.interface.js';

export const INITIAL_MPESA_VERIFICATION_DELAY_MS = 45_000;
export const MAX_MPESA_VERIFICATION_ATTEMPTS = 10;

export function computeNextMpesaVerificationAt(
  attemptsCompleted: number,
  now: Date = new Date(),
): Date {
  // Deterministic bounded exponential backoff: 15s, 30s, 60s, 120s, 240s, capped at 300s
  const baseSec = Math.min(300, 15 * Math.pow(2, Math.max(0, attemptsCompleted - 1)));
  return new Date(now.getTime() + baseSec * 1000);
}

export interface CommerceServiceOptions {
  db?: NodePgDatabase<typeof schemas>;
  paymentProvider?: PaymentProvider;
  paymentProviders?: Map<string, PaymentProvider> | Record<string, PaymentProvider>;
  contributorFinanceService?: ContributorFinanceService;
  allowSimulation?: boolean;
  nodeEnv?: 'development' | 'test' | 'production';
}

export class CommerceService {
  private readonly db: NodePgDatabase<typeof schemas>;
  private readonly contributorFinanceService: ContributorFinanceService;
  private readonly providers: Map<string, PaymentProvider> = new Map();
  private readonly simulationEnabled: boolean;
  private readonly effectiveNodeEnv: 'development' | 'test' | 'production';

  constructor(options: CommerceServiceOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.contributorFinanceService =
      options.contributorFinanceService ?? defaultContributorFinanceService;
    this.effectiveNodeEnv = options.nodeEnv ?? env.NODE_ENV;

    // W1-AC-03: Simulation is strictly banned in production regardless of options
    if (this.effectiveNodeEnv === 'production') {
      if (
        options.allowSimulation === true ||
        options.paymentProvider?.providerCode.toUpperCase() === 'SIMULATION'
      ) {
        throw new SimulationDisabledError(
          'SimulationPaymentProvider cannot be enabled or registered in production.',
        );
      }
      this.simulationEnabled = false;
    } else {
      const explicitSimProvider =
        options.paymentProvider?.providerCode.toUpperCase() === 'SIMULATION';
      this.simulationEnabled =
        options.allowSimulation ?? (explicitSimProvider ? true : env.ALLOW_PAYMENT_SIMULATION);
    }

    if (options.paymentProvider) {
      if (
        this.effectiveNodeEnv === 'production' &&
        options.paymentProvider.providerCode.toUpperCase() === 'SIMULATION'
      ) {
        throw new SimulationDisabledError(
          'SimulationPaymentProvider cannot be registered in production.',
        );
      }
      this.registerProvider(options.paymentProvider);
    } else if (this.simulationEnabled) {
      this.registerProvider(new SimulationPaymentProvider());
    }

    // Register additional providers if provided in options
    if (options.paymentProviders) {
      const entries =
        options.paymentProviders instanceof Map
          ? Array.from(options.paymentProviders.entries())
          : Object.entries(options.paymentProviders);

      for (const [code, p] of entries) {
        if (
          this.effectiveNodeEnv === 'production' &&
          (code.toUpperCase() === 'SIMULATION' ||
            p.providerCode.toUpperCase() === 'SIMULATION')
        ) {
          throw new SimulationDisabledError(
            'SimulationPaymentProvider cannot be registered in production.',
          );
        }
        this.providers.set(code.toUpperCase(), p);
      }
    }

    // Auto-register M-Pesa provider if configured and not overridden
    if (
      !this.providers.has('MPESA') &&
      env.MPESA_CONSUMER_KEY &&
      env.MPESA_CONSUMER_SECRET
    ) {
      try {
        this.registerProvider(
          new MpesaPaymentProvider({
            config: {
              environment: env.MPESA_ENVIRONMENT,
              consumerKey: env.MPESA_CONSUMER_KEY,
              consumerSecret: env.MPESA_CONSUMER_SECRET,
              shortcode: env.MPESA_SHORTCODE || '174379',
              passkey: env.MPESA_PASSKEY || '',
              callbackUrl: env.MPESA_CALLBACK_URL || '',
            },
          }),
        );
      } catch {
        // Ignored if configuration is incomplete
      }
    }
  }

  isSimulationEnabled(): boolean {
    return this.simulationEnabled && this.effectiveNodeEnv !== 'production';
  }

  /**
   * Registers a payment provider.
   */
  registerProvider(provider: PaymentProvider): void {
    const code = provider.providerCode.toUpperCase();
    if (this.effectiveNodeEnv === 'production' && code === 'SIMULATION') {
      throw new SimulationDisabledError(
        'SimulationPaymentProvider cannot be registered in production.',
      );
    }
    this.providers.set(code, provider);
  }

  /**
   * Retrieves a registered payment provider by its code.
   */
  getPaymentProvider(providerCode: string): PaymentProvider {
    const code = providerCode.toUpperCase();
    if (code === 'SIMULATION' && !this.isSimulationEnabled()) {
      throw new SimulationDisabledError('Payment simulation provider is disabled');
    }
    const provider = this.providers.get(code);
    if (!provider) {
      throw new PaymentProviderNotFoundError(
        `Payment provider "${providerCode}" is not registered or supported`,
      );
    }
    return provider;
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
   */
  async getActiveProducts(): Promise<ProductDto[]> {
    const now = new Date();

    const activeProductRows = await this.db
      .select()
      .from(products)
      .where(eq(products.status, 'ACTIVE'));

    if (activeProductRows.length === 0) {
      return [];
    }

    const productIds = activeProductRows.map((p) => p.id);

    const activeOffers = await this.db
      .select()
      .from(offers)
      .where(
        and(
          inArray(offers.productId, productIds),
          eq(offers.commercialStatus, 'ACTIVE'),
          or(isNull(offers.startsAt), lte(offers.startsAt, now)),
          or(isNull(offers.endsAt), gt(offers.endsAt, now)),
        ),
      );

    const offersByProduct = new Map<string, typeof activeOffers>();
    for (const off of activeOffers) {
      const list = offersByProduct.get(off.productId) || [];
      list.push(off);
      offersByProduct.set(off.productId, list);
    }

    return activeProductRows.map((p) => ({
      ...this.mapProduct(p),
      activeOffers: (offersByProduct.get(p.id) || []).map((o) => this.mapOffer(o)),
    }));
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
   * Enforces user-scoped idempotency `(user_id, idempotency_key)` (`W1-AC-02`).
   */
  async createOrder(
    userId: string,
    input: CreateOrderInput,
  ): Promise<OrderDto> {
    if (!input.items || input.items.length === 0) {
      throw new OfferNotValidError('Order must contain at least one item');
    }

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

    try {
      const createdOrder = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
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
          await tx.insert(orderItems).values({
            orderId: inserted.id,
            productId: item.product.id,
            offerId: item.offer.id,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            totalMinor: item.totalMinor,
          });
        }

        return inserted;
      });

      const items = await this.getOrderItems(createdOrder.id);
      return {
        ...this.mapOrder(createdOrder),
        items,
      };
    } catch (err: any) {
      const isUniqueViolation =
        err?.code === '23505' ||
        err?.cause?.code === '23505' ||
        err?.cause?.cause?.code === '23505';
      if (isUniqueViolation && input.idempotencyKey) {
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
      throw err;
    }
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
   * - Network dispatch to provider runs OUTSIDE DB locks.
   * - Persistence locks `commerce.orders` (`FOR UPDATE`) BEFORE `commerce.payments` (`W1-AC-07`).
   * - Schedules `next_verification_at = now + 45s` for M-Pesa (`W1-AC-06`).
   * - Permits retry attempts if prior attempts are terminal (`FAILED` / `CANCELLED`), while blocking
   *   duplicate active in-flight attempts (`PENDING` / `PROCESSING` / `RECONCILIATION_REQUIRED`).
   */
  async initiatePayment(
    userId: string,
    orderId: string,
    providerCode = 'MPESA',
    metadata?: Record<string, unknown>,
  ): Promise<{ payment: PaymentDto; order: OrderDto }> {
    const normalizedProviderCode = providerCode.toUpperCase();
    const provider = this.getPaymentProvider(normalizedProviderCode);

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

    // Check for any active in-flight payment on this order before invoking upstream gateway
    const [existingInFlight] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, ord.id),
          inArray(payments.status, ['PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED']),
        ),
      )
      .limit(1);

    if (existingInFlight) {
      throw new OrderPaymentInProgressError();
    }

    // Dispatch to payment provider OUTSIDE DB transaction (no locks held during HTTP I/O)
    const initResult = await provider.createPayment({
      orderId: ord.id,
      amountMinor: ord.totalMinor,
      currencyCode: 'KES',
      userId,
      metadata,
    });

    const mpesaMeta = initResult as Partial<MpesaInitiationResult>;
    const isMpesa = (initResult.providerCode || normalizedProviderCode) === 'MPESA';
    const now = new Date();

    const { paymentRecord, updatedOrderRow } = await this.db.transaction(async (tx) => {
      // Lock order FIRST (`W1-AC-07`)
      const [lockedOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ord.id))
        .for('update')
        .limit(1);

      if (!lockedOrder) {
        throw new OrderNotFoundError();
      }
      if (lockedOrder.status === 'COMPLETED') {
        throw new InvalidStateTransitionError('Order is already completed');
      }

      // Lock existing payments for this order SECOND (`W1-AC-07`)
      const activeSiblings = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.orderId, lockedOrder.id),
            inArray(payments.status, ['PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED']),
          ),
        )
        .for('update');

      if (activeSiblings.length > 0) {
        throw new OrderPaymentInProgressError();
      }

      const [updatedOrd] = await tx
        .update(orders)
        .set({
          status: 'PROCESSING',
          updatedAt: now,
        })
        .where(eq(orders.id, lockedOrder.id))
        .returning();

      const [insertedPayment] = await tx
        .insert(payments)
        .values({
          orderId: lockedOrder.id,
          providerCode: initResult.providerCode || normalizedProviderCode,
          providerReference: initResult.providerReference,
          providerMerchantRequestId: mpesaMeta.providerMerchantRequestId ?? null,
          providerTransactionId: initResult.providerTransactionId ?? null,
          initiatedPhoneHash: mpesaMeta.initiatedPhoneHash ?? null,
          amountMinor: lockedOrder.totalMinor,
          currencyCode: 'KES',
          status: isMpesa ? 'PROCESSING' : 'PENDING',
          requestedAt: now,
          nextVerificationAt: isMpesa
            ? new Date(now.getTime() + INITIAL_MPESA_VERIFICATION_DELAY_MS)
            : null,
          providerPayload: initResult.payload ?? null,
        })
        .returning();

      return { paymentRecord: insertedPayment, updatedOrderRow: updatedOrd };
    });

    const items = await this.getOrderItems(updatedOrderRow.id);
    return {
      payment: this.mapPayment(paymentRecord),
      order: {
        ...this.mapOrder(updatedOrderRow),
        items,
      },
    };
  }

  /**
   * Processes confirmed simulated/non-M-Pesa payment success (strictly forbidden for SIMULATION in production).
   * Enforces canonical `orders` -> `payments` `FOR UPDATE` lock ordering (`W1-AC-07`).
   */
  async processPaymentSuccess(input: {
    paymentId: string;
    providerTransactionId?: string;
    payload?: Record<string, unknown>;
  }): Promise<{ payment: PaymentDto; order: OrderDto; entitlementsGranted: number }> {
    const [lookupPayment] = await this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        providerCode: payments.providerCode,
      })
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);

    if (!lookupPayment) {
      throw new PaymentNotFoundError();
    }

    if (
      lookupPayment.providerCode === 'SIMULATION' &&
      !this.isSimulationEnabled()
    ) {
      throw new SimulationDisabledError(
        'Simulated payment settlement is disabled.',
      );
    }

    const settled = await this.db.transaction(async (tx) => {
      // 1. Lock order FIRST (`W1-AC-07`)
      const [lockedOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, lookupPayment.orderId))
        .for('update')
        .limit(1);

      if (!lockedOrder) {
        throw new OrderNotFoundError();
      }

      // 2. Lock payment SECOND (`W1-AC-07`)
      const [lockedPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, lookupPayment.id))
        .for('update')
        .limit(1);

      if (!lockedPayment) {
        throw new PaymentNotFoundError();
      }

      if (lockedPayment.status === 'COMPLETED') {
        return {
          payment: lockedPayment,
          order: lockedOrder,
          entitlementsGranted: 0,
        };
      }

      if (
        lockedPayment.amountMinor !== lockedOrder.totalMinor ||
        lockedPayment.currencyCode !== 'KES' ||
        lockedOrder.currencyCode !== 'KES'
      ) {
        await tx
          .update(payments)
          .set({
            status: 'FAILED',
            failedAt: new Date(),
            failureReason: 'Payment amount or currency mismatch with order total',
            updatedAt: new Date(),
          })
          .where(eq(payments.id, lockedPayment.id));

        throw new PaymentAmountMismatchError();
      }

      return this.settleVerifiedPaymentInTx(tx, lockedOrder, lockedPayment, {
        providerTransactionId:
          input.providerTransactionId ?? lockedPayment.providerTransactionId ?? null,
        verifiedReceiptNumber: null,
        receiptVerificationSource: null,
        providerPayload: input.payload ?? (lockedPayment.providerPayload as Record<string, unknown> | null),
      });
    });

    const items = await this.getOrderItems(settled.order.id);
    return {
      payment: this.mapPayment(settled.payment),
      order: {
        ...this.mapOrder(settled.order),
        items,
      },
      entitlementsGranted: settled.entitlementsGranted,
    };
  }

  /**
   * 3-Phase Lock-Free M-Pesa Callback Wake-Up & Server-Side Verification (`W1-AC-05`, `W1-AC-07`).
   *
   * - Callback is treated strictly as an UNTRUSTED wake-up hint:
   *   - Never marks a payment `COMPLETED`, `FAILED`, or `CANCELLED` from callback payload alone.
   *   - Never writes `verified_receipt_number` from callback metadata (`callback_receipt_candidate` only).
   * - Phase 1 (short DB tx, lock `orders` -> `payments`): records candidate metadata & `next_verification_at = now`.
   * - Phase 2 (ZERO DB locks held): queries Safaricom Daraja `stkpushquery/v1/query`.
   * - Phase 3 (short DB tx, lock `orders` -> `payments`): applies authoritative Daraja query outcome.
   */
  async handleMpesaCallback(
    payload: unknown,
    rawBodyString?: string,
  ): Promise<{
    ack: { ResultCode: number; ResultDesc: string };
    result?: { paymentId: string; status: string; entitlementsGranted: number };
  }> {
    const mpesaProvider = this.getPaymentProvider('MPESA') as MpesaPaymentProvider;
    const callback = mpesaProvider.parseCallback(payload, rawBodyString);

    // Non-locking index lookup to locate orderId + paymentId
    const [lookup] = await this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.providerCode, 'MPESA'),
          eq(payments.providerReference, callback.checkoutRequestId),
        ),
      )
      .limit(1);

    if (!lookup) {
      return {
        ack: { ResultCode: 0, ResultDesc: 'Accepted' },
      };
    }

    const now = new Date();

    // Phase 1: Record untrusted wake-up metadata under strict `orders` -> `payments` lock order
    const phase1 = await this.db.transaction(async (tx) => {
      const [lockedOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, lookup.orderId))
        .for('update')
        .limit(1);

      const [lockedPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, lookup.id))
        .for('update')
        .limit(1);

      if (!lockedOrder || !lockedPayment) {
        return { shouldQuery: false as const, status: 'UNKNOWN' };
      }

      if (
        lockedPayment.status === 'COMPLETED' ||
        lockedPayment.status === 'FAILED' ||
        lockedPayment.status === 'CANCELLED' ||
        lockedPayment.status === 'RECONCILIATION_REQUIRED'
      ) {
        return {
          shouldQuery: false as const,
          paymentId: lockedPayment.id,
          status: lockedPayment.status,
        };
      }

      // If MerchantRequestID mismatches, NEVER fail the payment from an untrusted callback;
      // simply wake up immediate server-side Daraja verification.
      const merchantMatches =
        !lockedPayment.providerMerchantRequestId ||
        lockedPayment.providerMerchantRequestId === callback.merchantRequestId;

      const existingPayload =
        lockedPayment.providerPayload && typeof lockedPayment.providerPayload === 'object'
          ? (lockedPayment.providerPayload as Record<string, unknown>)
          : {};

      const mergedPayload: Record<string, unknown> = {
        ...existingPayload,
        lastCallbackHint: merchantMatches
          ? callback.sanitizedSummary
          : {
              ignoredMerchantMismatch: true,
              receivedAt: now.toISOString(),
            },
      };

      await tx
        .update(payments)
        .set({
          callbackReceivedAt: lockedPayment.callbackReceivedAt ?? now,
          callbackReceiptCandidate:
            merchantMatches && callback.mpesaReceiptNumber
              ? lockedPayment.callbackReceiptCandidate ?? callback.mpesaReceiptNumber
              : lockedPayment.callbackReceiptCandidate,
          nextVerificationAt: now,
          updatedAt: now,
          providerPayload: mergedPayload,
        })
        .where(eq(payments.id, lockedPayment.id));

      return {
        shouldQuery: true as const,
        paymentId: lockedPayment.id,
        orderId: lockedOrder.id,
        merchantMatches,
      };
    });

    if (!phase1.shouldQuery) {
      if ('paymentId' in phase1 && phase1.paymentId) {
        return {
          ack: { ResultCode: 0, ResultDesc: 'Accepted' },
          result: {
            paymentId: phase1.paymentId,
            status: phase1.status,
            entitlementsGranted: 0,
          },
        };
      }
      return {
        ack: { ResultCode: 0, ResultDesc: 'Accepted' },
      };
    }

    // Phase 2: Authoritative server-to-server Daraja query OUTSIDE any DB lock
    const queryResult = await mpesaProvider.queryTransactionStatus(
      callback.checkoutRequestId,
    );

    // Phase 3: Apply authoritative Daraja outcome under strict `orders` -> `payments` lock order
    const outcome = await this.db.transaction(async (tx) =>
      this.applyDarajaQueryOutcomeInTx(tx, phase1.orderId, phase1.paymentId, queryResult, {
        callbackHint: phase1.merchantMatches ? callback : undefined,
      }),
    );

    return {
      ack: { ResultCode: 0, ResultDesc: 'Accepted' },
      result: {
        paymentId: phase1.paymentId,
        status: outcome.status,
        entitlementsGranted: outcome.entitlementsGranted,
      },
    };
  }

  /**
   * Executes one server-side reconciliation attempt for an M-Pesa payment by ID
   * (invoked by `MpesaReconciliationWorker`, holding ZERO DB locks during Daraja HTTP call).
   */
  async reconcileMpesaPaymentById(
    paymentId: string,
    workerId?: string,
  ): Promise<{ paymentId: string; status: string; entitlementsGranted: number } | null> {
    const [lookup] = await this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        providerCode: payments.providerCode,
        providerReference: payments.providerReference,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (
      !lookup ||
      lookup.providerCode !== 'MPESA' ||
      !lookup.providerReference ||
      (lookup.status !== 'PENDING' && lookup.status !== 'PROCESSING')
    ) {
      return null;
    }

    const mpesaProvider = this.getPaymentProvider('MPESA') as MpesaPaymentProvider;
    const queryResult = await mpesaProvider.queryTransactionStatus(
      lookup.providerReference,
    );

    const outcome = await this.db.transaction(async (tx) =>
      this.applyDarajaQueryOutcomeInTx(tx, lookup.orderId, lookup.id, queryResult, {
        workerId,
      }),
    );

    return {
      paymentId: lookup.id,
      status: outcome.status,
      entitlementsGranted: outcome.entitlementsGranted,
    };
  }

  /**
   * Admin endpoint helper: lists payments requiring manual reconciliation (`W1-AC-06`).
   */
  async listReconciliationQueue(options?: {
    status?: 'RECONCILIATION_REQUIRED' | 'PROCESSING' | 'FAILED';
    limit?: number;
  }): Promise<AdminPaymentDto[]> {
    const targetStatus = options?.status ?? 'RECONCILIATION_REQUIRED';
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);

    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.status, targetStatus))
      .orderBy(desc(payments.updatedAt))
      .limit(limit);

    return rows.map((pm) => this.mapAdminPayment(pm));
  }

  /**
   * Admin endpoint helper: resets bounded verification attempts and requeues a payment (`W1-AC-06`).
   */
  async requeuePaymentVerification(paymentId: string): Promise<AdminPaymentDto> {
    const [lookup] = await this.db
      .select({ id: payments.id, orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!lookup) {
      throw new PaymentNotFoundError();
    }

    const now = new Date();

    const updated = await this.db.transaction(async (tx) => {
      // Lock order FIRST, payment SECOND (`W1-AC-07`)
      const [lockedOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, lookup.orderId))
        .for('update')
        .limit(1);

      if (!lockedOrder) {
        throw new OrderNotFoundError();
      }

      const [lockedPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, lookup.id))
        .for('update')
        .limit(1);

      if (!lockedPayment) {
        throw new PaymentNotFoundError();
      }

      if (lockedPayment.providerCode !== 'MPESA') {
        throw new InvalidStateTransitionError('Only MPESA payments can be requeued for Daraja verification');
      }

      if (lockedPayment.status === 'COMPLETED') {
        throw new InvalidStateTransitionError('Cannot requeue an already COMPLETED payment');
      }

      if (lockedOrder.status !== 'COMPLETED' && lockedOrder.status !== 'PROCESSING') {
        await tx
          .update(orders)
          .set({ status: 'PROCESSING', updatedAt: now })
          .where(eq(orders.id, lockedOrder.id));
      }

      const [requeued] = await tx
        .update(payments)
        .set({
          status: 'PROCESSING',
          verificationAttempts: 0,
          nextVerificationAt: now,
          verificationLockedAt: null,
          verificationLockedBy: null,
          updatedAt: now,
        })
        .where(eq(payments.id, lockedPayment.id))
        .returning();

      return requeued;
    });

    return this.mapAdminPayment(updated);
  }

  /**
   * Admin endpoint helper: manually resolves a `RECONCILIATION_REQUIRED` payment (`W1-AC-06`).
   * Enforces `ADMIN_RECONCILED_RECEIPT` provenance and `uq_payments_verified_receipt` uniqueness.
   */
  async resolvePaymentReconciliation(
    input: ResolveReconciliationInput,
  ): Promise<{ payment: AdminPaymentDto; order: OrderDto; entitlementsGranted: number }> {
    const trimmedReason = input.reason?.trim() || '';
    if (trimmedReason.length < 5) {
      throw new InvalidStateTransitionError(
        'A descriptive reconciliation reason (at least 5 characters) is required.',
      );
    }

    const [lookup] = await this.db
      .select({ id: payments.id, orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);

    if (!lookup) {
      throw new PaymentNotFoundError();
    }

    try {
      const resolved = await this.db.transaction(async (tx) => {
        // Lock order FIRST, payment SECOND (`W1-AC-07`)
        const [lockedOrder] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, lookup.orderId))
          .for('update')
          .limit(1);

        if (!lockedOrder) {
          throw new OrderNotFoundError();
        }

        const [lockedPayment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, lookup.id))
          .for('update')
          .limit(1);

        if (!lockedPayment) {
          throw new PaymentNotFoundError();
        }

        if (lockedPayment.status !== 'RECONCILIATION_REQUIRED') {
          throw new InvalidStateTransitionError(
            `Only RECONCILIATION_REQUIRED payments can be manually resolved (current: ${lockedPayment.status}).`,
          );
        }

        const now = new Date();
        const existingPayload =
          lockedPayment.providerPayload && typeof lockedPayment.providerPayload === 'object'
            ? (lockedPayment.providerPayload as Record<string, unknown>)
            : {};

        const adminResolutionPayload: Record<string, unknown> = {
          ...existingPayload,
          adminReconciliation: {
            actorUserId: input.actorUserId,
            outcome: input.outcome,
            reason: trimmedReason,
            resolvedAt: now.toISOString(),
          },
        };

        if (input.outcome === 'COMPLETE_WITH_RECEIPT') {
          const cleanReceipt = input.verifiedReceiptNumber?.trim() || '';
          if (cleanReceipt.length === 0 || cleanReceipt.length > 100) {
            throw new InvalidStateTransitionError(
              'A non-empty verifiedReceiptNumber is required when outcome is COMPLETE_WITH_RECEIPT.',
            );
          }

          if (lockedOrder.status === 'COMPLETED') {
            throw new InvalidStateTransitionError(
              'Order is already COMPLETED by a sibling payment; refund or mark duplicate payment instead.',
            );
          }

          return this.settleVerifiedPaymentInTx(tx, lockedOrder, lockedPayment, {
            providerTransactionId: cleanReceipt,
            verifiedReceiptNumber: cleanReceipt,
            receiptVerificationSource: 'ADMIN_RECONCILED_RECEIPT',
            verifiedAt: now,
            providerPayload: adminResolutionPayload,
          });
        }

        const targetStatus = input.outcome === 'MARK_CANCELLED' ? 'CANCELLED' : 'FAILED';
        const [updatedPayment] = await tx
          .update(payments)
          .set({
            status: targetStatus,
            failedAt: now,
            failureReason: `[ADMIN_RECONCILED] ${trimmedReason}`,
            nextVerificationAt: null,
            verificationLockedAt: null,
            verificationLockedBy: null,
            providerPayload: adminResolutionPayload,
            updatedAt: now,
          })
          .where(eq(payments.id, lockedPayment.id))
          .returning();

        let finalOrder = lockedOrder;
        if (lockedOrder.status !== 'COMPLETED') {
          const remainingActive = await tx
            .select({ id: payments.id })
            .from(payments)
            .where(
              and(
                eq(payments.orderId, lockedOrder.id),
                inArray(payments.status, ['PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED']),
              ),
            );
          if (remainingActive.length === 0) {
            const [ordUpdated] = await tx
              .update(orders)
              .set({ status: targetStatus, updatedAt: now })
              .where(eq(orders.id, lockedOrder.id))
              .returning();
            finalOrder = ordUpdated;
          }
        }

        return {
          payment: updatedPayment,
          order: finalOrder,
          entitlementsGranted: 0,
        };
      });

      const items = await this.getOrderItems(resolved.order.id);
      return {
        payment: this.mapAdminPayment(resolved.payment),
        order: {
          ...this.mapOrder(resolved.order),
          items,
        },
        entitlementsGranted: resolved.entitlementsGranted,
      };
    } catch (err: any) {
      const isUniqueViolation =
        err?.code === '23505' ||
        err?.cause?.code === '23505' ||
        err?.cause?.cause?.code === '23505';
      if (isUniqueViolation) {
        throw new DuplicatePaymentReferenceError(
          'The provided verifiedReceiptNumber is already linked to another payment.',
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves a payment record by ID, verifying user ownership of the parent order.
   * Returns redacted learner `PaymentDto` (`W1-AC-03`).
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
   * Applies an authoritative Daraja `stkpushquery` classification inside a transaction.
   * Enforces canonical `orders` -> `payments` `FOR UPDATE` lock ordering (`W1-AC-07`).
   */
  private async applyDarajaQueryOutcomeInTx(
    tx: Parameters<Parameters<NodePgDatabase<typeof schemas>['transaction']>[0]>[0],
    orderId: string,
    paymentId: string,
    queryResult: DarajaStkQueryResult,
    context?: {
      callbackHint?: NormalizedMpesaCallback;
      workerId?: string;
    },
  ): Promise<{ status: string; entitlementsGranted: number }> {
    // 1. Lock order FIRST (`W1-AC-07`)
    const [lockedOrder] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1);

    // 2. Lock payment SECOND (`W1-AC-07`)
    const [lockedPayment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1);

    if (!lockedOrder || !lockedPayment) {
      return { status: 'UNKNOWN', entitlementsGranted: 0 };
    }

    // Idempotency if already settled or terminal
    if (
      lockedPayment.status === 'COMPLETED' ||
      lockedPayment.status === 'FAILED' ||
      lockedPayment.status === 'CANCELLED' ||
      lockedPayment.status === 'RECONCILIATION_REQUIRED'
    ) {
      return { status: lockedPayment.status, entitlementsGranted: 0 };
    }

    const now = new Date();
    const existingPayload =
      lockedPayment.providerPayload && typeof lockedPayment.providerPayload === 'object'
        ? (lockedPayment.providerPayload as Record<string, unknown>)
        : {};

    const updatedPayload: Record<string, unknown> = {
      ...existingPayload,
      lastDarajaQuery: {
        classification: queryResult.classification,
        responseCode: queryResult.responseCode,
        resultCode: queryResult.resultCode,
        resultDesc: queryResult.resultDesc.slice(0, 250),
        httpStatus: queryResult.httpStatus,
        queriedAt: now.toISOString(),
        workerId: context?.workerId ?? 'inline',
      },
    };

    if (queryResult.classification === 'TRANSACTION_CONFIRMED_COMPLETED') {
      // Verify order & payment monetary invariants
      if (
        lockedPayment.amountMinor !== lockedOrder.totalMinor ||
        lockedPayment.currencyCode !== 'KES' ||
        lockedOrder.currencyCode !== 'KES'
      ) {
        await tx
          .update(payments)
          .set({
            status: 'RECONCILIATION_REQUIRED',
            verifiedAt: now,
            failureReason: `Order/payment amount mismatch detected during verified settlement: payment=${lockedPayment.amountMinor}, order=${lockedOrder.totalMinor}`,
            nextVerificationAt: null,
            verificationLockedAt: null,
            verificationLockedBy: null,
            providerPayload: updatedPayload,
            updatedAt: now,
          })
          .where(eq(payments.id, lockedPayment.id));
        return { status: 'RECONCILIATION_REQUIRED', entitlementsGranted: 0 };
      }

      // W1-AC-07: Sibling race protection — if another payment attempt ALREADY completed this order,
      // never duplicate entitlements or contributor earnings; park for financial reconciliation/refund.
      if (lockedOrder.status === 'COMPLETED') {
        await tx
          .update(payments)
          .set({
            status: 'RECONCILIATION_REQUIRED',
            verifiedAt: now,
            failureReason: 'DUPLICATE_PAID_ATTEMPT_ON_COMPLETED_ORDER',
            nextVerificationAt: null,
            verificationLockedAt: null,
            verificationLockedBy: null,
            providerPayload: updatedPayload,
            updatedAt: now,
          })
          .where(eq(payments.id, lockedPayment.id));
        return { status: 'RECONCILIATION_REQUIRED', entitlementsGranted: 0 };
      }

      // Note (`W1-AC-04`, `W1-AC-07`): Daraja `stkpushquery` does NOT return `MpesaReceiptNumber`.
      // Untrusted callback receipts remain strictly in `callback_receipt_candidate`;
      // `verified_receipt_number` and `receipt_verification_source` remain NULL unless verified
      // by a signed provider receipt channel or admin reconciliation.
      const settled = await this.settleVerifiedPaymentInTx(
        tx,
        lockedOrder,
        lockedPayment,
        {
          providerTransactionId: lockedPayment.providerTransactionId ?? null,
          verifiedReceiptNumber: null,
          receiptVerificationSource: null,
          verifiedAt: now,
          providerPayload: updatedPayload,
        },
      );

      return {
        status: 'COMPLETED',
        entitlementsGranted: settled.entitlementsGranted,
      };
    }

    if (
      queryResult.classification === 'TRANSACTION_CONFIRMED_CANCELLED' ||
      queryResult.classification === 'TRANSACTION_CONFIRMED_FAILED'
    ) {
      const terminalStatus =
        queryResult.classification === 'TRANSACTION_CONFIRMED_CANCELLED'
          ? 'CANCELLED'
          : 'FAILED';

      await tx
        .update(payments)
        .set({
          status: terminalStatus,
          verifiedAt: now,
          failedAt: now,
          failureReason:
            queryResult.resultDesc ||
            (terminalStatus === 'CANCELLED'
              ? 'M-Pesa transaction cancelled by user'
              : 'M-Pesa transaction failed'),
          nextVerificationAt: null,
          verificationLockedAt: null,
          verificationLockedBy: null,
          providerPayload: updatedPayload,
          updatedAt: now,
        })
        .where(eq(payments.id, lockedPayment.id));

      if (lockedOrder.status !== 'COMPLETED') {
        const activeSiblings = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.orderId, lockedOrder.id),
              inArray(payments.status, [
                'PENDING',
                'PROCESSING',
                'RECONCILIATION_REQUIRED',
              ]),
            ),
          );

        if (activeSiblings.length === 0) {
          await tx
            .update(orders)
            .set({
              status: terminalStatus,
              updatedAt: now,
            })
            .where(eq(orders.id, lockedOrder.id));
        }
      }

      return { status: terminalStatus, entitlementsGranted: 0 };
    }

    // Retryable inconclusive / transport error (`W1-AC-05`, `W1-AC-06`)
    const attempts = lockedPayment.verificationAttempts + 1;
    if (attempts >= MAX_MPESA_VERIFICATION_ATTEMPTS) {
      await tx
        .update(payments)
        .set({
          status: 'RECONCILIATION_REQUIRED',
          verificationAttempts: attempts,
          nextVerificationAt: null,
          verificationLockedAt: null,
          verificationLockedBy: null,
          failureReason: `MAX_VERIFICATION_ATTEMPTS_EXCEEDED (${attempts}): ${queryResult.resultDesc}`,
          providerPayload: updatedPayload,
          updatedAt: now,
        })
        .where(eq(payments.id, lockedPayment.id));

      return { status: 'RECONCILIATION_REQUIRED', entitlementsGranted: 0 };
    }

    await tx
      .update(payments)
      .set({
        status: 'PROCESSING',
        verificationAttempts: attempts,
        nextVerificationAt: computeNextMpesaVerificationAt(attempts, now),
        verificationLockedAt: null,
        verificationLockedBy: null,
        providerPayload: updatedPayload,
        updatedAt: now,
      })
      .where(eq(payments.id, lockedPayment.id));

    return { status: 'PROCESSING', entitlementsGranted: 0 };
  }

  /**
   * Unified transactional settlement engine (`W1-AC-07`):
   * Assumes caller has ALREADY locked `lockedOrder` (`FOR UPDATE`) FIRST and `lockedPayment` (`FOR UPDATE`) SECOND.
   * Atomically marks payment + order `COMPLETED`, grants `commerce.entitlements` idempotently,
   * and records `community.contributor_earnings` idempotently.
   */
  private async settleVerifiedPaymentInTx(
    tx: Parameters<Parameters<NodePgDatabase<typeof schemas>['transaction']>[0]>[0],
    lockedOrder: typeof orders.$inferSelect,
    lockedPayment: typeof payments.$inferSelect,
    opts: {
      providerTransactionId: string | null;
      verifiedReceiptNumber: string | null;
      receiptVerificationSource: ReceiptVerificationSource | null;
      verifiedAt?: Date;
      providerPayload?: Record<string, unknown> | null;
    },
  ): Promise<{
    payment: typeof payments.$inferSelect;
    order: typeof orders.$inferSelect;
    entitlementsGranted: number;
  }> {
    const now = opts.verifiedAt ?? new Date();

    const [updatedPayment] = await tx
      .update(payments)
      .set({
        status: 'COMPLETED',
        verifiedAt: opts.verifiedAt ?? lockedPayment.verifiedAt ?? now,
        completedAt: now,
        providerTransactionId: opts.providerTransactionId,
        verifiedReceiptNumber: opts.verifiedReceiptNumber,
        receiptVerificationSource: opts.receiptVerificationSource,
        nextVerificationAt: null,
        verificationLockedAt: null,
        verificationLockedBy: null,
        failureReason: null,
        providerPayload: opts.providerPayload ?? lockedPayment.providerPayload,
        updatedAt: now,
      })
      .where(eq(payments.id, lockedPayment.id))
      .returning();

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        status: 'COMPLETED',
        updatedAt: now,
      })
      .where(eq(orders.id, lockedOrder.id))
      .returning();

    const items = await tx
      .select({
        item: orderItems,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, lockedOrder.id));

    let entitlementsGranted = 0;

    for (const { product } of items) {
      if (product.productType === 'RESOURCE' && product.resourceId) {
        const insertedEntitlement = await tx
          .insert(entitlements)
          .values({
            userId: lockedOrder.userId,
            resourceId: product.resourceId,
            sourceOrderId: lockedOrder.id,
            status: 'ACTIVE',
            startsAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: entitlements.id });

        if (insertedEntitlement.length > 0) {
          entitlementsGranted++;
        }
      }
    }

    await this.contributorFinanceService.recordOrderEarnings(tx, lockedOrder.id, now);

    return {
      payment: updatedPayment,
      order: updatedOrder,
      entitlementsGranted,
    };
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

  /**
   * Redacts `CheckoutRequestID` (`providerReference`) for M-Pesa payments on learner DTOs (`W1-AC-03`).
   */
  private mapPayment(pm: typeof payments.$inferSelect): PaymentDto {
    const isMpesa = pm.providerCode === 'MPESA';
    return {
      id: pm.id,
      orderId: pm.orderId,
      providerCode: pm.providerCode,
      providerReference: isMpesa ? null : pm.providerReference,
      providerTransactionId: pm.providerTransactionId,
      verifiedReceiptNumber: pm.verifiedReceiptNumber ?? null,
      receiptVerificationSource:
        (pm.receiptVerificationSource as ReceiptVerificationSource | null) ?? null,
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

  private mapAdminPayment(pm: typeof payments.$inferSelect): AdminPaymentDto {
    return {
      id: pm.id,
      orderId: pm.orderId,
      providerCode: pm.providerCode,
      providerReference: pm.providerReference,
      providerMerchantRequestId: pm.providerMerchantRequestId ?? null,
      providerTransactionId: pm.providerTransactionId,
      initiatedPhoneHash: pm.initiatedPhoneHash ?? null,
      callbackReceiptCandidate: pm.callbackReceiptCandidate ?? null,
      verifiedReceiptNumber: pm.verifiedReceiptNumber ?? null,
      receiptVerificationSource:
        (pm.receiptVerificationSource as ReceiptVerificationSource | null) ?? null,
      amountMinor: pm.amountMinor.toString(),
      currencyCode: 'KES',
      status: pm.status as any,
      requestedAt: pm.requestedAt,
      callbackReceivedAt: pm.callbackReceivedAt ?? null,
      verifiedAt: pm.verifiedAt ?? null,
      completedAt: pm.completedAt,
      failedAt: pm.failedAt,
      failureReason: pm.failureReason,
      verificationAttempts: pm.verificationAttempts ?? 0,
      nextVerificationAt: pm.nextVerificationAt ?? null,
      verificationLockedAt: pm.verificationLockedAt ?? null,
      verificationLockedBy: pm.verificationLockedBy ?? null,
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
