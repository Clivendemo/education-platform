import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import {
  BodyHashingTransform,
  EMPTY_BODY_SHA256_HEX,
  RateLimitService,
  RateLimitStoreUnavailableError,
  computePayloadFingerprints,
  derivePrivacyBucketKey,
  deriveScopedAdmissionKey,
  type BucketSpec,
  type Tier1PolicySpec,
} from '../../services/rate-limit.service.js';
import { extractRequestCookies, isMpesaWebhookPath } from './csrf-guard.js';

export const DEFAULT_GLOBAL_BODY_LIMIT_BYTES = 1_048_576; // 1 MiB
const VALID_IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]{1,128}$/;
const SIMPLE_EMAIL_CHECK_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RateLimitGuardOptions {
  rateLimitService: RateLimitService;
  defaultBodyLimitBytes?: number;
  sessionCookieName?: string;
  enableLegacyCallbackAlias?: boolean;
}

type DbFailureMode =
  | { kind: 'FAIL_CLOSED' }
  | { kind: 'DEGRADED_TIER1'; degradedSpec: Tier1PolicySpec };

interface Tier2RouteClassification {
  scopePrefix: string;
  admissionTtlSecs: number;
  failureMode: DbFailureMode;
  skipIfInvalidEmailBody?: boolean;
  buildBuckets: (ctx: {
    ip: string;
    actorKey: string;
    normalizedEmail: string | null;
    hmacSecret: string;
  }) => BucketSpec[];
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const trimmed = ip.trim().toLowerCase();
  return (
    trimmed === '127.0.0.1' ||
    trimmed === '::1' ||
    trimmed === '::ffff:127.0.0.1'
  );
}

function getPathname(rawUrl: string): string {
  const qIdx = rawUrl.indexOf('?');
  return qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
}

function hasRequestBodyStream(request: FastifyRequest): boolean {
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
    if (!trimmed || trimmed === '0') {
      return false;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) || parsed > 0;
  }
  return false;
}

function isJsonContentType(rawContentType: string | string[] | undefined): boolean {
  if (typeof rawContentType !== 'string') return false;
  const trimmed = rawContentType.trim().toLowerCase();
  return trimmed === 'application/json' || /^application\/json\s*;/.test(trimmed);
}

function resolveTier1ActorIdentifier(
  request: FastifyRequest,
  sessionCookieName: string,
): string {
  const cookies = extractRequestCookies(request);
  const sessionTok = cookies[sessionCookieName]?.trim();
  if (sessionTok) {
    return `sess:${crypto.createHash('sha256').update(sessionTok, 'utf8').digest('hex').slice(0, 32)}`;
  }
  const calTok = cookies['calendar_session']?.trim();
  if (calTok) {
    return `cal:${crypto.createHash('sha256').update(calTok, 'utf8').digest('hex').slice(0, 32)}`;
  }
  const fbTok = cookies['rf_sid']?.trim();
  if (fbTok) {
    return `fb:${crypto.createHash('sha256').update(fbTok, 'utf8').digest('hex').slice(0, 32)}`;
  }
  return `ip:${request.ip || '127.0.0.1'}`;
}

function resolveTier2ActorIdentifier(
  request: FastifyRequest,
  sessionCookieName: string,
): string {
  const authUser = (request as FastifyRequest & { user?: { id?: string } }).user;
  if (authUser?.id) {
    return `uid:${authUser.id}`;
  }
  return resolveTier1ActorIdentifier(request, sessionCookieName);
}

/**
 * Classifies a request into its Tier 1 in-memory shield policy (`WP4 §6.2`).
 * Returns `null` when exempt (loopback `/health` or M-Pesa S2S webhook).
 */
