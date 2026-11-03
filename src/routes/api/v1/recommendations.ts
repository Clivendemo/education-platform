import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, or, sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../../../db/index.js';
import { countries } from '../../../db/schemas.js';
import {
  defaultRecommendationService,
  type RecommendationService,
  RecommendationError,
} from '../../../services/recommendations/recommendation.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import {
  defaultAuditService,
  type AuditService,
} from '../../../services/audit.service.js';
import {
  GENERIC_FORBIDDEN_MESSAGE,
  resolveStaffPermissionAccess,
} from '../../hooks/authorize.js';

export interface RecommendationRouteOptions {
  recommendationService?: RecommendationService;
  authService?: AuthService;
  rbacService?: RbacService;
  auditService?: AuditService;
  db?: AppDatabase;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ResourceIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Resource ID must be a valid UUID' }),
});

const RuleIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Rule ID must be a valid UUID' }),
});

const ResourceRecommendationsQuerySchema = z.object({
  surface: z
    .enum(['related-resources', 'you-may-also-need', 'teachers-also-viewed'])
    .default('related-resources'),
  limit: z.coerce.number().int().min(1, 'limit must be at least 1').optional(),
  country: z.string().min(1).optional(),
});

const ContinueExploringQuerySchema = z.object({
  country: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1, 'limit must be at least 1').optional(),
});

