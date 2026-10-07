export type ProductType = 'RESOURCE' | 'BUNDLE';

export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type CommercialStatus = 'ACTIVE' | 'INACTIVE';

export type OrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type EntitlementStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ProductDto {
  id: string;
  name: string;
  productType: ProductType;
  resourceId: string | null;
  bundleId: string | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
  activeOffers?: OfferDto[];
}

export interface OfferDto {
  id: string;
  productId: string;
  currencyCode: 'KES';
  priceMinor: string; // Serialized string representation of bigint
  commercialStatus: CommercialStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  productId: string;
  productName?: string;
  offerId: string;
  quantity: number;
  unitPriceMinor: string; // Serialized string representation of bigint
  totalMinor: string; // Serialized string representation of bigint
  createdAt: Date;
}

export interface OrderDto {
  id: string;
  userId: string;
  currencyCode: 'KES';
  totalMinor: string; // Serialized string representation of bigint
  status: OrderStatus;
  idempotencyKey: string | null;
  items?: OrderItemDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentDto {
  id: string;
  orderId: string;
  providerCode: string;
  providerReference: string | null;
  providerTransactionId: string | null;
  amountMinor: string; // Serialized string representation of bigint
  currencyCode: 'KES';
  status: PaymentStatus;
  requestedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntitlementDto {
  id: string;
  userId: string;
  resourceId: string;
  sourceOrderId: string | null;
  status: EntitlementStatus;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderItemInput {
  offerId: string;
  quantity?: number;
}

export interface CreateOrderInput {
  items: CreateOrderItemInput[];
  idempotencyKey?: string;
}

export interface ProcessPaymentInput {
  paymentId: string;
  providerReference?: string;
  providerTransactionId?: string;
  status?: 'COMPLETED' | 'FAILED';
  failureReason?: string;
  payload?: Record<string, unknown>;
}

/**
 * Domain error classes
 */
export class CommerceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

export class ProductNotFoundError extends CommerceError {
  constructor(message = 'Product not found') {
    super(message, 'PRODUCT_NOT_FOUND', 404);
    this.name = 'ProductNotFoundError';
  }
}

export class OfferNotFoundError extends CommerceError {
  constructor(message = 'Offer not found') {
    super(message, 'OFFER_NOT_FOUND', 404);
    this.name = 'OfferNotFoundError';
  }
}

export class OfferNotValidError extends CommerceError {
  constructor(message = 'Offer is inactive, expired, or currency is unsupported') {
    super(message, 'OFFER_NOT_VALID', 400);
    this.name = 'OfferNotValidError';
  }
}

export class ProductTypeNotSupportedError extends CommerceError {
  constructor(message = 'Product type is not supported for single-item checkout in Prompt 18') {
    super(message, 'PRODUCT_TYPE_NOT_SUPPORTED', 400);
    this.name = 'ProductTypeNotSupportedError';
  }
}

export class OrderNotFoundError extends CommerceError {
  constructor(message = 'Order not found') {
    super(message, 'ORDER_NOT_FOUND', 404);
    this.name = 'OrderNotFoundError';
  }
}

export class PaymentNotFoundError extends CommerceError {
  constructor(message = 'Payment not found') {
    super(message, 'PAYMENT_NOT_FOUND', 404);
    this.name = 'PaymentNotFoundError';
  }
}

export class UnauthorizedCommerceAccessError extends CommerceError {
  constructor(message = 'You do not have permission to view or mutate this commerce resource') {
    super(message, 'UNAUTHORIZED_COMMERCE_ACCESS', 403);
    this.name = 'UnauthorizedCommerceAccessError';
  }
}

export class InvalidStateTransitionError extends CommerceError {
  constructor(message = 'Invalid state transition for order or payment') {
    super(message, 'INVALID_STATE_TRANSITION', 400);
    this.name = 'InvalidStateTransitionError';
  }
}

export class PaymentAmountMismatchError extends CommerceError {
  constructor(message = 'Payment amount or currency does not match order total') {
    super(message, 'PAYMENT_AMOUNT_MISMATCH', 400);
    this.name = 'PaymentAmountMismatchError';
  }
}

export class DuplicatePaymentReferenceError extends CommerceError {
  constructor(message = 'Duplicate payment provider reference already recorded') {
    super(message, 'DUPLICATE_PAYMENT_REFERENCE', 409);
    this.name = 'DuplicatePaymentReferenceError';
  }
}
