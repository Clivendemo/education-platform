import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultPublicationService,
  type PublicationService,
  PublicationError,
} from '../../../services/publication.service.js';

export interface PublicationRoutesOptions {
  publicationService?: PublicationService;
}

const SubmitSchema = z.object({
  versionId: z.string().uuid().optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1, 'A non-empty rejection reason is required.'),
});

const PublishSchema = z.object({
  versionId: z.string().uuid(),
});

const ArchiveSchema = z.object({
  reason: z.string().optional(),
});

const ReturnToDraftSchema = z.object({
  reason: z.string().optional(),
});

export const publicationRoutes: FastifyPluginAsync<PublicationRoutesOptions> = async (
  fastify,
  opts,
) => {
  const publicationService = opts.publicationService || defaultPublicationService;

  // Custom Fastify Error Mapper for PublicationError
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof PublicationError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    // Delegate unhandled errors to global handler
    throw error;
  });

  // 1. POST /resources/:id/submit
  fastify.post<{ Params: { id: string } }>('/resources/:id/submit', async (request, reply) => {
    const { id } = request.params;
    const bodyResult = SubmitSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
    }

    try {
      const result = await publicationService.submitResourceForReview(id, {
        versionId: bodyResult.data.versionId,
      });
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 2. POST /resources/:id/approve
  fastify.post<{ Params: { id: string } }>('/resources/:id/approve', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await publicationService.approveResource(id);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 3. POST /resources/:id/reject
  fastify.post<{ Params: { id: string } }>('/resources/:id/reject', async (request, reply) => {
    const { id } = request.params;
    const bodyResult = RejectSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
    }

    try {
      const result = await publicationService.rejectResource(id, bodyResult.data.reason);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 4. POST /resources/:id/publish
  fastify.post<{ Params: { id: string } }>('/resources/:id/publish', async (request, reply) => {
    const { id } = request.params;
    const bodyResult = PublishSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
    }

    try {
      const result = await publicationService.publishResourceVersion(id, bodyResult.data.versionId);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 5. POST /resources/:id/archive
  fastify.post<{ Params: { id: string } }>('/resources/:id/archive', async (request, reply) => {
    const { id } = request.params;
    const bodyResult = ArchiveSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
    }

    try {
      const result = await publicationService.archiveResource(id, bodyResult.data.reason);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 6. POST /resources/:id/return-to-draft
  fastify.post<{ Params: { id: string } }>('/resources/:id/return-to-draft', async (request, reply) => {
    const { id } = request.params;
    const bodyResult = ReturnToDraftSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
    }

    try {
      const result = await publicationService.returnResourceToDraft(id, bodyResult.data.reason);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });

  // 7. GET /resources/:id/events (Publication History)
  fastify.get<{ Params: { id: string } }>('/resources/:id/events', async (request, reply) => {
    const { id } = request.params;
    try {
      const events = await publicationService.getPublicationHistory(id);
      return reply.status(200).send({ data: events });
    } catch (err) {
      if (err instanceof PublicationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: request.id,
          },
        });
      }
      throw err;
    }
  });
};
