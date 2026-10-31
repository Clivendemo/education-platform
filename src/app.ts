import crypto from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyServerOptions, type FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { env } from './config/env.js';
import { healthRoutes } from './routes/api/v1/health.js';
import { countriesRoutes } from './routes/api/v1/countries.js';
import { geographyRoutes } from './routes/api/v1/geography.js';
import { schoolsRoutes } from './routes/api/v1/schools.js';
import { curriculumRoutes } from './routes/api/v1/curriculum.js';
import { resourceRoutes } from './routes/api/v1/resources.js';
import { publicationRoutes } from './routes/api/v1/publications.js';
import { catalogueRoutes } from './routes/api/v1/catalogue.js';
import { searchRoutes } from './routes/api/v1/search.js';
import { seoRoutes } from './routes/api/v1/seo.js';
import { authRoutes } from './routes/api/v1/auth.js';
import { libraryRoutes } from './routes/api/v1/library.js';
import { downloadRoutes } from './routes/api/v1/downloads.js';
import { calendarRoutes } from './routes/api/v1/calendar.js';
import { commerceRoutes } from './routes/api/v1/commerce.js';
import { contributorRoutes } from './routes/api/v1/contributors.js';
import { updatesRoutes } from './routes/api/v1/updates.js';
import { qualityGovernanceRoutes } from './routes/api/v1/quality-governance.js';
import { feedbackRoutes } from './routes/api/v1/feedback.js';
import { notificationRoutes } from './routes/api/v1/notifications.js';
import { analyticsRoutes } from './routes/api/v1/analytics.js';
import { auditRoutes } from './routes/api/v1/audit.js';
import { retentionRoutes } from './routes/api/v1/retention.js';
import { recommendationRoutes } from './routes/api/v1/recommendations.js';
import { adminDashboardRoutes } from './routes/api/v1/admin-dashboard.js';
import { homepageRoutes } from './routes/api/v1/homepage.js';
import {
  adminHomepageRoutes,
  type HomepageAdminInstrumentation,
} from './routes/api/v1/admin-homepage.js';
import {
  MPESA_WEBHOOK_BODY_LIMIT_BYTES,
  MpesaWebhookRateLimiter,
  defaultMpesaWebhookRateLimiter,
  createMpesaWebhookPreHandler,
  registerRawDecimalWebhookJsonParser,
} from './routes/middleware/mpesa-webhook-guard.js';
import type { GeographyService } from './services/geography.service.js';
import type { SchoolService } from './services/school.service.js';
import type { CurriculumService } from './services/curriculum.service.js';
import type { ResourceService } from './services/resource.service.js';
import type { PublicationService } from './services/publication.service.js';
import type { CatalogueService } from './services/catalogue.service.js';
import type { SearchService } from './services/search.service.js';
import type { SeoService } from './services/seo.service.js';
import type { AuthService } from './services/auth.service.js';
import type { RbacService } from './services/rbac.service.js';
import type { LibraryService } from './services/library.service.js';
import type { DownloadService } from './services/download.service.js';
import type { CalendarService } from './services/calendar/calendar.service.js';
import type { CommerceService } from './services/commerce/commerce.service.js';
import type { ContributorService } from './services/contributor.service.js';
import type { ContributorFinanceService } from './services/contributor-finance.service.js';
import type { EducationUpdateService } from './services/education-update.service.js';
import type { QualityGovernanceService } from './services/quality-governance.service.js';
import type { FeedbackService } from './services/feedback.service.js';
import type { NotificationService } from './services/notification.service.js';
import type { AnalyticsService } from './services/analytics.service.js';
import type { AuditService } from './services/audit.service.js';
import type { RetentionService } from './services/retention.service.js';
import type { RecommendationService } from './services/recommendations/recommendation.service.js';
import type { FileStorageService } from './services/file-storage.service.js';
import type { AdminDashboardService } from './services/admin-dashboard.service.js';
import type { HomepageService } from './services/homepage.service.js';
import type { HomepageAdminService } from './services/homepage-admin.service.js';
import { defaultCommerceService } from './services/commerce/commerce.service.js';

