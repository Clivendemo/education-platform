import { describe, it, expect, vi } from 'vitest';
import { MpesaPaymentProvider } from '../../src/services/commerce/mpesa/mpesa-payment-provider.js';
import { DarajaClient } from '../../src/services/commerce/mpesa/daraja-client.js';
import {
  MpesaPhoneValidationError,
  InvalidCallbackError,
} from '../../src/services/commerce/commerce.interface.js';

describe('MpesaPaymentProvider Unit Tests', () => {
  const dummyConfig = {
    environment: 'sandbox' as const,
    consumerKey: 'key',
    consumerSecret: 'secret',
    shortcode: '174379',
    passkey: 'passkey',
    callbackUrl: 'https://example.com/callback',
  };

  describe('1. createPayment Initiation', () => {
    it('successfully initiates STK push and returns providerReference', async () => {
      const mockDarajaClient = {
        initiateStkPush: vi.fn().mockResolvedValue({
          MerchantRequestID: 'MERCHANT-REQ-1',
          CheckoutRequestID: 'ws_CO_TEST_123',
          ResponseCode: '0',
          ResponseDescription: 'Success',
          CustomerMessage: 'Success',
        }),
      } as unknown as DarajaClient;

      const provider = new MpesaPaymentProvider({
        darajaClient: mockDarajaClient,
      });

      const result = await provider.createPayment({
        orderId: '00000000-0000-0000-0000-000000000001',
        amountMinor: 20000n, // 200 KES
        currencyCode: 'KES',
        userId: 'user-1',
        metadata: {
          phoneNumber: '0712345678',
        },
      });

      expect(result.providerCode).toBe('MPESA');
      expect(result.providerReference).toBe('ws_CO_TEST_123');
      expect(result.status).toBe('PENDING');
      expect(result.payload?.phoneNumber).toBe('254712345678');
      expect(result.payload?.merchantRequestId).toBe('MERCHANT-REQ-1');

      expect(mockDarajaClient.initiateStkPush).toHaveBeenCalledWith({
        phoneNumber: '254712345678',
        amountKes: 200,
        accountReference: expect.any(String),
        transactionDesc: expect.any(String),
      });
    });

    it('throws MpesaPhoneValidationError when phoneNumber is missing from metadata', async () => {
      const provider = new MpesaPaymentProvider({ config: dummyConfig });

      await expect(
        provider.createPayment({
          orderId: 'order-1',
          amountMinor: 10000n,
          currencyCode: 'KES',
          userId: 'user-1',
        }),
      ).rejects.toThrow(MpesaPhoneValidationError);
    });

    it('throws MpesaPhoneValidationError when phoneNumber is invalid', async () => {
      const provider = new MpesaPaymentProvider({ config: dummyConfig });

      await expect(
        provider.createPayment({
          orderId: 'order-1',
          amountMinor: 10000n,
          currencyCode: 'KES',
          userId: 'user-1',
          metadata: {
            phoneNumber: '0201234567', // landline
          },
        }),
      ).rejects.toThrow(MpesaPhoneValidationError);
    });
  });

  describe('2. parseCallback Parsing & Validation', () => {
    const provider = new MpesaPaymentProvider({ config: dummyConfig });

    it('parses a successful Daraja callback with metadata', () => {
      const successPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_191220231024531234567890',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 200.0 },
                { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                { Name: 'Balance' },
                { Name: 'TransactionDate', Value: 20231219102453 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          },
        },
      };

      const parsed = provider.parseCallback(successPayload);
      expect(parsed.isSuccessful).toBe(true);
      expect(parsed.isCancelled).toBe(false);
      expect(parsed.checkoutRequestId).toBe('ws_CO_191220231024531234567890');
      expect(parsed.merchantRequestId).toBe('29115-34620561-1');
      expect(parsed.amountKes).toBe(200);
      expect(parsed.mpesaReceiptNumber).toBe('NLJ7RT61SV');
      expect(parsed.phoneNumber).toBe('254712345678');
    });

    it('parses a user-cancelled callback (ResultCode 1032)', () => {
      const cancelledPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_191220231024531234567890',
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user.',
          },
        },
      };

      const parsed = provider.parseCallback(cancelledPayload);
      expect(parsed.isSuccessful).toBe(false);
      expect(parsed.isCancelled).toBe(true);
      expect(parsed.resultCode).toBe(1032);
      expect(parsed.resultDesc).toBe('Request cancelled by user.');
    });

    it('parses a failure callback (ResultCode 1 - Insufficient funds)', () => {
      const failedPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_191220231024531234567890',
            ResultCode: 1,
            ResultDesc: 'The balance is insufficient for the transaction.',
          },
        },
      };

      const parsed = provider.parseCallback(failedPayload);
      expect(parsed.isSuccessful).toBe(false);
      expect(parsed.isCancelled).toBe(false);
      expect(parsed.resultCode).toBe(1);
    });

    it('throws InvalidCallbackError for malformed payloads', () => {
      expect(() => provider.parseCallback(null)).toThrow(InvalidCallbackError);
      expect(() => provider.parseCallback({})).toThrow(InvalidCallbackError);
      expect(() => provider.parseCallback({ Body: {} })).toThrow(
        InvalidCallbackError,
      );
      expect(() =>
        provider.parseCallback({
          Body: {
            stkCallback: {
              MerchantRequestID: '123',
              // missing CheckoutRequestID
              ResultCode: 0,
            },
          },
        }),
      ).toThrow(InvalidCallbackError);
    });
  });
});
