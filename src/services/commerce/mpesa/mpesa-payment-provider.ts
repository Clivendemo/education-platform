import crypto from 'node:crypto';
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
  DarajaStkQueryResult,
  NormalizedMpesaCallback,
} from './mpesa.types.js';
import { DarajaClient } from './daraja-client.js';
import { normalizeMpesaPhoneNumber } from './mpesa-phone.util.js';
import { parseExactKesToMinor, minorToExactWholeKesInt } from '../money.util.js';
import {
  MpesaPhoneValidationError,
  InvalidCallbackError,
} from '../commerce.interface.js';

export interface MpesaPaymentProviderOptions {
  config?: MpesaConfig;
  darajaClient?: DarajaClient;
}

export interface MpesaInitiationResult extends PaymentInitiationResult {
  providerMerchantRequestId: string;
  initiatedPhoneHash: string;
}

export function hashMpesaPhone(normalizedPhone: string): string {
  return crypto.createHash('sha256').update(normalizedPhone).digest('hex');
}

/**
 * Extracts the exact JSON source lexeme for `CallbackMetadata.Item[Name="Amount"].Value`
 * from a raw JSON string BEFORE IEEE-754 number coercion can lose precision.
 */
export function extractCallbackAmountLexeme(rawJson: string): string | undefined {
  if (typeof rawJson !== 'string' || rawJson.length === 0) {
    return undefined;
  }

  // Match {"Name":"Amount","Value":<token>} or {"Value":<token>,"Name":"Amount"}
  const nameFirst =
    /"Name"\s*:\s*"Amount"\s*,\s*"Value"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))/;
  const m1 = nameFirst.exec(rawJson);
  if (m1) {
    return m1[1] !== undefined ? m1[1] : m1[2];
  }

  const valueFirst =
    /"Value"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))\s*,\s*"Name"\s*:\s*"Amount"/;
  const m2 = valueFirst.exec(rawJson);
  if (m2) {
    return m2[1] !== undefined ? m2[1] : m2[2];
  }

  return undefined;
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
   * - Enforces exact whole-KES `amountMinor` (`% 100n === 0n`) before calling Daraja.
   * - Hashes normalized phone number (SHA-256) and never persists raw MSISDN in DB payload.
   */
  async createPayment(params: CreatePaymentParams): Promise<MpesaInitiationResult> {
    const rawPhone = (params.metadata?.phoneNumber as string) || '';
    if (!rawPhone) {
      throw new MpesaPhoneValidationError(
        'Phone number is required for M-Pesa STK Push payment initiation',
      );
    }

    const normalizedPhone = normalizeMpesaPhoneNumber(rawPhone);
    // Validate whole-KES precondition up-front with zero float math
    minorToExactWholeKesInt(params.amountMinor);

    const initiatedPhoneHash = hashMpesaPhone(normalizedPhone);

    // Daraja limits: AccountReference max 12 chars
    const accountRef = params.orderId.replace(/-/g, '').slice(0, 12) || 'ORDER';

    const stkResponse = await this.darajaClient.initiateStkPush({
      phoneNumber: normalizedPhone,
      amountMinor: params.amountMinor,
      accountReference: accountRef,
      transactionDesc: 'ElimuPin Edu',
    });

    return {
      providerCode: this.providerCode,
      providerReference: stkResponse.CheckoutRequestID,
      providerMerchantRequestId: stkResponse.MerchantRequestID,
      initiatedPhoneHash,
      status: 'PROCESSING',
      payload: {
        merchantRequestId: stkResponse.MerchantRequestID,
        checkoutRequestId: stkResponse.CheckoutRequestID,
        responseCode: stkResponse.ResponseCode,
        customerMessage: stkResponse.CustomerMessage,
        initiatedPhoneHash,
      },
    };
  }

  /**
   * Performs server-to-server Daraja `stkpushquery` verification for a CheckoutRequestID.
   */
  async queryTransactionStatus(checkoutRequestId: string): Promise<DarajaStkQueryResult> {
    return this.darajaClient.queryStkPushStatus(checkoutRequestId);
  }

  /**
   * Implements PaymentProvider.verifyPayment using server-to-server Daraja `stkpushquery`.
   */
  async verifyPayment(params: VerifyPaymentParams): Promise<PaymentVerificationResult> {
    if (params.amountMinor <= 0n || !params.providerReference) {
      return {
        isVerified: false,
        status: 'FAILED',
        failureReason: 'Positive amountMinor and providerReference are required',
      };
    }

    const queryResult = await this.queryTransactionStatus(params.providerReference);
    if (queryResult.classification === 'TRANSACTION_CONFIRMED_COMPLETED') {
      return {
        isVerified: true,
        status: 'COMPLETED',
        payload: {
          responseCode: queryResult.responseCode,
          resultCode: queryResult.resultCode,
          resultDesc: queryResult.resultDesc,
        },
      };
    }

    return {
      isVerified: false,
      status: 'FAILED',
      failureReason: queryResult.resultDesc,
      payload: {
        classification: queryResult.classification,
        responseCode: queryResult.responseCode,
        resultCode: queryResult.resultCode,
      },
    };
  }

  /**
   * Parses and normalizes an incoming untrusted Daraja callback wake-up payload.
   * - Extracts exact `Amount` string lexeme (when `rawBodyString` is provided by webhook parser)
   *   and parses via string-only `parseExactKesToMinor` (`W1-AC-05`).
   * - Hashes callback `PhoneNumber` and omits raw MSISDN from persisted summary.
   */
  parseCallback(body: unknown, rawBodyString?: string): NormalizedMpesaCallback {
    if (!body || typeof body !== 'object') {
      throw new InvalidCallbackError('Callback body must be an object');
    }

    const payload = body as Partial<DarajaCallbackPayload> & {
      __rawAmountLexeme?: string;
    };
    const stkCallback = payload.Body?.stkCallback;

    if (!stkCallback) {
      throw new InvalidCallbackError('Missing Body.stkCallback in Daraja callback payload');
    }

    if (
      typeof stkCallback.MerchantRequestID !== 'string' ||
      stkCallback.MerchantRequestID.trim().length === 0 ||
      typeof stkCallback.CheckoutRequestID !== 'string' ||
      stkCallback.CheckoutRequestID.trim().length === 0 ||
      typeof stkCallback.ResultCode !== 'number' ||
      !Number.isInteger(stkCallback.ResultCode)
    ) {
      throw new InvalidCallbackError('Invalid or missing required fields in Daraja stkCallback');
    }

    const isSuccessfulClaim = stkCallback.ResultCode === 0;
    const isCancelledClaim = stkCallback.ResultCode === 1032;

    let amountRawString: string | undefined =
      typeof payload.__rawAmountLexeme === 'string'
        ? payload.__rawAmountLexeme
        : rawBodyString
          ? extractCallbackAmountLexeme(rawBodyString)
          : undefined;
    let mpesaReceiptNumber: string | undefined;
    let transactionDate: string | undefined;
    let callbackPhoneHash: string | undefined;

    if (stkCallback.CallbackMetadata?.Item && Array.isArray(stkCallback.CallbackMetadata.Item)) {
      for (const item of stkCallback.CallbackMetadata.Item) {
        if (!item || typeof item !== 'object') continue;
        if (item.Name === 'Amount' && item.Value !== undefined) {
          if (amountRawString === undefined) {
            if (typeof item.Value === 'string') {
              amountRawString = item.Value;
            } else if (typeof item.Value === 'number' && Number.isFinite(item.Value)) {
              amountRawString = item.Value.toString();
            }
          }
        } else if (item.Name === 'MpesaReceiptNumber' && item.Value !== undefined) {
          const trimmedReceipt = String(item.Value).trim();
          if (trimmedReceipt.length > 0 && trimmedReceipt.length <= 100) {
            mpesaReceiptNumber = trimmedReceipt;
          }
        } else if (item.Name === 'TransactionDate' && item.Value !== undefined) {
          transactionDate = String(item.Value).trim();
        } else if (item.Name === 'PhoneNumber' && item.Value !== undefined) {
          try {
            const normalized = normalizeMpesaPhoneNumber(String(item.Value));
            callbackPhoneHash = hashMpesaPhone(normalized);
          } catch {
            callbackPhoneHash = crypto
              .createHash('sha256')
              .update(String(item.Value).trim())
              .digest('hex');
          }
        }
      }
    }

    const amountMinor =
      amountRawString !== undefined ? parseExactKesToMinor(amountRawString) : null;

    return {
      merchantRequestId: stkCallback.MerchantRequestID.trim(),
      checkoutRequestId: stkCallback.CheckoutRequestID.trim(),
      resultCode: stkCallback.ResultCode,
      resultDesc: typeof stkCallback.ResultDesc === 'string' ? stkCallback.ResultDesc : '',
      isSuccessfulClaim,
      isCancelledClaim,
      amountRawString,
      amountMinor,
      mpesaReceiptNumber,
      transactionDate,
      callbackPhoneHash,
      sanitizedSummary: {
        merchantRequestId: stkCallback.MerchantRequestID.trim(),
        checkoutRequestId: stkCallback.CheckoutRequestID.trim(),
        callbackResultCode: stkCallback.ResultCode,
        callbackResultDesc:
          typeof stkCallback.ResultDesc === 'string'
            ? stkCallback.ResultDesc.slice(0, 250)
            : '',
        amountRawString: amountRawString ?? null,
        callbackReceiptCandidate: mpesaReceiptNumber ?? null,
        transactionDate: transactionDate ?? null,
        callbackPhoneHash: callbackPhoneHash ?? null,
      },
    };
  }
}
