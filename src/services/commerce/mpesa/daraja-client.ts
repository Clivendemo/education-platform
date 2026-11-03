import type {
  MpesaConfig,
  DarajaTokenResponse,
  DarajaStkPushPayload,
  DarajaStkPushResponse,
  DarajaStkQueryPayload,
  DarajaStkQueryRawResponse,
  DarajaStkQueryResult,
  DarajaResultCodeEvidenceEntry,
} from './mpesa.types.js';
import { MpesaProviderError } from '../commerce.interface.js';
import { minorToExactWholeKesInt } from '../money.util.js';

export const DEFAULT_DARAJA_TIMEOUT_MS = 8_000;

const SYNTHETIC_EVIDENCE_PLACEHOLDER_PATTERN =
  /\b(?:placeholder|todo|tbd|confirmed terminal failure|synthetic|mock|unverified|developer[-\s]+note)\b/i;

const CANONICAL_NON_NEGATIVE_INT_CODE_PATTERN = /^(?:0|[1-9]\d*)$/;

/**
 * Strict W1-AC-05 Daraja `ResponseCode` validator.
 *
 * Accepts ONLY the exact raw string `"0"` (`typeof value === 'string' && value === '0'`).
 * - Does NOT coerce numeric values (`0` is rejected).
 * - Does NOT trim whitespace (`" 0 "`, `"0 "`, `" 0"` are rejected).
 * - Rejects `undefined`, `null`, booleans, objects, arrays, empty strings, and all other strings.
 */
export function isStrictDarajaResponseCodeZero(value: unknown): value is '0' {
  return typeof value === 'string' && value === '0';
}

/**
 * Validates that a Daraja `ResultCode` evidence entry satisfies the Prompt 33 Revision 3.3
 * Daraja ResultCode Evidence Addendum without synthetic placeholders or developer-only prose.
 */
export function validateDarajaEvidenceEntry(
  code: string,
  entry: DarajaResultCodeEvidenceEntry,
): void {
  if (!CANONICAL_NON_NEGATIVE_INT_CODE_PATTERN.test(code) || entry.code !== code) {
    throw new Error(`Invalid Daraja ResultCode evidence key "${code}"`);
  }

  if (
    typeof entry.verbatimResultDesc !== 'string' ||
    entry.verbatimResultDesc.trim() !== entry.verbatimResultDesc ||
    entry.verbatimResultDesc.length < 15 ||
    SYNTHETIC_EVIDENCE_PLACEHOLDER_PATTERN.test(entry.verbatimResultDesc)
  ) {
    throw new Error(
      `Daraja ResultCode "${code}" is missing a valid verbatimResultDesc or uses a synthetic placeholder`,
    );
  }

  if (entry.endpointPath !== '/mpesa/stkpushquery/v1/query') {
    throw new Error(
      `Daraja ResultCode "${code}" evidence must target /mpesa/stkpushquery/v1/query`,
    );
  }

  if (
    typeof entry.sourceTitle !== 'string' ||
    entry.sourceTitle.trim().length < 20 ||
    SYNTHETIC_EVIDENCE_PLACEHOLDER_PATTERN.test(entry.sourceTitle)
  ) {
    throw new Error(`Daraja ResultCode "${code}" is missing an authoritative sourceTitle`);
  }

  if (entry.evidenceType === 'SAFARICOM_PORTAL_SPEC') {
    if (
      typeof entry.sourceUrl !== 'string' ||
      !entry.sourceUrl.startsWith('https://developer.safaricom.co.ke/')
    ) {
      throw new Error(
        `Daraja ResultCode "${code}" SAFARICOM_PORTAL_SPEC evidence must cite https://developer.safaricom.co.ke/`,
      );
    }
  } else if (entry.evidenceType === 'VERIFIED_SANDBOX_FIXTURE') {
    if (
      typeof entry.sourceUrl !== 'string' ||
      !entry.sourceUrl.startsWith('docs/security/fixtures/daraja/')
    ) {
      throw new Error(
        `Daraja ResultCode "${code}" VERIFIED_SANDBOX_FIXTURE must reference a committed fixture under docs/security/fixtures/daraja/`,
      );
    }
  } else {
    throw new Error(`Daraja ResultCode "${code}" has unsupported evidenceType`);
  }

  const fixture = entry.sanitizedQueryFixture;
  if (
    !fixture ||
    !isStrictDarajaResponseCodeZero(fixture.ResponseCode) ||
    fixture.ResultCode !== code ||
    fixture.ResultDesc !== entry.verbatimResultDesc
  ) {
    throw new Error(
      `Daraja ResultCode "${code}" sanitizedQueryFixture does not match strict ResponseCode === "0", ResultCode, or verbatimResultDesc`,
    );
  }

  if (entry.classification === 'TRANSACTION_CONFIRMED_COMPLETED') {
    if (entry.nonDebitFinality !== false) {
      throw new Error(
        `Daraja ResultCode "${code}" COMPLETED classification must record nonDebitFinality: false`,
      );
    }
  } else if (
    entry.classification === 'TRANSACTION_CONFIRMED_CANCELLED' ||
    entry.classification === 'TRANSACTION_CONFIRMED_FAILED'
  ) {
    if (entry.nonDebitFinality !== true) {
      throw new Error(
        `Daraja ResultCode "${code}" terminal non-settlement classification must establish nonDebitFinality: true`,
      );
    }
  } else {
    throw new Error(`Daraja ResultCode "${code}" has invalid classification`);
  }

  if (
    typeof entry.justification !== 'string' ||
    entry.justification.trim().length < 30 ||
    SYNTHETIC_EVIDENCE_PLACEHOLDER_PATTERN.test(entry.justification)
  ) {
    throw new Error(`Daraja ResultCode "${code}" requires a substantive evidence justification`);
  }
}

