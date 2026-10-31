import type {
  MpesaConfig,
  DarajaTokenResponse,
  DarajaStkPushPayload,
  DarajaStkPushResponse,
  DarajaStkQueryPayload,
  DarajaStkQueryRawResponse,
  DarajaStkQueryResult,
} from './mpesa.types.js';
import { MpesaProviderError } from '../commerce.interface.js';
import { minorToExactWholeKesInt } from '../money.util.js';

export const DEFAULT_DARAJA_TIMEOUT_MS = 8_000;

/**
 * Authoritative evidence registry for Safaricom Daraja `stkpushquery/v1/query` ResultCodes.
 * Documented in `docs/security/daraja-result-codes.md` (`W1-AC-05`).
 *
 * Codes `1001` (subscriber lock contention) and `1025` (push send error) are intentionally
 * EXCLUDED from `DARAJA_CONFIRMED_FAILURE_CODES` so they classify as `QUERY_INCONCLUSIVE_RETRYABLE`
 * and escalate to `RECONCILIATION_REQUIRED` if unresolved after 10 attempts.
 */
export const DARAJA_RESULT_CODE_EVIDENCE = {
  '0': {
    classification: 'TRANSACTION_CONFIRMED_COMPLETED',
    darajaSpecMeaning: 'The service request is processed successfully.',
    nonDebitFinality: false,
  },
  '1032': {
    classification: 'TRANSACTION_CONFIRMED_CANCELLED',
    darajaSpecMeaning: 'Request cancelled by user.',
    nonDebitFinality: true,
  },
  '1': {
    classification: 'TRANSACTION_CONFIRMED_FAILED',
    darajaSpecMeaning: 'The balance is insufficient for the transaction.',
    nonDebitFinality: true,
  },
  '1019': {
    classification: 'TRANSACTION_CONFIRMED_FAILED',
    darajaSpecMeaning: 'Transaction has expired.',
    nonDebitFinality: true,
  },
  '1037': {
    classification: 'TRANSACTION_CONFIRMED_FAILED',
    darajaSpecMeaning: 'DS timeout user cannot be reached.',
    nonDebitFinality: true,
  },
  '2001': {
    classification: 'TRANSACTION_CONFIRMED_FAILED',
    darajaSpecMeaning: 'The initiator information is invalid.',
    nonDebitFinality: true,
  },
} as const;

export type EvidencedDarajaFailureCode = '1' | '1019' | '1037' | '2001';

export const DARAJA_CONFIRMED_FAILURE_CODES: ReadonlySet<string> = new Set<EvidencedDarajaFailureCode>([
  '1',
  '1019',
  '1037',
  '2001',
]);

export interface DarajaClientOptions {
  config: MpesaConfig;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class DarajaClient {
  private readonly config: MpesaConfig;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(options: DarajaClientOptions) {
    this.config = options.config;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DARAJA_TIMEOUT_MS;
    this.baseUrl =
      this.config.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
  }

  /**
   * Generates or retrieves a valid cached OAuth access token from Daraja.
   * Caches token for valid lifetime minus a 60-second safety buffer.
   * Never logs credentials, secrets, or tokens.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt && now < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    const authHeader = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString('base64');

    const tokenUrl = `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

    try {
      const res = await this.fetchFn(tokenUrl, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        throw new MpesaProviderError(
          `Daraja OAuth token request failed with HTTP ${res.status}`,
        );
      }

      const data = (await res.json()) as DarajaTokenResponse;
      if (!data.access_token) {
        throw new MpesaProviderError('Daraja OAuth response missing access token');
      }

      const expiresInSec = Number.parseInt(data.expires_in, 10) || 3599;
      this.cachedToken = data.access_token;
      this.tokenExpiresAt = Date.now() + expiresInSec * 1000;

      return this.cachedToken;
    } catch (err: unknown) {
      if (err instanceof MpesaProviderError) {
        throw err;
      }
      throw new MpesaProviderError('Failed to obtain Daraja authorization token');
    }
  }

  /**
   * Generates timestamp in YYYYMMDDHHmmss format.
   */
  generateTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /**
   * Generates base64 encoded password for STK Push & STK Push Query.
   */
  generatePassword(timestamp: string): string {
    const str = `${this.config.shortcode}${this.config.passkey}${timestamp}`;
    return Buffer.from(str).toString('base64');
  }

  /**
   * Initiates an STK Push (Lipa Na M-Pesa Online) request to Daraja.
   * Accepts `amountMinor: bigint` and enforces exact whole-KES divisibility (`amountMinor % 100n === 0n`)
   * with zero floating-point arithmetic (`W1-AC-05`).
   */
  async initiateStkPush(params: {
    phoneNumber: string;
    amountMinor: bigint;
    accountReference: string;
    transactionDesc: string;
  }): Promise<DarajaStkPushResponse> {
    const amountWholeKes = minorToExactWholeKesInt(params.amountMinor);
    const accessToken = await this.getAccessToken();
    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);

    // Daraja has field length limits: AccountReference <= 12 chars, TransactionDesc <= 13 chars
    const safeAccountRef =
      params.accountReference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'ORDER';
    const safeDesc = params.transactionDesc.slice(0, 13) || 'Payment';

    const payload: DarajaStkPushPayload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: this.config.transactionType || 'CustomerPayBillOnline',
      Amount: amountWholeKes,
      PartyA: params.phoneNumber,
      PartyB: this.config.shortcode,
      PhoneNumber: params.phoneNumber,
      CallBackURL: this.config.callbackUrl,
      AccountReference: safeAccountRef,
      TransactionDesc: safeDesc,
    };

