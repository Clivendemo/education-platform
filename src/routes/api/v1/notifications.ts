import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  type NotificationService,
  defaultNotificationService,
  NotificationError,
} from '../../../services/notification.service.js';
import {
  type AuthService,
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  type RbacService,
  defaultRbacService,
} from '../../../services/rbac.service.js';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_STATUSES,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
} from '../../../db/schemas.js';

export interface NotificationRoutesOptions {
  notificationService?: NotificationService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const IdParamSchema = z.object({
  id: z.string().uuid('Id must be a valid UUID'),
});

const ListUserNotificationsQuerySchema = z.object({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const UpdatePreferencesBodySchema = z.object({
  emailEnabled: z.boolean().optional(),
  marketingEmailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
});

const ListAdminDeliveriesQuerySchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  channel: z.enum(DELIVERY_CHANNELS).optional(),
  notificationId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ProcessPendingBodySchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(200).default(50).optional(),
});

export const notificationRoutes: FastifyPluginAsync<NotificationRoutesOptions> = async (
  fastify,
  opts,
) => {
  const notificationService =
    opts.notificationService ?? defaultNotificationService;
  const authService = opts.authService ?? defaultAuthService;
  const rbacService = opts.rbacService ?? defaultRbacService;

  // Register worker cleanup on Fastify close
  fastify.addHook('onClose', async () => {
    notificationService.stopWorker();
  });

  // Helper: Authenticate session
  async function requireAuth(request: any, reply: any) {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required to access notifications',
          requestId: request.id,
        },
      });
      return null;
    }

    const validation = await authService.validateSession(sessionToken);
    if (!validation) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Invalid or expired session token',
          requestId: request.id,
        },
      });
      return null;
    }

    return validation.user;
  }

  // 1. GET /me/notifications
  fastify.get('/me/notifications', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const queryResult = ListUserNotificationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.issues[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const result = await notificationService.listUserNotifications(
      user.id,
      queryResult.data,
    );

    return reply.status(200).send({
      data: result,
    });
  });

  // 2. POST /me/notifications/:id/read
  fastify.post('/me/notifications/:id/read', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: paramResult.error.issues[0]?.message || 'Notification id must be a valid UUID',
          requestId: request.id,
        },
      });
    }

    try {
      const updated = await notificationService.markAsRead(
        user.id,
        paramResult.data.id,
      );
      return reply.status(200).send({
        data: updated,
      });
    } catch (err: any) {
      if (err instanceof NotificationError) {
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

  // 3. POST /me/notifications/read-all
  fastify.post('/me/notifications/read-all', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const result = await notificationService.markAllAsRead(user.id);
    return reply.status(200).send({
      data: result,
    });
  });

  // 4. POST /me/notifications/:id/archive
  fastify.post('/me/notifications/:id/archive', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: paramResult.error.issues[0]?.message || 'Notification id must be a valid UUID',
          requestId: request.id,
        },
      });
    }

    try {
      const updated = await notificationService.archiveNotification(
        user.id,
        paramResult.data.id,
      );
      return reply.status(200).send({
        data: updated,
      });
    } catch (err: any) {
      if (err instanceof NotificationError) {
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

  // 5. GET /me/notification-preferences
  fastify.get('/me/notification-preferences', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const prefs = await notificationService.getUserPreferences(user.id);
    return reply.status(200).send({
      data: prefs,
    });
  });

  // 6. PATCH /me/notification-preferences
  fastify.patch('/me/notification-preferences', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const bodyResult = UpdatePreferencesBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.issues[0]?.message || 'Invalid preferences payload',
          requestId: request.id,
        },
      });
    }

    const updated = await notificationService.updateUserPreferences(
      user.id,
      bodyResult.data,
    );

    return reply.status(200).send({
      data: updated,
    });
  });

  // 7. GET /admin/notifications (Staff Audit Queue)
  fastify.get('/admin/notifications', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const authorized = await rbacService.hasPermission(
      user.id,
      'notification.admin.read',
    );
    if (!authorized) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to view administrative notifications',
          requestId: request.id,
        },
      });
    }

    const queryResult = ListAdminDeliveriesQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.issues[0]?.message || 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const result = await notificationService.listAdminDeliveries(queryResult.data);
    return reply.status(200).send({
      data: result,
    });
  });

  // 8. POST /admin/notifications/process-pending (Outbox Worker Sweep)
  fastify.post('/admin/notifications/process-pending', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const authorized = await rbacService.hasPermission(
      user.id,
      'notification.admin.manage',
    );
    if (!authorized) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to trigger notification delivery sweeps',
          requestId: request.id,
        },
      });
    }

    const bodyResult = ProcessPendingBodySchema.safeParse(request.body ?? {});
    const batchSize = bodyResult.success ? bodyResult.data.batchSize : 50;

    const result = await notificationService.processPendingDeliveries(batchSize);
    return reply.status(200).send({
      data: result,
    });
  });
};
