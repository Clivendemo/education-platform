import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';

export const CSRF_CTX_COOKIE_NAME = 'csrf_ctx';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_RESPONSE_HEADER_NAME = 'X-CSRF-Token';

const UNSAFE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_TOKEN_FORMAT_REGEX = /^v1\.(\d{10,11})\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const MAX_CLOCK_SKEW_SECONDS = 60;

export interface CsrfGuardOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  allowedOrigins?: string[];
  csrfSecret?: string;
  csrfSecretPrevious?: string;
  csrfTokenTtlSeconds?: number;
  sessionCookieName?: string;
  enableLegacyCallbackAlias?: boolean;
  nowSecFn?: () => number;
}

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function parseRawCookieHeader(rawCookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawCookieHeader || typeof rawCookieHeader !== 'string') {
    return out;
  }
  for (const part of rawCookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(rawVal);
    } catch {
      out[name] = rawVal;
    }
  }
  return out;
}

export function extractRequestCookies(request: FastifyRequest): Record<string, string> {
  if (request.cookies && Object.keys(request.cookies).length > 0) {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.cookies)) {
      if (typeof v === 'string') {
        normalized[k] = v;
      }
    }
    return normalized;
  }
  return parseRawCookieHeader(request.headers.cookie);
}

/**
 * Exact normalized pathname match for Safaricom M-Pesa Daraja S2S callbacks (only S2S exception).
 */
export function isMpesaWebhookPath(
  rawUrl: string,
  enableLegacyCallbackAlias: boolean = env.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS,
): boolean {
  const qIdx = rawUrl.indexOf('?');
  const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  if (
    pathname === '/api/v1/commerce/webhooks/mpesa' ||
    pathname === '/api/v1/payments/mpesa/callback' ||
    pathname === '/api/v1/mpesa/callback'
  ) {
    return true;
  }
  if (
    enableLegacyCallbackAlias &&
    (pathname === '/api/payments/mpesa/callback' || pathname === '/api/mpesa/callback')
  ) {
    return true;
  }
  return false;
}

/**
 * Principal subject binding hierarchy (`WP3 §3.2`):
 * Resolves stateless CSRF binding strictly from active HttpOnly cookie SHA-256 digests with zero DB queries.
 */
export function resolveCsrfSubject(
  cookies: Record<string, string | undefined>,
  sessionCookieName: string = env.SESSION_COOKIE_NAME,
): string | null {
  const sessionToken = cookies[sessionCookieName]?.trim();
  if (sessionToken) {
    return `auth:${sha256Hex(sessionToken)}`;
  }

  const calSession = cookies['calendar_session']?.trim();
  if (calSession) {
    return `cal:${sha256Hex(calSession)}`;
  }

  const fbSession = cookies['rf_sid']?.trim();
  if (fbSession) {
    return `fb:${sha256Hex(fbSession)}`;
  }

  const anonSession = cookies['elimu_anon_sid']?.trim();
  if (anonSession) {
    return `anon:${sha256Hex(anonSession)}`;
  }

  const preCtx = cookies[CSRF_CTX_COOKIE_NAME]?.trim();
  if (preCtx) {
    return `pre:${sha256Hex(preCtx)}`;
  }

  return null;
}

function computeCsrfHmacBuffer(
  secret: string,
  subjectBinding: string,
  issuedAtUnixSec: number | string,
  nonceHex32: string,
): Buffer {
  return crypto
    .createHmac('sha256', secret)
    .update(`v1|${subjectBinding}|${issuedAtUnixSec}|${nonceHex32}`, 'utf8')
    .digest();
}

export function mintCsrfToken(
  subjectBinding: string,
  secret: string = env.CSRF_SECRET,
  issuedAtUnixSec: number = Math.floor(Date.now() / 1000),
): string {
  const nonceHex32 = crypto.randomBytes(16).toString('hex');
  const hmacHex64 = computeCsrfHmacBuffer(
    secret,
    subjectBinding,
    issuedAtUnixSec,
    nonceHex32,
  ).toString('hex');
  return `v1.${issuedAtUnixSec}.${nonceHex32}.${hmacHex64}`;
}

export type CsrfVerificationFailureCode =
  | 'CSRF_TOKEN_MISSING'
  | 'CSRF_TOKEN_INVALID'
  | 'CSRF_TOKEN_EXPIRED';

