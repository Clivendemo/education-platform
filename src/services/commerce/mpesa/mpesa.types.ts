/**
 * Safaricom Daraja M-Pesa types and interfaces
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
  isSuccessful: boolean;
  isCancelled: boolean;
  amountKes?: number;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber?: string;
  rawPayload: Record<string, unknown>;
}

export interface DarajaAckResponse {
  ResultCode: number;
  ResultDesc: string;
}
