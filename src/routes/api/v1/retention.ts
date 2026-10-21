import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  defaultRetentionService,
  type RetentionService,
  RetentionError,
} from '../../../services/retention.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';

export interface RetentionRouteOptions {
  retentionService?: RetentionService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const CreatePolicyBodySchema = z
  .object({
    policyCode: z.string().min(3).max(64),
    name: z.string().min(3).max(128),
    description: z.string().optional(),
    dataCategory: z.string().min(2).max(64),
    targetIdentifier: z.string().min(2).max(64),
    referencePoint: z.string().min(2).max(64),
    retentionDurationDays: z.number().int().positive(),
    disposition: z.enum(['DELETE', 'ANONYMIZE', 'ARCHIVE']),
    legalBasis: z.string().optional(),
  })
  .strict();

const UpdatePolicyBodySchema = z
  .object({
    name: z.string().min(3).max(128).optional(),
    description: z.string().optional(),
    retentionDurationDays: z.number().int().positive().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED']).optional(),
    changeReason: z.string().min(3, 'changeReason is required'),
  })
  .strict();

const DryRunBodySchema = z
  .object({
    policyId: z.string().uuid({ message: 'policyId must be a valid UUID' }),
  })
  .strict();

const ExecuteBodySchema = z
  .object({
    policyId: z.string().uuid({ message: 'policyId must be a valid UUID' }),
  })
  .strict();

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const PoliciesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED']).optional(),
  dataCategory: z.string().optional(),
});

const ExecutionsQuerySchema = z.object({
  policyId: z.string().uuid().optional(),
  status: z.enum(['RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const retentionRoutes: FastifyPluginAsync<RetentionRouteOptions> = async (fastify, opts) => {
  const retentionService = opts.retentionService || defaultRetentionService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

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

  // GET /admin/retention/policies
  fastify.get('/admin/retention/policies', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.read required' });
    }

    const parseQuery = PoliciesQuerySchema.safeParse(req.query);
    if (!parseQuery.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseQuery.error.flatten() });
    }

    const policies = await retentionService.getPolicies(parseQuery.data);
    return reply.status(200).send({ success: true, data: policies });
  });

  // POST /admin/retention/policies
  fastify.post('/admin/retention/policies', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.manage');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.manage required' });
    }

    const parseBody = CreatePolicyBodySchema.safeParse(req.body);
    if (!parseBody.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseBody.error.flatten() });
    }

    try {
      const created = await retentionService.createPolicy(parseBody.data, user.id);
      return reply.status(201).send({ success: true, data: created });
    } catch (err: any) {
      const statusCode = err instanceof RetentionError ? err.statusCode : 400;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  // GET /admin/retention/policies/:id
  fastify.get('/admin/retention/policies/:id', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.read required' });
    }

    const parseParams = IdParamSchema.safeParse(req.params);
    if (!parseParams.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseParams.error.flatten() });
    }

    const result = await retentionService.getPolicyById(parseParams.data.id);
    if (!result) {
      return reply.status(404).send({ success: false, error: 'Policy not found' });
    }

    return reply.status(200).send({ success: true, data: result });
  });

  // PATCH /admin/retention/policies/:id
  fastify.patch('/admin/retention/policies/:id', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.manage');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.manage required' });
    }

    const parseParams = IdParamSchema.safeParse(req.params);
    const parseBody = UpdatePolicyBodySchema.safeParse(req.body);

    if (!parseParams.success || !parseBody.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: {
          params: parseParams.success ? undefined : parseParams.error.flatten(),
          body: parseBody.success ? undefined : parseBody.error.flatten(),
        },
      });
    }

    try {
      const updated = await retentionService.updatePolicy(parseParams.data.id, parseBody.data, user.id);
      return reply.status(200).send({ success: true, data: updated });
    } catch (err: any) {
      const statusCode = err instanceof RetentionError ? err.statusCode : 400;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  // POST /admin/retention/dry-run
  fastify.post('/admin/retention/dry-run', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.read required' });
    }

    const parseBody = DryRunBodySchema.safeParse(req.body);
    if (!parseBody.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseBody.error.flatten() });
    }

    try {
      const result = await retentionService.dryRun(parseBody.data.policyId, user.id);
      return reply.status(200).send({ success: true, data: result });
    } catch (err: any) {
      const statusCode = err instanceof RetentionError ? err.statusCode : 400;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  // POST /admin/retention/execute
  fastify.post('/admin/retention/execute', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.execute');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.execute required' });
    }

    const parseBody = ExecuteBodySchema.safeParse(req.body);
    if (!parseBody.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseBody.error.flatten() });
    }

    try {
      const result = await retentionService.execute(parseBody.data.policyId, user.id);
      return reply.status(202).send({ success: true, data: result });
    } catch (err: any) {
      const statusCode = err instanceof RetentionError ? err.statusCode : 400;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  // GET /admin/retention/executions
  fastify.get('/admin/retention/executions', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.read required' });
    }

    const parseQuery = ExecutionsQuerySchema.safeParse(req.query);
    if (!parseQuery.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseQuery.error.flatten() });
    }

    const result = await retentionService.getExecutions(parseQuery.data);
    return reply.status(200).send({ success: true, data: result.executions, pagination: result.pagination });
  });

  // GET /admin/retention/executions/:id
  fastify.get('/admin/retention/executions/:id', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.read');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.read required' });
    }

    const parseParams = IdParamSchema.safeParse(req.params);
    if (!parseParams.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseParams.error.flatten() });
    }

    const execution = await retentionService.getExecutionById(parseParams.data.id);
    if (!execution) {
      return reply.status(404).send({ success: false, error: 'Execution not found' });
    }

    return reply.status(200).send({ success: true, data: execution });
  });

  // POST /admin/retention/executions/:id/recover
  fastify.post('/admin/retention/executions/:id/recover', async (req, reply) => {
    const user = await authenticateUser(req, reply);
    if (!user) return;

    const hasPermission = await rbacService.hasPermission(user.id, 'retention.execute');
    if (!hasPermission) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions: retention.execute required' });
    }

    const parseParams = IdParamSchema.safeParse(req.params);
    if (!parseParams.success) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: parseParams.error.flatten() });
    }

    try {
      const result = await retentionService.recover(parseParams.data.id, user.id);
      return reply.status(202).send({ success: true, data: result });
    } catch (err: any) {
      const statusCode = err instanceof RetentionError ? err.statusCode : 400;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });
};
