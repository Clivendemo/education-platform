import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../../../db/index.js';
import { resources } from '../../../db/schemas.js';
import {
  defaultPublicationService,
  type PublicationService,
  type PublicationActorContext,
  PublicationError,
} from '../../../services/publication.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
  type PermissionAccessResolution,
} from '../../../services/rbac.service.js';
import {
  defaultAuditService,
  type AuditService,
  type ActorSnapshot,
} from '../../../services/audit.service.js';
import { createRequireAuth } from './auth.js';
import {
  resolveStaffPermissionAccess,
  GENERIC_FORBIDDEN_MESSAGE,
} from '../../hooks/authorize.js';

import type { ResourceService } from '../../../services/resource.service.js';

export interface PublicationRoutesOptions {
  publicationService?: PublicationService;
  resourceService?: ResourceService;
  authService?: AuthService;
  rbacService?: RbacService;
  auditService?: AuditService;
  db?: AppDatabase;
}

const ResourceIdParamSchema = z.object({
  id: z.string().uuid('Resource ID must be a valid UUID.'),
});

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


async function buildActorSnapshot(
  request: FastifyRequest,
  rbacService: RbacService,
): Promise<ActorSnapshot> {
  const user = request.user!;
  let actorRole: string | undefined;
  if (typeof rbacService.getUserRoles === 'function') {
    try {
      const activeRoles = await rbacService.getUserRoles(user.id);
      if (activeRoles.length > 0) {
        actorRole = Array.from(new Set(activeRoles.map((r) => r.roleSlug)))
          .slice(0, 5)
          .join(',');
      }
    } catch {
      actorRole = undefined;
    }
  }

  let emailDomain: string | undefined;
  if (user.email && user.email.includes('@')) {
    emailDomain = user.email.split('@')[1]?.slice(0, 120);
  }

  return {
    actorId: user.id,
    actorType: 'AUTHENTICATED',
    actorRole,
    emailDomain,
  };
}

