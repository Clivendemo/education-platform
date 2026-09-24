import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ResourceService,
  defaultResourceService,
} from '../../../services/resource.service.js';

export interface ResourceRouteOptions {
  resourceService?: ResourceService;
}

const ListResourceTypesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

const ListResourcesQuerySchema = z.object({
  country: z.string().optional(),
  type: z.string().optional(),
  status: z
    .enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED'])
    .optional(),
  qualityLabel: z.enum(['STANDARD', 'VERIFIED', 'PREMIUM']).optional(),
  gradeId: z.string().uuid('Invalid grade UUID format').optional(),
  subjectId: z.string().uuid('Invalid subject UUID format').optional(),
  schoolId: z.string().uuid('Invalid school UUID format').optional(),
  academicYear: z.coerce.number().int().min(1970).max(2100).optional(),
  term: z.coerce.number().int().min(1).max(3).optional(),
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

const VersionsQuerySchema = z.object({
  includeUnpublished: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export const resourceRoutes: FastifyPluginAsync<ResourceRouteOptions> = async (
  fastify,
  opts,
) => {
  const resourceService = opts.resourceService || defaultResourceService;

  // GET /api/v1/resource-types
  fastify.get('/resource-types', async (request, reply) => {
    const queryResult = ListResourceTypesQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.errors[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const types = await resourceService.listResourceTypes({
      includeInactive: queryResult.data.includeInactive,
    });

    return reply.status(200).send({
      data: types,
    });
  });

  // GET /api/v1/resources
  fastify.get('/resources', async (request, reply) => {
    const queryResult = ListResourcesQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.errors[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const {
      country,
      type,
      status,
      qualityLabel,
      gradeId,
      subjectId,
      schoolId,
      academicYear,
      term,
      page,
      pageSize,
    } = queryResult.data;

    const result = await resourceService.listResources({
      country,
      resourceType: type,
      status,
      qualityLabel,
      gradeId,
      subjectId,
      schoolId,
      academicYear,
      term,
      page,
      pageSize,
    });

    return reply.status(200).send(result);
  });

  // GET /api/v1/resources/:id
  fastify.get('/resources/:id', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'The requested resource id must be a valid UUID.',
          requestId: request.id,
        },
      });
    }

    const resource = await resourceService.getResourceById(paramResult.data.id);
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

  // GET /api/v1/resources/:id/versions
  fastify.get('/resources/:id/versions', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'The requested resource id must be a valid UUID.',
          requestId: request.id,
        },
      });
    }

    const queryResult = VersionsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.errors[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    // Verify parent resource exists
    const resource = await resourceService.getResourceById(paramResult.data.id);
    if (!resource) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource with id '${paramResult.data.id}' was not found.`,
          requestId: request.id,
        },
      });
    }

    const versions = await resourceService.listResourceVersions(paramResult.data.id, {
      includeUnpublished: queryResult.data.includeUnpublished,
    });

    return reply.status(200).send({
      data: versions,
    });
  });

  // GET /api/v1/resource-versions/:id
  fastify.get('/resource-versions/:id', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'The requested version id must be a valid UUID.',
          requestId: request.id,
        },
      });
    }

    const version = await resourceService.getResourceVersionById(paramResult.data.id);
    if (!version) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_VERSION_NOT_FOUND',
          message: `Resource version with id '${paramResult.data.id}' was not found.`,
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: version,
    });
  });
};
