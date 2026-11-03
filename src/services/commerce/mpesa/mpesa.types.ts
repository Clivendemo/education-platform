/**
 * Safaricom Daraja M-Pesa types and interfaces (Wave 1 Hardened)
 */

export interface MpesaConfig {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  transactionType?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
}

export interface DarajaTokenResponse {
  access_token: string;
  expires_in: string;
}

export interface DarajaStkPushPayload {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: string;
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

/**
 * Parsed response from `POST /mpesa/stkpush/v1/processrequest`.
 *
 * Strict W1-AC-05 contract: `ResponseCode` MUST be the exact raw JSON string `'0'`.
 * Numeric `0`, whitespace-padded `' 0 '`, missing/null values, booleans, objects, arrays,
 * empty strings, and non-`'0'` strings are rejected without coercion or trimming.
 */
export interface DarajaStkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: '0';
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface DarajaStkQueryPayload {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  CheckoutRequestID: string;
}

/**
 * Raw upstream JSON payload returned by `POST /mpesa/stkpushquery/v1/query`.
 *
 * Strict W1-AC-05 contract:
 * - `ResponseCode` is accepted ONLY when the raw JSON value is the exact string `'0'`
 *   (`typeof ResponseCode === 'string' && ResponseCode === '0'`).
 * - Numeric `0`, whitespace-padded `' 0 '`, `null`, `undefined`, booleans, objects,
 *   arrays, empty strings, and non-`'0'` strings are rejected without coercion or trimming,
 *   producing `QUERY_INCONCLUSIVE_RETRYABLE`.
 */
export interface DarajaStkQueryRawResponse {
  ResponseCode?: unknown;
  ResponseDescription?: unknown;
  MerchantRequestID?: unknown;
  CheckoutRequestID?: unknown;
  ResultCode?: unknown;
  ResultDesc?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
}

export type DarajaQueryClassification =
  | 'TRANSACTION_CONFIRMED_COMPLETED'
  | 'TRANSACTION_CONFIRMED_CANCELLED'
  | 'TRANSACTION_CONFIRMED_FAILED'
  | 'QUERY_INCONCLUSIVE_RETRYABLE'
  | 'QUERY_TRANSPORT_ERROR';

export type DarajaEvidenceSourceType =
  | 'SAFARICOM_PORTAL_SPEC'
  | 'VERIFIED_SANDBOX_FIXTURE';

export interface DarajaSanitizedQueryFixture {
  readonly ResponseCode: '0';
  readonly ResponseDescription: string;
  readonly MerchantRequestID: string;
  readonly CheckoutRequestID: string;
  readonly ResultCode: string;
  readonly ResultDesc: string;
}

export interface DarajaResultCodeEvidenceEntry {
  readonly code: string;
  readonly classification:
    | 'TRANSACTION_CONFIRMED_COMPLETED'
    | 'TRANSACTION_CONFIRMED_CANCELLED'
    | 'TRANSACTION_CONFIRMED_FAILED';
  readonly verbatimResultDesc: string;
  readonly evidenceType: DarajaEvidenceSourceType;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly endpointPath: '/mpesa/stkpushquery/v1/query';
  readonly sanitizedQueryFixture: DarajaSanitizedQueryFixture;
  readonly nonDebitFinality: boolean;
  readonly justification: string;
}

export interface DarajaStkQueryResult {
  classification: DarajaQueryClassification;
  responseCode: string | null;
  resultCode: string | null;
  resultDesc: string;
  merchantRequestId: string | null;
  checkoutRequestId: string | null;
  httpStatus: number | null;
}

export interface DarajaCallbackItem {
  Name: string;
  Value?: string | number;
}

export interface DarajaCallbackMetadata {
  Item: DarajaCallbackItem[];
}

export interface DarajaStkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: DarajaCallbackMetadata;
}

export interface DarajaCallbackPayload {
  Body: {
    stkCallback: DarajaStkCallback;
  };
}

export interface NormalizedMpesaCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  isSuccessfulClaim: boolean;
  isCancelledClaim: boolean;
  amountRawString?: string;
  amountMinor: bigint | null;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  callbackPhoneHash?: string;
  sanitizedSummary: Record<string, unknown>;
}

export interface DarajaAckResponse {
  ResultCode: number;
  ResultDesc: string;
}
