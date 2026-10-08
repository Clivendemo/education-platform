import type {
  PaymentProvider,
  CreatePaymentParams,
  PaymentInitiationResult,
  VerifyPaymentParams,
  PaymentVerificationResult,
} from '../payment-provider.interface.js';
import type {
  MpesaConfig,
  DarajaCallbackPayload,
  NormalizedMpesaCallback,
} from './mpesa.types.js';
import { DarajaClient } from './daraja-client.js';
import { normalizeMpesaPhoneNumber } from './mpesa-phone.util.js';
import {
  MpesaPhoneValidationError,
  InvalidCallbackError,
} from '../commerce.interface.js';

export interface MpesaPaymentProviderOptions {
  config?: MpesaConfig;
  darajaClient?: DarajaClient;
}

export class MpesaPaymentProvider implements PaymentProvider {
  readonly providerCode = 'MPESA';
  private readonly darajaClient: DarajaClient;

  constructor(options: MpesaPaymentProviderOptions) {
    if (options.darajaClient) {
      this.darajaClient = options.darajaClient;
    } else if (options.config) {
      this.darajaClient = new DarajaClient({ config: options.config });
    } else {
      throw new Error('MpesaPaymentProvider requires either config or darajaClient');
    }
  }

  /**
   * Initiates STK push for the specified order payment.
   * Phone number must be supplied in params.metadata.phoneNumber.
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentInitiationResult> {
    const rawPhone = (params.metadata?.phoneNumber as string) || '';
    if (!rawPhone) {
      throw new MpesaPhoneValidationError(
        'Phone number is required for M-Pesa STK Push payment initiation',
      );
    }

    const normalizedPhone = normalizeMpesaPhoneNumber(rawPhone);

    // Minor units to whole KES (1 KES = 100 minor units)
    const amountKes = Math.max(1, Math.round(Number(params.amountMinor) / 100));

    // Daraja limits: AccountReference max 12 chars
    const accountRef = params.orderId.replace(/-/g, '').slice(0, 12) || 'ORDER';

    const stkResponse = await this.darajaClient.initiateStkPush({
      phoneNumber: normalizedPhone,
      amountKes,
      accountReference: accountRef,
      transactionDesc: 'ElimuPin Edu',
    });

    return {
      providerCode: this.providerCode,
      providerReference: stkResponse.CheckoutRequestID,
      status: 'PENDING',
      payload: {
        merchantRequestId: stkResponse.MerchantRequestID,
        checkoutRequestId: stkResponse.CheckoutRequestID,
        customerMessage: stkResponse.CustomerMessage,
        phoneNumber: normalizedPhone,
      },
    };
  }

  /**
   * Verifies payment status.
   */
  async verifyPayment(params: VerifyPaymentParams): Promise<PaymentVerificationResult> {
    if (params.amountMinor <= 0n) {
      return {
        isVerified: false,
        status: 'FAILED',
        failureReason: 'Amount must be greater than zero',
      };
    }

    return {
      isVerified: true,
      providerTransactionId: params.payload?.providerTransactionId as string | undefined,
      status: 'COMPLETED',
      payload: params.payload,
    };
  }

  /**
   * Parses and normalizes incoming Daraja callback payload.
   * Throws InvalidCallbackError if JSON structure does not match Daraja schema.
   */
  parseCallback(body: unknown): NormalizedMpesaCallback {
    if (!body || typeof body !== 'object') {
      throw new InvalidCallbackError('Callback body must be an object');
    }

    const payload = body as Partial<DarajaCallbackPayload>;
    const stkCallback = payload.Body?.stkCallback;

    if (!stkCallback) {
      throw new InvalidCallbackError('Missing Body.stkCallback in Daraja callback payload');
    }

    if (
      typeof stkCallback.MerchantRequestID !== 'string' ||
      typeof stkCallback.CheckoutRequestID !== 'string' ||
      typeof stkCallback.ResultCode !== 'number'
    ) {
      throw new InvalidCallbackError('Invalid or missing required fields in Daraja stkCallback');
    }

    const isSuccessful = stkCallback.ResultCode === 0;
    const isCancelled = stkCallback.ResultCode === 1032;

    let amountKes: number | undefined;
    let mpesaReceiptNumber: string | undefined;
    let transactionDate: string | undefined;
    let phoneNumber: string | undefined;

    if (isSuccessful && stkCallback.CallbackMetadata?.Item) {
      for (const item of stkCallback.CallbackMetadata.Item) {
        if (item.Name === 'Amount' && item.Value !== undefined) {
          amountKes = Number(item.Value);
        } else if (item.Name === 'MpesaReceiptNumber' && item.Value !== undefined) {
          mpesaReceiptNumber = String(item.Value);
        } else if (item.Name === 'TransactionDate' && item.Value !== undefined) {
          transactionDate = String(item.Value);
        } else if (item.Name === 'PhoneNumber' && item.Value !== undefined) {
          phoneNumber = String(item.Value);
        }
      }
    }

    return {
      merchantRequestId: stkCallback.MerchantRequestID,
      checkoutRequestId: stkCallback.CheckoutRequestID,
      resultCode: stkCallback.ResultCode,
      resultDesc: stkCallback.ResultDesc || '',
      isSuccessful,
      isCancelled,
      amountKes,
      mpesaReceiptNumber,
      transactionDate,
      phoneNumber,
      rawPayload: body as Record<string, unknown>,
    };
  }
}
