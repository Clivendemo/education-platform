import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SeoService, defaultSeoService } from '../../../services/seo.service.js';

export interface SeoRouteOptions {
  seoService?: SeoService;
}

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

export const seoRoutes: FastifyPluginAsync<SeoRouteOptions> = async (fastify, opts) => {
  const seoService = opts.seoService || defaultSeoService;

  // GET /api/v1/seo/resources/:id
  fastify.get('/seo/resources/:id', async (request, reply) => {
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

    const metadata = await seoService.getResourceSeoMetadata(paramResult.data.id);
    if (!metadata) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `SEO metadata for resource with id '${paramResult.data.id}' was not found or resource is not published.`,
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: metadata,
    });
  });
};
