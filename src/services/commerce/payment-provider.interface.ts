export interface CreatePaymentParams {
  orderId: string;
  amountMinor: bigint;
  currencyCode: 'KES';
  userId: string;
  providerReference?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitiationResult {
  providerCode: string;
  providerReference: string;
  providerTransactionId?: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  payload?: Record<string, unknown>;
}

export interface VerifyPaymentParams {
  providerReference: string;
  amountMinor: bigint;
  currencyCode: 'KES';
  payload?: Record<string, unknown>;
}

export interface PaymentVerificationResult {
  isVerified: boolean;
  providerTransactionId?: string;
  status: 'COMPLETED' | 'FAILED';
  failureReason?: string;
  payload?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerCode: string;
  createPayment(params: CreatePaymentParams): Promise<PaymentInitiationResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<PaymentVerificationResult>;
}
