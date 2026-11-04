import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';

export interface HttpSecurityOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  allowedOrigins?: string[];
  canonicalDomain?: string;
  hstsMaxAgeSeconds?: number;
  hstsIncludeSubDomains?: boolean;
}

const ALLOWED_PREFLIGHT_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const ALLOWED_PREFLIGHT_HEADERS_LOWER = new Set([
  'content-type',
  'x-csrf-token',
  'x-request-id',
  'x-calendar-session',
  'accept',
  'idempotency-key',
]);

const ALLOW_HEADERS_HEADER_VALUE =
  'Content-Type, X-CSRF-Token, X-Request-ID, X-Calendar-Session, Accept, Idempotency-Key';

const ALLOW_METHODS_HEADER_VALUE = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

const PREFLIGHT_VARY_TOKENS = [
  'Origin',
  'Access-Control-Request-Method',
  'Access-Control-Request-Headers',
];

const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const PERMISSIONS_POLICY_VALUE =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

function appendVaryTokens(reply: FastifyReply, tokens: string[]): void {
  const existingRaw = reply.getHeader('Vary') ?? reply.getHeader('vary');
  const existingList: string[] = [];

  if (typeof existingRaw === 'string') {
    for (const part of existingRaw.split(',')) {
      const trimmed = part.trim();
      if (trimmed) existingList.push(trimmed);
    }
  } else if (Array.isArray(existingRaw)) {
    for (const entry of existingRaw) {
      for (const part of String(entry).split(',')) {
        const trimmed = part.trim();
        if (trimmed) existingList.push(trimmed);
      }
    }
  }

  const seenLower = new Set(existingList.map((t) => t.toLowerCase()));
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      existingList.push(token);
    }
  }

  if (existingList.length > 0) {
    reply.header('Vary', existingList.join(', '));
  }
}

function isSensitiveApiPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/v1/auth/') ||
    pathname === '/api/v1/auth' ||
    pathname.startsWith('/api/v1/me/') ||
    pathname === '/api/v1/me' ||
    pathname.startsWith('/api/v1/admin/') ||
    pathname === '/api/v1/admin' ||
    pathname.startsWith('/api/v1/checkout') ||
    pathname.startsWith('/api/v1/orders') ||
    pathname.startsWith('/api/v1/payments') ||
    pathname.startsWith('/api/v1/audit') ||
    pathname.startsWith('/api/v1/retention') ||
    pathname.startsWith('/api/v1/contributors') ||
    pathname.startsWith('/api/v1/calendar/session')
  );
}

/**
 * Registers Wave 3 WP3 HTTP Security Headers, RFC 6797 §7.2 Staged HSTS,
 * Strict CORS Allowlist, and Split `Vary` / Preflight Cache Rules.
 */
