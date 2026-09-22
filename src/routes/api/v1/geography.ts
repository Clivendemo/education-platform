import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  GeographyService,
  defaultGeographyService,
} from '../../../services/geography.service.js';

export interface GeographyRouteOptions {
  geographyService?: GeographyService;
}

const ListAreasQuerySchema = z.object({
  countryId: z.string().uuid().optional(),
  typeId: z.string().uuid().optional(),
  parentId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const AreaIdParamSchema = z.object({
  id: z.string().uuid('Invalid area UUID format'),
});

export const geographyRoutes: FastifyPluginAsync<GeographyRouteOptions> = async (
  fastify,
  opts,
) => {
  const service = opts.geographyService ?? defaultGeographyService;

  /**
   * GET /api/v1/geography/areas
   * Returns paginated administrative areas, filterable by country, type, or parent.
   */
  fastify.get('/geography/areas', async (request, reply) => {
    const queryResult = ListAreasQuerySchema.safeParse(request.query);
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

    const { countryId, typeId, parentId, page, pageSize } = queryResult.data;

    const result = await service.listAreas({
      countryId,
      typeId,
      parentId,
      page,
      pageSize,
    });

    return reply.status(200).send(result);
  });

  /**
   * GET /api/v1/geography/areas/:id
   * Returns details of a specific administrative area with its type metadata.
   */
  fastify.get('/geography/areas/:id', async (request, reply) => {
    const paramResult = AreaIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message: paramResult.error.issues[0]?.message ?? 'Invalid area ID',
          requestId: request.id,
        },
      });
    }

    const area = await service.getAreaById(paramResult.data.id);
    if (!area) {
      return reply.status(404).send({
        error: {
          code: 'AREA_NOT_FOUND',
          message: 'The requested administrative area was not found.',
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: area,
    });
  });

  /**
   * GET /api/v1/geography/children/:id
   * Returns all active direct children of an administrative area (e.g. Sub-counties of a County).
   */
  fastify.get('/geography/children/:id', async (request, reply) => {
    const paramResult = AreaIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message: paramResult.error.issues[0]?.message ?? 'Invalid area ID',
          requestId: request.id,
        },
      });
    }

    const children = await service.getChildAreas(paramResult.data.id);

    return reply.status(200).send({
      data: children,
    });
  });
};