function classifyTier1Policy(
  method: string,
  pathname: string,
  ip: string,
  actorKey: string,
  hmacSecret: string,
  enableLegacyAlias: boolean,
): { key: string; spec: Tier1PolicySpec } | null {
  if (isMpesaWebhookPath(pathname, enableLegacyAlias)) {
    return null;
  }

  if (pathname === '/api/v1/health' || pathname.startsWith('/api/v1/health/')) {
    if (isLoopbackIp(ip)) {
      return null;
    }
    const spec: Tier1PolicySpec = {
      policyId: 't1_health_ext',
      capacityMt: 120_000,
      refillTokensMt: 120_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  // Category 9: Analytics Ingestion (Tier 1 ONLY — 0 PG rate-limit writes)
  if (method === 'POST' && pathname === '/api/v1/analytics/events') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_analytics_events',
      capacityMt: 120_000,
      refillTokensMt: 120_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  // Category 2: Search & Autocomplete & Search Analytics
  if (method === 'GET') {
    if (pathname === '/api/v1/search/autocomplete') {
      const spec: Tier1PolicySpec = {
        policyId: 't1_search_autocomplete',
        capacityMt: 180_000,
        refillTokensMt: 180_000,
        refillPeriodMs: 60_000,
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
        spec,
      };
    }

    if (
      pathname === '/api/v1/admin/search/demand' ||
      pathname === '/api/v1/search/analytics'
    ) {
      const spec: Tier1PolicySpec = {
        policyId: 't1_search_analytics',
        capacityMt: 60_000,
        refillTokensMt: 60_000,
        refillPeriodMs: 60_000,
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
        spec,
      };
    }

    if (
      pathname === '/api/v1/search' ||
      pathname === '/api/v1/search/resources' ||
      pathname === '/api/v1/search/related'
    ) {
      const spec: Tier1PolicySpec = {
        policyId: 't1_search_query',
        capacityMt: 90_000,
        refillTokensMt: 90_000,
        refillPeriodMs: 60_000,
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
        spec,
      };
    }
  }

  // Category 3 & 4: Authentication & Registration
  if (method === 'POST' && pathname === '/api/v1/auth/login') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_auth_login_ip',
      capacityMt: 40_000,
      refillTokensMt: 40_000,
      refillPeriodMs: 900_000, // 15m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  if (method === 'POST' && pathname === '/api/v1/auth/register') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_auth_register_ip',
      capacityMt: 20_000,
      refillTokensMt: 20_000,
      refillPeriodMs: 3_600_000, // 1h
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  if (method === 'POST' && pathname === '/api/v1/auth/change-password') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_auth_change_pw',
      capacityMt: 20_000,
      refillTokensMt: 20_000,
      refillPeriodMs: 900_000, // 15m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  if (
    pathname === '/api/v1/auth/csrf' ||
    pathname === '/api/v1/auth/logout' ||
    pathname === '/api/v1/auth/me'
  ) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_auth_light',
      capacityMt: 60_000,
      refillTokensMt: 60_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  // Category 5: Commerce / Payment
  if (method === 'POST' && (pathname === '/api/v1/checkout' || pathname === '/api/v1/orders')) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_commerce_orders',
      capacityMt: 20_000,
      refillTokensMt: 20_000,
      refillPeriodMs: 600_000, // 10m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  if (method === 'POST' && pathname === '/api/v1/payments') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_commerce_payments',
      capacityMt: 10_000,
      refillTokensMt: 10_000,
      refillPeriodMs: 600_000, // 10m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  if (
    method === 'GET' &&
    (pathname.startsWith('/api/v1/orders') ||
      pathname.startsWith('/api/v1/me/orders') ||
      pathname.startsWith('/api/v1/me/entitlements') ||
      pathname.startsWith('/api/v1/payments'))
  ) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_commerce_reads',
      capacityMt: 60_000,
      refillTokensMt: 60_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  // Category 7: Downloads & Calendar Exports
  if (method === 'POST' && /^\/api\/v1\/resources\/[^/]+\/download$/.test(pathname)) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_resource_download',
      capacityMt: 40_000,
      refillTokensMt: 40_000,
      refillPeriodMs: 300_000, // 5m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  if (method === 'POST' && pathname === '/api/v1/calendar/export') {
    const spec: Tier1PolicySpec = {
      policyId: 't1_calendar_export',
      capacityMt: 10_000,
      refillTokensMt: 10_000,
      refillPeriodMs: 900_000, // 15m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  if (method === 'GET' && pathname.startsWith('/api/v1/calendar/export/')) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_calendar_export_get',
      capacityMt: 30_000,
      refillTokensMt: 30_000,
      refillPeriodMs: 300_000, // 5m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  // Category 8: Feedback & Learner / Contributor Writes
  if (method === 'POST' && /^\/api\/v1\/resources\/[^/]+\/feedback$/.test(pathname)) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_feedback_submit',
      capacityMt: 15_000,
      refillTokensMt: 15_000,
      refillPeriodMs: 900_000, // 15m
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'ip', ip, hmacSecret),
      spec,
    };
  }

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (
      /^\/api\/v1\/admin\/files\/[^/]+\/verify-integrity$/.test(pathname) ||
      pathname === '/api/v1/admin/retention/execute' ||
      /^\/api\/v1\/admin\/retention\/executions\/[^/]+\/recover$/.test(pathname) ||
      /^\/api\/v1\/retention\/policies\/[^/]+\/execute$/.test(pathname) ||
      /^\/api\/v1\/retention\/executions\/[^/]+\/recover$/.test(pathname)
    ) {
      const spec: Tier1PolicySpec = {
        policyId: 't1_admin_heavy_write',
        capacityMt: 10_000,
        refillTokensMt: 10_000,
        refillPeriodMs: 300_000, // 5m
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
        spec,
      };
    }

    if (
      pathname.startsWith('/api/v1/calendar/session') ||
      pathname.startsWith('/api/v1/me/calendar') ||
      pathname.startsWith('/api/v1/me/library') ||
      pathname.startsWith('/api/v1/me/bookmarks') ||
      pathname.startsWith('/api/v1/me/notifications') ||
      pathname.startsWith('/api/v1/library')
    ) {
      const spec: Tier1PolicySpec = {
        policyId: 't1_learner_write',
        capacityMt: 60_000,
        refillTokensMt: 60_000,
        refillPeriodMs: 300_000, // 5m
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
        spec,
      };
    }

    if (pathname.startsWith('/api/v1/contributors') && !pathname.startsWith('/api/v1/admin/')) {
      const spec: Tier1PolicySpec = {
        policyId: 't1_contributor_write',
        capacityMt: 15_000,
        refillTokensMt: 15_000,
        refillPeriodMs: 900_000, // 15m
      };
      return {
        key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
        spec,
      };
    }

    // Category 6: Standard Administrative / Editorial Mutations
    const spec: Tier1PolicySpec = {
      policyId: 't1_admin_write',
      capacityMt: 60_000,
      refillTokensMt: 60_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  // Admin GETs (Tier 1 120 / 1m, 0 PG writes)
  if (
    pathname.startsWith('/api/v1/admin/') ||
    pathname.startsWith('/api/v1/audit') ||
    pathname.startsWith('/api/v1/retention')
  ) {
    const spec: Tier1PolicySpec = {
      policyId: 't1_admin_read',
      capacityMt: 120_000,
      refillTokensMt: 120_000,
      refillPeriodMs: 60_000,
    };
    return {
      key: derivePrivacyBucketKey(spec.policyId, 'actor', actorKey, hmacSecret),
      spec,
    };
  }

  // Category 1: General Public Reads (300 / 1m per IP, 0 PG writes)
  const publicSpec: Tier1PolicySpec = {
    policyId: 't1_public_read',
    capacityMt: 300_000,
    refillTokensMt: 300_000,
    refillPeriodMs: 60_000,
  };
  return {
    key: derivePrivacyBucketKey(publicSpec.policyId, 'ip', ip, hmacSecret),
    spec: publicSpec,
  };
}

