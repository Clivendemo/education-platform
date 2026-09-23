import crypto from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyServerOptions, type FastifyError } from 'fastify';
import { healthRoutes } from './routes/api/v1/health.js';
import { countriesRoutes } from './routes/api/v1/countries.js';
import { geographyRoutes } from './routes/api/v1/geography.js';
import { schoolsRoutes } from './routes/api/v1/schools.js';
import { curriculumRoutes } from './routes/api/v1/curriculum.js';
import type { GeographyService } from './services/geography.service.js';
import type { SchoolService } from './services/school.service.js';
import type { CurriculumService } from './services/curriculum.service.js';

// Fastify Request ID validation rule:
// 1 to 64 characters, allowed characters: alphanumeric, hyphen, underscore
const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export interface AppOptions extends FastifyServerOptions {
  services?: {
    geographyService?: GeographyService;
    schoolService?: SchoolService;
    curriculumService?: CurriculumService;
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

  return app;
}