/**
 * Validates the complete Daraja evidence registry and confirmed-failure allowlist invariant:
 * 1. Every entry in `evidenceRegistry` passes `validateDarajaEvidenceEntry`.
 * 2. Every code in `confirmedFailureCodes` exists in `evidenceRegistry` with
 *    `classification === 'TRANSACTION_CONFIRMED_FAILED'` and `nonDebitFinality === true`.
 */
export function assertValidDarajaEvidenceRegistry(
  evidenceRegistry: Readonly<Record<string, DarajaResultCodeEvidenceEntry>>,
  confirmedFailureCodes: ReadonlySet<string>,
): void {
  for (const [code, entry] of Object.entries(evidenceRegistry)) {
    validateDarajaEvidenceEntry(code, entry);
  }

  for (const failCode of confirmedFailureCodes) {
    const entry = evidenceRegistry[failCode];
    if (!entry) {
      throw new Error(
        `Confirmed failure allowlist code "${failCode}" has no entry in DARAJA_RESULT_CODE_EVIDENCE`,
      );
    }
    validateDarajaEvidenceEntry(failCode, entry);
    if (
      entry.classification !== 'TRANSACTION_CONFIRMED_FAILED' ||
      entry.nonDebitFinality !== true
    ) {
      throw new Error(
        `Confirmed failure allowlist code "${failCode}" must have TRANSACTION_CONFIRMED_FAILED and nonDebitFinality: true`,
      );
    }
  }
}

/**
 * Authoritative primary-evidence registry for Safaricom Daraja `stkpushquery/v1/query` ResultCodes.
 * Documented in `docs/security/daraja-result-codes.md` (`W1-AC-05`).
 *
 * Only `"0"` and `"1032"` are publicly verifiable directly from Safaricom's official
 * M-PESA Express specification on `https://developer.safaricom.co.ke/apis/MpesaExpressSimulate`
 * (paired with `https://developer.safaricom.co.ke/apis/MpesaExpressQuery`).
 *
 * Candidate failure codes `"1"`, `"1019"`, `"1037"`, and `"2001"` (alongside `"1001"`, `"1025"`,
 * and `"4999"`) lack unauthenticated primary Safaricom specification entries or live-captured
 * sandbox query fixtures in this repository and are therefore EXCLUDED from
 * `DARAJA_CONFIRMED_FAILURE_CODES`, classifying conservatively as `QUERY_INCONCLUSIVE_RETRYABLE`
 * and escalating to `RECONCILIATION_REQUIRED` after 10 bounded attempts.
 */
