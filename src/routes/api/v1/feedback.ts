import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultFeedbackService,
  type FeedbackService,
  FeedbackError,
  FEEDBACK_SESSION_COOKIE_NAME,
  FEEDBACK_COOKIE_MAX_AGE_SECONDS,
  hashFeedbackSessionToken,
} from '../../../services/feedback.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import { createRequireAuth } from './auth.js';
import { createRequirePermission } from '../../hooks/authorize.js';
import { FEEDBACK_TYPES, FEEDBACK_STATUSES } from '../../../db/schemas.js';

export interface FeedbackRoutesOptions {
  feedbackService?: FeedbackService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const IdParamSchema = z.object({
  id: z.string().uuid('Id must be a valid UUID'),
});

const SubmitFeedbackBodySchema = z.object({
  resourceVersionId: z.string().uuid('resourceVersionId must be a valid UUID'),
  feedbackType: z.enum(FEEDBACK_TYPES, {
    errorMap: () => ({
      message: `feedbackType must be one of: ${FEEDBACK_TYPES.join(', ')}`,
    }),
  }),
  details: z
    .string()
    .trim()
    .max(1000, 'details cannot exceed 1000 characters')
    .optional()
    .nullable(),
});

const ListFeedbackQuerySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  resourceId: z.string().uuid('resourceId must be a valid UUID').optional(),
  resourceVersionId: z.string().uuid('resourceVersionId must be a valid UUID').optional(),
  feedbackType: z.enum(FEEDBACK_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const TriageFeedbackBodySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES, {
    errorMap: () => ({
      message: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`,
    }),
  }),
  internalNote: z
    .string()
    .trim()
    .max(2000, 'internalNote cannot exceed 2000 characters')
    .optional()
    .nullable(),
});

export const feedbackRoutes: FastifyPluginAsync<FeedbackRoutesOptions> = async (
  fastify,
  options,
) => {
  const feedbackService = options.feedbackService || defaultFeedbackService;
  const authService = options.authService || defaultAuthService;
  const rbacService = options.rbacService || defaultRbacService;

  const requireAuth = createRequireAuth(authService);
  const requireFeedbackRead = createRequirePermission(rbacService, 'feedback.read');
  const requireFeedbackManage = createRequirePermission(rbacService, 'feedback.manage');

  /**
   * POST /resources/:id/feedback
   * Public submission of structured feedback for a resource.
   * Supports authenticated users and anonymous visitors with server-issued HttpOnly session cookie.
   */
  fastify.post('/resources/:id/feedback', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: paramResult.error.issues[0]?.message || 'Resource id must be a valid UUID',
          requestId: request.id,
        },
      });
    }

    const bodyResult = SubmitFeedbackBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.issues[0]?.message || 'Invalid feedback payload',
          requestId: request.id,
        },
      });
    }

    const resourceId = paramResult.data.id;
    const { resourceVersionId, feedbackType, details } = bodyResult.data;

    let userId: string | null = null;
    let sessionId: string | null = null;

    // 1. Check for authenticated user session
    const authSessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (authSessionToken) {
      const authValidation = await authService.validateSession(authSessionToken);
      if (authValidation) {
        userId = authValidation.user.id;
      }
    }

    // 2. If not authenticated, identify via server-controlled anonymous cookie
    if (!userId) {
      let rawSid = request.cookies[FEEDBACK_SESSION_COOKIE_NAME];
      if (!rawSid || typeof rawSid !== 'string' || rawSid.trim().length === 0) {
        rawSid = crypto.randomUUID();
        reply.setCookie(FEEDBACK_SESSION_COOKIE_NAME, rawSid, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: FEEDBACK_COOKIE_MAX_AGE_SECONDS,
        });
      }

      sessionId = hashFeedbackSessionToken(rawSid);
    }

    try {
      const result = await feedbackService.submitFeedback({
        resourceId,
        resourceVersionId,
        feedbackType,
        details,
        userId,
        sessionId,
      });

      return reply.status(201).send({
        data: result,
      });
    } catch (err: any) {
      if (err instanceof FeedbackError) {
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

  /**
   * GET /catalogue/resources/:id/feedback-summary
   * Public aggregate feedback metrics (totalFeedback and helpfulCount).
   * Exposes zero confidential feedback rows, defect categories, or staff notes.
   */
  fastify.get('/catalogue/resources/:id/feedback-summary', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'Resource id must be a valid UUID',
          requestId: request.id,
        },
      });
    }

    try {
      const summary = await feedbackService.getPublicSummary(paramResult.data.id);
      return reply.status(200).send({
        data: summary,
      });
    } catch (err: any) {
      if (err instanceof FeedbackError) {
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

  /**
   * GET /admin/feedback
   * Staff queue: List and filter feedback entries.
   * Access: content_reviewer (read-only), content_manager, system_admin.
   */
  fastify.get(
    '/admin/feedback',
    { preHandler: [requireAuth, requireFeedbackRead] },
    async (request, reply) => {
      const queryResult = ListFeedbackQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: queryResult.error.issues[0]?.message || 'Invalid query parameters',
            requestId: request.id,
          },
        });
      }

      const result = await feedbackService.listFeedbackQueue(queryResult.data);
      return reply.status(200).send(result);
    },
  );

  /**
   * GET /admin/feedback/:id
   * Staff detail: View feedback entry with complete audit event history.
   * Access: content_reviewer (read-only), content_manager, system_admin.
   */
  fastify.get(
    '/admin/feedback/:id',
    { preHandler: [requireAuth, requireFeedbackRead] },
    async (request, reply) => {
      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ID_FORMAT',
            message: 'Feedback id must be a valid UUID',
            requestId: request.id,
          },
        });
      }

      try {
        const result = await feedbackService.getFeedbackById(paramResult.data.id);
        return reply.status(200).send({
          data: result,
        });
      } catch (err: any) {
        if (err instanceof FeedbackError) {
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

  /**
   * PATCH /admin/feedback/:id/triage
   * Staff triage action: Transition feedback status with mandatory audit event.
   * Access: content_manager, system_admin (content_reviewer is strictly 403 Forbidden).
   */
  fastify.patch(
    '/admin/feedback/:id/triage',
    { preHandler: [requireAuth, requireFeedbackManage] },
    async (request, reply) => {
      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ID_FORMAT',
            message: 'Feedback id must be a valid UUID',
            requestId: request.id,
          },
        });
      }

      const bodyResult = TriageFeedbackBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyResult.error.issues[0]?.message || 'Invalid triage payload',
            requestId: request.id,
          },
        });
      }

      try {
        const result = await feedbackService.triageFeedback({
          feedbackId: paramResult.data.id,
          toStatus: bodyResult.data.status,
          actorUserId: request.user!.id,
          internalNote: bodyResult.data.internalNote,
        });

        return reply.status(200).send({
          data: result,
        });
      } catch (err: any) {
        if (err instanceof FeedbackError) {
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