export const publicationRoutes: FastifyPluginAsync<PublicationRoutesOptions> = async (
  fastify,
  opts,
) => {
  const publicationService = opts.publicationService || defaultPublicationService;
  const resourceService = opts.resourceService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;
  const auditService = opts.auditService || defaultAuditService;
  const dbInstance = opts.db || defaultDb;

  const requireAuth = createRequireAuth(authService);

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
    throw error;
  });

  const logDeniedScopeAudit = async (
    request: FastifyRequest,
    action: string,
    resourceId: string,
    countryId: string | null,
  ) => {
    try {
      const actorSnapshot = await buildActorSnapshot(request, rbacService);
      await auditService.logEvent({
        action,
        entityType: 'RESOURCE',
        entityId: resourceId,
        actorType: 'AUTHENTICATED',
        actorUserId: request.user!.id,
        actorSnapshot,
        outcome: 'DENIED',
        requestId: request.id.slice(0, 64),
        countryId,
        context: {
          denialReason: 'COUNTRY_SCOPE_MISMATCH',
        },
      });
    } catch (auditErr) {
      request.log.error(auditErr, 'Failed to record DENIED scope audit event');
    }
  };

  /**
   * Enforces:
   * 1. Authentication (401 UNAUTHENTICATED)
   * 2. Baseline permission check (403 FORBIDDEN — before resource lookup to prevent enumeration)
   * 3. UUID parameter validation (400 VALIDATION_ERROR)
   * 4. Resource country scope check when caller holds only COUNTRY-scoped grants
   *    (404 RESOURCE_NOT_FOUND if missing; 403 FORBIDDEN + DENIED audit if out-of-country)
   */
  const authorizePublicationAction = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    permission: string | readonly string[],
    deniedAuditAction: string,
  ): Promise<{ resourceId: string; actorContext: PublicationActorContext } | null> => {
    reply.header('Cache-Control', 'private, no-store');
    const access: PermissionAccessResolution = await resolveStaffPermissionAccess(
      rbacService,
      request.user!.id,
      permission,
    );

    if (!access.granted) {
      reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
      return null;
    }

    const paramParse = ResourceIdParamSchema.safeParse(request.params);
    if (!paramParse.success) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: paramParse.error.errors.map((e) => e.message).join('; '),
          requestId: request.id,
        },
      });
      return null;
    }

    const resourceId = paramParse.data.id;

    if (!access.hasGlobalGrant) {
      let resourceRow: { id: string; countryId: string } | undefined;
      if (resourceService) {
        const found = await resourceService.getResourceById(resourceId, {
          includeUnpublished: true,
        });
        if (found) {
          resourceRow = { id: found.id, countryId: found.country.id };
        }
      } else {
        const [dbRow] = await dbInstance
          .select({ id: resources.id, countryId: resources.countryId })
          .from(resources)
          .where(eq(resources.id, resourceId))
          .limit(1);
        resourceRow = dbRow;
      }

      if (!resourceRow) {
        reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource with id ${resourceId} not found`,
            requestId: request.id,
          },
        });
        return null;
      }

      if (!access.countryIds.includes(resourceRow.countryId)) {
        await logDeniedScopeAudit(
          request,
          deniedAuditAction,
          resourceId,
          resourceRow.countryId,
        );
        reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
        return null;
      }
    }

    const actorSnapshot = await buildActorSnapshot(request, rbacService);
    return {
      resourceId,
      actorContext: {
        actorUserId: request.user!.id,
        actorSnapshot,
        requestId: request.id.slice(0, 64),
      },
    };
  };

  // Helper to register handler across multiple endpoint paths with authentication gate
  const registerPostHandler = (
    paths: string[],
    handler: (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => Promise<any>,
  ) => {
    for (const path of paths) {
      fastify.post<{ Params: { id: string } }>(
        path,
        { preHandler: [requireAuth] },
        handler,
      );
    }
  };

  // 1. Submit for Review
  registerPostHandler(
    ['/resources/:id/submit', '/admin/resources/:id/submit-review', '/admin/resources/:id/submit'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.submit',
        'RESOURCE_SUBMITTED_FOR_REVIEW',
      );
      if (!authCtx) return;

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
        const result = await publicationService.submitResourceForReview(
          authCtx.resourceId,
          {
            versionId: bodyResult.data.versionId,
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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

  // 2. Approve Resource
  registerPostHandler(
    ['/resources/:id/approve', '/admin/resources/:id/approve'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.approve',
        'RESOURCE_APPROVED',
      );
      if (!authCtx) return;

      try {
        const result = await publicationService.approveResource(
          authCtx.resourceId,
          {
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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

  // 3. Reject Resource
  registerPostHandler(
    ['/resources/:id/reject', '/admin/resources/:id/reject'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.reject',
        'RESOURCE_REJECTED',
      );
      if (!authCtx) return;

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
        const result = await publicationService.rejectResource(
          authCtx.resourceId,
          bodyResult.data.reason,
          {
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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

  // 4. Publish Resource
  registerPostHandler(
    ['/resources/:id/publish', '/admin/resources/:id/publish'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.publish',
        'RESOURCE_VERSION_PUBLISHED',
      );
      if (!authCtx) return;

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
          authCtx.resourceId,
          bodyResult.data.versionId,
          {
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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
  registerPostHandler(
    ['/resources/:id/archive', '/admin/resources/:id/retire', '/admin/resources/:id/archive'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.archive',
        'RESOURCE_ARCHIVED',
      );
      if (!authCtx) return;

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
        const result = await publicationService.archiveResource(
          authCtx.resourceId,
          bodyResult.data.reason,
          {
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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

  // 6. Return Resource to Draft
  registerPostHandler(
    ['/resources/:id/return-to-draft', '/admin/resources/:id/return-to-draft'],
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        'resource.update',
        'RESOURCE_RETURNED_TO_DRAFT',
      );
      if (!authCtx) return;

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
        const result = await publicationService.returnResourceToDraft(
          authCtx.resourceId,
          bodyResult.data.reason,
          {
            actorUserId: authCtx.actorContext.actorUserId,
            actorContext: authCtx.actorContext,
          },
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

  // 7a. GET /resources/:id/events — Staff-only publication history (resource.admin.read | resource.review + COUNTRY scope)
  fastify.get<{ Params: { id: string } }>(
    '/resources/:id/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        ['resource.admin.read', 'resource.review'],
        'RESOURCE_EVENTS_READ',
      );
      if (!authCtx) return;

      try {
        const events = await publicationService.getPublicationHistory(authCtx.resourceId);
        reply.header('Cache-Control', 'private, no-store');
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
    },
  );

  // 7b. GET /admin/resources/:id/events — Administrative publication history (resource.admin.read | resource.review + COUNTRY scope)
  fastify.get<{ Params: { id: string } }>(
    '/admin/resources/:id/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const authCtx = await authorizePublicationAction(
        request,
        reply,
        ['resource.admin.read', 'resource.review'],
        'ADMIN_RESOURCE_EVENTS_READ',
      );
      if (!authCtx) return;

      try {
        const events = await publicationService.getPublicationHistory(authCtx.resourceId);
        reply.header('Cache-Control', 'private, no-store');
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
    },
  );
};