export const DARAJA_RESULT_CODE_EVIDENCE: Readonly<
  Record<'0' | '1032', DarajaResultCodeEvidenceEntry>
> = {
  '0': {
    code: '0',
    classification: 'TRANSACTION_CONFIRMED_COMPLETED',
    verbatimResultDesc: 'The service request is processed successfully.',
    evidenceType: 'SAFARICOM_PORTAL_SPEC',
    sourceTitle:
      'Safaricom Daraja Developer Portal — M-PESA Express (Lipa Na M-PESA Online) API Specification (Successful Result Sample)',
    sourceUrl: 'https://developer.safaricom.co.ke/apis/MpesaExpressSimulate',
    endpointPath: '/mpesa/stkpushquery/v1/query',
    sanitizedQueryFixture: {
      ResponseCode: '0',
      ResponseDescription: 'The service request has been accepted successfully',
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_191220191020363925',
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully.',
    },
    nonDebitFinality: false,
    justification:
      'Safaricom M-PESA Express specification documents ResultCode 0 with verbatim ResultDesc "The service request is processed successfully." as authoritative wallet debit completion; verified_receipt_number remains NULL until corroborated because stkpushquery omits MpesaReceiptNumber.',
  },
  '1032': {
    code: '1032',
    classification: 'TRANSACTION_CONFIRMED_CANCELLED',
    verbatimResultDesc: 'Request cancelled by user',
    evidenceType: 'SAFARICOM_PORTAL_SPEC',
    sourceTitle:
      'Safaricom Daraja Developer Portal — M-PESA Express (Lipa Na M-PESA Online) API Specification (Unsuccessful / Cancelled Result Sample)',
    sourceUrl: 'https://developer.safaricom.co.ke/apis/MpesaExpressSimulate',
    endpointPath: '/mpesa/stkpushquery/v1/query',
    sanitizedQueryFixture: {
      ResponseCode: '0',
      ResponseDescription: 'The service request has been accepted successfully',
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_191220191020363925',
      ResultCode: '1032',
      ResultDesc: 'Request cancelled by user',
    },
    nonDebitFinality: true,
    justification:
      'Safaricom M-PESA Express specification documents ResultCode 1032 with verbatim ResultDesc "Request cancelled by user" as the terminal non-debit outcome when the subscriber cancels the SIM Toolkit prompt before PIN entry.',
  },
} as const;

/**
 * Failure candidate codes explicitly excluded from `DARAJA_CONFIRMED_FAILURE_CODES` because
 * `https://developer.safaricom.co.ke/apis/MpesaExpressQuery` gates authenticated result-code
 * specification tables behind portal login and no live-captured sandbox query fixtures exist
 * in this repository. Per the Prompt 33 Revision 3.3 Daraja Evidence Addendum, all excluded
 * codes remain `QUERY_INCONCLUSIVE_RETRYABLE`.
 */
export const DARAJA_EXCLUDED_UNVERIFIED_FAILURE_CANDIDATES = [
  '1',
  '1019',
  '1037',
  '2001',
] as const;

export type EvidencedDarajaFailureCode = never;

export const DARAJA_CONFIRMED_FAILURE_CODES: ReadonlySet<string> = new Set<string>([]);