const AdminListRulesQuerySchema = z.object({
  country: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  ruleType: z.enum(['PIN', 'EXCLUDE']).optional(),
  sourceResourceId: z.string().uuid().optional(),
  sourceTopicId: z.string().uuid().optional(),
  targetResourceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateRuleBodySchema = z
  .object({
    countryId: z.string().uuid({ message: 'countryId must be a valid UUID' }),
    ruleType: z.enum(['PIN', 'EXCLUDE']),
    sourceResourceId: z.string().uuid().nullable().optional(),
    sourceTopicId: z.string().uuid().nullable().optional(),
    targetResourceId: z.string().uuid({ message: 'targetResourceId must be a valid UUID' }),
    priority: z.number().int().min(1).max(10).nullable().optional(),
    reason: z.string().trim().min(3, 'reason must be at least 3 characters').max(1000),
  })
  .strict();

const DeactivateRuleBodySchema = z
  .object({
    reason: z.string().trim().min(3, 'reason must be at least 3 characters').max(1000),
  })
  .strict();

const ReactivateRuleBodySchema = z
  .object({
    reason: z.string().trim().min(3, 'reason must be at least 3 characters').max(1000),
    priority: z.number().int().min(1).max(10).optional(),
  })
  .strict();

function isBenchmarkBypassAllowed(request: FastifyRequest): boolean {
  const headerVal = request.headers['x-benchmark-cache-bypass'];
  if (headerVal !== 'true') {
    return false;
  }
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.ENABLE_BENCHMARK_BYPASS === 'true'
  );
}

export const recommendationRoutes: FastifyPluginAsync<RecommendationRouteOptions> = async (
  fastify,
  opts,
) => {
  const recommendationService = opts.recommendationService || defaultRecommendationService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;
  const auditService = opts.auditService || defaultAuditService;
  const dbInstance = opts.db || defaultDb;

  fastify.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof RecommendationError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.errors[0]?.message || 'Validation failed',
          details: error.flatten(),
          requestId: request.id,
        },
      });
    }

    throw error;
  });

  const resolveOptionalUser = async (request: FastifyRequest) => {
    const directUser = (request as any).user;
    if (directUser?.id) return directUser;

    const cookieHeader = request.headers.cookie;
    const rawToken =
      request.cookies?.[SESSION_COOKIE_NAME] ||
      cookieHeader?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

    if (!rawToken) return null;

    try {
      const sessionResult = await authService.validateSession(rawToken.trim());
      return sessionResult ? sessionResult.user : null;
    } catch {
      return null;
    }
  };

  const requireAuthenticatedUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveOptionalUser(request);
    if (!user) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
      return null;
    }
    request.user = user;
    return user;
  };

  const resolveAdminCountryIdentifier = async (identifier: string): Promise<string | null> => {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    const isUuid = UUID_REGEX.test(trimmed);
    const conditions = [
      eq(sql`lower(${countries.isoCode})`, trimmed.toLowerCase()),
      eq(sql`lower(${countries.urlPrefix})`, trimmed.toLowerCase()),
    ];
    if (isUuid) {
      conditions.push(eq(countries.id, trimmed));
    }
    const [row] = await dbInstance
      .select({ id: countries.id })
      .from(countries)
      .where(or(...conditions))
      .limit(1);
    return row ? row.id : null;
  };

  const logDeniedAttempt = async (params: {
    user: { id: string; email?: string | null; displayName?: string | null };
    action: string;
    entityId?: string | null;
    countryId?: string | null;
    requestId: string;
  }) => {
    try {
      const emailDomain =
        params.user.email && params.user.email.includes('@')
          ? params.user.email.split('@')[1]
          : undefined;
      await auditService.logEvent({
        action: params.action,
        entityType: 'resource_recommendation_rule',
        entityId: params.entityId ?? null,
        actorType: 'AUTHENTICATED',
        actorUserId: params.user.id,
        actorSnapshot: {
          actorId: params.user.id,
          actorType: 'AUTHENTICATED',
          emailDomain,
        },
        outcome: 'DENIED',
        requestId: params.requestId,
        countryId: params.countryId ?? null,
        context: { reason: 'Insufficient RBAC permission or country scope' },
      });
    } catch {
      // Do not fail 403 response if audit write encounters transient error
    }
  };

  /**
   * 1. Public Resource-Anchored Recommendations
   * GET /api/v1/resources/:id/recommendations
   */
  fastify.get('/resources/:id/recommendations', async (request, reply) => {
    const { id } = ResourceIdParamSchema.parse(request.params);
    const query = ResourceRecommendationsQuerySchema.parse(request.query);

    const result = await recommendationService.getResourceRecommendations({
      sourceResourceId: id,
      surface: query.surface,
      limit: query.limit,
      country: query.country,
      bypassCache: isBenchmarkBypassAllowed(request),
    });

    return reply.status(200).send({
      data: result.data,
      meta: result.meta,
    });
  });

  /**
   * 2. Public Contextual & Cold-Start Discovery
   * GET /api/v1/recommendations/continue-exploring
   */
  fastify.get('/recommendations/continue-exploring', async (request, reply) => {
    const query = ContinueExploringQuerySchema.parse(request.query);
    const user = await resolveOptionalUser(request);

    let anonymousSessionHash: string | null = null;
    if (!user) {
      const rawAnon =
        (request.headers['x-anonymous-session-id'] as string | undefined) ||
        request.cookies?.['elimu_anon_sid'];
      if (typeof rawAnon === 'string' && rawAnon.trim().length > 0) {
        anonymousSessionHash = crypto
          .createHash('sha256')
          .update(rawAnon.trim())
          .digest('hex');
      }
    }

    const profileData = (user?.profileData ?? {}) as Record<string, unknown>;
    const userCountryHint =
      typeof profileData.countryId === 'string'
        ? profileData.countryId
        : typeof profileData.country === 'string'
          ? profileData.country
          : null;

    const result = await recommendationService.getContinueExploring({
      country: query.country,
      userCountryHint,
      userId: user?.id ?? null,
      anonymousSessionHash,
      limit: query.limit,
      bypassCache: isBenchmarkBypassAllowed(request),
    });

    return reply.status(200).send({
      data: result.data,
      meta: result.meta,
    });
  });

  /**
   * 3. Admin List Editorial Rules
   * GET /api/v1/admin/recommendations/rules
   */
  fastify.get('/admin/recommendations/rules', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    const user = await requireAuthenticatedUser(request, reply);
    if (!user) return;

    const access = await resolveStaffPermissionAccess(
      rbacService,
      user.id,
      'recommendation.read',
    );
    if (!access.granted) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.read',
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const query = AdminListRulesQuerySchema.parse(request.query);
    let resolvedCountryId: string | undefined;

    if (query.country) {
      const foundId = await resolveAdminCountryIdentifier(query.country);
      if (!foundId) {
        return reply.status(404).send({
          error: {
            code: 'COUNTRY_NOT_FOUND',
            message: `Country not found for identifier '${query.country}'`,
            requestId: request.id,
          },
        });
      }
      resolvedCountryId = foundId;

      const authorizedForCountry =
        access.hasGlobalGrant || access.countryIds.includes(resolvedCountryId);
      if (!authorizedForCountry) {
        await logDeniedAttempt({
          user,
          action: 'recommendation.rule.read',
          countryId: resolvedCountryId,
          requestId: request.id,
        });
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }
    }

    const allowedCountryIds = access.hasGlobalGrant ? null : access.countryIds;

    const result = await recommendationService.listRules({
      countryId: resolvedCountryId,
      allowedCountryIds,
      status: query.status,
      ruleType: query.ruleType,
      sourceResourceId: query.sourceResourceId,
      sourceTopicId: query.sourceTopicId,
      targetResourceId: query.targetResourceId,
      page: query.page,
      pageSize: query.pageSize,
    });

    return reply.status(200).send(result);
  });

  /**
   * 4. Admin Create Editorial Rule
   * POST /api/v1/admin/recommendations/rules
   */
  fastify.post('/admin/recommendations/rules', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    const user = await requireAuthenticatedUser(request, reply);
    if (!user) return;

    const rawBodyCountryId =
      typeof (request.body as any)?.countryId === 'string' &&
      UUID_REGEX.test((request.body as any).countryId)
        ? ((request.body as any).countryId as string)
        : undefined;

    const access = await resolveStaffPermissionAccess(
      rbacService,
      user.id,
      'recommendation.manage',
    );
    if (!access.granted) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.create',
        countryId: rawBodyCountryId ?? null,
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const body = CreateRuleBodySchema.parse(request.body);

    const authorizedForCountry =
      access.hasGlobalGrant || access.countryIds.includes(body.countryId);
    if (!authorizedForCountry) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.create',
        countryId: body.countryId,
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const userRoles =
      typeof rbacService.getUserRoles === 'function'
        ? await rbacService.getUserRoles(user.id)
        : [];
    const primaryRole = userRoles[0]?.roleSlug;

    const created = await recommendationService.createRule({
      countryId: body.countryId,
      ruleType: body.ruleType,
      sourceResourceId: body.sourceResourceId ?? null,
      sourceTopicId: body.sourceTopicId ?? null,
      targetResourceId: body.targetResourceId,
      priority: body.priority ?? null,
      reason: body.reason,
      actor: {
        userId: user.id,
        roleSlug: primaryRole,
        email: user.email,
        displayName: user.displayName,
        requestId: request.id,
      },
    });

    return reply.status(201).send({ data: created });
  });

  /**
   * 5. Admin Soft-Deactivate Editorial Rule
   * POST /api/v1/admin/recommendations/rules/:id/deactivate
   */
  fastify.post('/admin/recommendations/rules/:id/deactivate', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    const user = await requireAuthenticatedUser(request, reply);
    if (!user) return;

    const access = await resolveStaffPermissionAccess(
      rbacService,
      user.id,
      'recommendation.manage',
    );
    if (!access.granted) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.deactivate',
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const { id } = RuleIdParamSchema.parse(request.params);
    const body = DeactivateRuleBodySchema.parse(request.body);

    const existing = await recommendationService.getRuleById(id);
    if (!existing) {
      return reply.status(404).send({
        error: {
          code: 'RULE_NOT_FOUND',
          message: 'Recommendation rule not found.',
          requestId: request.id,
        },
      });
    }

    const authorizedForCountry =
      access.hasGlobalGrant || access.countryIds.includes(existing.countryId);
    if (!authorizedForCountry) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.deactivate',
        entityId: existing.id,
        countryId: existing.countryId,
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const userRoles =
      typeof rbacService.getUserRoles === 'function'
        ? await rbacService.getUserRoles(user.id)
        : [];
    const updated = await recommendationService.deactivateRule({
      ruleId: id,
      reason: body.reason,
      actor: {
        userId: user.id,
        roleSlug: userRoles[0]?.roleSlug,
        email: user.email,
        displayName: user.displayName,
        requestId: request.id,
      },
    });

    return reply.status(200).send({ data: updated });
  });

  /**
   * 6. Admin Reactivate Editorial Rule
   * POST /api/v1/admin/recommendations/rules/:id/reactivate
   */
  fastify.post('/admin/recommendations/rules/:id/reactivate', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    const user = await requireAuthenticatedUser(request, reply);
    if (!user) return;

    const access = await resolveStaffPermissionAccess(
      rbacService,
      user.id,
      'recommendation.manage',
    );
    if (!access.granted) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.reactivate',
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const { id } = RuleIdParamSchema.parse(request.params);
    const body = ReactivateRuleBodySchema.parse(request.body);

    const existing = await recommendationService.getRuleById(id);
    if (!existing) {
      return reply.status(404).send({
        error: {
          code: 'RULE_NOT_FOUND',
          message: 'Recommendation rule not found.',
          requestId: request.id,
        },
      });
    }

    const authorizedForCountry =
      access.hasGlobalGrant || access.countryIds.includes(existing.countryId);
    if (!authorizedForCountry) {
      await logDeniedAttempt({
        user,
        action: 'recommendation.rule.reactivate',
        entityId: existing.id,
        countryId: existing.countryId,
        requestId: request.id,
      });
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }

    const userRoles =
      typeof rbacService.getUserRoles === 'function'
        ? await rbacService.getUserRoles(user.id)
        : [];
    const updated = await recommendationService.reactivateRule({
      ruleId: id,
      reason: body.reason,
      priority: body.priority,
      actor: {
        userId: user.id,
        roleSlug: userRoles[0]?.roleSlug,
        email: user.email,
        displayName: user.displayName,
        requestId: request.id,
      },
    });

    return reply.status(200).send({ data: updated });
  });

  /**
   * 7. Permanent Hard-Delete Prohibition
   * DELETE /api/v1/admin/recommendations/rules/:id -> 405 Method Not Allowed
   */
  fastify.delete('/admin/recommendations/rules/:id', async (request, reply) => {
    reply.header('Allow', 'GET, POST');
    return reply.status(405).send({
      error: {
        code: 'HARD_DELETE_DISALLOWED',
        message:
          'Physical deletion of editorial recommendation rules is permanently disallowed; deactivate rules via POST /api/v1/admin/recommendations/rules/:id/deactivate.',
        requestId: request.id,
      },
    });
  });
};
