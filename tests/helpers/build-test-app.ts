import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  CSRF_CTX_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isMpesaWebhookPath,
  mintCsrfToken,
  parseRawCookieHeader,
  resolveCsrfSubject,
} from '../../src/routes/middleware/csrf-guard.js';

export const TEST_ALLOWED_ORIGIN = 'http://localhost:3000';
const DEFAULT_PREAUTH_CSRF_CTX = 'test-wave3-preauth-csrf-context-0001';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WRAPPED_SYM = Symbol.for('elimu.wave3.testCsrfAutoInjectWrapped');

function hasHeaderCaseInsensitive(
  headers: Record<string, unknown>,
  targetLower: string,
): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === targetLower);
}

function findHeaderKeyCaseInsensitive(
  headers: Record<string, unknown>,
  targetLower: string,
): string | undefined {
  return Object.keys(headers).find((k) => k.toLowerCase() === targetLower);
}

export function createTestCsrfHeaders(
  cookiesOrRawHeader?: Record<string, string | undefined> | string,
  origin: string = TEST_ALLOWED_ORIGIN,
): {
  headers: Record<string, string>;
  cookies: Record<string, string>;
} {
  const mergedCookies: Record<string, string> = {};
  if (typeof cookiesOrRawHeader === 'string') {
    Object.assign(mergedCookies, parseRawCookieHeader(cookiesOrRawHeader));
  } else if (cookiesOrRawHeader) {
    for (const [k, v] of Object.entries(cookiesOrRawHeader)) {
      if (typeof v === 'string') {
        mergedCookies[k] = v;
      }
    }
  }

  let subject = resolveCsrfSubject(mergedCookies);
  if (!subject) {
    mergedCookies[CSRF_CTX_COOKIE_NAME] = DEFAULT_PREAUTH_CSRF_CTX;
    subject = resolveCsrfSubject(mergedCookies)!;
  }

  const csrfToken = mintCsrfToken(subject);
  return {
    headers: {
      origin,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    cookies: mergedCookies,
  };
}

export function withCsrfInjectOptions(opts: InjectOptions | string): InjectOptions | string {
  if (typeof opts === 'string') {
    return opts;
  }

  const method = String(opts.method ?? 'GET').toUpperCase();
  const url = String(opts.url ?? '/');
  if (!UNSAFE_METHODS.has(method) || isMpesaWebhookPath(url, true)) {
    return opts;
  }

  const headers: Record<string, any> = { ...(opts.headers ?? {}) };
  const cookieHeaderKey = findHeaderKeyCaseInsensitive(headers, 'cookie');
  const rawCookieStr =
    cookieHeaderKey && typeof headers[cookieHeaderKey] === 'string'
      ? (headers[cookieHeaderKey] as string)
      : undefined;

  const mergedCookies: Record<string, string> = {
    ...parseRawCookieHeader(rawCookieStr),
  };
  if (opts.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      if (typeof v === 'string') {
        mergedCookies[k] = v;
      }
    }
  }

  let nextCookies = opts.cookies ? { ...opts.cookies } : undefined;
  let subject = resolveCsrfSubject(mergedCookies);

  if (!subject) {
    mergedCookies[CSRF_CTX_COOKIE_NAME] = DEFAULT_PREAUTH_CSRF_CTX;
    subject = resolveCsrfSubject(mergedCookies)!;
    if (cookieHeaderKey && typeof headers[cookieHeaderKey] === 'string') {
      const existing = (headers[cookieHeaderKey] as string).trim();
      headers[cookieHeaderKey] = existing
        ? `${existing}; ${CSRF_CTX_COOKIE_NAME}=${DEFAULT_PREAUTH_CSRF_CTX}`
        : `${CSRF_CTX_COOKIE_NAME}=${DEFAULT_PREAUTH_CSRF_CTX}`;
    } else {
      nextCookies = {
        ...(nextCookies ?? {}),
        [CSRF_CTX_COOKIE_NAME]: DEFAULT_PREAUTH_CSRF_CTX,
      };
    }
  }

  if (
    !hasHeaderCaseInsensitive(headers, 'origin') &&
    !hasHeaderCaseInsensitive(headers, 'referer')
  ) {
    headers.origin = TEST_ALLOWED_ORIGIN;
  }

  if (!hasHeaderCaseInsensitive(headers, CSRF_HEADER_NAME)) {
    headers[CSRF_HEADER_NAME] = mintCsrfToken(subject);
  }

  return {
    ...opts,
    headers,
    ...(nextCookies ? { cookies: nextCookies } : {}),
  };
}

/**
 * Wraps `app.inject` for existing non-CSRF functional test suites so state-changing requests
 * supply real cryptographic `Origin` + cookie-bound `X-CSRF-Token` material without any
 * test-mode bypass in `src/routes/middleware/csrf-guard.ts`.
 */
export function enableTestCsrfAutoInject<T extends FastifyInstance>(app: T): T {
  const tagged = app as T & { [WRAPPED_SYM]?: boolean };
  if (tagged[WRAPPED_SYM]) {
    return app;
  }

  const origInject = app.inject.bind(app);
  (app as unknown as { inject: typeof app.inject }).inject = ((
    opts?: InjectOptions | string,
    cb?: any,
  ) => {
    const transformed = opts ? withCsrfInjectOptions(opts) : opts;
    if (typeof cb === 'function') {
      return origInject(transformed as any, cb);
    }
    return origInject(transformed as any);
  }) as typeof app.inject;

  tagged[WRAPPED_SYM] = true;
  return app;
}

export async function injectWithCsrf(
  app: FastifyInstance,
  opts: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject(withCsrfInjectOptions(opts) as InjectOptions);
}

export function buildTestApp(): FastifyInstance {
  return enableTestCsrfAutoInject(
    buildApp({
      logger: false,
    }),
  );
}

