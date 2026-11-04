import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import {
  CSRF_CTX_COOKIE_NAME,
  mintCsrfToken,
  resolveCsrfSubject,
} from '../../src/routes/middleware/csrf-guard.js';
import {
  InMemoryTwoPhaseRateLimitStore,
  RateLimitService,
} from '../../src/services/rate-limit.service.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../../src/routes/hooks/authorize.js';

const ALLOWED_ORIGIN = 'http://localhost:3000';
const TEST_CSRF_SECRET = 'wave3-http-sec-csrf-secret-primary-32bytes-minimum-key!';
const PREV_CSRF_SECRET = 'wave3-http-sec-csrf-secret-previous-32bytes-minimum-key!';

function makeIsolatedRateLimitService() {
  return new RateLimitService({
    tier2Store: new InMemoryTwoPhaseRateLimitStore(),
    hmacSecret: 'wave3-http-sec-rl-secret-32bytes-minimum-key-material!',
  });
}

function extractSetCookieLines(rawHeader: string | string[] | undefined): string[] {
  if (!rawHeader) return [];
  return Array.isArray(rawHeader) ? rawHeader : [String(rawHeader)];
}

function extractCookieValueFromSetCookie(
  setCookieLines: string[],
  cookieName: string,
): string | null {
  for (const line of setCookieLines) {
    const firstSeg = line.split(';')[0]?.trim() ?? '';
    const eqIdx = firstSeg.indexOf('=');
    if (eqIdx > 0 && firstSeg.slice(0, eqIdx).trim() === cookieName) {
      return decodeURIComponent(firstSeg.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

describe('Wave 3 WP3 — HTTP Security, Strict CORS, Staged HSTS, Conjunctive CSRF & Auth Alignment', () => {
  describe('W3-AC-01: Strict CORS Allowlist & Split Vary / Preflight Cache Rules', () => {
    it('reflects Access-Control-Allow-Origin + Credentials + Vary: Origin for allowlisted Origin on non-OPTIONS', async () => {
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN, 'https://app.elimupin.co.ke'],
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/health',
          headers: { origin: 'https://app.elimupin.co.ke' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('https://app.elimupin.co.ke');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(res.headers['vary']).toBe('Origin');
      } finally {
        await app.close();
      }
    });

    it('omits Access-Control-Allow-* headers for unlisted Origin and literal "null" Origin while preserving Vary: Origin', async () => {
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        for (const badOrigin of ['https://evil.example.com', 'null']) {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/health',
            headers: { origin: badOrigin },
          });

          expect(res.statusCode).toBe(200);
          expect(res.headers['access-control-allow-origin']).toBeUndefined();
          expect(res.headers['access-control-allow-credentials']).toBeUndefined();
          expect(res.headers['vary']).toBe('Origin');
        }
      } finally {
        await app.close();
      }
    });

    it('returns 204 with split Vary, Access-Control-Max-Age: 600, and private max-age=600 on allowed OPTIONS preflight', async () => {
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/checkout',
          headers: {
            origin: ALLOWED_ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type, x-csrf-token, idempotency-key',
          },
        });

        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(res.headers['access-control-max-age']).toBe('600');
        expect(res.headers['cache-control']).toBe('private, max-age=600');
        expect(res.headers['vary']).toBe(
          'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        );
      } finally {
        await app.close();
      }
    });

    it('returns 403 + Cache-Control: no-store + zero ACAO headers on denied OPTIONS Origin or unlisted header', async () => {
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const badOriginRes = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/checkout',
          headers: {
            origin: 'https://attacker.example',
            'access-control-request-method': 'POST',
          },
        });
        expect(badOriginRes.statusCode).toBe(403);
        expect(badOriginRes.headers['cache-control']).toBe('no-store');
        expect(badOriginRes.headers['access-control-allow-origin']).toBeUndefined();
        expect(badOriginRes.json().error.code).toBe('CORS_ORIGIN_DENIED');

        const badHeaderRes = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/checkout',
          headers: {
            origin: ALLOWED_ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'x-custom-backdoor-header',
          },
        });
        expect(badHeaderRes.statusCode).toBe(403);
        expect(badHeaderRes.headers['cache-control']).toBe('no-store');
        expect(badHeaderRes.headers['access-control-allow-origin']).toBeUndefined();
        expect(badHeaderRes.json().error.code).toBe('CORS_PREFLIGHT_DENIED');
      } finally {
        await app.close();
      }
    });
  });

  describe('W3-AC-02: Deterministic API Security Headers & RFC 6797 §7.2 Staged HSTS Gate', () => {
    it('emits API CSP, nosniff, DENY, Referrer-Policy, Permissions-Policy, COOP, and CORP on all responses and omits HSTS in test/dev', async () => {
      const app = buildApp({
        logger: false,
        nodeEnvOverride: 'test',
        canonicalDomainOverride: 'https://elimupin.co.ke',
        hstsMaxAgeSecondsOverride: 300,
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/health',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-security-policy']).toBe(
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(res.headers['permissions-policy']).toContain('camera=()');
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
        expect(res.headers['strict-transport-security']).toBeUndefined();
      } finally {
        await app.close();
      }
    });

    it('never emits HSTS over plain HTTP even in production, and emits staged/full HSTS ONLY over verified HTTPS in production', async () => {
      const stagedProdApp = buildApp({
        logger: false,
        nodeEnvOverride: 'production',
        configuredTrustProxyHopsOverride: 1,
        canonicalDomainOverride: 'https://elimupin.co.ke',
        hstsMaxAgeSecondsOverride: 300,
        hstsIncludeSubDomainsOverride: false,
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await stagedProdApp.ready();

      try {
        // Plain HTTP in production -> RFC 6797 §7.2 forbids HSTS header
        const plainHttpRes = await stagedProdApp.inject({
          method: 'GET',
          url: '/api/v1/health',
          headers: { 'x-forwarded-proto': 'http' },
        });
        expect(plainHttpRes.headers['strict-transport-security']).toBeUndefined();

        // Verified 1-hop HTTPS proxy in production -> emits conservative default max-age=300 without includeSubDomains
        const httpsRes = await stagedProdApp.inject({
          method: 'GET',
          url: '/api/v1/health',
          headers: { 'x-forwarded-proto': 'https' },
        });
        expect(httpsRes.headers['strict-transport-security']).toBe('max-age=300');
      } finally {
        await stagedProdApp.close();
      }

      const fullHstsApp = buildApp({
        logger: false,
        nodeEnvOverride: 'production',
        configuredTrustProxyHopsOverride: 1,
        canonicalDomainOverride: 'https://elimupin.co.ke',
        hstsMaxAgeSecondsOverride: 31536000,
        hstsIncludeSubDomainsOverride: true,
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await fullHstsApp.ready();

      try {
        const res = await fullHstsApp.inject({
          method: 'GET',
          url: '/api/v1/health',
          headers: { 'x-forwarded-proto': 'https' },
        });
        expect(res.headers['strict-transport-security']).toBe(
          'max-age=31536000; includeSubDomains',
        );
      } finally {
        await fullHstsApp.close();
      }
    });
  });

  describe('W3-AC-03: Conjunctive Stateless HMAC CSRF Guard, Session Rotation & Zero Bypass', () => {
    it('enforces full pre-auth csrf_ctx -> login session_token rotation -> old-token rejection -> logout rotation lifecycle', async () => {
      const mockAuthService = {
        login: vi.fn().mockResolvedValue({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'teacher@elimupin.co.ke',
            displayName: 'Teacher One',
            status: 'ACTIVE',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
          sessionToken: 'live-session-tok-abc123',
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
        validateSession: vi.fn().mockResolvedValue({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'teacher@elimupin.co.ke',
            displayName: 'Teacher One',
            status: 'ACTIVE',
          },
          session: {
            id: 'sess-uuid-1',
            userId: '11111111-1111-4111-8111-111111111111',
          },
        }),
        logout: vi.fn().mockResolvedValue(undefined),
      };

      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        csrfSecretOverride: TEST_CSRF_SECRET,
        services: {
          authService: mockAuthService as any,
          rateLimitService: makeIsolatedRateLimitService(),
        },
      });
      await app.ready();

      try {
        // 1. Raw POST /api/v1/auth/login without CSRF is rejected even in NODE_ENV=test (zero test bypass!)
        const unbootstrappedLogin = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ email: 'teacher@elimupin.co.ke', password: 'Password123!' }),
        });
        expect(unbootstrappedLogin.statusCode).toBe(403);
        expect(unbootstrappedLogin.json().error.code).toBe('CSRF_TOKEN_MISSING');
        expect(mockAuthService.login).not.toHaveBeenCalled();

        // 2. Bootstrap via GET /api/v1/auth/csrf
        const bootstrapRes = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/csrf',
        });
        expect(bootstrapRes.statusCode).toBe(200);
        expect(bootstrapRes.headers['cache-control']).toContain('no-store');
        const preAuthCsrfToken = String(bootstrapRes.headers['x-csrf-token']);
        expect(preAuthCsrfToken).toBe(bootstrapRes.json().data.csrfToken);

        const setCookieLines = extractSetCookieLines(bootstrapRes.headers['set-cookie']);
        const csrfCtxVal = extractCookieValueFromSetCookie(setCookieLines, CSRF_CTX_COOKIE_NAME);
        expect(csrfCtxVal).toBeTruthy();
        expect(setCookieLines.some((l) => l.includes(`${CSRF_CTX_COOKIE_NAME}=`) && l.includes('HttpOnly'))).toBe(true);

        // 3. POST /api/v1/auth/login with csrf_ctx + pre-auth token succeeds and rotates X-CSRF-Token to session_token!
        const loginRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtxVal}`,
            'x-csrf-token': preAuthCsrfToken,
          },
          payload: JSON.stringify({ email: 'teacher@elimupin.co.ke', password: 'Password123!' }),
        });
        expect(loginRes.statusCode).toBe(200);
        const postLoginCsrfToken = String(loginRes.headers['x-csrf-token']);
        expect(postLoginCsrfToken).toBeTruthy();
        expect(postLoginCsrfToken).not.toBe(preAuthCsrfToken);

        const loginSetCookies = extractSetCookieLines(loginRes.headers['set-cookie']);
        const sessionCookieVal = extractCookieValueFromSetCookie(
          loginSetCookies,
          SESSION_COOKIE_NAME,
        );
        expect(sessionCookieVal).toBe('live-session-tok-abc123');

        // 4. Replaying the pre-login CSRF token alongside the new session_token MUST fail with 403 CSRF_TOKEN_INVALID
        const replayPreTokenRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `${SESSION_COOKIE_NAME}=${sessionCookieVal}`,
            'x-csrf-token': preAuthCsrfToken,
          },
        });
        expect(replayPreTokenRes.statusCode).toBe(403);
        expect(replayPreTokenRes.json().error.code).toBe('CSRF_TOKEN_INVALID');

        // 5. Using the rotated post-login CSRF token succeeds on POST /api/v1/auth/logout and rotates token again
        const logoutRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `${SESSION_COOKIE_NAME}=${sessionCookieVal}`,
            'x-csrf-token': postLoginCsrfToken,
          },
        });
        expect(logoutRes.statusCode).toBe(200);
        const postLogoutToken = String(logoutRes.headers['x-csrf-token']);
        expect(postLogoutToken).toBeTruthy();
        expect(postLogoutToken).not.toBe(postLoginCsrfToken);
      } finally {
        await app.close();
      }
    });

    it('enforces conjunctive 415 Content-Type, 403 Origin/Referer allowlist, Referer fallback, TTL expiry, and previous-secret rotation', async () => {
      let currentNowSec = 1_760_000_000;
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        csrfSecretOverride: TEST_CSRF_SECRET,
        csrfSecretPreviousOverride: PREV_CSRF_SECRET,
        csrfTokenTtlSecondsOverride: 600,
        csrfNowSecFn: () => currentNowSec,
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const csrfCtx = 'pre-ctx-fixed-cookie-value';
        const subject = resolveCsrfSubject({ [CSRF_CTX_COOKIE_NAME]: csrfCtx })!;
        const validToken = mintCsrfToken(subject, TEST_CSRF_SECRET, currentNowSec);

        // 1. 415 UNSUPPORTED_MEDIA_TYPE on HTML form / multipart / text/plain simple requests
        for (const badType of [
          'application/x-www-form-urlencoded',
          'multipart/form-data; boundary=---xyz',
          'text/plain',
        ]) {
          const formRes = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            headers: {
              origin: ALLOWED_ORIGIN,
              'content-type': badType,
              cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
              'x-csrf-token': validToken,
            },
            payload: 'email=a%40b.com&password=secret',
          });
          expect(formRes.statusCode).toBe(415);
          expect(formRes.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
        }

        // 2. Missing both Origin and Referer -> 403 CSRF_ORIGIN_REQUIRED even with valid token
        const missingOriginRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': validToken,
          },
          payload: JSON.stringify({ email: 'bad', password: 'x' }),
        });
        expect(missingOriginRes.statusCode).toBe(403);
        expect(missingOriginRes.json().error.code).toBe('CSRF_ORIGIN_REQUIRED');

        // 3. Unlisted Origin or Origin: null -> 403 CSRF_ORIGIN_DENIED even with valid token
        for (const deniedOrigin of ['https://evil.site', 'null']) {
          const deniedRes = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            headers: {
              origin: deniedOrigin,
              'content-type': 'application/json',
              cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
              'x-csrf-token': validToken,
            },
            payload: JSON.stringify({ email: 'bad', password: 'x' }),
          });
          expect(deniedRes.statusCode).toBe(403);
          expect(deniedRes.json().error.code).toBe('CSRF_ORIGIN_DENIED');
        }

        // 4. Referer fallback when Origin is absent passes CSRF and reaches route validation (400)
        const refererFallbackRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            referer: `${ALLOWED_ORIGIN}/login?next=%2Fdashboard`,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': validToken,
          },
          payload: JSON.stringify({ email: 'not-an-email', password: 'x' }),
        });
        expect(refererFallbackRes.statusCode).toBe(400);

        // 5. Previous secret verification during rolling CSRF secret rotation
        const prevSignedToken = mintCsrfToken(subject, PREV_CSRF_SECRET, currentNowSec);
        const prevSecretRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': prevSignedToken,
          },
          payload: JSON.stringify({ email: 'not-an-email', password: 'x' }),
        });
        expect(prevSecretRes.statusCode).toBe(400);

        // 6. Token expiration after TTL -> 403 CSRF_TOKEN_EXPIRED
        currentNowSec += 601;
        const expiredRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': validToken,
          },
          payload: JSON.stringify({ email: 'not-an-email', password: 'x' }),
        });
        expect(expiredRes.statusCode).toBe(403);
        expect(expiredRes.json().error.code).toBe('CSRF_TOKEN_EXPIRED');
      } finally {
        await app.close();
      }
    });

    it('exempts ONLY the Safaricom M-Pesa S2S webhook path from browser Origin/CSRF requirements', async () => {
      const mockCommerceService = {
        isSimulationEnabled: () => false,
        handleMpesaCallback: vi.fn().mockResolvedValue({
          ack: { ResultCode: 0, ResultDesc: 'Accepted' },
        }),
      };

      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        csrfSecretOverride: TEST_CSRF_SECRET,
        services: {
          commerceService: mockCommerceService as any,
          rateLimitService: makeIsolatedRateLimitService(),
        },
      });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ Body: { stkCallback: { ResultCode: 0 } } }),
        });

        expect(res.statusCode).toBe(200);
        expect(mockCommerceService.handleMpesaCallback).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });
  });

  describe('W3-AC-04 & W3-AC-05: Body Limits, Search Analytics Auth Alignment & Calendar Session Clear', () => {
    it('enforces 16 KiB body limit on /api/v1/auth/*, 32 KiB on M-Pesa webhook, and 1 MiB global body limit', async () => {
      const mockCommerceService = {
        isSimulationEnabled: () => false,
        handleMpesaCallback: vi.fn().mockResolvedValue({
          ack: { ResultCode: 0, ResultDesc: 'Accepted' },
        }),
      };

      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        csrfSecretOverride: TEST_CSRF_SECRET,
        services: {
          commerceService: mockCommerceService as any,
          rateLimitService: makeIsolatedRateLimitService(),
        },
      });
      await app.ready();

      try {
        const csrfCtx = 'body-limit-ctx';
        const csrfToken = mintCsrfToken(
          resolveCsrfSubject({ [CSRF_CTX_COOKIE_NAME]: csrfCtx })!,
          TEST_CSRF_SECRET,
        );

        // 1. > 16 KiB on /api/v1/auth/login -> 413
        const over16Kib = JSON.stringify({
          email: 'user@example.com',
          password: 'x'.repeat(17_000),
        });
        const authTooLarge = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': csrfToken,
          },
          payload: over16Kib,
        });
        expect(authTooLarge.statusCode).toBe(413);

        // 2. > 32 KiB on /api/v1/commerce/webhooks/mpesa -> 413
        const over32Kib = JSON.stringify({
          padding: 'y'.repeat(34_000),
        });
        const webhookTooLarge = await app.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhooks/mpesa',
          headers: { 'content-type': 'application/json' },
          payload: over32Kib,
        });
        expect(webhookTooLarge.statusCode).toBe(413);

        // 3. > 1 MiB on non-auth mutation route -> 413
        const over1Mib = JSON.stringify({
          eventCode: 'page_view',
          padding: 'z'.repeat(1_060_000),
        });
        const globalTooLarge = await app.inject({
          method: 'POST',
          url: '/api/v1/analytics/events',
          headers: {
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
            cookie: `${CSRF_CTX_COOKIE_NAME}=${csrfCtx}`,
            'x-csrf-token': csrfToken,
          },
          payload: over1Mib,
        });
        expect(globalTooLarge.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });

    it('standardizes search.ts protected analytics auth on SESSION_COOKIE_NAME only (401 UNAUTHENTICATED, generic 403 FORBIDDEN)', async () => {
      const mockAuthService = {
        validateSession: vi.fn().mockImplementation(async (token: string) => {
          if (token === 'valid-learner-session') {
            return {
              user: { id: 'learner-1', email: 'l@elimu.org', status: 'ACTIVE' },
              session: { id: 's-1', userId: 'learner-1' },
            };
          }
          return null;
        }),
      };
      const mockRbacService = {
        hasPermission: vi.fn().mockResolvedValue(false),
      };

      const app = buildApp({
        logger: false,
        services: {
          authService: mockAuthService as any,
          rbacService: mockRbacService as any,
          rateLimitService: makeIsolatedRateLimitService(),
        },
      });
      await app.ready();

      try {
        // Legacy elimu_session cookie & Authorization: Bearer header MUST be ignored -> 401 UNAUTHENTICATED
        const legacyRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/search/demand',
          headers: {
            cookie: 'elimu_session=valid-learner-session',
            authorization: 'Bearer valid-learner-session',
          },
        });
        expect(legacyRes.statusCode).toBe(401);
        expect(legacyRes.json().error.code).toBe('UNAUTHENTICATED');
        expect(mockAuthService.validateSession).not.toHaveBeenCalled();

        // Valid session_token without analytics.read -> 403 FORBIDDEN with generic message (no permission slug leak)
        const forbiddenRes = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/search/demand',
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=valid-learner-session`,
          },
        });
        expect(forbiddenRes.statusCode).toBe(403);
        expect(forbiddenRes.json().error.code).toBe('FORBIDDEN');
        expect(forbiddenRes.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);
        expect(forbiddenRes.json().error.message).not.toContain('analytics.read');
      } finally {
        await app.close();
      }
    });

    it('clears calendar_session with aligned HttpOnly + SameSite=Lax + Path=/ attributes and rotates X-CSRF-Token on DELETE /api/v1/calendar/session', async () => {
      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [ALLOWED_ORIGIN],
        csrfSecretOverride: TEST_CSRF_SECRET,
        services: { rateLimitService: makeIsolatedRateLimitService() },
      });
      await app.ready();

      try {
        const calSid = '22222222-2222-4222-8222-222222222222';
        const calBoundToken = mintCsrfToken(
          resolveCsrfSubject({ calendar_session: calSid })!,
          TEST_CSRF_SECRET,
        );

        const res = await app.inject({
          method: 'DELETE',
          url: '/api/v1/calendar/session',
          headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `calendar_session=${calSid}`,
            'x-csrf-token': calBoundToken,
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ success: true });

        const setCookies = extractSetCookieLines(res.headers['set-cookie']);
        const clearedLine = setCookies.find((l) => l.startsWith('calendar_session='));
        expect(clearedLine).toBeDefined();
        expect(clearedLine).toContain('Path=/');
        expect(clearedLine).toContain('HttpOnly');
        expect(clearedLine?.toLowerCase()).toContain('samesite=lax');

        const rotatedCsrf = String(res.headers['x-csrf-token']);
        expect(rotatedCsrf).toBeTruthy();
        expect(rotatedCsrf).not.toBe(calBoundToken);
      } finally {
        await app.close();
      }
    });
  });
});