export function verifyCsrfToken(
  rawHeader: string | string[] | undefined,
  subjectBinding: string | null,
  options: {
    activeSecret?: string;
    previousSecret?: string;
    ttlSeconds?: number;
    nowSec?: number;
  } = {},
): { valid: true } | { valid: false; code: CsrfVerificationFailureCode } {
  if (
    rawHeader === undefined ||
    rawHeader === null ||
    Array.isArray(rawHeader) ||
    typeof rawHeader !== 'string' ||
    rawHeader.trim() === ''
  ) {
    return { valid: false, code: 'CSRF_TOKEN_MISSING' };
  }

  const trimmed = rawHeader.trim();
  if (trimmed.length > 128 || !subjectBinding) {
    return { valid: false, code: 'CSRF_TOKEN_INVALID' };
  }

  const match = CSRF_TOKEN_FORMAT_REGEX.exec(trimmed);
  if (!match) {
    return { valid: false, code: 'CSRF_TOKEN_INVALID' };
  }

  const issuedAtStr = match[1];
  const nonceHex32 = match[2];
  const candidateHmacHex = match[3];
  const issuedAtSec = Number.parseInt(issuedAtStr, 10);
  if (!Number.isSafeInteger(issuedAtSec)) {
    return { valid: false, code: 'CSRF_TOKEN_INVALID' };
  }

  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? env.CSRF_TOKEN_TTL_SECONDS;

  if (issuedAtSec > nowSec + MAX_CLOCK_SKEW_SECONDS) {
    return { valid: false, code: 'CSRF_TOKEN_INVALID' };
  }

  if (nowSec - issuedAtSec > ttlSeconds) {
    return { valid: false, code: 'CSRF_TOKEN_EXPIRED' };
  }

  const candidateBuf = Buffer.from(candidateHmacHex, 'hex');
  if (candidateBuf.byteLength !== 32) {
    return { valid: false, code: 'CSRF_TOKEN_INVALID' };
  }

  const activeSecret = options.activeSecret ?? env.CSRF_SECRET;
  const expectedPrimary = computeCsrfHmacBuffer(
    activeSecret,
    subjectBinding,
    issuedAtStr,
    nonceHex32,
  );
  if (crypto.timingSafeEqual(expectedPrimary, candidateBuf)) {
    return { valid: true };
  }

  const previousSecret = options.previousSecret ?? env.CSRF_SECRET_PREVIOUS;
  if (previousSecret && previousSecret !== activeSecret) {
    const expectedPrevious = computeCsrfHmacBuffer(
      previousSecret,
      subjectBinding,
      issuedAtStr,
      nonceHex32,
    );
    if (crypto.timingSafeEqual(expectedPrevious, candidateBuf)) {
      return { valid: true };
    }
  }

  return { valid: false, code: 'CSRF_TOKEN_INVALID' };
}

/**
 * Bootstrap helper for `GET /api/v1/auth/csrf`.
 * Binds token to active HttpOnly session cookie or mints an opaque HttpOnly `csrf_ctx` pre-auth cookie.
 */
export function issueCsrfBootstrap(
  request: FastifyRequest,
  reply: FastifyReply,
  options: {
    nodeEnv?: 'development' | 'test' | 'production';
    csrfSecret?: string;
    csrfTokenTtlSeconds?: number;
    sessionCookieName?: string;
  } = {},
): { csrfToken: string; expiresInSeconds: number } {
  const effectiveNodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const activeSecret = options.csrfSecret ?? env.CSRF_SECRET;
  const ttlSeconds = options.csrfTokenTtlSeconds ?? env.CSRF_TOKEN_TTL_SECONDS;
  const sessionCookieName = options.sessionCookieName ?? env.SESSION_COOKIE_NAME;

  const cookies = extractRequestCookies(request);
  let subjectBinding = resolveCsrfSubject(cookies, sessionCookieName);

  if (!subjectBinding) {
    const rawCsrfCtx = crypto.randomBytes(16).toString('hex');
    reply.setCookie(CSRF_CTX_COOKIE_NAME, rawCsrfCtx, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: effectiveNodeEnv === 'production',
      maxAge: ttlSeconds,
    });
    subjectBinding = `pre:${sha256Hex(rawCsrfCtx)}`;
  }

  const csrfToken = mintCsrfToken(subjectBinding, activeSecret);
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header(CSRF_RESPONSE_HEADER_NAME, csrfToken);

  return {
    csrfToken,
    expiresInSeconds: ttlSeconds,
  };
}

function hasNonEmptyRequestBody(request: FastifyRequest): boolean {
  const te = request.headers['transfer-encoding'];
  if (typeof te === 'string' && te.trim().length > 0) {
    return true;
  }
  if (Array.isArray(te) && te.length > 0) {
    return true;
  }
  const cl = request.headers['content-length'];
  if (typeof cl === 'string') {
    const trimmed = cl.trim();
    if (trimmed.length === 0 || trimmed === '0') {
      return false;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) || parsed > 0;
  }
  return false;
}

