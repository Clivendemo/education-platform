import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CatalogueService,
  defaultCatalogueService,
} from '../../../services/catalogue.service.js';

export interface CatalogueRouteOptions {
  catalogueService?: CatalogueService;
}

const ListCatalogueQuerySchema = z.object({
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
  sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

export const catalogueRoutes: FastifyPluginAsync<CatalogueRouteOptions> = async (
  fastify,
  opts,
) => {
  const catalogueService = opts.catalogueService || defaultCatalogueService;

  // GET /api/v1/catalogue/resources
  fastify.get('/catalogue/resources', async (request, reply) => {
    const queryResult = ListCatalogueQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.errors[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const result = await catalogueService.listCatalogueResources(queryResult.data);
    return reply.status(200).send(result);
  });

  // GET /api/v1/catalogue/resources/:id
  fastify.get('/catalogue/resources/:id', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'The requested catalogue resource id must be a valid UUID.',
          requestId: request.id,
        },
      });
    }

    const resource = await catalogueService.getCatalogueResourceById(paramResult.data.id);
    if (!resource) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource with id '${paramResult.data.id}' was not found.`,
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: resource,
    });
  });
};
