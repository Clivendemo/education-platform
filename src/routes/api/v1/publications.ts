import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultPublicationService,
  type PublicationService,
  PublicationError,
} from '../../../services/publication.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import { createRequireAuth } from './auth.js';
import { createRequirePermission } from '../../hooks/authorize.js';

export interface PublicationRoutesOptions {
  publicationService?: PublicationService;
  authService?: AuthService;
  rbacService?: RbacService;
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
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  const requireAuth = createRequireAuth(authService);
  const requirePermission = (permission: string) =>
    createRequirePermission(rbacService, permission);

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

  // Helper to register handler across multiple endpoint paths with authorization gates
  const registerPostHandler = (
    paths: string[],
    permission: string,
    handler: (request: any, reply: any) => Promise<any>,
  ) => {
    for (const path of paths) {
      fastify.post<{ Params: { id: string } }>(
        path,
        { preHandler: [requireAuth, requirePermission(permission)] },
        handler,
      );
    }
  };

  // 1. Submit for Review
  // Supported paths:
  // - /resources/:id/submit
  // - /admin/resources/:id/submit-review (approved in docs/API_SPEC.md Section 22)
  // - /admin/resources/:id/submit
  registerPostHandler(
    ['/resources/:id/submit', '/admin/resources/:id/submit-review', '/admin/resources/:id/submit'],
    'resource.submit',
    async (request, reply) => {
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
    },
  );

  // 2. Approve Resource
  // Supported paths:
  // - /resources/:id/approve
  // - /admin/resources/:id/approve (approved in docs/API_SPEC.md Section 22)
  registerPostHandler(
    ['/resources/:id/approve', '/admin/resources/:id/approve'],
    'resource.approve',
    async (request, reply) => {
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
    },
  );

  // 3. Reject Resource
  // Supported paths:
  // - /resources/:id/reject
  // - /admin/resources/:id/reject (approved in docs/API_SPEC.md Section 22)
  registerPostHandler(
    ['/resources/:id/reject', '/admin/resources/:id/reject'],
    'resource.reject',
    async (request, reply) => {
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
    },
  );

  // 4. Publish Resource
  // Supported paths:
  // - /resources/:id/publish
  // - /admin/resources/:id/publish (approved in docs/API_SPEC.md Section 22)
  registerPostHandler(
    ['/resources/:id/publish', '/admin/resources/:id/publish'],
    'resource.publish',
    async (request, reply) => {
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
        const result = await publicationService.publishResourceVersion(
          id,
          bodyResult.data.versionId,
        );
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
    },
  );

  // 5. Archive / Retire Resource
  // Supported paths:
  // - /resources/:id/archive
  // - /admin/resources/:id/retire (approved in docs/API_SPEC.md Section 22)
  // - /admin/resources/:id/archive
  registerPostHandler(
    ['/resources/:id/archive', '/admin/resources/:id/retire', '/admin/resources/:id/archive'],
    'resource.archive',
    async (request, reply) => {
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
    },
  );

  // 6. Return Resource to Draft
  // Supported paths:
  // - /resources/:id/return-to-draft
  // - /admin/resources/:id/return-to-draft
  registerPostHandler(
    ['/resources/:id/return-to-draft', '/admin/resources/:id/return-to-draft'],
    'resource.update',
    async (request, reply) => {
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
    },
  );

  // 7. GET /resources/:id/events & /admin/resources/:id/events (Publication History)
  const getEventsHandler = async (request: any, reply: any) => {
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
  };

  fastify.get<{ Params: { id: string } }>(
    '/resources/:id/events',
    { preHandler: [requireAuth, requirePermission('resource.read')] },
    getEventsHandler,
  );
  fastify.get<{ Params: { id: string } }>(
    '/admin/resources/:id/events',
    { preHandler: [requireAuth, requirePermission('resource.read')] },
    getEventsHandler,
  );
};
