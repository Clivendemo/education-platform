import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  SearchService,
  DefaultSearchService,
} from '../../../services/search.service.js';
import {
  defaultAnalyticsService,
  type AnalyticsService,
} from '../../../services/analytics.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import { sanitizeSearchQuery } from '../../../utils/search-sanitizer.js';

export const defaultSearchService: SearchService = new DefaultSearchService();

export interface SearchRouteOptions {
  searchService?: SearchService;
  analyticsService?: AnalyticsService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const SearchQuerySchema = z.object({
  q: z
    .string({ required_error: "Search query 'q' is required" })
    .min(1, "Search query 'q' must not be empty")
    .refine((val) => val.trim().length > 0, "Search query 'q' must not be empty"),
  country: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  curriculum: z.string().min(1).optional(),
  curriculumVersion: z.string().min(1).optional(),
  educationLevel: z.string().min(1).optional(),
  grade: z.string().min(1).optional(),
  pathway: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
  school: z.string().min(1).optional(),
  academicYear: z.coerce.number().int().min(1970).max(2100).optional(),
  term: z.coerce.number().int().min(1).max(3).optional(),
  quality: z.enum(['STANDARD', 'VERIFIED', 'PREMIUM']).optional(),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});

const AutocompleteQuerySchema = z.object({
  q: z.string().optional().default(''),
  country: z.string().optional(),
  curriculum: z.string().optional(),
  curriculumVersion: z.string().optional(),
  educationLevel: z.string().optional(),
  grade: z.string().optional(),
  pathway: z.string().optional(),
  subject: z.string().optional(),
  topic: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5).default(5),
});

const RelatedQuerySchema = z.object({
  q: z
    .string({ required_error: "Search query 'q' is required" })
    .min(1, "Search query 'q' must not be empty")
    .refine((val) => val.trim().length > 0, "Search query 'q' must not be empty"),
  country: z.string().optional(),
  curriculum: z.string().optional(),
  grade: z.string().optional(),
  subject: z.string().optional(),
});

const SearchDemandQuerySchema = z.object({
  window: z.enum(['7d', '30d', '90d']).default('30d'),
  type: z.enum(['all', 'popular', 'zero_results']).default('all'),
  country: z.string().optional(),
  minCount: z.coerce.number().int().min(3, 'minCount must be at least 3').optional().default(3),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});

