import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  FILE_STATUSES,
  PUBLICATION_EVENT_TYPES,
  QUALITY_LABELS,
  RESOURCE_FILE_TYPES,
  RESOURCE_STATUSES,
  STORAGE_PROVIDERS,
} from '../../../db/schemas.js';
import {
  ADMIN_ATTENTION_FLAGS,
  AdminDashboardError,
  defaultAdminDashboardService,
  type AdminDashboardService,
} from '../../../services/admin-dashboard.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type PermissionAccessResolution,
  type RbacService,
} from '../../../services/rbac.service.js';
import {
  defaultAuditService,
  type ActorSnapshot,
  type AuditService,
} from '../../../services/audit.service.js';
import { createRequireAuth } from './auth.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../../hooks/authorize.js';
import {
  type BoundedConcurrencyRegistry,
  defaultConcurrencyRegistry,
} from '../../../services/rate-limit.service.js';

export interface AdminDashboardRouteOptions {
  adminDashboardService?: AdminDashboardService;
  authService?: AuthService;
  rbacService?: RbacService;
  auditService?: AuditService;
  concurrencyRegistry?: BoundedConcurrencyRegistry;
}

const UuidParamSchema = z
  .object({
    id: z.string().uuid('ID parameter must be a valid UUID.'),
  })
  .strict();

const OverviewQuerySchema = z
  .object({
    countryId: z.string().uuid('countryId must be a valid UUID.').optional(),
  })
  .strict();

