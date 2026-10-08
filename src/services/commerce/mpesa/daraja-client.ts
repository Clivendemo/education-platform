import type {
  MpesaConfig,
  DarajaTokenResponse,
  DarajaStkPushPayload,
  DarajaStkPushResponse,
} from './mpesa.types.js';
import { MpesaProviderError } from '../commerce.interface.js';

export interface DarajaClientOptions {
  config: MpesaConfig;
  fetchFn?: typeof fetch;
}

export class DarajaClient {
  private readonly config: MpesaConfig;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(options: DarajaClientOptions) {
    this.config = options.config;
    this.fetchFn = options.fetchFn ?? fetch;
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
   * Generates base64 encoded password for STK Push.
   */
  generatePassword(timestamp: string): string {
    const str = `${this.config.shortcode}${this.config.passkey}${timestamp}`;
    return Buffer.from(str).toString('base64');
  }

  /**
   * Initiates an STK Push (Lipa Na M-Pesa Online) request to Daraja.
   */
  async initiateStkPush(params: {
    phoneNumber: string;
    amountKes: number;
    accountReference: string;
    transactionDesc: string;
  }): Promise<DarajaStkPushResponse> {
    const accessToken = await this.getAccessToken();
    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);

    // Daraja has field length limits: AccountReference <= 12 chars, TransactionDesc <= 13 chars
    const safeAccountRef = params.accountReference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'ORDER';
    const safeDesc = params.transactionDesc.slice(0, 13) || 'Payment';

    const payload: DarajaStkPushPayload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: this.config.transactionType || 'CustomerPayBillOnline',
      Amount: Math.max(1, Math.round(params.amountKes)),
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
      });

      if (!res.ok) {
        throw new MpesaProviderError(
          `Daraja STK push request failed with HTTP ${res.status}`,
        );
      }

      const data = (await res.json()) as DarajaStkPushResponse;

      if (data.ResponseCode !== '0') {
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
}
