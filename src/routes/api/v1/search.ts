import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  SearchService,
  DefaultSearchService,
} from '../../../services/search.service.js';

export const defaultSearchService: SearchService = new DefaultSearchService();

export interface SearchRouteOptions {
  searchService?: SearchService;
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

export const searchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (
  fastify,
  opts,
) => {
  const searchService = opts.searchService || defaultSearchService;

  const handleSearch = async (request: any, reply: any) => {
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
};