assertValidDarajaEvidenceRegistry(
  DARAJA_RESULT_CODE_EVIDENCE,
  DARAJA_CONFIRMED_FAILURE_CODES,
);

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
   * - Accepts `amountMinor: bigint` and enforces exact whole-KES divisibility (`amountMinor % 100n === 0n`)
   *   with zero floating-point arithmetic (`W1-AC-05`).
   * - Requires the raw upstream `ResponseCode` to be the exact string `"0"`
   *   (`isStrictDarajaResponseCodeZero`); rejects numeric `0`, whitespace-padded `" 0 "`,
   *   missing/null values, booleans, objects, arrays, empty strings, and non-`"0"` strings.
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

      const rawJson: unknown = await res.json();
      if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
        throw new MpesaProviderError('Daraja STK push response was not a valid JSON object');
      }

      const data = rawJson as Record<string, unknown>;

      if (!isStrictDarajaResponseCodeZero(data.ResponseCode)) {
        const desc =
          typeof data.ResponseDescription === 'string' &&
          data.ResponseDescription.trim().length > 0
            ? data.ResponseDescription.trim()
            : 'M-Pesa STK push rejected or returned invalid ResponseCode';
        throw new MpesaProviderError(desc);
      }

      if (
        typeof data.CheckoutRequestID !== 'string' ||
        data.CheckoutRequestID.trim().length === 0 ||
        typeof data.MerchantRequestID !== 'string' ||
        data.MerchantRequestID.trim().length === 0
      ) {
        throw new MpesaProviderError(
          'Daraja STK push response missing CheckoutRequestID or MerchantRequestID',
        );
      }

      return {
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        ResponseCode: '0',
        ResponseDescription:
          typeof data.ResponseDescription === 'string' ? data.ResponseDescription : '',
        CustomerMessage:
          typeof data.CustomerMessage === 'string' ? data.CustomerMessage : '',
      };
    } catch (err: unknown) {
      if (err instanceof MpesaProviderError) {
        throw err;
      }
      throw new MpesaProviderError('M-Pesa STK Push request dispatch failed');
    }
  }

  /**
   * Authoritative server-to-server STK Push status query (`POST /mpesa/stkpushquery/v1/query`).
   * Enforces (`W1-AC-05`):
   * - `8_000 ms` request timeout (`QUERY_TRANSPORT_ERROR` on timeout/network/5xx/429).
   * - HTTP `200` AND strict `ResponseCode === "0"` (`typeof ResponseCode === 'string' && ResponseCode === '0'`,
   *   no numeric coercion, no whitespace trimming) before inspecting `ResultCode`.
   * - Any invalid or non-`"0"` `ResponseCode` returns `QUERY_INCONCLUSIVE_RETRYABLE` with `resultCode: null`.
   * - Primary-evidence closed allowlist classification (`DARAJA_RESULT_CODE_EVIDENCE` / `DARAJA_CONFIRMED_FAILURE_CODES`);
   *   excluded unverified failure candidates (`1`, `1019`, `1037`, `2001`), contention/dispatch/in-flight codes
   *   (`1001`, `1025`, `4999`), missing, malformed, or unknown codes return `QUERY_INCONCLUSIVE_RETRYABLE`.
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

      let rawJson: unknown = null;
      try {
        rawJson = await res.json();
      } catch {
        rawJson = null;
      }

      const rawData: DarajaStkQueryRawResponse | null =
        rawJson !== null && typeof rawJson === 'object' && !Array.isArray(rawJson)
          ? (rawJson as DarajaStkQueryRawResponse)
          : null;

      // Preserve raw string ResponseCode for diagnostics without coercing numbers/booleans/objects or trimming
      const diagnosticResponseCode =
        typeof rawData?.ResponseCode === 'string' && rawData.ResponseCode.length > 0
          ? rawData.ResponseCode
          : null;

      const extractNonEmptyString = (val: unknown): string | null =>
        typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;

      // Daraja frequently returns HTTP 400/500 with structured JSON `errorCode` (e.g. "500.001.1001":
      // "The transaction is being processed") while the STK prompt is still active on the handset.
      const upstreamErrorCode = extractNonEmptyString(rawData?.errorCode);
      if (!res.ok && rawData && upstreamErrorCode !== null) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: diagnosticResponseCode,
          resultCode: null,
          resultDesc:
            extractNonEmptyString(rawData.errorMessage) ??
            extractNonEmptyString(rawData.ResultDesc) ??
            extractNonEmptyString(rawData.ResponseDescription) ??
            `Daraja query errorCode ${upstreamErrorCode}`,
          merchantRequestId: extractNonEmptyString(rawData.MerchantRequestID),
          checkoutRequestId:
            extractNonEmptyString(rawData.CheckoutRequestID) ?? checkoutRequestId,
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

      if (!res.ok || !rawData) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: diagnosticResponseCode,
          resultCode: null,
          resultDesc:
            extractNonEmptyString(rawData?.errorMessage) ??
            extractNonEmptyString(rawData?.ResultDesc) ??
            extractNonEmptyString(rawData?.ResponseDescription) ??
            `Daraja query non-final HTTP ${httpStatus}`,
          merchantRequestId: extractNonEmptyString(rawData?.MerchantRequestID),
          checkoutRequestId:
            extractNonEmptyString(rawData?.CheckoutRequestID) ?? checkoutRequestId,
          httpStatus,
        };
      }

      const merchantRequestId = extractNonEmptyString(rawData.MerchantRequestID);
      const returnedCheckoutId =
        extractNonEmptyString(rawData.CheckoutRequestID) ?? checkoutRequestId;
      const resultDesc =
        extractNonEmptyString(rawData.ResultDesc) ??
        extractNonEmptyString(rawData.ResponseDescription) ??
        '';

      // Strict W1-AC-05 prerequisite: HTTP 200 AND raw ResponseCode === "0" before inspecting ResultCode
      if (!isStrictDarajaResponseCodeZero(rawData.ResponseCode)) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: diagnosticResponseCode,
          resultCode: null,
          resultDesc:
            resultDesc || 'Daraja query ResponseCode was not the exact string "0"',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      const strictResponseCode: '0' = rawData.ResponseCode;

      // Normalize ResultCode strictly without falsy coercion or whitespace trimming
      let normalizedResultCode: string | null = null;
      if (
        typeof rawData.ResultCode === 'string' &&
        CANONICAL_NON_NEGATIVE_INT_CODE_PATTERN.test(rawData.ResultCode)
      ) {
        normalizedResultCode = rawData.ResultCode;
      } else if (
        typeof rawData.ResultCode === 'number' &&
        Number.isSafeInteger(rawData.ResultCode) &&
        rawData.ResultCode >= 0
      ) {
        normalizedResultCode = String(rawData.ResultCode);
      }

      if (normalizedResultCode === null) {
        return {
          classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
          responseCode: strictResponseCode,
          resultCode: null,
          resultDesc:
            resultDesc || 'Missing or malformed ResultCode in Daraja query response',
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (normalizedResultCode === '0') {
        return {
          classification: 'TRANSACTION_CONFIRMED_COMPLETED',
          responseCode: strictResponseCode,
          resultCode: normalizedResultCode,
          resultDesc:
            resultDesc || DARAJA_RESULT_CODE_EVIDENCE['0'].verbatimResultDesc,
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (normalizedResultCode === '1032') {
        return {
          classification: 'TRANSACTION_CONFIRMED_CANCELLED',
          responseCode: strictResponseCode,
          resultCode: normalizedResultCode,
          resultDesc:
            resultDesc || DARAJA_RESULT_CODE_EVIDENCE['1032'].verbatimResultDesc,
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      if (DARAJA_CONFIRMED_FAILURE_CODES.has(normalizedResultCode)) {
        const failureEvidence = (
          DARAJA_RESULT_CODE_EVIDENCE as Readonly<
            Record<string, DarajaResultCodeEvidenceEntry | undefined>
          >
        )[normalizedResultCode];
        return {
          classification: 'TRANSACTION_CONFIRMED_FAILED',
          responseCode: strictResponseCode,
          resultCode: normalizedResultCode,
          resultDesc:
            resultDesc ||
            failureEvidence?.verbatimResultDesc ||
            `M-Pesa transaction failed (ResultCode ${normalizedResultCode})`,
          merchantRequestId,
          checkoutRequestId: returnedCheckoutId,
          httpStatus,
        };
      }

      // Fail-safe closed allowlist fallback: excluded candidates (1, 1019, 1037, 2001),
      // contention/dispatch/in-flight codes (1001, 1025, 4999), or any unknown/future code
      return {
        classification: 'QUERY_INCONCLUSIVE_RETRYABLE',
        responseCode: strictResponseCode,
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