// Fastify Request ID validation rule:
// 1 to 64 characters, allowed characters: alphanumeric, hyphen, underscore
const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validates and resolves the effective Fastify `trustProxy` setting (W1-AC-08).
 * - Rejects `trustProxy: true` and all non-hop forms (strings, arrays, functions, negative/float/>5) in ALL environments.
 * - Requires explicit `configuredHops` (0..5) in `production` and forbids programmatic overrides that deviate from it.
 */
export function resolveEffectiveTrustProxy(
  optsTrustProxy: unknown,
  configuredHops: number | undefined,
  nodeEnv: string = env.NODE_ENV,
): number | false {
  if (nodeEnv === 'production' && configuredHops === undefined) {
    throw new Error(
      'SECURITY_CONFIG_ERROR: TRUST_PROXY_HOPS (0..5) must be explicitly configured in production.',
    );
  }

  const envHops = configuredHops ?? 0;
  if (!Number.isInteger(envHops) || envHops < 0 || envHops > 5) {
    throw new Error(
      `Invalid TRUST_PROXY_HOPS value (${String(configuredHops)}): must be an integer between 0 and 5.`,
    );
  }

  let effectiveHops = envHops;

  if (optsTrustProxy !== undefined) {
    let normalizedOverrideHops: number;
    if (optsTrustProxy === false) {
      normalizedOverrideHops = 0;
    } else if (
      typeof optsTrustProxy === 'number' &&
      Number.isInteger(optsTrustProxy) &&
      optsTrustProxy >= 0 &&
      optsTrustProxy <= 5
    ) {
      normalizedOverrideHops = optsTrustProxy;
    } else {
      throw new Error(
        'Invalid trustProxy configuration: boolean true or unbounded proxy trust is forbidden; use an integer hop count between 0 and 5.',
      );
    }

    if (nodeEnv === 'production' && normalizedOverrideHops !== envHops) {
      throw new Error(
        `In production, buildApp trustProxy override (${normalizedOverrideHops}) cannot deviate from validated TRUST_PROXY_HOPS (${envHops}).`,
      );
    }

    effectiveHops = normalizedOverrideHops;
  }

  return effectiveHops === 0 ? false : effectiveHops;
}

export interface AppOptions extends Omit<FastifyServerOptions, 'trustProxy'> {
  trustProxy?:
    | number
    | boolean
    | string
    | string[]
    | ((address: string, hop: number) => boolean);
  nodeEnvOverride?: 'development' | 'test' | 'production';
  configuredTrustProxyHopsOverride?: number;
  services?: {
    geographyService?: GeographyService;
    schoolService?: SchoolService;
    curriculumService?: CurriculumService;
    resourceService?: ResourceService;
    publicationService?: PublicationService;
    catalogueService?: CatalogueService;
    searchService?: SearchService;
    seoService?: SeoService;
    authService?: AuthService;
    rbacService?: RbacService;
    libraryService?: LibraryService;
    downloadService?: DownloadService;
    calendarService?: CalendarService;
    commerceService?: CommerceService;
    contributorService?: ContributorService;
    contributorFinanceService?: ContributorFinanceService;
    educationUpdateService?: EducationUpdateService;
    qualityService?: QualityGovernanceService;
    feedbackService?: FeedbackService;
    notificationService?: NotificationService;
    analyticsService?: AnalyticsService;
    auditService?: AuditService;
    retentionService?: RetentionService;
    recommendationService?: RecommendationService;
    fileStorageService?: FileStorageService;
    adminDashboardService?: AdminDashboardService;
    homepageService?: HomepageService;
    homepageAdminService?: HomepageAdminService;
    homepageAdminInstrumentation?: HomepageAdminInstrumentation;
    webhookRateLimiter?: MpesaWebhookRateLimiter;
    enableLegacyCallbackAlias?: boolean;
  };
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const {
    services,
    trustProxy: optsTrustProxy,
    nodeEnvOverride,
    configuredTrustProxyHopsOverride,
    ...restServerOpts
  } = opts;