/**
 * Classifies a route (`method` + `routeUrl`) for Tier 2 two-phase PostgreSQL enforcement (`Tx1` + `Tx2`).
 * Returns `null` for all Tier-1-only routes (all GET/HEAD/OPTIONS, `/auth/logout`, `/analytics/events`, and M-Pesa webhooks).
 */
function classifyTier2Route(
  method: string,
  routeUrl: string,
  enableLegacyAlias: boolean,
): Tier2RouteClassification | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return null;
  }

  if (isMpesaWebhookPath(routeUrl, enableLegacyAlias)) {
    return null;
  }

  if (routeUrl === '/api/v1/analytics/events' || routeUrl === '/api/v1/auth/logout') {
    return null;
  }

  // Category 3: POST /api/v1/auth/login -> [20/15m IP, 5/15m email], FAIL_CLOSED
  if (method === 'POST' && routeUrl === '/api/v1/auth/login') {
    return {
      scopePrefix: 'auth_login',
      admissionTtlSecs: 960,
      failureMode: { kind: 'FAIL_CLOSED' },
      skipIfInvalidEmailBody: true,
      buildBuckets: ({ ip, normalizedEmail, hmacSecret }) => {
        const buckets: BucketSpec[] = [
          {
            bucketKey: derivePrivacyBucketKey('auth_login_ip', 'ip', ip, hmacSecret),
            policyId: 'auth_login_ip',
            capacityMt: 20_000n,
            refillTokensMt: 20_000n,
            refillPeriodMs: 900_000n,
            costMt: 1_000n,
          },
        ];
        if (normalizedEmail) {
          buckets.push({
            bucketKey: derivePrivacyBucketKey('auth_login_email', 'email', normalizedEmail, hmacSecret),
            policyId: 'auth_login_email',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 900_000n,
            costMt: 1_000n,
          });
        }
        return buckets;
      },
    };
  }

  // Category 3: POST /api/v1/auth/change-password -> [10/15m user, 20/15m IP], FAIL_CLOSED
  if (method === 'POST' && routeUrl === '/api/v1/auth/change-password') {
    return {
      scopePrefix: 'auth_change_pw',
      admissionTtlSecs: 960,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('auth_cpw_user', 'actor', actorKey, hmacSecret),
          policyId: 'auth_cpw_user',
          capacityMt: 10_000n,
          refillTokensMt: 10_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('auth_cpw_ip', 'ip', ip, hmacSecret),
          policyId: 'auth_cpw_ip',
          capacityMt: 20_000n,
          refillTokensMt: 20_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  // Category 4: POST /api/v1/auth/register -> [10/1h IP, 3/1h email], FAIL_CLOSED
  if (method === 'POST' && routeUrl === '/api/v1/auth/register') {
    return {
      scopePrefix: 'auth_register',
      admissionTtlSecs: 3660,
      failureMode: { kind: 'FAIL_CLOSED' },
      skipIfInvalidEmailBody: true,
      buildBuckets: ({ ip, normalizedEmail, hmacSecret }) => {
        const buckets: BucketSpec[] = [
          {
            bucketKey: derivePrivacyBucketKey('auth_reg_ip', 'ip', ip, hmacSecret),
            policyId: 'auth_reg_ip',
            capacityMt: 10_000n,
            refillTokensMt: 10_000n,
            refillPeriodMs: 3_600_000n,
            costMt: 1_000n,
          },
        ];
        if (normalizedEmail) {
          buckets.push({
            bucketKey: derivePrivacyBucketKey('auth_reg_email', 'email', normalizedEmail, hmacSecret),
            policyId: 'auth_reg_email',
            capacityMt: 3_000n,
            refillTokensMt: 3_000n,
            refillPeriodMs: 3_600_000n,
            costMt: 1_000n,
          });
        }
        return buckets;
      },
    };
  }

  // Category 5: Commerce / Payment Mutations
  if (method === 'POST' && (routeUrl === '/api/v1/checkout' || routeUrl === '/api/v1/orders')) {
    return {
      scopePrefix: 'commerce_checkout',
      admissionTtlSecs: 660,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('comm_order_user', 'actor', actorKey, hmacSecret),
          policyId: 'comm_order_user',
          capacityMt: 15_000n,
          refillTokensMt: 15_000n,
          refillPeriodMs: 600_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('comm_order_ip', 'ip', ip, hmacSecret),
          policyId: 'comm_order_ip',
          capacityMt: 30_000n,
          refillTokensMt: 30_000n,
          refillPeriodMs: 600_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  if (method === 'POST' && routeUrl === '/api/v1/payments') {
    return {
      scopePrefix: 'commerce_payments',
      admissionTtlSecs: 660,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('comm_pay_user', 'actor', actorKey, hmacSecret),
          policyId: 'comm_pay_user',
          capacityMt: 5_000n,
          refillTokensMt: 5_000n,
          refillPeriodMs: 600_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('comm_pay_ip', 'ip', ip, hmacSecret),
          policyId: 'comm_pay_ip',
          capacityMt: 15_000n,
          refillTokensMt: 15_000n,
          refillPeriodMs: 600_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  if (
    routeUrl.startsWith('/api/v1/admin/commerce/payments/') ||
    routeUrl === '/api/v1/payments/:id/simulate-success'
  ) {
    return {
      scopePrefix: 'commerce_admin_reconcile',
      admissionTtlSecs: 660,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('comm_reconcile_admin', 'actor', actorKey, hmacSecret),
          policyId: 'comm_reconcile_admin',
          capacityMt: 20_000n,
          refillTokensMt: 20_000n,
          refillPeriodMs: 600_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  // Category 7: Downloads & Calendar Exports
  if (method === 'POST' && routeUrl === '/api/v1/resources/:id/download') {
    return {
      scopePrefix: 'resource_download',
      admissionTtlSecs: 360,
      failureMode: {
        kind: 'DEGRADED_TIER1',
        degradedSpec: {
          policyId: 't1_degraded_download',
          capacityMt: 15_000,
          refillTokensMt: 15_000,
          refillPeriodMs: 300_000,
        },
      },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('res_download_actor', 'actor', actorKey, hmacSecret),
          policyId: 'res_download_actor',
          capacityMt: 30_000n,
          refillTokensMt: 30_000n,
          refillPeriodMs: 300_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('res_download_ip', 'ip', ip, hmacSecret),
          policyId: 'res_download_ip',
          capacityMt: 30_000n,
          refillTokensMt: 30_000n,
          refillPeriodMs: 300_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  if (method === 'POST' && routeUrl === '/api/v1/calendar/export') {
    return {
      scopePrefix: 'calendar_export',
      admissionTtlSecs: 960,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('cal_export_actor', 'actor', actorKey, hmacSecret),
          policyId: 'cal_export_actor',
          capacityMt: 5_000n,
          refillTokensMt: 5_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('cal_export_ip', 'ip', ip, hmacSecret),
          policyId: 'cal_export_ip',
          capacityMt: 10_000n,
          refillTokensMt: 10_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  // Category 8: Feedback, Learner State Toggles, and Contributor Mutations
  if (method === 'POST' && routeUrl === '/api/v1/resources/:id/feedback') {
    return {
      scopePrefix: 'resource_feedback',
      admissionTtlSecs: 960,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ ip, actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('res_feedback_actor', 'actor', actorKey, hmacSecret),
          policyId: 'res_feedback_actor',
          capacityMt: 5_000n,
          refillTokensMt: 5_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
        {
          bucketKey: derivePrivacyBucketKey('res_feedback_ip', 'ip', ip, hmacSecret),
          policyId: 'res_feedback_ip',
          capacityMt: 15_000n,
          refillTokensMt: 15_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  if (
    routeUrl.startsWith('/api/v1/calendar/session') ||
    routeUrl.startsWith('/api/v1/me/calendar') ||
    routeUrl.startsWith('/api/v1/me/library') ||
    routeUrl.startsWith('/api/v1/me/bookmarks') ||
    routeUrl.startsWith('/api/v1/me/notifications') ||
    routeUrl.startsWith('/api/v1/library')
  ) {
    return {
      scopePrefix: 'learner_state_write',
      admissionTtlSecs: 360,
      failureMode: {
        kind: 'DEGRADED_TIER1',
        degradedSpec: {
          policyId: 't1_degraded_learner_write',
          capacityMt: 30_000,
          refillTokensMt: 30_000,
          refillPeriodMs: 300_000,
        },
      },
      buildBuckets: ({ actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('learner_write_actor', 'actor', actorKey, hmacSecret),
          policyId: 'learner_write_actor',
          capacityMt: 60_000n,
          refillTokensMt: 60_000n,
          refillPeriodMs: 300_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  if (routeUrl.startsWith('/api/v1/contributors') && !routeUrl.startsWith('/api/v1/admin/')) {
    return {
      scopePrefix: 'contributor_write',
      admissionTtlSecs: 960,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('contrib_write_actor', 'actor', actorKey, hmacSecret),
          policyId: 'contrib_write_actor',
          capacityMt: 10_000n,
          refillTokensMt: 10_000n,
          refillPeriodMs: 900_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  // Category 6: Heavy Admin Mutations (verify-integrity, retention execute/recover)
  if (
    routeUrl === '/api/v1/admin/files/:id/verify-integrity' ||
    routeUrl === '/api/v1/admin/retention/execute' ||
    routeUrl === '/api/v1/admin/retention/executions/:id/recover' ||
    routeUrl === '/api/v1/retention/policies/:id/execute' ||
    routeUrl === '/api/v1/retention/executions/:id/recover'
  ) {
    return {
      scopePrefix: 'admin_heavy_write',
      admissionTtlSecs: 360,
      failureMode: { kind: 'FAIL_CLOSED' },
      buildBuckets: ({ actorKey, hmacSecret }) => [
        {
          bucketKey: derivePrivacyBucketKey('admin_heavy_actor', 'actor', actorKey, hmacSecret),
          policyId: 'admin_heavy_actor',
          capacityMt: 10_000n,
          refillTokensMt: 10_000n,
          refillPeriodMs: 300_000n,
          costMt: 1_000n,
        },
      ],
    };
  }

  // Category 6: Standard Administrative / Editorial Mutations
  return {
    scopePrefix: 'admin_write',
    admissionTtlSecs: 120,
    failureMode: { kind: 'FAIL_CLOSED' },
    buildBuckets: ({ actorKey, hmacSecret }) => [
      {
        bucketKey: derivePrivacyBucketKey('admin_write_actor', 'actor', actorKey, hmacSecret),
        policyId: 'admin_write_actor',
        capacityMt: 60_000n,
        refillTokensMt: 60_000n,
        refillPeriodMs: 60_000n,
        costMt: 1_000n,
      },
    ],
  };
}

function setRateLimitHeaders(
  reply: FastifyReply,
  limitTokens: number,
  remainingTokens: number,
  resetSeconds: number,
): void {
  reply.header('RateLimit-Limit', String(Math.max(1, limitTokens)));
  reply.header('RateLimit-Remaining', String(Math.max(0, remainingTokens)));
  reply.header('RateLimit-Reset', String(Math.max(1, resetSeconds)));
}

/**
 * Registers Wave 3 WP4 Two-Tier Hybrid Rate Limiting & Single-Winner Atomic Admission Claims (`Tx1` + `Tx2`).
 */
export function registerRateLimitGuard(
  app: FastifyInstance,
  options: RateLimitGuardOptions,
): void {
  const { rateLimitService } = options;
  const defaultBodyLimitBytes =
    options.defaultBodyLimitBytes ?? DEFAULT_GLOBAL_BODY_LIMIT_BYTES;
  const sessionCookieName = options.sessionCookieName ?? env.SESSION_COOKIE_NAME;
  const enableLegacyAlias =
    options.enableLegacyCallbackAlias ?? env.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS;

  // 1. Tier 1 In-Memory Bounded-LRU Pre-Filter (`onRequest` — 0 PostgreSQL queries)
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      return;
    }

    const pathname = getPathname(request.url);
    const ip = request.ip || '127.0.0.1';
    const actorKey = resolveTier1ActorIdentifier(request, sessionCookieName);
    const { activeSecret } = rateLimitService.getSecrets();

    const tier1 = classifyTier1Policy(
      request.method,
      pathname,
      ip,
      actorKey,
      activeSecret,
      enableLegacyAlias,
    );
    if (!tier1) {
      return;
    }

    const decision = rateLimitService.tier1.consume(tier1.key, tier1.spec);
    setRateLimitHeaders(
      reply,
      decision.limitTokens,
      decision.remainingTokens,
      decision.resetAfterSeconds,
    );

    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry after the indicated backoff window.',
          requestId: request.id,
        },
      });
    }
  });

  // 2. Single-Pass Stream Body Hashing (`preParsing`) for Payload Fingerprinting & Fail-Closed Media Guard
  app.addHook('preParsing', async (request, reply, payload) => {
    if (
      request.method === 'GET' ||
      request.method === 'HEAD' ||
      request.method === 'OPTIONS' ||
      isMpesaWebhookPath(request.url, enableLegacyAlias)
    ) {
      return payload;
    }

    if (!hasRequestBodyStream(request)) {
      (request as FastifyRequest & { rawBodySha256Hex?: string }).rawBodySha256Hex =
        EMPTY_BODY_SHA256_HEX;
      return payload;
    }

    if (!isJsonContentType(request.headers['content-type'])) {
      return reply.status(415).send({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type must be application/json.',
          requestId: request.id,
        },
      });
    }

    const effectiveBodyLimit =
      typeof request.routeOptions?.bodyLimit === 'number' && request.routeOptions.bodyLimit > 0
        ? request.routeOptions.bodyLimit
        : defaultBodyLimitBytes;

    const rawCl = request.headers['content-length'];
    if (typeof rawCl === 'string' && rawCl.trim().length > 0) {
      const declaredBytes = Number.parseInt(rawCl.trim(), 10);
      if (!Number.isNaN(declaredBytes) && declaredBytes > effectiveBodyLimit) {
        return reply.status(413).send({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request payload exceeds maximum size of ${effectiveBodyLimit} bytes.`,
            requestId: request.id,
          },
        });
      }
    }

    const hashingTransform = new BodyHashingTransform(effectiveBodyLimit);
    (
      request as FastifyRequest & { _bodyHashingTransform?: BodyHashingTransform }
    )._bodyHashingTransform = hashingTransform;

    payload.pause?.();
    payload.on('error', (err) => {
      hashingTransform.destroy(err);
    });

    hashingTransform.on('finish', () => {
      (request as FastifyRequest & { rawBodySha256Hex?: string }).rawBodySha256Hex =
        hashingTransform.getDigestHex();
    });

    // Defer piping until Fastify's content-type parser attaches stream 'error'/'data' listeners to hashingTransform
    setImmediate(() => {
      payload.pipe(hashingTransform);
    });

    return hashingTransform;
  });

  // 3. Attach Tier 2 Two-Phase (`Tx1` + `Tx2`) PreHandler to Matching Mutation Routes via `onRoute`
  //    Appending after route-level `preHandler` ensures `requireAuth` runs ONCE first (populating `request.user`
  //    without consuming `.mockResolvedValueOnce` test spies or polluting PG buckets on 401 requests).
  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];

    const matchedConfigs: Tier2RouteClassification[] = [];
    for (const m of methods) {
      const cfg = classifyTier2Route(String(m).toUpperCase(), routeOptions.url, enableLegacyAlias);
      if (cfg) {
        matchedConfigs.push(cfg);
      }
    }

    if (matchedConfigs.length === 0) {
      return;
    }

    const tier2Config = matchedConfigs[0];

    const tier2PreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      const rawIdempotencyHeader = request.headers['idempotency-key'];
      let clientIdempotencyKey: string | null = null;

      if (rawIdempotencyHeader !== undefined) {
        if (
          Array.isArray(rawIdempotencyHeader) ||
          typeof rawIdempotencyHeader !== 'string' ||
          !VALID_IDEMPOTENCY_KEY_REGEX.test(rawIdempotencyHeader.trim())
        ) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_IDEMPOTENCY_KEY',
              message:
                'Idempotency-Key header must be 1 to 128 printable ASCII characters.',
              requestId: request.id,
            },
          });
        }
        clientIdempotencyKey = rawIdempotencyHeader.trim();
      }

      let normalizedEmail: string | null = null;
      if (tier2Config.skipIfInvalidEmailBody) {
        const rawEmail = (request.body as { email?: unknown } | null | undefined)?.email;
        if (
          typeof rawEmail === 'string' &&
          rawEmail.trim().length > 0 &&
          rawEmail.trim().length <= 255 &&
          SIMPLE_EMAIL_CHECK_REGEX.test(rawEmail.trim())
        ) {
          normalizedEmail = rawEmail.trim().toLowerCase();
        } else if (!clientIdempotencyKey) {
          // Malformed/missing email without Idempotency-Key: let route's Zod schema return 400
          // without creating garbage email buckets (Tier 1 IP guard already ran in onRequest).
          return;
        }
      }

      const secrets = rateLimitService.getSecrets();
      const ip = request.ip || '127.0.0.1';
      const actorKey = resolveTier2ActorIdentifier(request, sessionCookieName);

      const reqWithHash = request as FastifyRequest & {
        rawBodySha256Hex?: string;
        _bodyHashingTransform?: BodyHashingTransform;
      };
      const bodySha256Hex =
        reqWithHash.rawBodySha256Hex ??
        reqWithHash._bodyHashingTransform?.getDigestHex() ??
        EMPTY_BODY_SHA256_HEX;

      const fingerprints = computePayloadFingerprints(
        {
          method: request.method,
          rawUrl: request.raw?.url ?? request.url,
          bodySha256Hex,
        },
        secrets,
      );

      // Note on Coordinated Rotation: Admission keys use a stable scope + actor + key derivation.
      // When no client Idempotency-Key header is provided, generate a unique per-request UUID so Tx1/Tx2
      // still executes the identical atomic single-winner protocol.
      const rawKeyMaterial = clientIdempotencyKey ?? crypto.randomUUID();
      const admissionKey = deriveScopedAdmissionKey(
        `${tier2Config.scopePrefix}:${routeOptions.url}`,
        actorKey,
        rawKeyMaterial,
      );

      const admissionTtlSecs = clientIdempotencyKey
        ? Math.max(tier2Config.admissionTtlSecs, 86_400)
        : tier2Config.admissionTtlSecs;

      const buckets = tier2Config.buildBuckets({
        ip,
        actorKey,
        normalizedEmail,
        hmacSecret: secrets.activeSecret,
      });

      const candidateClaimToken = crypto.randomUUID();

      try {
        const tx1 = await rateLimitService.tier2Store.consumeAndPrepareAdmission({
          buckets,
          admissionKey,
          claimToken: candidateClaimToken,
          admissionTtlSecs,
          payloadFingerprint: fingerprints.primary,
          secondaryPayloadFingerprint: fingerprints.secondary,
        });

        if (tx1.admissionStatus === 'CONFLICT_PAYLOAD') {
          return reply.status(409).send({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message:
                'Idempotency-Key has already been used with a different request target or payload.',
              requestId: request.id,
            },
          });
        }

        if (tx1.admissionStatus === 'ALREADY_CLAIMED') {
          return reply.status(409).send({
            error: {
              code: 'IDEMPOTENCY_ALREADY_CLAIMED',
              message:
                'Request with this Idempotency-Key has already been claimed for execution.',
              requestId: request.id,
            },
          });
        }

        if (!tx1.allowed || tx1.admissionStatus === 'RATE_LIMITED') {
          const retrySecs = Math.max(1, Math.ceil(Number(tx1.retryAfterMs) / 1000));
          const minCapTokens = Math.min(
            ...buckets.map((b) => Math.max(1, Number(b.capacityMt / 1000n))),
          );
          setRateLimitHeaders(reply, minCapTokens, 0, retrySecs);
          reply.header('Retry-After', String(retrySecs));
          return reply.status(429).send({
            error: {
              code: 'RATE_LIMITED',
              message: 'Rate limit exceeded. Please retry later.',
              requestId: request.id,
            },
          });
        }

        // Phase 2 (`Tx2`): Terminal single-winner claim (`UNCLAIMED -> CLAIMED`)
        const effectiveClaimToken = tx1.claimToken ?? candidateClaimToken;
        const tx2 = await rateLimitService.tier2Store.claimAdmission(
          admissionKey,
          effectiveClaimToken,
        );

        if (!tx2.claimed || tx2.claimStatus !== 'CLAIMED_WINNER') {
          return reply.status(409).send({
            error: {
              code: 'IDEMPOTENCY_ALREADY_CLAIMED',
              message:
                'Concurrent request won the execution claim for this Idempotency-Key.',
              requestId: request.id,
            },
          });
        }

        const minCapTokens = Math.min(
          ...buckets.map((b) => Math.max(1, Number(b.capacityMt / 1000n))),
        );
        const remTokens = Math.max(0, Math.floor(Number(tx1.minRemainingMt / 1000n)));
        setRateLimitHeaders(reply, minCapTokens, remTokens, tier2Config.admissionTtlSecs);
      } catch (err) {
        if (err instanceof RateLimitStoreUnavailableError) {
          // Ambiguous COMMIT acknowledgement ALWAYS fails closed across all categories!
          if (err.isAmbiguousCommit || tier2Config.failureMode.kind === 'FAIL_CLOSED') {
            reply.header('Retry-After', '2');
            return reply.status(503).send({
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Rate-limiting subsystem is temporarily unavailable. Please retry.',
                requestId: request.id,
              },
            });
          }

          // Degraded 50%-capacity Tier 1 fallback for eligible non-financial/non-auth learner mutations
          const degSpec = tier2Config.failureMode.degradedSpec;
          const degKey = derivePrivacyBucketKey(
            degSpec.policyId,
            'actor',
            actorKey,
            secrets.activeSecret,
          );
          const degDecision = rateLimitService.tier1.consume(degKey, degSpec);
          setRateLimitHeaders(
            reply,
            degDecision.limitTokens,
            degDecision.remainingTokens,
            degDecision.resetAfterSeconds,
          );
          if (!degDecision.allowed) {
            reply.header('Retry-After', String(degDecision.retryAfterSeconds));
            return reply.status(429).send({
              error: {
                code: 'RATE_LIMITED',
                message: 'Rate limit exceeded during degraded operation. Please retry later.',
                requestId: request.id,
              },
            });
          }
          return;
        }
        throw err;
      }
    };

    if (!routeOptions.preHandler) {
      routeOptions.preHandler = [tier2PreHandler];
    } else if (Array.isArray(routeOptions.preHandler)) {
      routeOptions.preHandler.push(tier2PreHandler);
    } else {
      routeOptions.preHandler = [routeOptions.preHandler, tier2PreHandler];
    }
  });
}
