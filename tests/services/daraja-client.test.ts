import { describe, it, expect, vi } from 'vitest';
import { DarajaClient } from '../../src/services/commerce/mpesa/daraja-client.js';
import { MpesaProviderError } from '../../src/services/commerce/commerce.interface.js';

describe('Daraja API Client Unit Tests', () => {
  const dummyConfig = {
    environment: 'sandbox' as const,
    consumerKey: 'test_consumer_key_123',
    consumerSecret: 'test_consumer_secret_456',
    shortcode: '174379',
    passkey: 'test_passkey_abc',
    callbackUrl: 'https://example.com/api/v1/payments/mpesa/callback',
  };

  describe('1. Authentication & Token Management', () => {
    it('obtains Daraja access token using Basic Auth credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock_token_abc123',
          expires_in: '3599',
        }),
      });

      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      const token = await client.getAccessToken();
      expect(token).toBe('mock_token_abc123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      );

      const expectedBasic = Buffer.from(
        `${dummyConfig.consumerKey}:${dummyConfig.consumerSecret}`,
      ).toString('base64');
      expect(options.headers.Authorization).toBe(`Basic ${expectedBasic}`);
    });

    it('caches access token and does not re-fetch while valid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'cached_token_xyz',
          expires_in: '3599',
        }),
      });

      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      const token1 = await client.getAccessToken();
      const token2 = await client.getAccessToken();
      const token3 = await client.getAccessToken();

      expect(token1).toBe('cached_token_xyz');
      expect(token2).toBe('cached_token_xyz');
      expect(token3).toBe('cached_token_xyz');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles OAuth token acquisition failure without exposing secrets', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      await expect(client.getAccessToken()).rejects.toThrow(MpesaProviderError);
    });

    it('uses production URL when environment is production', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'prod_token_123',
          expires_in: '3599',
        }),
      });

      const prodClient = new DarajaClient({
        config: {
          ...dummyConfig,
          environment: 'production',
        },
        fetchFn: mockFetch as any,
      });

      await prodClient.getAccessToken();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      );
    });
  });

  describe('2. STK Push Request Initiation', () => {
    it('constructs correct STK push payload with timestamp, password, and authoritative amount', async () => {
      const mockFetch = vi
        .fn()
        // 1st call: OAuth token
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'stk_bearer_token',
            expires_in: '3599',
          }),
        })
        // 2nd call: STK push
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_191220231024531234567890',
            ResponseCode: '0',
            ResponseDescription: 'Success. Request accepted for processing',
            CustomerMessage: 'Success. Request accepted for processing',
          }),
        });

      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      const result = await client.initiateStkPush({
        phoneNumber: '254712345678',
        amountKes: 250,
        accountReference: 'ORDER-1234',
        transactionDesc: 'Revision Kit',
      });

      expect(result.CheckoutRequestID).toBe('ws_CO_191220231024531234567890');
      expect(result.MerchantRequestID).toBe('29115-34620561-1');

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [stkUrl, stkOptions] = mockFetch.mock.calls[1];
      expect(stkUrl).toBe(
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      );
      expect(stkOptions.headers.Authorization).toBe('Bearer stk_bearer_token');

      const body = JSON.parse(stkOptions.body);
      expect(body.BusinessShortCode).toBe('174379');
      expect(body.PartyB).toBe('174379');
      expect(body.Amount).toBe(250);
      expect(body.PhoneNumber).toBe('254712345678');
      expect(body.PartyA).toBe('254712345678');
      expect(body.CallBackURL).toBe(dummyConfig.callbackUrl);
      expect(body.AccountReference).toBe('ORDER1234');
      expect(body.Password).toBeTruthy();
      expect(body.Timestamp).toBeTruthy();
    });

    it('rejects when upstream Daraja returns non-zero ResponseCode', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'stk_bearer_token',
            expires_in: '3599',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_191220231024531234567890',
            ResponseCode: '1',
            ResponseDescription: 'The initiator information is invalid.',
            CustomerMessage: '',
          }),
        });

      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      await expect(
        client.initiateStkPush({
          phoneNumber: '254712345678',
          amountKes: 100,
          accountReference: 'ORD1',
          transactionDesc: 'Payment',
        }),
      ).rejects.toThrow(MpesaProviderError);
    });
  });
});