export function registerHttpSecurity(
  app: FastifyInstance,
  options: HttpSecurityOptions = {},
): void {
  const effectiveNodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const allowedOriginsSet = new Set(
    options.allowedOrigins ?? env.ALLOWED_CORS_ORIGINS_LIST,
  );
  const canonicalDomain = options.canonicalDomain ?? env.CANONICAL_DOMAIN;
  const hstsMaxAgeSeconds = options.hstsMaxAgeSeconds ?? env.HSTS_MAX_AGE_SECONDS;
  const hstsIncludeSubDomains =
    options.hstsIncludeSubDomains ?? env.HSTS_INCLUDE_SUBDOMAINS;

  // 1. Strict OPTIONS preflight handling before route dispatch
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'OPTIONS') {
      return;
    }

    appendVaryTokens(reply, PREFLIGHT_VARY_TOKENS);

    const rawOrigin = request.headers.origin;
    const origin =
      typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
    const originAllowed =
      origin.length > 0 &&
      origin.toLowerCase() !== 'null' &&
      allowedOriginsSet.has(origin);

    const rawReqMethod = request.headers['access-control-request-method'];
    const reqMethod =
      typeof rawReqMethod === 'string' ? rawReqMethod.trim().toUpperCase() : '';
    const methodAllowed =
      reqMethod.length > 0 && ALLOWED_PREFLIGHT_METHODS.has(reqMethod);

    const rawReqHeaders = request.headers['access-control-request-headers'];
    let headersAllowed = true;
    if (Array.isArray(rawReqHeaders)) {
      const joined = rawReqHeaders.join(',');
      for (const token of joined.split(',')) {
        const normalized = token.trim().toLowerCase();
        if (normalized.length > 0 && !ALLOWED_PREFLIGHT_HEADERS_LOWER.has(normalized)) {
          headersAllowed = false;
          break;
        }
      }
    } else if (typeof rawReqHeaders === 'string' && rawReqHeaders.trim().length > 0) {
      for (const token of rawReqHeaders.split(',')) {
        const normalized = token.trim().toLowerCase();
        if (normalized.length > 0 && !ALLOWED_PREFLIGHT_HEADERS_LOWER.has(normalized)) {
          headersAllowed = false;
          break;
        }
      }
    }

    if (originAllowed && methodAllowed && headersAllowed) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', ALLOW_METHODS_HEADER_VALUE);
      reply.header('Access-Control-Allow-Headers', ALLOW_HEADERS_HEADER_VALUE);
      reply.header('Access-Control-Max-Age', '600');
      reply.header('Cache-Control', 'private, max-age=600');
      return reply.status(204).send();
    }

    reply.header('Cache-Control', 'no-store');
    return reply.status(403).send({
      error: {
        code: originAllowed ? 'CORS_PREFLIGHT_DENIED' : 'CORS_ORIGIN_DENIED',
        message: 'CORS preflight request denied.',
        requestId: request.id,
      },
    });
  });

  // 2. Response security headers, RFC 6797 §7.2 HSTS gate, non-OPTIONS CORS, and sensitive Cache-Control
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);

    // RFC 6797 §7.2 Strict HSTS Emission Gate:
    // Emitted ONLY in production, when HSTS_MAX_AGE_SECONDS > 0, CANONICAL_DOMAIN uses https://,
    // and the request arrived over verified HTTPS (via bounded resolveEffectiveTrustProxy).
    if (
      effectiveNodeEnv === 'production' &&
      hstsMaxAgeSeconds > 0 &&
      canonicalDomain.startsWith('https://') &&
      request.protocol === 'https'
    ) {
      const hstsValue = hstsIncludeSubDomains
        ? `max-age=${hstsMaxAgeSeconds}; includeSubDomains`
        : `max-age=${hstsMaxAgeSeconds}`;
      reply.header('Strict-Transport-Security', hstsValue);
    } else {
      reply.removeHeader('Strict-Transport-Security');
    }

    if (request.method === 'OPTIONS') {
      appendVaryTokens(reply, PREFLIGHT_VARY_TOKENS);
      return;
    }

    // Standard non-OPTIONS responses always append `Origin` to `Vary`
    appendVaryTokens(reply, ['Origin']);

    const rawOrigin = request.headers.origin;
    const origin = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
    if (
      origin.length > 0 &&
      origin.toLowerCase() !== 'null' &&
      allowedOriginsSet.has(origin)
    ) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
    } else {
      reply.removeHeader('Access-Control-Allow-Origin');
      reply.removeHeader('Access-Control-Allow-Credentials');
    }

    // Sensitive-endpoint cache lockdown (preserving existing explicit `no-store` headers)
    const qIdx = request.url.indexOf('?');
    const pathname = qIdx >= 0 ? request.url.slice(0, qIdx) : request.url;
    const existingCacheControl = String(
      reply.getHeader('Cache-Control') ?? reply.getHeader('cache-control') ?? '',
    );

    if (
      !existingCacheControl.toLowerCase().includes('no-store') &&
      (isSensitiveApiPath(pathname) ||
        (Boolean(request.headers.cookie) && !existingCacheControl))
    ) {
      reply.header('Cache-Control', 'private, no-store, max-age=0');
    }
  });
}
