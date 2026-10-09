import crypto from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyServerOptions, type FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
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
import { defaultCommerceService } from './services/commerce/commerce.service.js';

// Fastify Request ID validation rule:
// 1 to 64 characters, allowed characters: alphanumeric, hyphen, underscore
const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export interface AppOptions extends FastifyServerOptions {
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
  };
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const { services, ...serverOpts } = opts;

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
    ...serverOpts,
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
  });
  app.register(catalogueRoutes, {
    prefix: '/api/v1',
    catalogueService: services?.catalogueService,
  });
  app.register(searchRoutes, {
    prefix: '/api/v1',
    searchService: services?.searchService,
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
  });
  app.register(contributorRoutes, {
    prefix: '/api/v1',
    contributorService: services?.contributorService,
    authService: services?.authService,
    rbacService: services?.rbacService,
  });

  // Support unversioned /api/payments/mpesa/callback & /api/mpesa/callback
  app.register(
    async (sub) => {
      const handleCallback = async (request: any, reply: any) => {
        const cs = services?.commerceService ?? defaultCommerceService;
        const response = await cs.handleMpesaCallback(request.body);
        return reply.status(200).send(response.ack);
      };
      sub.post('/payments/mpesa/callback', handleCallback);
      sub.post('/mpesa/callback', handleCallback);
    },
    { prefix: '/api' },
  );

  return app;
}