  const effectiveNodeEnv = nodeEnvOverride ?? env.NODE_ENV;
  const effectiveConfiguredHops =
    configuredTrustProxyHopsOverride !== undefined
      ? configuredTrustProxyHopsOverride
      : env.TRUST_PROXY_HOPS;

  const effectiveTrustProxy = resolveEffectiveTrustProxy(
    optsTrustProxy,
    effectiveConfiguredHops,
    effectiveNodeEnv,
  );

  // Fastify 5.8+ fails closed on raw numeric trustProxy; compile validated hop count into an exact N-hop TrustProxyFunction
  const fastifyTrustProxy: false | ((address: string, hop: number) => boolean) =
    effectiveTrustProxy === false
      ? false
      : (_address: string, hop: number) => hop < effectiveTrustProxy;

  const app = fastify({
    requestIdHeader: false, // Prevents Fastify from blindly adopting unvalidated headers
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && VALID_REQUEST_ID_REGEX.test(header)) {
        return header;
      }
      return crypto.randomUUID();
    },
    childLoggerFactory: function (logger, bindings, options) {
      return logger.child({ ...bindings, requestId: bindings.reqId }, options);
    },
    ...restServerOpts,
    // Placed strictly AFTER ...restServerOpts so unvalidated options can never overwrite trustProxy
    trustProxy: fastifyTrustProxy,
  });

  // Ensure accepted/generated request ID is always included in response headers
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Standardized Centralized Error Handler (docs/API_SPEC.md Section 6)
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    request.log.error(error);

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    const code =
      statusCode === 500
        ? 'INTERNAL_SERVER_ERROR'
        : typeof error.code === 'string'
          ? error.code
          : 'BAD_REQUEST';

    // Strictly protect against leaking stack traces, SQL, filesystem paths, or internal implementation details
    const message =
      statusCode === 500
        ? 'An internal server error occurred.'
        : error.message || 'Request failed.';

    return reply.status(statusCode).send({
      error: {
        code,
        message,
        requestId: request.id,
      },
    });
  });

  // Standardized 404 Handler
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method}:${request.url} not found`,
        requestId: request.id,
      },
    });
  });

  // Register cookie parser/serializer without signing secret
  app.register(fastifyCookie);

  // Mount API v1 routes
  app.register(healthRoutes, { prefix: '/api/v1' });
  app.register(countriesRoutes, {
    prefix: '/api/v1',
    geographyService: services?.geographyService,
  });
  app.register(geographyRoutes, {
    prefix: '/api/v1',
    geographyService: services?.geographyService,
  });
  app.register(schoolsRoutes, {
    prefix: '/api/v1',
    schoolService: services?.schoolService,
  });
  app.register(curriculumRoutes, {
    prefix: '/api/v1',
    curriculumService: services?.curriculumService,
  });
  app.register(resourceRoutes, {
    prefix: '/api/v1',
    resourceService: services?.resourceService,
  });
  app.register(publicationRoutes, {
    prefix: '/api/v1',
    publicationService: services?.publicationService,
    authService: services?.authService,
    rbacService: services?.rbacService,
    auditService: services?.auditService,
  });
  app.register(catalogueRoutes, {
    prefix: '/api/v1',
    catalogueService: services?.catalogueService,
  });
  app.register(searchRoutes, {
    prefix: '/api/v1',
    searchService: services?.searchService,
    analyticsService: services?.analyticsService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(seoRoutes, {
    prefix: '/api/v1',
    seoService: services?.seoService,
  });
  app.register(authRoutes, {
    prefix: '/api/v1',
    authService: services?.authService,
  });
  app.register(libraryRoutes, {
    prefix: '/api/v1',
    libraryService: services?.libraryService,
    authService: services?.authService,
  });
  app.register(downloadRoutes, {
    prefix: '/api/v1',
    downloadService: services?.downloadService,
    authService: services?.authService,
    analyticsService: services?.analyticsService,
  });
  app.register(calendarRoutes, {
    prefix: '/api/v1',
    calendarService: services?.calendarService,
    authService: services?.authService,
  });
  app.register(commerceRoutes, {
    prefix: '/api/v1',
    commerceService: services?.commerceService,
    authService: services?.authService,
    rbacService: services?.rbacService,
    auditService: services?.auditService,
    webhookRateLimiter: services?.webhookRateLimiter,
    enableLegacyCallbackAlias: services?.enableLegacyCallbackAlias,
  });
  app.register(contributorRoutes, {
    prefix: '/api/v1',
    contributorService: services?.contributorService,
    contributorFinanceService: services?.contributorFinanceService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(updatesRoutes, {
    prefix: '/api/v1',
    educationUpdateService: services?.educationUpdateService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(qualityGovernanceRoutes, {
    prefix: '/api/v1',
    qualityService: services?.qualityService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(feedbackRoutes, {
    prefix: '/api/v1',
    feedbackService: services?.feedbackService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(notificationRoutes, {
    prefix: '/api/v1',
    notificationService: services?.notificationService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(analyticsRoutes, {
    prefix: '/api/v1',
    analyticsService: services?.analyticsService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(auditRoutes, {
    prefix: '/api/v1',
    auditService: services?.auditService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(recommendationRoutes, {
    prefix: '/api/v1',
    recommendationService: services?.recommendationService,
    authService: services?.authService,
    rbacService: services?.rbacService,
    auditService: services?.auditService,
  });
  app.register(retentionRoutes, {
    prefix: '/api/v1',
    retentionService: services?.retentionService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });
  app.register(adminDashboardRoutes, {
    prefix: '/api/v1',
    adminDashboardService: services?.adminDashboardService,
    authService: services?.authService,
    rbacService: services?.rbacService,
    auditService: services?.auditService,
  });
  app.register(homepageRoutes, {
    prefix: '/api/v1',
    homepageService: services?.homepageService,
  });
  app.register(adminHomepageRoutes, {
    prefix: '/api/v1',
    homepageAdminService: services?.homepageAdminService,
    authService: services?.authService,
    rbacService: services?.rbacService,
    auditService: services?.auditService,
    instrumentation: services?.homepageAdminInstrumentation,
  });

  // Legacy unversioned callback aliases are disabled by default (W1-AC-08).
  // When explicitly enabled via MPESA_ENABLE_LEGACY_CALLBACK_ALIAS=true, enforce identical 32 KiB body limit,
  // raw decimal lexeme extraction, and bounded-LRU per-IP rate limiting.
  const enableLegacyAlias =
    services?.enableLegacyCallbackAlias ?? env.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS;
  if (enableLegacyAlias) {
    const rateLimiter = services?.webhookRateLimiter ?? defaultMpesaWebhookRateLimiter;
    const webhookPreHandler = createMpesaWebhookPreHandler(rateLimiter);

    app.register(
      async (sub) => {
        registerRawDecimalWebhookJsonParser(sub);

        const handleCallback = async (request: any, reply: any) => {
          const cs = services?.commerceService ?? defaultCommerceService;
          const response = await cs.handleMpesaCallback(request.body, request.rawWebhookBody);
          return reply.status(200).send(response.ack);
        };

        sub.post(
          '/payments/mpesa/callback',
          {
            bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES,
            preHandler: [webhookPreHandler],
          },
          handleCallback,
        );
        sub.post(
          '/mpesa/callback',
          {
            bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES,
            preHandler: [webhookPreHandler],
          },
          handleCallback,
        );
      },
      { prefix: '/api' },
    );
  }

  return app;
}
