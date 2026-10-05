import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  defaultLibraryService,
  type LibraryService,
  LibraryError,
} from '../../../services/library.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import { createRequireAuth } from './auth.js';

export interface LibraryRoutesOptions {
  libraryService?: LibraryService;
  authService?: AuthService;
}

const ResourceVersionParamSchema = z.object({
  resourceVersionId: z.string().uuid({ message: 'Resource version ID must be a valid UUID' }),
});

const ListSavedResourcesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const libraryRoutes: FastifyPluginAsync<LibraryRoutesOptions> = async (
  fastify,
  opts,
) => {
  const libraryService = opts.libraryService || defaultLibraryService;
  const authService = opts.authService || defaultAuthService;
  const requireAuth = createRequireAuth(authService);

  // Custom Fastify Error Mapper for LibraryError
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof LibraryError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.errors[0]?.message || 'Validation error',
          details: error.errors,
          requestId: request.id,
        },
      });
    }

    // Default error handling
    return reply.send(error);
  });

  // Reusable Handlers
  const handleSave = async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = ResourceVersionParamSchema.safeParse(request.params);
    if (!parse.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parse.error.errors[0]?.message || 'Invalid resource version ID',
          requestId: request.id,
        },
      });
    }

    const { resourceVersionId } = parse.data;
    const result = await libraryService.saveResourceVersion(
      request.user!.id,
      resourceVersionId,
    );

    return reply.status(200).send({
      data: result,
    });
  };

  const handleRemove = async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = ResourceVersionParamSchema.safeParse(request.params);
    if (!parse.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parse.error.errors[0]?.message || 'Invalid resource version ID',
          requestId: request.id,
        },
      });
    }

    const { resourceVersionId } = parse.data;
    const result = await libraryService.removeResourceVersion(
      request.user!.id,
      resourceVersionId,
    );

    return reply.status(200).send({
      data: result,
    });
  };

  const handleCheck = async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = ResourceVersionParamSchema.safeParse(request.params);
    if (!parse.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parse.error.errors[0]?.message || 'Invalid resource version ID',
          requestId: request.id,
        },
      });
    }

    const { resourceVersionId } = parse.data;
    const result = await libraryService.isResourceVersionSaved(
      request.user!.id,
      resourceVersionId,
    );

    return reply.status(200).send({
      data: result,
    });
  };

  const handleList = async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = ListSavedResourcesQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parse.error.errors[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const result = await libraryService.listSavedResources(
      request.user!.id,
      parse.data,
    );

    return reply.status(200).send(result);
  };

  // 1. Primary Prompt 15 Routes: /api/v1/library/resources
  fastify.post('/library/resources/:resourceVersionId', { preHandler: [requireAuth] }, handleSave);
  fastify.delete('/library/resources/:resourceVersionId', { preHandler: [requireAuth] }, handleRemove);
  fastify.get('/library/resources/:resourceVersionId', { preHandler: [requireAuth] }, handleCheck);
  fastify.get('/library/resources', { preHandler: [requireAuth] }, handleList);

  // 2. docs/API_SPEC.md Section 33 Aliases: /api/v1/me/saved-resources
  fastify.post('/me/saved-resources/:resourceVersionId', { preHandler: [requireAuth] }, handleSave);
  fastify.delete('/me/saved-resources/:resourceVersionId', { preHandler: [requireAuth] }, handleRemove);
  fastify.get('/me/saved-resources/:resourceVersionId', { preHandler: [requireAuth] }, handleCheck);
  fastify.get('/me/saved-resources', { preHandler: [requireAuth] }, handleList);
};
