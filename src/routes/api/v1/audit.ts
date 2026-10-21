import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  defaultAuditService,
  type AuditService,
} from '../../../services/audit.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';

export interface AuditRouteOptions {
  auditService?: AuditService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const AuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  action: z.string().min(1).max(64).optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  requestId: z.string().min(1).max(64).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const AuditLogParamsSchema = z.object({
  id: z.string().uuid({ message: 'Audit log ID must be a valid UUID' }),
});

export const auditRoutes: FastifyPluginAsync<AuditRouteOptions> = async (fastify, opts) => {
  const auditService = opts.auditService || defaultAuditService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  // Helper to authenticate request
  async function authenticateUser(req: FastifyRequest, reply: FastifyReply) {
    const sessionToken = req.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      reply.status(401).send({ success: false, error: 'Authentication required' });
      return null;
    }

    const session = await authService.validateSession(sessionToken);
    if (!session || !session.user) {
      reply.status(401).send({ success: false, error: 'Invalid or expired session' });
      return null;
    }

    return session.user;
  }

  // GET /admin/audit-logs
  fastify.get('/admin/audit-logs', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'audit.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: audit.read required' });
    }

    const parseResult = AuditLogsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: parseResult.error.flatten(),
      });
    }

    const result = await auditService.getAuditLogs(parseResult.data);
    return reply.status(200).send({
      success: true,
      data: result.logs,
      pagination: result.pagination,
    });
  });

  // GET /admin/audit-logs/:id
  fastify.get('/admin/audit-logs/:id', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'audit.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: audit.read required' });
    }

    const parseParams = AuditLogParamsSchema.safeParse(req.params);
    if (!parseParams.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: parseParams.error.flatten(),
      });
    }

    const log = await auditService.getAuditLogById(parseParams.data.id);
    if (!log) {
      return reply.status(404).send({ success: false, error: 'Audit log not found' });
    }

    return reply.status(200).send({
      success: true,
      data: log,
    });
  });
};