export const searchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (
  fastify,
  opts,
) => {
  const searchService = opts.searchService || defaultSearchService;
  const analyticsService = opts.analyticsService || defaultAnalyticsService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  const getAuthenticatedUser = async (request: FastifyRequest) => {
    const directUser = (request as any).user;
    if (directUser?.id) return directUser;

    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const cookieHeader = request.headers.cookie;
    const cookieToken =
      request.cookies?.[SESSION_COOKIE_NAME] ||
      request.cookies?.['session_token'] ||
      (cookieHeader
        ? cookieHeader.match(/(?:^|;\s*)(?:session_token|elimu_session)=([^;]+)/)?.[1]
        : null);

    const rawToken = bearerToken || cookieToken;
    if (!rawToken) return null;

    try {
      const sessionResult = await authService.validateSession(rawToken.trim());
      return sessionResult ? sessionResult.user : null;
    } catch {
      return null;
    }
  };

  const handleSearch = async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = SearchQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            queryResult.error.errors[0]?.message || 'Invalid search parameters',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await searchService.searchResources(queryResult.data);

      // Safe asynchronous analytics event emission (post-success, non-blocking)
      const sanitized = sanitizeSearchQuery(queryResult.data.q);
      const queryHash = crypto
        .createHash('sha256')
        .update(queryResult.data.q.trim().toLowerCase())
        .digest('hex');
      const count = result.data?.length ?? result.meta?.total ?? 0;
      const filters = Object.keys(queryResult.data).filter(
        (k) =>
          k !== 'q' &&
          k !== 'page' &&
          k !== 'pageSize' &&
          (queryResult.data as any)[k] !== undefined,
      );

      const clientIp = request.raw?.socket?.remoteAddress || '127.0.0.1';
      const rawAnonSession =
        (request.headers['x-anonymous-session-id'] as string) ||
        request.cookies?.['elimu_anon_sid'] ||
        `${clientIp}:${request.headers['user-agent'] || 'unknown'}`;
      const anonHash = crypto.createHash('sha256').update(rawAnonSession).digest('hex');

      analyticsService.captureSafe({
        eventCode: 'search',
        actorType: (request as any).user?.id ? 'AUTHENTICATED' : 'ANONYMOUS',
        userId: (request as any).user?.id || null,
        anonymousSessionHash: anonHash,
        country: queryResult.data.country || null,
        context: {
          search_query_hash: queryHash,
          results_count: count,
          filters_applied: filters.slice(0, 10),
          zero_results: count === 0,
          normalized_query: sanitized.normalizedQuery || undefined,
        },
      });

      return reply.status(200).send(result);
    } catch (err: any) {
      request.log.error(err, 'Search execution error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while executing the search query.',
          requestId: request.id,
        },
      });
    }
  };

  // Primary Canonical Route: GET /api/v1/search/resources
  fastify.get('/search/resources', handleSearch);

  // Compatibility Route: GET /api/v1/search
  fastify.get('/search', handleSearch);

  /**
   * Public Autocomplete Endpoint: GET /api/v1/search/autocomplete
   */
  fastify.get('/search/autocomplete', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseRes = AutocompleteQuerySchema.safeParse(request.query);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseRes.error.errors[0]?.message || 'Invalid autocomplete parameters',
          requestId: request.id,
        },
      });
    }

    const trimmedQ = (parseRes.data.q || '').trim();
    if (trimmedQ.length < 2) {
      return reply.status(200).send({
        data: [],
        meta: {
          count: 0,
          query: trimmedQ,
          fallbackUsed: false,
        },
      });
    }

    try {
      if (!searchService.getAutocompleteSuggestions) {
        throw new Error('getAutocompleteSuggestions is not supported by the configured SearchService');
      }
      const result = await searchService.getAutocompleteSuggestions(parseRes.data);
      return reply.status(200).send({
        data: result.suggestions,
        meta: {
          count: result.suggestions.length,
          query: trimmedQ,
          fallbackUsed: result.fallbackUsed,
        },
      });
    } catch (err: any) {
      request.log.error(err, 'Autocomplete execution error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while fetching autocomplete suggestions.',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * Public Related Discovery Endpoint: GET /api/v1/search/related
   */
  fastify.get('/search/related', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseRes = RelatedQuerySchema.safeParse(request.query);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseRes.error.errors[0]?.message || 'Invalid related search parameters',
          requestId: request.id,
        },
      });
    }

    try {
      if (!searchService.getRelatedDiscovery) {
        throw new Error('getRelatedDiscovery is not supported by the configured SearchService');
      }
      const result = await searchService.getRelatedDiscovery(parseRes.data);
      return reply.status(200).send({
        data: result,
        meta: {
          hasSuggestions:
            result.relatedSubjects.length > 0 ||
            result.relatedTopics.length > 0 ||
            result.suggestedResources.length > 0,
        },
      });
    } catch (err: any) {
      request.log.error(err, 'Related discovery execution error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while fetching related discoveries.',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * Protected Search Demand Analytics: GET /api/v1/admin/search/demand
   * Requires valid authenticated user session and canonical permission 'analytics.read'.
   */
  fastify.get('/admin/search/demand', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to access search demand analytics',
          requestId: request.id,
        },
      });
    }

    const hasPerm = await rbacService.hasPermission(user.id, 'analytics.read');
    if (!hasPerm) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to view search demand analytics',
          requestId: request.id,
        },
      });
    }

    const parseRes = SearchDemandQuerySchema.safeParse(request.query);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseRes.error.errors[0]?.message || 'Invalid search demand parameters',
          requestId: request.id,
        },
      });
    }

    try {
      if (!searchService.getSearchDemand) {
        throw new Error('getSearchDemand is not supported by the configured SearchService');
      }
      const result = await searchService.getSearchDemand(parseRes.data);
      return reply.status(200).send({
        data: result.data,
        meta: result.meta,
      });
    } catch (err: any) {
      request.log.error(err, 'Search demand report error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while generating search demand report.',
          requestId: request.id,
        },
      });
    }
  });
};
