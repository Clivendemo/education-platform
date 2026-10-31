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
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ReceiptVerificationSource =
  | 'PROVIDER_VERIFIED_RECEIPT'
  | 'ADMIN_RECONCILED_RECEIPT';

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

/**
 * Learner-facing Payment DTO (`W1-AC-03`):
 * Redacts `CheckoutRequestID` (`providerReference` is `null` for M-Pesa),
 * `MerchantRequestID`, `callbackReceiptCandidate`, `initiatedPhoneHash`,
 * and internal `providerPayload` so no learner can forge a webhook callback.
 */
export interface PaymentDto {
  id: string;
  orderId: string;
  providerCode: string;
  providerReference: string | null;
  providerTransactionId: string | null;
  verifiedReceiptNumber: string | null;
  receiptVerificationSource: ReceiptVerificationSource | null;
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

/**
 * Administrative Payment DTO (`W1-AC-06`):
 * Exposed exclusively on `system_admin` reconciliation endpoints.
 */
export interface AdminPaymentDto extends PaymentDto {
  providerMerchantRequestId: string | null;
  initiatedPhoneHash: string | null;
  callbackReceiptCandidate: string | null;
  callbackReceivedAt: Date | null;
  verifiedAt: Date | null;
  verificationAttempts: number;
  nextVerificationAt: Date | null;
  verificationLockedAt: Date | null;
  verificationLockedBy: string | null;
}

export interface ResolveReconciliationInput {
  paymentId: string;
  outcome: 'COMPLETE_WITH_RECEIPT' | 'MARK_FAILED' | 'MARK_CANCELLED';
  verifiedReceiptNumber?: string;
  reason: string;
  actorUserId: string;
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

export class OrderPaymentInProgressError extends CommerceError {
  constructor(
    message = 'An active payment verification or reconciliation is already in progress for this order',
  ) {
    super(message, 'ORDER_PAYMENT_IN_PROGRESS', 409);
    this.name = 'OrderPaymentInProgressError';
  }
}

export class SimulationDisabledError extends CommerceError {
  constructor(message = 'Payment simulation provider is disabled') {
    super(message, 'PAYMENT_SIMULATION_DISABLED', 403);
    this.name = 'SimulationDisabledError';
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

export class MpesaPhoneValidationError extends CommerceError {
  constructor(
    message = 'Invalid Kenyan M-Pesa phone number. Format must be a valid Kenyan mobile number (e.g. 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXXX)',
  ) {
    super(message, 'MPESA_PHONE_INVALID', 400);
    this.name = 'MpesaPhoneValidationError';
  }
}

export class MpesaProviderError extends CommerceError {
  constructor(message = 'M-Pesa payment provider communication error') {
    super(message, 'MPESA_PROVIDER_ERROR', 502);
    this.name = 'MpesaProviderError';
  }
}

export class InvalidCallbackError extends CommerceError {
  constructor(message = 'Invalid payment callback structure') {
    super(message, 'INVALID_CALLBACK_PAYLOAD', 400);
    this.name = 'InvalidCallbackError';
  }
}

export class PaymentProviderNotFoundError extends CommerceError {
  constructor(message = 'Payment provider not found or not configured') {
    super(message, 'PAYMENT_PROVIDER_NOT_FOUND', 400);
    this.name = 'PaymentProviderNotFoundError';
  }
}
