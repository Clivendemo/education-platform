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

export interface DarajaStkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface DarajaStkQueryPayload {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  CheckoutRequestID: string;
}

export interface DarajaStkQueryRawResponse {
  ResponseCode?: string | number;
  ResponseDescription?: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: string | number;
  ResultDesc?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type DarajaQueryClassification =
  | 'TRANSACTION_CONFIRMED_COMPLETED'
  | 'TRANSACTION_CONFIRMED_CANCELLED'
  | 'TRANSACTION_CONFIRMED_FAILED'
  | 'QUERY_INCONCLUSIVE_RETRYABLE'
  | 'QUERY_TRANSPORT_ERROR';

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
