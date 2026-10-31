import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  COUNTRY_IDENTIFIER_REGEX,
  defaultHomepageService,
  HomepageError,
  type HomepageService,
} from '../../../services/homepage.service.js';

export interface HomepageRouteOptions {
  homepageService?: HomepageService;
}

const PublicHomepageQuerySchema = z
  .object({
    country: z
      .string()
      .regex(
        COUNTRY_IDENTIFIER_REGEX,
        'Country identifier must be 1 to 64 alphanumeric or hyphen characters without whitespace.',
      )
      .optional(),
  })
  .strict();

const CountryCodeParamSchema = z
  .object({
    countryCode: z
      .string()
      .regex(
        COUNTRY_IDENTIFIER_REGEX,
        'Country code must be 1 to 64 alphanumeric or hyphen characters without whitespace.',
      ),
  })
  .strict();

const EmptyStrictQuerySchema = z.object({}).strict();

function isBenchmarkBypassAllowed(request: FastifyRequest): boolean {
  if (request.headers['x-benchmark-cache-bypass'] !== 'true') {
    return false;
  }
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.ENABLE_BENCHMARK_BYPASS === 'true'
  );
}

export const homepageRoutes: FastifyPluginAsync<HomepageRouteOptions> = async (
  fastify,
  opts,
) => {
  const homepageService = opts.homepageService ?? defaultHomepageService;

  // Enforce Cache-Control: no-store across all 2xx, 4xx, and 5xx public homepage responses (R17-05)
  fastify.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  fastify.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      if (error instanceof HomepageError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
          },
        });
      }

      request.log.error(error);
      const anyErr = error as { statusCode?: number; code?: string; message?: string };
      const statusCode =
        typeof anyErr?.statusCode === 'number' &&
        anyErr.statusCode >= 400 &&
        anyErr.statusCode < 600
          ? anyErr.statusCode
          : 500;

      return reply.status(statusCode).send({
        error: {
          code:
            statusCode === 500
              ? 'INTERNAL_SERVER_ERROR'
              : typeof anyErr?.code === 'string'
                ? anyErr.code
                : 'BAD_REQUEST',
          message:
            statusCode === 500
              ? 'An internal server error occurred.'
              : anyErr?.message || 'Request failed.',
          requestId: request.id,
        },
      });
    },
  );

  /**
   * P1: GET /api/v1/homepage
   * Country-aware public homepage intelligence endpoint (defaults to 'KE' when country query is omitted).
   */
  fastify.get('/homepage', async (request, reply) => {
    const parsedQuery = PublicHomepageQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            parsedQuery.error.issues[0]?.message ??
            'Invalid homepage query parameters.',
          requestId: request.id,
        },
      });
    }

    const result = await homepageService.getPublicHomepage({
      countryIdentifier: parsedQuery.data.country,
      bypassCache: isBenchmarkBypassAllowed(request),
    });

    return reply.status(200).send({
      data: result.data,
    });
  });

  /**
   * P2: GET /api/v1/countries/:countryCode/homepage
   * Explicit country-prefixed public homepage intelligence endpoint.
   * Note: /homepage/slots/:slotKey is intentionally NOT registered (C63).
   */
  fastify.get<{ Params: { countryCode: string } }>(
    '/countries/:countryCode/homepage',
    async (request, reply) => {
      const parsedParams = CountryCodeParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              parsedParams.error.issues[0]?.message ??
              'Invalid countryCode path parameter.',
            requestId: request.id,
          },
        });
      }

      const parsedQuery = EmptyStrictQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              parsedQuery.error.issues[0]?.message ??
              'Unexpected query parameters.',
            requestId: request.id,
          },
        });
      }

      const result = await homepageService.getPublicHomepage({
        countryIdentifier: parsedParams.data.countryCode,
        bypassCache: isBenchmarkBypassAllowed(request),
      });

      return reply.status(200).send({
        data: result.data,
      });
    },
  );
};