function isJsonMediaType(rawContentType: string | string[] | undefined): boolean {
  if (typeof rawContentType !== 'string') {
    return false;
  }
  const trimmed = rawContentType.trim().toLowerCase();
  return trimmed === 'application/json' || /^application\/json\s*;/.test(trimmed);
}

function parseSingleHeaderOrigin(rawVal: string | string[] | undefined): string | null {
  if (typeof rawVal !== 'string') {
    return null;
  }
  const trimmed = rawVal.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

interface ParsedSetCookieMutation {
  name: string;
  value: string;
  isCleared: boolean;
}

function parseSetCookieMutations(
  rawSetCookie: number | string | string[] | undefined,
): ParsedSetCookieMutation[] {
  if (!rawSetCookie) return [];
  const lines = Array.isArray(rawSetCookie) ? rawSetCookie : [String(rawSetCookie)];
  const mutations: ParsedSetCookieMutation[] = [];

  for (const line of lines) {
    const segments = line.split(';').map((s) => s.trim());
    if (segments.length === 0 || !segments[0]) continue;
    const eqIdx = segments[0].indexOf('=');
    if (eqIdx <= 0) continue;

    const name = segments[0].slice(0, eqIdx).trim();
    const rawVal = segments[0].slice(eqIdx + 1).trim();
    let decodedVal = rawVal;
    try {
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      decodedVal = rawVal;
    }

    let isCleared = decodedVal === '';
    for (let i = 1; i < segments.length; i++) {
      const attr = segments[i].toLowerCase();
      if (attr.startsWith('max-age=')) {
        const ageNum = Number.parseInt(attr.slice('max-age='.length), 10);
        if (!Number.isNaN(ageNum) && ageNum <= 0) {
          isCleared = true;
        }
      } else if (attr.startsWith('expires=')) {
        const expTime = Date.parse(segments[i].slice('expires='.length));
        if (!Number.isNaN(expTime) && expTime <= Date.now() - 1000) {
          isCleared = true;
        }
      }
    }

    mutations.push({
      name,
      value: decodedVal,
      isCleared,
    });
  }

  return mutations;
}

/**
 * Registers strict conjunctive Wave 3 WP3 CSRF defense (`415` Content-Type + `403` Origin/Referer
 * allowlist + constant-time HMAC-SHA256 `X-CSRF-Token` bound to active HttpOnly cookie digest)
 * across ALL environments (`development`, `test`, `production`) with zero test-mode bypasses.
 */
export function registerCsrfGuard(
  app: FastifyInstance,
  options: CsrfGuardOptions = {},
): void {
  const effectiveNodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const allowedOriginsSet = new Set(
    options.allowedOrigins ?? env.ALLOWED_CORS_ORIGINS_LIST,
  );
  const activeSecret = options.csrfSecret ?? env.CSRF_SECRET;
  const previousSecret = options.csrfSecretPrevious ?? env.CSRF_SECRET_PREVIOUS;
  const ttlSeconds = options.csrfTokenTtlSeconds ?? env.CSRF_TOKEN_TTL_SECONDS;
  const sessionCookieName = options.sessionCookieName ?? env.SESSION_COOKIE_NAME;
  const enableLegacyAlias =
    options.enableLegacyCallbackAlias ?? env.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS;
  const nowSecFn = options.nowSecFn ?? (() => Math.floor(Date.now() / 1000));

  const trackedRotationCookies = new Set([
    sessionCookieName,
    'calendar_session',
    'rf_sid',
  ]);

  // 1. Conjunctive CSRF pre-parse guard (runs before body parsing on all unsafe methods)
  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_HTTP_METHODS.has(request.method)) {
      return;
    }

    if (isMpesaWebhookPath(request.url, enableLegacyAlias)) {
      return;
    }

    // Step A: Form / Simple-Request Content-Type Rejection (415 UNSUPPORTED_MEDIA_TYPE)
    const hasBody = hasNonEmptyRequestBody(request);
    const rawContentType = request.headers['content-type'];
    const hasContentType =
      rawContentType !== undefined &&
      !(typeof rawContentType === 'string' && rawContentType.trim() === '');

    if ((hasBody && !isJsonMediaType(rawContentType)) || (!hasBody && hasContentType && !isJsonMediaType(rawContentType))) {
      return reply.status(415).send({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type must be application/json for state-changing requests.',
          requestId: request.id,
        },
      });
    }

    // Step B: Strict Origin / Referer Allowlist Check (403 CSRF_ORIGIN_DENIED / CSRF_ORIGIN_REQUIRED)
    if (request.headers.origin !== undefined) {
      const parsedOrigin = parseSingleHeaderOrigin(request.headers.origin);
      if (!parsedOrigin || !allowedOriginsSet.has(parsedOrigin)) {
        return reply.status(403).send({
          error: {
            code: 'CSRF_ORIGIN_DENIED',
            message: 'Request Origin is not permitted.',
            requestId: request.id,
          },
        });
      }
    } else if (request.headers.referer !== undefined) {
      const parsedRefererOrigin = parseSingleHeaderOrigin(request.headers.referer);
      if (!parsedRefererOrigin || !allowedOriginsSet.has(parsedRefererOrigin)) {
        return reply.status(403).send({
          error: {
            code: 'CSRF_ORIGIN_DENIED',
            message: 'Request Referer origin is not permitted.',
            requestId: request.id,
          },
        });
      }
    } else {
      return reply.status(403).send({
        error: {
          code: 'CSRF_ORIGIN_REQUIRED',
          message: 'Origin or Referer header is required for state-changing requests.',
          requestId: request.id,
        },
      });
    }

    // Step C: Constant-Time HMAC-SHA256 X-CSRF-Token Verification
    const cookies = extractRequestCookies(request);
    const subjectBinding = resolveCsrfSubject(cookies, sessionCookieName);
    const verification = verifyCsrfToken(request.headers[CSRF_HEADER_NAME], subjectBinding, {
      activeSecret,
      previousSecret,
      ttlSeconds,
      nowSec: nowSecFn(),
    });

    if (!verification.valid) {
      const message =
        verification.code === 'CSRF_TOKEN_MISSING'
          ? 'Missing X-CSRF-Token header.'
          : verification.code === 'CSRF_TOKEN_EXPIRED'
            ? 'CSRF token has expired. Refresh token via GET /api/v1/auth/csrf.'
            : 'Invalid CSRF token for active session context.';
      return reply.status(403).send({
        error: {
          code: verification.code,
          message,
          requestId: request.id,
        },
      });
    }
  });

  // 2. Automatic CSRF rotation across session transitions (`Set-Cookie` on login/register/password-change/logout/calendar/feedback)
  app.addHook('onSend', async (request, reply) => {
    const rawSetCookie = reply.getHeader('set-cookie') ?? reply.getHeader('Set-Cookie');
    if (!rawSetCookie) {
      return;
    }

    const mutations = parseSetCookieMutations(rawSetCookie);
    const touchedSessionCookie = mutations.some((m) => trackedRotationCookies.has(m.name));
    if (!touchedSessionCookie) {
      return;
    }

    const effectiveCookies: Record<string, string | undefined> = {
      ...extractRequestCookies(request),
    };

    let primarySessionNewlySet = false;
    for (const mut of mutations) {
      if (mut.isCleared) {
        delete effectiveCookies[mut.name];
      } else {
        effectiveCookies[mut.name] = mut.value;
        if (mut.name === sessionCookieName) {
          primarySessionNewlySet = true;
        }
      }
    }

    // When `session_token` is issued/rotated, clear pre-auth `csrf_ctx` cookie with matching attributes
    if (primarySessionNewlySet && effectiveCookies[CSRF_CTX_COOKIE_NAME]) {
      delete effectiveCookies[CSRF_CTX_COOKIE_NAME];
      reply.clearCookie(CSRF_CTX_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: effectiveNodeEnv === 'production',
      });
    }

    let nextSubject = resolveCsrfSubject(effectiveCookies, sessionCookieName);
    if (!nextSubject) {
      // Session was cleared (e.g., POST /auth/logout or DELETE /calendar/session) with no remaining session cookie:
      // issue a fresh pre-auth `csrf_ctx` cookie and bind rotated token to it.
      const newCsrfCtx = crypto.randomBytes(16).toString('hex');
      reply.setCookie(CSRF_CTX_COOKIE_NAME, newCsrfCtx, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: effectiveNodeEnv === 'production',
        maxAge: ttlSeconds,
      });
      nextSubject = `pre:${sha256Hex(newCsrfCtx)}`;
    }

    const rotatedToken = mintCsrfToken(nextSubject, activeSecret, nowSecFn());
    reply.header(CSRF_RESPONSE_HEADER_NAME, rotatedToken);
  });
}
