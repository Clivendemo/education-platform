import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  SchoolService,
  defaultSchoolService,
} from '../../../services/school.service.js';
import { SCHOOL_TYPES } from '../../../db/schemas.js';

export interface SchoolsRouteOptions {
  schoolService?: SchoolService;
}

const ListSchoolsQuerySchema = z.object({
  country: z.string().optional(),
  countryId: z.string().uuid('Invalid country UUID').optional(),
  administrativeAreaId: z
    .string()
    .uuid('Invalid administrative area UUID')
    .optional(),
  schoolType: z
    .enum(SCHOOL_TYPES, {
      errorMap: () => ({
        message: `schoolType must be one of: ${SCHOOL_TYPES.join(', ')}`,
      }),
    })
    .optional(),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});

const SchoolIdParamSchema = z.object({
  id: z.string().uuid('Invalid school UUID format'),
});

export const schoolsRoutes: FastifyPluginAsync<SchoolsRouteOptions> = async (
  fastify,
  opts,
) => {
  const service = opts.schoolService ?? defaultSchoolService;

  /**
   * GET /api/v1/schools
   * Returns paginated active schools, filterable by country, administrativeAreaId, and schoolType.
   */
  fastify.get('/schools', async (request, reply) => {
    const queryResult = ListSchoolsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_QUERY_PARAMETER',
          message:
            queryResult.error.issues[0]?.message ?? 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const { country, countryId, administrativeAreaId, schoolType, page, pageSize } =
      queryResult.data;

    const result = await service.listSchools({
      country,
      countryId,
      administrativeAreaId,
      schoolType,
      page,
      pageSize,
    });

    return reply.status(200).send(result);
  });

  /**
   * GET /api/v1/schools/:id
   * Returns a specific active school by UUID.
   */
  fastify.get('/schools/:id', async (request, reply) => {
    const paramResult = SchoolIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid school UUID format',
          requestId: request.id,
        },
      });
    }

    const school = await service.getSchoolById(paramResult.data.id);
    if (!school) {
      return reply.status(404).send({
        error: {
          code: 'SCHOOL_NOT_FOUND',
          message: 'School not found',
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: school,
    });
  });
};
