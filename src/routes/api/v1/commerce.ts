import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CommerceService,
  defaultCommerceService,
} from '../../../services/commerce/commerce.service.js';
import {
  CommerceError,
} from '../../../services/commerce/commerce.interface.js';
import {
  AuthService,
  defaultAuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import {
  defaultAuditService,
  type AuditService,
} from '../../../services/audit.service.js';
import { env } from '../../../config/env.js';
import { createRequireAuth } from './auth.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../../hooks/authorize.js';
import {
  MPESA_WEBHOOK_BODY_LIMIT_BYTES,
  MpesaWebhookRateLimiter,
  defaultMpesaWebhookRateLimiter,
  registerRawDecimalWebhookJsonParser,
  createMpesaWebhookPreHandler,
} from '../../middleware/mpesa-webhook-guard.js';
import {
  type BoundedConcurrencyRegistry,
  defaultConcurrencyRegistry,
} from '../../../services/rate-limit.service.js';

export interface CommerceRouteOptions {
  commerceService?: CommerceService;
  authService?: AuthService;
  rbacService?: RbacService;
  auditService?: AuditService;
  webhookRateLimiter?: MpesaWebhookRateLimiter;
  enableLegacyCallbackAlias?: boolean;
  concurrencyRegistry?: BoundedConcurrencyRegistry;
}

const CheckoutItemSchema = z.object({
  offerId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

const CheckoutBodySchema = z.object({
  items: z.array(CheckoutItemSchema).min(1, 'At least one item is required'),
  idempotencyKey: z.string().max(100).optional(),
});

const InitiatePaymentSchema = z.object({
  orderId: z.string().uuid(),
  providerCode: z.string().max(50).default('MPESA'),
  phoneNumber: z.string().max(50).optional(),
});

const ReconciliationQueueQuerySchema = z.object({
  status: z
    .enum(['RECONCILIATION_REQUIRED', 'PROCESSING', 'FAILED'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

const PaymentIdParamSchema = z.object({
  paymentId: z.string().uuid(),
});

const ResolveReconciliationBodySchema = z.object({
  outcome: z.enum(['COMPLETE_WITH_RECEIPT', 'MARK_FAILED', 'MARK_CANCELLED']),
  verifiedReceiptNumber: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(5).max(500),
});

function createRequireSystemFinanceAdmin(rbacService: RbacService) {
  return async function requireSystemFinanceAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
    }

    // Require active global system_admin / finance permission (`contributor.finance.manage` is exclusively system_admin)
    const hasFinancePerm = await rbacService.hasPermission(
      request.user.id,
      'contributor.finance.manage',
    );
    const activeRoles = await rbacService.getUserRoles(request.user.id);
    const hasGlobalSystemAdmin = activeRoles.some(
      (r) => r.roleSlug === 'system_admin' && r.scopeType === null && r.scopeId === null,
    );

    if (!hasFinancePerm || !hasGlobalSystemAdmin) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: GENERIC_FORBIDDEN_MESSAGE,
          requestId: request.id,
        },
      });
    }
  };
}

export const commerceRoutes: FastifyPluginAsync<CommerceRouteOptions> = async (
  fastify,
  opts,
) => {
  const commerceService = opts.commerceService ?? defaultCommerceService;
  const authService = opts.authService ?? defaultAuthService;
  const rbacService = opts.rbacService ?? defaultRbacService;
  const auditService = opts.auditService ?? defaultAuditService;
  const webhookRateLimiter = opts.webhookRateLimiter ?? defaultMpesaWebhookRateLimiter;
  const concurrencyRegistry = opts.concurrencyRegistry ?? defaultConcurrencyRegistry;
  const enableLegacyAlias =
    opts.enableLegacyCallbackAlias ?? env.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS;

  const requireAuth = createRequireAuth(authService);
  const requireSystemFinanceAdmin = createRequireSystemFinanceAdmin(rbacService);

  // Map Commerce domain errors to controlled HTTP error responses
  fastify.setErrorHandler((error: any, request, reply) => {
    if (error instanceof CommerceError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.errors[0]?.message || 'Validation failed.',
          details: error.flatten(),
          requestId: request.id,
        },
      });
    }

    if (error?.statusCode === 413 || error?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Webhook payload exceeds 32 KiB limit.',
          requestId: request.id,
        },
      });
    }

    if (error?.code === 'INVALID_CALLBACK_PAYLOAD') {
      return reply.status(400).send({
        error: {
          code: 'INVALID_CALLBACK_PAYLOAD',
          message: 'Invalid payment callback JSON payload.',
          requestId: request.id,
        },
      });
    }

    throw error;
  });

  // 1. GET /products — Public Product Catalog with Active Offers
  fastify.get('/products', async (_request, reply) => {
    const productsList = await commerceService.getActiveProducts();
    return reply.status(200).send({ data: productsList });
  });

  // 2. GET /products/:id — Public Product Details
  fastify.get<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const product = await commerceService.getProductById(id);
    return reply.status(200).send({ data: product });
  });

  // 3. POST /checkout — Authenticated Order Creation (Server-calculated total)
  fastify.post(
    '/checkout',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const body = CheckoutBodySchema.parse(request.body);
      const order = await commerceService.createOrder(user.id, body);
      return reply.status(201).send({ data: order });
    },
  );

  // 4. GET /orders/:id — Authenticated Order Retrieval (User-Isolated)
  fastify.get<{ Params: { id: string } }>(
    '/orders/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = IdParamSchema.parse(request.params);
      const order = await commerceService.getOrderById(user.id, id);
      return reply.status(200).send({ data: order });
    },
  );

  // 5. GET /me/orders — Current User's Orders
  fastify.get(
    '/me/orders',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const userOrders = await commerceService.getUserOrders(user.id);
      return reply.status(200).send({ data: userOrders });
    },
  );

  // 6. GET /me/entitlements — Current User's Active Entitlements
  fastify.get(
    '/me/entitlements',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const userEntitlements = await commerceService.getUserEntitlements(user.id);
      return reply.status(200).send({ data: userEntitlements });
    },
  );

  // 7. POST /payments — Initiate Payment for an Order (`commerce_payment_initiate` semaphore, non-abortable on disconnect)
  fastify.post(
    '/payments',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const body = InitiatePaymentSchema.parse(request.body);
      const result = await concurrencyRegistry.runWithPermit(
        'commerce_payment_initiate',
        { actorKey: user.id, request, reply },
        () =>
          commerceService.initiatePayment(
            user.id,
            body.orderId,
            body.providerCode,
            body.phoneNumber ? { phoneNumber: body.phoneNumber } : undefined,
          ),
      );
      return reply.status(201).send({ data: result });
    },
  );

  // 8. GET /payments/:id — Retrieve Redacted Learner Payment Status
  fastify.get<{ Params: { id: string } }>(
    '/payments/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = IdParamSchema.parse(request.params);
      const payment = await commerceService.getPaymentById(user.id, id);
      return reply.status(200).send({ data: payment });
    },
  );

  // 9. W1-AC-03: POST /payments/:id/simulate-success
  // Completely UNMOUNTED in production or when simulation is disabled (`404 NOT_FOUND`).
  // When explicitly enabled in non-production, strictly requires `system_admin` (`403 FORBIDDEN` for learners).
  if (commerceService.isSimulationEnabled()) {
    fastify.post<{ Params: { id: string } }>(
      '/payments/:id/simulate-success',
      { preHandler: [requireAuth, requireSystemFinanceAdmin] },
      async (request, reply) => {
        const { id } = IdParamSchema.parse(request.params);
        const result = await commerceService.processPaymentSuccess({
          paymentId: id,
          providerTransactionId: `SIM-TXN-${Date.now()}`,
        });

        await auditService.logEvent({
          action: 'PAYMENT_SIMULATION_COMPLETED',
          entityType: 'PAYMENT',
          entityId: id,
          actorType: 'AUTHENTICATED',
          actorUserId: request.user!.id,
          actorSnapshot: {
            actorId: request.user!.id,
            actorType: 'AUTHENTICATED',
            actorRole: 'system_admin',
          },
          outcome: 'SUCCESS',
          requestId: request.id.slice(0, 64),
          afterState: {
            paymentStatus: result.payment.status,
            orderId: result.order.id,
          },
        });

        return reply.status(200).send({ data: result });
      },
    );
  }

  // 10. W1-AC-06: Administrative M-Pesa Reconciliation Endpoints (`system_admin` only)
  fastify.get(
    '/admin/commerce/payments/reconciliation-queue',
    { preHandler: [requireAuth, requireSystemFinanceAdmin] },
    async (request, reply) => {
      const query = ReconciliationQueueQuerySchema.parse(request.query ?? {});
      const data = await commerceService.listReconciliationQueue(query);
      return reply.status(200).send({ data });
    },
  );

  fastify.post(
    '/admin/commerce/payments/:paymentId/requeue-verification',
    { preHandler: [requireAuth, requireSystemFinanceAdmin] },
    async (request, reply) => {
      const { paymentId } = PaymentIdParamSchema.parse(request.params);
      const updated = await commerceService.requeuePaymentVerification(paymentId);

      await auditService.logEvent({
        action: 'PAYMENT_VERIFICATION_REQUEUED',
        entityType: 'PAYMENT',
        entityId: paymentId,
        actorType: 'AUTHENTICATED',
        actorUserId: request.user!.id,
        actorSnapshot: {
          actorId: request.user!.id,
          actorType: 'AUTHENTICATED',
          actorRole: 'system_admin',
        },
        outcome: 'SUCCESS',
        requestId: request.id.slice(0, 64),
        afterState: {
          status: updated.status,
          verificationAttempts: updated.verificationAttempts,
        },
      });

      return reply.status(200).send({ data: updated });
    },
  );

  fastify.post(
    '/admin/commerce/payments/:paymentId/resolve-reconciliation',
    { preHandler: [requireAuth, requireSystemFinanceAdmin] },
    async (request, reply) => {
      const { paymentId } = PaymentIdParamSchema.parse(request.params);
      const body = ResolveReconciliationBodySchema.parse(request.body);

      const resolved = await commerceService.resolvePaymentReconciliation({
        paymentId,
        outcome: body.outcome,
        verifiedReceiptNumber: body.verifiedReceiptNumber,
        reason: body.reason,
        actorUserId: request.user!.id,
      });

      await auditService.logEvent({
        action: 'PAYMENT_RECONCILIATION_RESOLVED',
        entityType: 'PAYMENT',
        entityId: paymentId,
        actorType: 'AUTHENTICATED',
        actorUserId: request.user!.id,
        actorSnapshot: {
          actorId: request.user!.id,
          actorType: 'AUTHENTICATED',
          actorRole: 'system_admin',
        },
        outcome: 'SUCCESS',
        requestId: request.id.slice(0, 64),
        afterState: {
          outcome: body.outcome,
          status: resolved.payment.status,
          verifiedReceiptNumber: resolved.payment.verifiedReceiptNumber,
          receiptVerificationSource: resolved.payment.receiptVerificationSource,
        },
        context: {
          reasonPreview: body.reason.slice(0, 200),
          entitlementsGranted: resolved.entitlementsGranted,
        },
      });

      return reply.status(200).send({ data: resolved });
    },
  );

  // 11. W1-AC-08: Canonical Encapsulated M-Pesa Webhook Sub-Plugin
  // Enforces 32 KiB bodyLimit, raw-string decimal lexeme parser, and bounded-LRU IP rate limiting.
  await fastify.register(async (webhookScope) => {
    registerRawDecimalWebhookJsonParser(webhookScope);
    const webhookGuard = createMpesaWebhookPreHandler(webhookRateLimiter);

    const handleMpesaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await commerceService.handleMpesaCallback(request.body);
      return reply.status(200).send(response.ack);
    };

    webhookScope.post(
      '/commerce/webhooks/mpesa',
      {
        bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES,
        preHandler: [webhookGuard],
      },
      handleMpesaWebhook,
    );

    if (enableLegacyAlias) {
      webhookScope.post(
        '/payments/mpesa/callback',
        {
          bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES,
          preHandler: [webhookGuard],
        },
        handleMpesaWebhook,
      );
      webhookScope.post(
        '/mpesa/callback',
        {
          bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES,
          preHandler: [webhookGuard],
        },
        handleMpesaWebhook,
      );
    }
  });
};
