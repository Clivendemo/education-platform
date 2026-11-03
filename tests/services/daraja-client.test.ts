import { describe, it, expect, vi } from 'vitest';
import {
  DarajaClient,
  DARAJA_CONFIRMED_FAILURE_CODES,
  DARAJA_EXCLUDED_UNVERIFIED_FAILURE_CANDIDATES,
  DARAJA_RESULT_CODE_EVIDENCE,
  isStrictDarajaResponseCodeZero,
  validateDarajaEvidenceEntry,
  assertValidDarajaEvidenceRegistry,
} from '../../src/services/commerce/mpesa/daraja-client.js';
import type { DarajaResultCodeEvidenceEntry } from '../../src/services/commerce/mpesa/mpesa.types.js';
import { MpesaProviderError } from '../../src/services/commerce/commerce.interface.js';
import { MpesaAmountPrecisionError } from '../../src/services/commerce/money.util.js';

describe('Daraja API Client Unit Tests', () => {
  const dummyConfig = {
    environment: 'sandbox' as const,
    consumerKey: 'test_consumer_key_123',
    consumerSecret: 'test_consumer_secret_456',
    shortcode: '174379',
    passkey: 'test_passkey_abc',
    callbackUrl: 'https://example.com/api/v1/commerce/webhooks/mpesa',
  };

  const INVALID_RESPONSE_CODES: ReadonlyArray<{ label: string; value: unknown; hasKey: boolean }> = [
    { label: 'numeric 0', value: 0, hasKey: true },
    { label: 'whitespace-padded " 0 "', value: ' 0 ', hasKey: true },
    { label: 'leading-space " 0"', value: ' 0', hasKey: true },
    { label: 'trailing-space "0 "', value: '0 ', hasKey: true },
    { label: 'missing ResponseCode', value: undefined, hasKey: false },
    { label: 'explicit undefined', value: undefined, hasKey: true },
    { label: 'null', value: null, hasKey: true },
    { label: 'boolean false', value: false, hasKey: true },
    { label: 'boolean true', value: true, hasKey: true },
    { label: 'empty string ""', value: '', hasKey: true },
    { label: 'object {}', value: {}, hasKey: true },
    { label: 'array []', value: [], hasKey: true },
    { label: 'single-element array ["0"]', value: ['0'], hasKey: true },
    { label: 'non-zero string "1"', value: '1', hasKey: true },
    { label: 'double-zero string "00"', value: '00', hasKey: true },
  ];

  describe('1. Authentication & Token Management', () => {
    it('obtains Daraja access token using Basic Auth credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
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
        status: 200,
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
        status: 200,
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

  describe('2. STK Push Request Initiation (Integer Minor Units & Strict ResponseCode === "0")', () => {
    it('constructs correct STK push payload from bigint amountMinor with zero float math', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'stk_bearer_token',
            expires_in: '3599',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
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
        amountMinor: 25000n,
        accountReference: 'ORDER-1234',
        transactionDesc: 'Revision Kit',
      });

      expect(result.ResponseCode).toBe('0');
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

    it('rejects fractional cent amounts before calling Daraja STK Push (W1-AC-05)', async () => {
      const mockFetch = vi.fn();
      const client = new DarajaClient({
        config: dummyConfig,
        fetchFn: mockFetch as any,
      });

      await expect(
        client.initiateStkPush({
          phoneNumber: '254712345678',
          amountMinor: 25050n, // KES 250.50 not divisible by 100
          accountReference: 'ORD1',
          transactionDesc: 'Payment',
        }),
      ).rejects.toThrow(MpesaAmountPrecisionError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('strictly requires raw ResponseCode === "0" on initiateStkPush and rejects numeric 0, " 0 ", missing, null, booleans, objects, arrays, empty strings, and non-zero strings', async () => {
      expect(isStrictDarajaResponseCodeZero('0')).toBe(true);

      for (const tc of INVALID_RESPONSE_CODES) {
        expect(isStrictDarajaResponseCodeZero(tc.value)).toBe(false);

        const stkPayload: Record<string, unknown> = {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_191220231024531234567890',
          ResponseDescription: 'Upstream response',
          CustomerMessage: 'Upstream message',
        };
        if (tc.hasKey) {
          stkPayload.ResponseCode = tc.value;
        }

        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'stk_bearer_token',
              expires_in: '3599',
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => stkPayload,
          });

        const client = new DarajaClient({
          config: dummyConfig,
          fetchFn: mockFetch as any,
        });

        await expect(
          client.initiateStkPush({
            phoneNumber: '254712345678',
            amountMinor: 10000n,
            accountReference: 'ORD1',
            transactionDesc: 'Payment',
          }),
          `Expected initiateStkPush to reject ResponseCode case: ${tc.label}`,
        ).rejects.toThrow(MpesaProviderError);
      }
    });
  });

  describe('3. Authoritative STK Push Query Strict ResponseCode & Evidence Registry', () => {
    it('classifies invalid or non-"0" ResponseCode as QUERY_INCONCLUSIVE_RETRYABLE across ResultCode "0", "1032", and "1"', async () => {
      for (const resultCodeCandidate of ['0', '1032', '1']) {
        for (const tc of INVALID_RESPONSE_CODES) {
          const queryPayload: Record<string, unknown> = {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_STRICT_QUERY_TEST',
            ResultCode: resultCodeCandidate,
            ResultDesc: 'The service request is processed successfully.',
          };
          if (tc.hasKey) {
            queryPayload.ResponseCode = tc.value;
          }

          const mockFetch = vi
            .fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'tok', expires_in: '3599' }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => queryPayload,
            });

          const client = new DarajaClient({
            config: dummyConfig,
            fetchFn: mockFetch as any,
          });

          const res = await client.queryStkPushStatus('ws_CO_STRICT_QUERY_TEST');
          expect(
            res.classification,
            `Expected QUERY_INCONCLUSIVE_RETRYABLE for ${tc.label} + ResultCode=${resultCodeCandidate}`,
          ).toBe('QUERY_INCONCLUSIVE_RETRYABLE');
          expect(res.resultCode).toBeNull();
          expect(res.responseCode).not.toBe('0');
        }
      }
    });

    it('enforces primary Safaricom evidence discipline and excludes unverified failure candidates 1, 1019, 1037, and 2001', async () => {
      // Only primary-evidenced outcomes ('0' and '1032') are present; unverified failure candidates are excluded
      expect(Object.keys(DARAJA_RESULT_CODE_EVIDENCE).sort()).toEqual(['0', '1032']);
      expect([...DARAJA_CONFIRMED_FAILURE_CODES]).toEqual([]);
      expect([...DARAJA_EXCLUDED_UNVERIFIED_FAILURE_CANDIDATES]).toEqual([
        '1',
        '1019',
        '1037',
        '2001',
      ]);

      for (const excluded of [
        ...DARAJA_EXCLUDED_UNVERIFIED_FAILURE_CANDIDATES,
        '1001',
        '1025',
        '4999',
      ]) {
        expect(DARAJA_CONFIRMED_FAILURE_CODES.has(excluded)).toBe(false);

        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', expires_in: '3599' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              ResponseCode: '0',
              CheckoutRequestID: 'ws_CO_EXCLUDED_TEST',
              MerchantRequestID: '29115-34620561-1',
              ResultCode: excluded,
              ResultDesc: `Upstream ResultCode ${excluded}`,
            }),
          });

        const client = new DarajaClient({
          config: dummyConfig,
          fetchFn: mockFetch as any,
        });
        const res = await client.queryStkPushStatus('ws_CO_EXCLUDED_TEST');
        expect(res.classification).toBe('QUERY_INCONCLUSIVE_RETRYABLE');
        expect(res.responseCode).toBe('0');
        expect(res.resultCode).toBe(excluded);
      }

      // Synthetic placeholders, developer-blog citations, or missing evidence entries are rejected
      const badPlaceholderEntry: DarajaResultCodeEvidenceEntry = {
        ...DARAJA_RESULT_CODE_EVIDENCE['1032'],
        code: '1',
        classification: 'TRANSACTION_CONFIRMED_FAILED',
        verbatimResultDesc: 'Confirmed terminal failure',
        sanitizedQueryFixture: {
          ...DARAJA_RESULT_CODE_EVIDENCE['1032'].sanitizedQueryFixture,
          ResultCode: '1',
          ResultDesc: 'Confirmed terminal failure',
        },
      };
      expect(() => validateDarajaEvidenceEntry('1', badPlaceholderEntry)).toThrow(
        /placeholder/i,
      );

      const thirdPartyUrlEntry: DarajaResultCodeEvidenceEntry = {
        ...DARAJA_RESULT_CODE_EVIDENCE['1032'],
        code: '1',
        classification: 'TRANSACTION_CONFIRMED_FAILED',
        sourceUrl: 'https://third-party-blog.example.com/mpesa-result-codes',
        sanitizedQueryFixture: {
          ...DARAJA_RESULT_CODE_EVIDENCE['1032'].sanitizedQueryFixture,
          ResultCode: '1',
        },
      };
      expect(() => validateDarajaEvidenceEntry('1', thirdPartyUrlEntry)).toThrow(
        /developer\.safaricom\.co\.ke/i,
      );

      expect(() =>
        assertValidDarajaEvidenceRegistry(DARAJA_RESULT_CODE_EVIDENCE, new Set(['1'])),
      ).toThrow(/no entry in DARAJA_RESULT_CODE_EVIDENCE/i);
    });
  });
});
