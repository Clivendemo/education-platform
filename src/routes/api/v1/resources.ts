import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db as defaultDb } from '../../../db/index.js';
import { countries } from '../../../db/schemas.js';
import {
  type ResourceService,
  type ResourceDetailResult,
  type ResourceVersionResult,
  defaultResourceService,
} from '../../../services/resource.service.js';
import {
  type AuthService,
  defaultAuthService,
} from '../../../services/auth.service.js';
import {
  type RbacService,
  type PermissionAccessResolution,
  defaultRbacService,
} from '../../../services/rbac.service.js';
import { extractSessionToken } from './auth.js';
import {
  resolveStaffPermissionAccess,
  GENERIC_FORBIDDEN_MESSAGE,
} from '../../hooks/authorize.js';

export interface ResourceRouteOptions {
  resourceService?: ResourceService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const STAFF_RESOURCE_READ_PERMISSIONS = [
  'resource.admin.read',
  'resource.review',
] as const;

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

function isVersionPubliclyPublished(
  version: ResourceVersionResult | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!version || version.status !== 'PUBLISHED' || !version.publishedAt) {
    return false;
  }
  const publishedMs = Date.parse(version.publishedAt);
  return !Number.isNaN(publishedMs) && publishedMs <= nowMs;
}

function isResourcePubliclyVisible(
  resource: ResourceDetailResult | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!resource || resource.status !== 'PUBLISHED') {
    return false;
  }
  if ((resource.country?.status ?? 'ACTIVE') !== 'ACTIVE') {
    return false;
  }
  if ((resource.resourceType?.status ?? 'ACTIVE') !== 'ACTIVE') {
    return false;
  }
  if (resource.latestVersion !== undefined) {
    return isVersionPubliclyPublished(resource.latestVersion, nowMs);
  }
  return true;
}