const AdminResourcesQuerySchema = z
  .object({
    countryId: z.string().uuid().optional(),
    status: z.enum(RESOURCE_STATUSES).optional(),
    qualityLabel: z.enum(QUALITY_LABELS).optional(),
    resourceTypeId: z.string().uuid().optional(),
    curriculumId: z.string().uuid().optional(),
    educationLevelId: z.string().uuid().optional(),
    gradeId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    topicId: z.string().uuid().optional(),
    schoolId: z.string().uuid().optional(),
    contributorId: z.string().uuid().optional(),
    academicYear: z.coerce.number().int().min(1970).max(2100).optional(),
    term: z.coerce.number().int().min(1).max(3).optional(),
    attentionFlag: z.enum(ADMIN_ATTENTION_FLAGS).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sortBy: z.enum(['updatedAt', 'createdAt', 'title']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const ReviewQueueQuerySchema = z
  .object({
    countryId: z.string().uuid().optional(),
    queueState: z.enum(['ALL', 'IN_REVIEW', 'APPROVED']).default('ALL'),
    resourceTypeId: z.string().uuid().optional(),
    gradeId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    sortBy: z.enum(['updatedAt', 'createdAt']).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const IsoDateQuerySchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid ISO-8601 date string.',
  });

const PublicationEventsQuerySchema = z
  .object({
    countryId: z.string().uuid().optional(),
    resourceId: z.string().uuid().optional(),
    eventType: z.enum(PUBLICATION_EVENT_TYPES).optional(),
    actorUserId: z.string().uuid().optional(),
    fromDate: IsoDateQuerySchema.optional(),
    toDate: IsoDateQuerySchema.optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const BooleanQueryString = z.preprocess((val) => {
  if (val === 'true' || val === true) return true;
  if (val === 'false' || val === false) return false;
  return val;
}, z.boolean());

const AdminFilesQuerySchema = z
  .object({
    countryId: z.string().uuid().optional(),
    resourceId: z.string().uuid().optional(),
    resourceVersionId: z.string().uuid().optional(),
    status: z.enum(FILE_STATUSES).optional(),
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
    fileType: z.enum(RESOURCE_FILE_TYPES).optional(),
    isPrimary: BooleanQueryString.optional(),
    versionStatus: z.enum(RESOURCE_STATUSES).optional(),
    checksumSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, 'checksumSha256 must be a 64-character hex SHA-256 digest.')
      .optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'fileSizeBytes']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const EmptyStrictBodySchema = z.object({}).strict();

async function resolveAccess(
  rbacService: RbacService,
  userId: string,
  permission: string,
): Promise<PermissionAccessResolution> {
  if (typeof rbacService.resolvePermissionAccess === 'function') {
    return rbacService.resolvePermissionAccess(userId, permission);
  }
  const granted = await rbacService.hasPermission(userId, permission);
  return {
    granted,
    hasGlobalGrant: granted,
    countryIds: [],
  };
}

async function buildActorSnapshot(
  request: FastifyRequest,
  rbacService: RbacService,
): Promise<ActorSnapshot> {
  const user = request.user!;
  let actorRole: string | undefined;
  if (typeof rbacService.getUserRoles === 'function') {
    try {
      const roles = await rbacService.getUserRoles(user.id);
      if (roles.length > 0) {
        actorRole = Array.from(new Set(roles.map((r) => r.roleSlug)))
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

export const adminDashboardRoutes: FastifyPluginAsync<AdminDashboardRouteOptions> = async (
  fastify,
  opts,
) => {
  const adminDashboardService =
    opts.adminDashboardService || defaultAdminDashboardService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;
  const auditService = opts.auditService || defaultAuditService;
  const concurrencyRegistry = opts.concurrencyRegistry || defaultConcurrencyRegistry;

  const requireAuth = createRequireAuth(authService);

  // Ensure private, non-cacheable headers on all administrative responses
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  const recordDeniedAudit = async (
    request: FastifyRequest,
    action: string,
    entityType: string,
    entityId: string | null,
    countryId: string | null,
    denialReason: string,
  ) => {
    if (!request.user) return;
    try {
      const actorSnapshot = await buildActorSnapshot(request, rbacService);
      await auditService.logEvent({
        action,
        entityType,
        entityId,
        actorType: 'AUTHENTICATED',
        actorUserId: request.user.id,
        actorSnapshot,
        outcome: 'DENIED',
        requestId: request.id.slice(0, 64),
        countryId,
        context: {
          denialReason,
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to write DENIED administrative audit log');
    }
  };

  const requireAdminPermission = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: string,
    auditAction: string,
    entityType: string,
  ): Promise<PermissionAccessResolution | null> => {
    const access = await resolveAccess(rbacService, request.user!.id, permission);
    if (!access.granted) {
      await recordDeniedAudit(
        request,
        auditAction,
        entityType,
        null,
        null,
        'MISSING_PERMISSION_OR_SCOPE',
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
    return access;
  };

  const handleServiceError = async (
    err: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
    auditAction: string,
    defaultEntityType: string,
  ) => {
    if (err instanceof AdminDashboardError) {
      if (err.statusCode === 403) {
        await recordDeniedAudit(
          request,
          auditAction,
          err.metadata?.entityType ?? defaultEntityType,
          err.metadata?.entityId ?? null,
          err.metadata?.targetCountryId ?? null,
          'COUNTRY_SCOPE_MISMATCH',
        );
      }
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          requestId: request.id,
        },
      });
    }
    throw err;
  };

  // 1. GET /api/v1/admin/dashboard/overview
  fastify.get(
    '/admin/dashboard/overview',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'admin.dashboard.read',
        'ADMIN_DASHBOARD_OVERVIEW_READ',
        'ADMIN_DASHBOARD',
      );
      if (!access) return;

      const parsedQuery = OverviewQuerySchema.safeParse(request.query || {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const overview = await adminDashboardService.getOverview({
          actorUserId: request.user!.id,
          dashboardAccess: access,
          countryId: parsedQuery.data.countryId,
        });
        return reply.status(200).send({ data: overview });
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_DASHBOARD_OVERVIEW_READ',
          'ADMIN_DASHBOARD',
        );
      }
    },
  );

  // 2. GET /api/v1/admin/resources
  fastify.get(
    '/admin/resources',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'resource.admin.read',
        'ADMIN_RESOURCES_LIST',
        'RESOURCE',
      );
      if (!access) return;

      const parsedQuery = AdminResourcesQuerySchema.safeParse(request.query || {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const result = await adminDashboardService.listResources(
          parsedQuery.data,
          access,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_RESOURCES_LIST',
          'RESOURCE',
        );
      }
    },
  );

  // 3. GET /api/v1/admin/resources/:id
  fastify.get<{ Params: { id: string } }>(
    '/admin/resources/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'resource.admin.read',
        'ADMIN_RESOURCE_DETAIL_READ',
        'RESOURCE',
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const detail = await adminDashboardService.getResourceById(
          parsedParams.data.id,
          request.user!.id,
          access,
        );
        return reply.status(200).send({ data: detail });
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_RESOURCE_DETAIL_READ',
          'RESOURCE',
        );
      }
    },
  );

  // 4. GET /api/v1/admin/publications/review-queue
  fastify.get(
    '/admin/publications/review-queue',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'resource.review',
        'ADMIN_REVIEW_QUEUE_READ',
        'RESOURCE',
      );
      if (!access) return;

      const parsedQuery = ReviewQueueQuerySchema.safeParse(request.query || {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const result = await adminDashboardService.getReviewQueue(
          parsedQuery.data,
          access,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_REVIEW_QUEUE_READ',
          'RESOURCE',
        );
      }
    },
  );

  // 5. GET /api/v1/admin/publications/events
  fastify.get(
    '/admin/publications/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'resource.admin.read',
        'ADMIN_PUBLICATION_EVENTS_LIST',
        'PUBLICATION_EVENT',
      );
      if (!access) return;

      const parsedQuery = PublicationEventsQuerySchema.safeParse(request.query || {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const fromDate = parsedQuery.data.fromDate
        ? new Date(parsedQuery.data.fromDate)
        : undefined;
      const toDate = parsedQuery.data.toDate
        ? new Date(parsedQuery.data.toDate)
        : undefined;

      if (fromDate && toDate && fromDate > toDate) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'fromDate must be less than or equal to toDate.',
            requestId: request.id,
          },
        });
      }

      try {
        const result = await adminDashboardService.listPublicationEvents(
          {
            countryId: parsedQuery.data.countryId,
            resourceId: parsedQuery.data.resourceId,
            eventType: parsedQuery.data.eventType,
            actorUserId: parsedQuery.data.actorUserId,
            fromDate,
            toDate,
            sortOrder: parsedQuery.data.sortOrder,
            page: parsedQuery.data.page,
            pageSize: parsedQuery.data.pageSize,
          },
          access,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_PUBLICATION_EVENTS_LIST',
          'PUBLICATION_EVENT',
        );
      }
    },
  );

  // 6. GET /api/v1/admin/files
  fastify.get(
    '/admin/files',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'file.admin.read',
        'ADMIN_FILES_LIST',
        'RESOURCE_FILE',
      );
      if (!access) return;

      const parsedQuery = AdminFilesQuerySchema.safeParse(request.query || {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const result = await adminDashboardService.listFiles(
          parsedQuery.data,
          access,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_FILES_LIST',
          'RESOURCE_FILE',
        );
      }
    },
  );

  // 7. GET /api/v1/admin/files/:id
  fastify.get<{ Params: { id: string } }>(
    '/admin/files/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'file.admin.read',
        'ADMIN_FILE_DETAIL_READ',
        'RESOURCE_FILE',
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      try {
        const detail = await adminDashboardService.getFileById(
          parsedParams.data.id,
          access,
        );
        return reply.status(200).send({ data: detail });
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_FILE_DETAIL_READ',
          'RESOURCE_FILE',
        );
      }
    },
  );

  // 8. POST /api/v1/admin/files/:id/verify-integrity
  fastify.post<{ Params: { id: string } }>(
    '/admin/files/:id/verify-integrity',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = await requireAdminPermission(
        request,
        reply,
        'file.admin.verify',
        'ADMIN_FILE_INTEGRITY_VERIFIED',
        'RESOURCE_FILE',
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.errors.map((e) => e.message).join('; '),
            requestId: request.id,
          },
        });
      }

      if (request.body !== undefined && request.body !== null) {
        const parsedBody = EmptyStrictBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: parsedBody.error.errors.map((e) => e.message).join('; '),
              requestId: request.id,
            },
          });
        }
      }

      try {
        const actorSnapshot = await buildActorSnapshot(request, rbacService);
        const result = await concurrencyRegistry.runWithPermit(
          'admin_file_verify',
          { actorKey: request.user!.id, request, reply },
          (signal) =>
            adminDashboardService.verifyFileIntegrity(
              parsedParams.data.id,
              {
                actorUserId: request.user!.id,
                actorSnapshot,
                requestId: request.id.slice(0, 64),
              },
              access,
              { signal },
            ),
        );
        return reply.status(200).send({ data: result });
      } catch (err) {
        return handleServiceError(
          err,
          request,
          reply,
          'ADMIN_FILE_INTEGRITY_VERIFIED',
          'RESOURCE_FILE',
        );
      }
    },
  );
};
