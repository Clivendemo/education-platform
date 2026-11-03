import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db as defaultDb } from '../../../db/index.js';
import { countries } from '../../../db/schemas.js';
import {
  type CurriculumService,
  type CurriculumResult,
  type CurriculumVersionResult,
  defaultCurriculumService,
} from '../../../services/curriculum.service.js';
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

export interface CurriculumRouteOptions {
  curriculumService?: CurriculumService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const STAFF_CURRICULUM_READ_PERMISSIONS = [
  'taxonomy.manage',
  'resource.admin.read',
  'resource.review',
] as const;

const ListCurriculaQuerySchema = z.object({
  country: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
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
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

const TopicsQuerySchema = z.object({
  parentId: z.string().uuid('Invalid parent UUID format').optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

function isCurriculumPubliclyVisible(c: CurriculumResult | null | undefined): boolean {
  if (!c || c.status !== 'ACTIVE') return false;
  return (c.country?.status ?? 'ACTIVE') === 'ACTIVE';
}

function isCurriculumVersionPubliclyVisible(
  v: CurriculumVersionResult | null | undefined,
): boolean {
  if (!v) return false;
  return v.status === 'CURRENT' || v.status === 'PLANNED';
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

export const curriculumRoutes: FastifyPluginAsync<
  CurriculumRouteOptions
> = async (fastify, opts) => {
  const service = opts.curriculumService ?? defaultCurriculumService;
  const authService = opts.authService ?? defaultAuthService;
  const rbacService = opts.rbacService ?? defaultRbacService;

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
      STAFF_CURRICULUM_READ_PERMISSIONS,
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
      STAFF_CURRICULUM_READ_PERMISSIONS,
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

  /**
   * GET /api/v1/curricula
   * List curricula with optional country filter and pagination.
   */
  fastify.get('/curricula', async (request, reply) => {
    const queryResult = ListCurriculaQuerySchema.safeParse(request.query);
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

    const { country, status, page, pageSize } = queryResult.data;
    const isInactiveRequested = status === 'INACTIVE';
    let allowedCountryIds: string[] | undefined;

    if (isInactiveRequested) {
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

    const result = await service.listCurricula({
      country,
      status: isInactiveRequested ? 'INACTIVE' : 'ACTIVE',
      page,
      pageSize,
      allowedCountryIds,
      includeInactiveCountries: isInactiveRequested,
    });

    if (!isInactiveRequested) {
      const visible = result.data.filter((c) => isCurriculumPubliclyVisible(c));
      if (visible.length !== result.data.length) {
        const dropped = result.data.length - visible.length;
        return reply.status(200).send({
          data: visible,
          meta: {
            ...result.meta,
            total: Math.max(0, result.meta.total - dropped),
          },
        });
      }
    }

    return reply.status(200).send(result);
  });

  /**
   * GET /api/v1/curricula/:id
   * Get curriculum by UUID.
   */
  fastify.get('/curricula/:id', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid curriculum UUID',
          requestId: request.id,
        },
      });
    }

    const staffAccess = await tryResolveOptionalStaffAccess(request);
    if (staffAccess) {
      const staffCurriculum = await service.getCurriculumById(paramResult.data.id, {
        includeInactive: true,
      });
      if (!staffCurriculum) {
        return reply.status(404).send({
          error: {
            code: 'CURRICULUM_NOT_FOUND',
            message: 'Curriculum not found',
            requestId: request.id,
          },
        });
      }
      if (
        staffAccess.hasGlobalGrant ||
        staffAccess.countryIds.includes(staffCurriculum.country.id)
      ) {
        if (!isCurriculumPubliclyVisible(staffCurriculum)) {
          reply.header('Cache-Control', 'private, no-store');
        }
        return reply.status(200).send({
          data: staffCurriculum,
        });
      }
    }

    const curriculum = await service.getCurriculumById(paramResult.data.id);
    if (!curriculum || !isCurriculumPubliclyVisible(curriculum)) {
      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_NOT_FOUND',
          message: 'Curriculum not found',
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: curriculum,
    });
  });

  /**
   * GET /api/v1/curricula/:id/versions
   * Get version history for a curriculum.
   */
  fastify.get('/curricula/:id/versions', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid curriculum UUID',
          requestId: request.id,
        },
      });
    }

    const queryResult = VersionsQuerySchema.safeParse(request.query);
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
    const includeInactive = queryResult.data.includeInactive;

    if (includeInactive) {
      const access = await requireStaffAccess(request, reply);
      if (!access) return;

      const curriculum = await service.getCurriculumById(paramResult.data.id, {
        includeInactive: true,
      });
      if (!curriculum) {
        return reply.status(404).send({
          error: {
            code: 'CURRICULUM_NOT_FOUND',
            message: 'Curriculum not found',
            requestId: request.id,
          },
        });
      }

      if (
        !access.hasGlobalGrant &&
        !access.countryIds.includes(curriculum.country.id)
      ) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const versions = await service.listCurriculumVersions(
        paramResult.data.id,
        { includeInactive: true },
      );

      return reply.status(200).send({
        data: versions,
      });
    }

    const curriculum = await service.getCurriculumById(paramResult.data.id);
    if (!curriculum || !isCurriculumPubliclyVisible(curriculum)) {
      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_NOT_FOUND',
          message: 'Curriculum not found',
          requestId: request.id,
        },
      });
    }

    const versions = await service.listCurriculumVersions(
      paramResult.data.id,
      { includeInactive: false },
    );
    const visibleVersions = versions.filter((v) =>
      isCurriculumVersionPubliclyVisible(v),
    );

    return reply.status(200).send({
      data: visibleVersions,
    });
  });

  /**
   * GET /api/v1/curriculum-versions/:id/levels
   * Get education levels under a curriculum version, deterministically ordered.
   */
  fastify.get('/curriculum-versions/:id/levels', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ??
            'Invalid curriculum version UUID',
          requestId: request.id,
        },
      });
    }

    const version = await service.getCurriculumVersionById(paramResult.data.id);
    if (!version || !isCurriculumVersionPubliclyVisible(version)) {
      const staffAccess = await tryResolveOptionalStaffAccess(request);
      if (staffAccess) {
        const staffVersion = await service.getCurriculumVersionById(
          paramResult.data.id,
          { includeInactive: true },
        );
        if (
          staffVersion &&
          (staffAccess.hasGlobalGrant ||
            staffAccess.countryIds.includes(staffVersion.countryId))
        ) {
          reply.header('Cache-Control', 'private, no-store');
          const levels = await service.listEducationLevels(paramResult.data.id, {
            includeInactive: true,
          });
          return reply.status(200).send({
            data: levels,
          });
        }
      }

      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_VERSION_NOT_FOUND',
          message: 'Curriculum version not found',
          requestId: request.id,
        },
      });
    }

    const levels = await service.listEducationLevels(paramResult.data.id);
    return reply.status(200).send({
      data: levels,
    });
  });

  /**
   * GET /api/v1/education-levels/:id/grades
   * Get grades under an education level, deterministically ordered.
   */
  fastify.get('/education-levels/:id/grades', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ??
            'Invalid education level UUID',
          requestId: request.id,
        },
      });
    }

    const gradesList = await service.listGrades(paramResult.data.id);
    return reply.status(200).send({
      data: gradesList,
    });
  });

  /**
   * GET /api/v1/grades/:id/pathways
   * Get specialization pathways under a grade (optional in hierarchy).
   */
  fastify.get('/grades/:id/pathways', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid grade UUID',
          requestId: request.id,
        },
      });
    }

    const pathwaysList = await service.listPathways(paramResult.data.id);
    return reply.status(200).send({
      data: pathwaysList,
    });
  });

  /**
   * GET /api/v1/grades/:id/subjects
   * Get subjects under a grade (for grades without pathways or direct subjects).
   */
  fastify.get('/grades/:id/subjects', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid grade UUID',
          requestId: request.id,
        },
      });
    }

    const subjectsList = await service.listSubjects({
      gradeId: paramResult.data.id,
    });
    return reply.status(200).send({
      data: subjectsList,
    });
  });

  /**
   * GET /api/v1/pathways/:id/subjects
   * Get subjects under a specialization pathway.
   */
  fastify.get('/pathways/:id/subjects', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid pathway UUID',
          requestId: request.id,
        },
      });
    }

    const subjectsList = await service.listSubjects({
      pathwayId: paramResult.data.id,
    });
    return reply.status(200).send({
      data: subjectsList,
    });
  });

  /**
   * GET /api/v1/subjects/:id/topics
   * Get topics under a subject, deterministically ordered.
   */
  fastify.get('/subjects/:id/topics', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid subject UUID',
          requestId: request.id,
        },
      });
    }

    const queryResult = TopicsQuerySchema.safeParse(request.query);
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
    const parentId = queryResult.data.parentId;
    const includeInactive = queryResult.data.includeInactive;

    if (includeInactive) {
      const access = await requireStaffAccess(request, reply);
      if (!access) return;

      if (
        !access.hasGlobalGrant &&
        typeof service.getSubjectCountryId === 'function'
      ) {
        const subjectCountryId = await service.getSubjectCountryId(
          paramResult.data.id,
        );
        if (subjectCountryId && !access.countryIds.includes(subjectCountryId)) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN',
              message: GENERIC_FORBIDDEN_MESSAGE,
              requestId: request.id,
            },
          });
        }
      }
    }

    const topicsList = await service.listTopics(paramResult.data.id, {
      parentId,
      includeInactive,
    });

    const filteredTopics = includeInactive
      ? topicsList
      : topicsList.filter((t) => t.status === 'ACTIVE');

    return reply.status(200).send({
      data: filteredTopics,
    });
  });
};