async function resolveCountryUuidFilter(identifier: string): Promise<string | null> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }
  const [row] = await defaultDb
    .select({ id: countries.id })
    .from(countries)
    .where(
      or(
        eq(countries.isoCode, trimmed.toUpperCase()),
        eq(countries.urlPrefix, trimmed.toLowerCase()),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export const resourceRoutes: FastifyPluginAsync<ResourceRouteOptions> = async (
  fastify,
  opts,
) => {
  const resourceService = opts.resourceService || defaultResourceService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  const tryResolveOptionalStaffAccess = async (
    request: FastifyRequest,
  ): Promise<PermissionAccessResolution | null> => {
    const rawToken = extractSessionToken(request);
    if (!rawToken) return null;
    const validation = await authService.validateSession(rawToken);
    if (!validation) return null;
    request.user = validation.user;
    request.session = validation.session;
    const access = await resolveStaffPermissionAccess(
      rbacService,
      validation.user.id,
      STAFF_RESOURCE_READ_PERMISSIONS,
    );
    return access.granted ? access : null;
  };

  const requireStaffAccess = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<PermissionAccessResolution | null> => {
    reply.header('Cache-Control', 'private, no-store');
    const rawToken = extractSessionToken(request);
    if (!rawToken) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
      return null;
    }
    const validation = await authService.validateSession(rawToken);
    if (!validation) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
      return null;
    }
    request.user = validation.user;
    request.session = validation.session;

    const access = await resolveStaffPermissionAccess(
      rbacService,
      validation.user.id,
      STAFF_RESOURCE_READ_PERMISSIONS,
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
    return access;
  };

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

    if (queryResult.data.includeInactive) {
      const access = await requireStaffAccess(request, reply);
      if (!access) return;
    }

    const types = await resourceService.listResourceTypes({
      includeInactive: queryResult.data.includeInactive,
    });

    const filteredTypes = queryResult.data.includeInactive
      ? types
      : types.filter((t) => t.status === 'ACTIVE');

    return reply.status(200).send({
      data: filteredTypes,
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

    const isNonPublicStatusRequested = Boolean(status && status !== 'PUBLISHED');
    let allowedCountryIds: string[] | undefined;

    if (isNonPublicStatusRequested) {
      const access = await requireStaffAccess(request, reply);
      if (!access) return;

      if (!access.hasGlobalGrant) {
        if (country) {
          const resolvedCountryId = await resolveCountryUuidFilter(country);
          if (!resolvedCountryId || !access.countryIds.includes(resolvedCountryId)) {
            return reply.status(403).send({
              error: {
                code: 'FORBIDDEN',
                message: GENERIC_FORBIDDEN_MESSAGE,
                requestId: request.id,
              },
            });
          }
        }
        allowedCountryIds = access.countryIds;
      }
    }

    const result = await resourceService.listResources({
      country,
      resourceType: type,
      status: isNonPublicStatusRequested ? status : 'PUBLISHED',
      qualityLabel,
      gradeId,
      subjectId,
      schoolId,
      academicYear,
      term,
      page,
      pageSize,
      publicOnly: !isNonPublicStatusRequested,
      allowedCountryIds,
    });

    if (!isNonPublicStatusRequested) {
      const visibleItems = result.data.filter((item) => isResourcePubliclyVisible(item));
      if (visibleItems.length !== result.data.length) {
        const droppedCount = result.data.length - visibleItems.length;
        return reply.status(200).send({
          data: visibleItems,
          meta: {
            ...result.meta,
            total: Math.max(0, result.meta.total - droppedCount),
          },
        });
      }
    }

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

    const staffAccess = await tryResolveOptionalStaffAccess(request);

    if (staffAccess) {
      const staffResource = await resourceService.getResourceById(paramResult.data.id, {
        includeUnpublished: true,
      });
      if (!staffResource) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource with id '${paramResult.data.id}' was not found.`,
            requestId: request.id,
          },
        });
      }

      const inCountryScope =
        staffAccess.hasGlobalGrant ||
        staffAccess.countryIds.includes(staffResource.country.id);

      if (inCountryScope) {
        if (!isResourcePubliclyVisible(staffResource)) {
          reply.header('Cache-Control', 'private, no-store');
        }
        return reply.status(200).send({
          data: staffResource,
        });
      }
    }

    const publicResource = await resourceService.getResourceById(paramResult.data.id, {
      publicOnly: true,
    });
    if (!publicResource || !isResourcePubliclyVisible(publicResource)) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource with id '${paramResult.data.id}' was not found.`,
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: publicResource,
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

    if (queryResult.data.includeUnpublished) {
      const access = await requireStaffAccess(request, reply);
      if (!access) return;

      const resource = await resourceService.getResourceById(paramResult.data.id, {
        includeUnpublished: true,
      });
      if (!resource) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource with id '${paramResult.data.id}' was not found.`,
            requestId: request.id,
          },
        });
      }

      if (!access.hasGlobalGrant && !access.countryIds.includes(resource.country.id)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const versions = await resourceService.listResourceVersions(paramResult.data.id, {
        includeUnpublished: true,
      });

      return reply.status(200).send({
        data: versions,
      });
    }

    const publicResource = await resourceService.getResourceById(paramResult.data.id, {
      publicOnly: true,
    });
    if (!publicResource || !isResourcePubliclyVisible(publicResource)) {
      return reply.status(404).send({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource with id '${paramResult.data.id}' was not found.`,
          requestId: request.id,
        },
      });
    }

    const versions = await resourceService.listResourceVersions(paramResult.data.id, {
      includeUnpublished: false,
    });
    const visibleVersions = versions.filter((v) => isVersionPubliclyPublished(v));

    return reply.status(200).send({
      data: visibleVersions,
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

    if (isVersionPubliclyPublished(version)) {
      const publicParent = await resourceService.getResourceById(version.resourceId, {
        publicOnly: true,
      });
      if (publicParent && isResourcePubliclyVisible(publicParent)) {
        return reply.status(200).send({
          data: version,
        });
      }
    }

    const staffAccess = await tryResolveOptionalStaffAccess(request);
    if (staffAccess) {
      const staffParent = await resourceService.getResourceById(version.resourceId, {
        includeUnpublished: true,
      });
      if (
        staffParent &&
        (staffAccess.hasGlobalGrant ||
          staffAccess.countryIds.includes(staffParent.country.id))
      ) {
        reply.header('Cache-Control', 'private, no-store');
        return reply.status(200).send({
          data: version,
        });
      }
    }

    return reply.status(404).send({
      error: {
        code: 'RESOURCE_VERSION_NOT_FOUND',
        message: `Resource version with id '${paramResult.data.id}' was not found.`,
        requestId: request.id,
      },
    });
  });
};