    const stkUrl = `${this.baseUrl}/mpesa/stkpush/v1/processrequest`;

    try {
      const res = await this.fetchFn(stkUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        throw new MpesaProviderError(
          `Daraja STK push request failed with HTTP ${res.status}`,
        );
      }

      const data = (await res.json()) as DarajaStkPushResponse;

      if (String(data.ResponseCode) !== '0') {
        throw new MpesaProviderError(
          data.ResponseDescription || 'M-Pesa STK push rejected by provider',
        );
      }

      return data;
    } catch (err: unknown) {
      if (err instanceof MpesaProviderError) {
        throw err;
      }
      throw new MpesaProviderError('M-Pesa STK Push request dispatch failed');
    }
  }

  /**
   * Authoritative server-to-server STK Push status query (`POST /mpesa/stkpushquery/v1/query`).
   * Enforces:
   * - `8_000 ms` request timeout (`QUERY_TRANSPORT_ERROR` on timeout/network/5xx/429)
   * - HTTP `200` + `String(ResponseCode) === '0'` prerequisite before inspecting `ResultCode`
   * - Closed allowlist classification (`DARAJA_CONFIRMED_FAILURE_CODES`); unknown, missing,
   *   malformed, or in-flight (`4999`, `1001`, `1025`) codes return `QUERY_INCONCLUSIVE_RETRYABLE`.
   */
  async queryStkPushStatus(checkoutRequestId: string): Promise<DarajaStkQueryResult> {
    let accessToken: string;
    try {
      accessToken = await this.getAccessToken();
    } catch (err) {
      return {
        classification: 'QUERY_TRANSPORT_ERROR',
        responseCode: null,
        resultCode: null,
        resultDesc:
          err instanceof Error ? err.message : 'Failed to obtain Daraja OAuth token',
        merchantRequestId: null,
        checkoutRequestId,
        httpStatus: null,
      };
    }

    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);
    const payload: DarajaStkQueryPayload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const queryUrl = `${this.baseUrl}/mpesa/stkpushquery/v1/query`;

    try {
      const res = await this.fetchFn(queryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const httpStatus = res.status;

      let rawData: DarajaStkQueryRawResponse | null = null;
      try {
        rawData = (await res.json()) as DarajaStkQueryRawResponse;
      } catch {
        rawData = null;
      }

      // Daraja frequently returns HTTP 400/500 with structured JSON `errorCode` (e.g. "500.001.1001":
      // "The transaction is being processed") while the STK prompt is still active on the handset.
      if (
        !res.ok &&
        rawData &&
        typeof rawData === 'object' &&
        typeof rawData.errorCode === 'string' &&
        rawData.errorCode.trim().length > 0
      ) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode:
            rawData.ResponseCode !== undefined ? String(rawData.ResponseCode) : null,
          resultCode:
            rawData.ResultCode !== undefined ? String(rawData.ResultCode) : null,
          resultDesc:
            rawData.errorMessage ||
            rawData.ResultDesc ||
            rawData.ResponseDescription ||
            `Daraja query errorCode ${rawData.errorCode}`,
          merchantRequestId:
            typeof rawData.MerchantRequestID === 'string'
              ? rawData.MerchantRequestID
              : null,
          checkoutRequestId:
            typeof rawData.CheckoutRequestID === 'string'
              ? rawData.CheckoutRequestID
              : checkoutRequestId,
          httpStatus,
        };
      }

      if (httpStatus === 429 || httpStatus >= 500) {
        return {
          classification: 'QUERY_TRANSPORT_ERROR',
          responseCode: null,
          resultCode: null,
          resultDesc: `Daraja query returned transient HTTP ${httpStatus}`,
          merchantRequestId: null,
          checkoutRequestId,
          httpStatus,
        };
      }

      if (!res.ok || !rawData || typeof rawData !== 'object') {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode:
            rawData?.ResponseCode !== undefined ? String(rawData.ResponseCode) : null,
          resultCode:
            rawData?.ResultCode !== undefined ? String(rawData.ResultCode) : null,
          resultDesc:
            rawData?.errorMessage ||
            rawData?.ResultDesc ||
            rawData?.ResponseDescription ||
            `Daraja query non-final HTTP ${httpStatus}`,
          merchantRequestId:
            typeof rawData?.MerchantRequestID === 'string'
              ? rawData.MerchantRequestID
              : null,
          checkoutRequestId:
            typeof rawData?.CheckoutRequestID === 'string'
              ? rawData.CheckoutRequestID
              : checkoutRequestId,
          httpStatus,
        };
      }

      const normalizedResponseCode =
        typeof rawData.ResponseCode === 'string'
          ? rawData.ResponseCode.trim()
          : typeof rawData.ResponseCode === 'number' && Number.isInteger(rawData.ResponseCode)
            ? String(rawData.ResponseCode)
            : '';

      const merchantRequestId =
        typeof rawData.MerchantRequestID === 'string' &&
        rawData.MerchantRequestID.trim().length > 0
          ? rawData.MerchantRequestID.trim()
          : null;
      const returnedCheckoutId =
        typeof rawData.CheckoutRequestID === 'string' &&
        rawData.CheckoutRequestID.trim().length > 0
          ? rawData.CheckoutRequestID.trim()
          : checkoutRequestId;
      const resultDesc =
        typeof rawData.ResultDesc === 'string' && rawData.ResultDesc.trim().length > 0
          ? rawData.ResultDesc.trim()
          : typeof rawData.ResponseDescription === 'string'
            ? rawData.ResponseDescription.trim()
            : '';

      // Prerequisite: HTTP 200 AND ResponseCode === "0" before trusting ResultCode
      if (normalizedResponseCode !== '0') {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: normalizedResponseCode || null,
          resultCode: null,
          resultDesc: resultDesc || 'Daraja query ResponseCode was not 0',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      // Normalize ResultCode strictly without falsy coercion (`String(undefined)` / `Number("")` traps)
      let normalizedResultCode: string | null = null;
      if (typeof rawData.ResultCode === 'string') {
        const trimmed = rawData.ResultCode.trim();
        normalizedResultCode = trimmed.length > 0 ? trimmed : null;
      } else if (
        typeof rawData.ResultCode === 'number' &&
        Number.isInteger(rawData.ResultCode)
      ) {
        normalizedResultCode = String(rawData.ResultCode);
      }

      if (normalizedResultCode === null) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: normalizedResponseCode,
          resultCode: null,
          resultDesc: resultDesc || 'Missing or malformed ResultCode in Daraja query response',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (normalizedResultCode === '0') {
        return {
          classification: 'TRANSACTION_CONFIRMED_COMPLETED',
          responseCode: normalizedResponseCode,
          resultCode: normalizedResultCode,
          resultDesc: resultDesc || 'The service request is processed successfully.',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (normalizedResultCode === '1032') {
        return {
          classification: 'TRANSACTION_CONFIRMED_CANCELLED',
          responseCode: normalizedResponseCode,
          resultCode: normalizedResultCode,
          resultDesc: resultDesc || 'Request cancelled by user.',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (DARAJA_CONFIRMED_FAILURE_CODES.has(normalizedResultCode)) {
        return {
          classification: 'TRANSACTION_CONFIRMED_FAILED',
          responseCode: normalizedResponseCode,
          resultCode: normalizedResultCode,
          resultDesc: resultDesc || `M-Pesa transaction failed (ResultCode ${normalizedResultCode})`,
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      // Fail-safe closed allowlist fallback: 4999, 1001, 1025, or any unknown/future code
      return {
        classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
        responseCode: normalizedResponseCode,
        resultCode: normalizedResultCode,
        resultDesc:
          resultDesc ||
          `Unrecognized or non-terminal Daraja ResultCode (${normalizedResultCode}); queued for retry`,
        merchantRequestId,
        checkoutRequestId: returnedCheckoutId,
        httpStatus,
      };
    } catch (err: unknown) {
      return {
        classification: 'QUERY_TRANSPORT_ERROR',
        responseCode: null,
        resultCode: null,
        resultDesc:
          err instanceof Error ? err.message : 'Daraja STK query network/timeout error',
        merchantRequestId: null,
        checkoutRequestId,
        httpStatus: null,
      };
    }
  }
}
