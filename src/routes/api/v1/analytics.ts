import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  defaultAnalyticsService,
  type AnalyticsService,
  AnalyticsError,
} from '../../../services/analytics.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';

export interface AnalyticsRouteOptions {
  analyticsService?: AnalyticsService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const IngestEventBodySchema = z
  .object({
    eventCode: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9_]{2,32}$/, 'eventCode must be lowercase alphanumeric with underscores'),
    idempotencyKey: z.string().min(1).max(128).optional(),
    country: z.string().min(1).max(100).optional(),
    entityType: z.string().min(1).max(32).optional(),
    entityId: z.string().uuid().optional(),
    anonymousSessionId: z.string().min(1).max(128).optional(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

const OverviewQuerySchema = z.object({
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO 8601 date string' }),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO 8601 date string' }),
  eventCode: z.string().min(1).max(32).optional(),
  country: z.string().min(1).max(100).optional(),
});

const UpdateEventTypeParamSchema = z.object({
  id: z.string().uuid({ message: 'Event type ID must be a valid UUID' }),
});

const UpdateEventTypeBodySchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']),
  })
  .strict();

export const analyticsRoutes: FastifyPluginAsync<AnalyticsRouteOptions> = async (
  fastify,
  opts,
) => {
  const analyticsService = opts.analyticsService || defaultAnalyticsService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  // Route-scoped error handler
  fastify.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AnalyticsError) {
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

  // Helper for auth validation
  const getAuthenticatedUser = async (request: FastifyRequest) => {
    const directUser = (request as any).user;
    if (directUser?.id) return directUser;

    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;

    const rawToken =
      request.cookies?.[SESSION_COOKIE_NAME] ||
      cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

    if (!rawToken) return null;

    try {
      const sessionResult = await authService.validateSession(rawToken.trim());
      return sessionResult ? sessionResult.user : null;
    } catch {
      return null;
    }
  };

  // Helper for client IP determination
  const getClientIp = (request: FastifyRequest): string => {
    if (process.env.TRUST_PROXY === 'true' || (fastify as any).initialConfig?.trustProxy) {
      const xff = request.headers['x-forwarded-for'];
      if (typeof xff === 'string') {
        const parts = xff.split(',').map((p) => p.trim());
        if (parts.length > 0 && parts[0]) return parts[0];
      }
    }
    return (request as any).ip || request.raw?.socket?.remoteAddress || '127.0.0.1';
  };

  /**
   * POST /api/v1/analytics/events
   * Public ingestion endpoint with rate-limiting, strict validation, and synchronous persistence.
   */
  fastify.post('/analytics/events', async (request, reply) => {
    const clientIp = getClientIp(request);
    const rateCheck = analyticsService.checkRateLimit(`ip:${clientIp}`);

    reply.header('x-ratelimit-remaining', rateCheck.remaining);
    reply.header('x-ratelimit-reset', Math.ceil(rateCheck.resetAt / 1000));

    if (!rateCheck.allowed) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Ingestion rate limit exceeded. Please try again later.',
          requestId: request.id,
        },
      });
    }

    const body = IngestEventBodySchema.parse(request.body);
    const user = await getAuthenticatedUser(request);

    // Compute or extract anonymous session hash
    let sessionHash: string | null = null;
    const rawAnonSession =
      body.anonymousSessionId ||
      (request.headers['x-anonymous-session-id'] as string) ||
      request.cookies?.['elimu_anon_sid'];

    if (rawAnonSession) {
      sessionHash = crypto.createHash('sha256').update(rawAnonSession.trim()).digest('hex');
    } else if (!user) {
      // Deterministic anonymous fingerprint if client did not supply one
      const ua = (request.headers['user-agent'] as string) || 'unknown';
      const fp = `${clientIp}:${ua}`;
      sessionHash = crypto.createHash('sha256').update(fp).digest('hex');
    }

    const result = await analyticsService.recordEvent({
      eventCode: body.eventCode,
      actorType: user ? 'AUTHENTICATED' : 'ANONYMOUS',
      userId: user ? user.id : null,
      anonymousSessionHash: sessionHash,
      idempotencyKey: body.idempotencyKey || null,
      country: body.country || null,
      entityType: body.entityType || null,
      entityId: body.entityId || null,
      context: body.context || {},
      occurredAt: new Date(),
    });

    return reply.status(200).send({
      data: result,
    });
  });

  /**
   * GET /api/v1/admin/analytics/overview
   * Protected administrative metrics overview report. Requires 'analytics.read'.
   */
  fastify.get('/admin/analytics/overview', async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to access analytics overview',
          requestId: request.id,
        },
      });
    }

    const hasPerm = await rbacService.hasPermission(user.id, 'analytics.read');
    if (!hasPerm) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to view analytics',
          requestId: request.id,
        },
      });
    }

    const query = OverviewQuerySchema.parse(request.query);
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const metrics = await analyticsService.getOverviewMetrics({
      startDate,
      endDate,
      eventCode: query.eventCode,
      country: query.country,
    });

    return reply.status(200).send({
      data: metrics,
    });
  });

  /**
   * GET /api/v1/admin/analytics/event-types
   * Lists configurable event types. Requires 'analytics.manage'.
   */
  fastify.get('/admin/analytics/event-types', async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          requestId: request.id,
        },
      });
    }

    const hasPerm = await rbacService.hasPermission(user.id, 'analytics.manage');
    if (!hasPerm) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to manage analytics event types',
          requestId: request.id,
        },
      });
    }

    const types = await analyticsService.listEventTypes();
    return reply.status(200).send({
      data: types,
    });
  });

  /**
   * PATCH /api/v1/admin/analytics/event-types/:id
   * Updates event type status. Requires 'analytics.manage'.
   */
  fastify.patch('/admin/analytics/event-types/:id', async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          requestId: request.id,
        },
      });
    }

    const hasPerm = await rbacService.hasPermission(user.id, 'analytics.manage');
    if (!hasPerm) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to manage analytics event types',
          requestId: request.id,
        },
      });
    }

    const params = UpdateEventTypeParamSchema.parse(request.params);
    const body = UpdateEventTypeBodySchema.parse(request.body);

    const updated = await analyticsService.updateEventTypeStatus(params.id, body.status);
    return reply.status(200).send({
      data: updated,
    });
  });
};
