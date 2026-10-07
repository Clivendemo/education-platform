import { randomUUID } from 'node:crypto';
import type {
  PaymentProvider,
  CreatePaymentParams,
  PaymentInitiationResult,
  VerifyPaymentParams,
  PaymentVerificationResult,
} from './payment-provider.interface.js';

/**
 * Foundation Simulation Payment Provider.
 * Allows deterministic payment initiation and verification without live external APIs.
 * Prompt 19 will introduce MpesaPaymentProvider under this same interface.
 */
export class SimulationPaymentProvider implements PaymentProvider {
  readonly providerCode = 'SIMULATION';

  async createPayment(params: CreatePaymentParams): Promise<PaymentInitiationResult> {
    const providerReference =
      params.providerReference || `SIM-REF-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    return {
      providerCode: this.providerCode,
      providerReference,
      status: 'PENDING',
      payload: {
        simulatedAt: new Date().toISOString(),
        orderId: params.orderId,
        amountMinor: params.amountMinor.toString(),
      },
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<PaymentVerificationResult> {
    // In simulation mode, payments with non-negative amounts verify successfully
    if (params.amountMinor <= 0n) {
      return {
        isVerified: false,
        status: 'FAILED',
        failureReason: 'Amount must be greater than zero',
      };
    }

    return {
      isVerified: true,
      providerTransactionId: `SIM-TXN-${Date.now()}`,
      status: 'COMPLETED',
      payload: {
        verifiedAt: new Date().toISOString(),
        providerReference: params.providerReference,
        amountMinor: params.amountMinor.toString(),
      },
    };
  }
}
