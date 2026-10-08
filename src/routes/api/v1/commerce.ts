import type { FastifyPluginAsync } from 'fastify';
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
import { createRequireAuth } from './auth.js';

export interface CommerceRouteOptions {
  commerceService?: CommerceService;
  authService?: AuthService;
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
  providerCode: z.string().max(50).default('SIMULATION'),
  phoneNumber: z.string().max(50).optional(),
});

export const commerceRoutes: FastifyPluginAsync<CommerceRouteOptions> = async (
  fastify,
  opts,
) => {
  const commerceService = opts.commerceService ?? defaultCommerceService;
  const authService = opts.authService ?? defaultAuthService;
  const requireAuth = createRequireAuth(authService);

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

    throw error;
  });

  // 1. GET /products — Public Product Catalog with Active Offers
  fastify.get('/products', async (_request, reply) => {
    const productsList = await commerceService.getActiveProducts();
    return reply.status(200).send({ data: productsList });
  });

  // 2. GET /products/:id — Public Product Details
  fastify.get<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const { id } = request.params;
    const product = await commerceService.getProductById(id);
    return reply.status(200).send({ data: product });
  });

  // 3. POST /checkout — Authenticated Order Creation (Server-calculated total)
  fastify.post(
    '/checkout',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
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
      const user = (request as any).user;
      const { id } = request.params;
      const order = await commerceService.getOrderById(user.id, id);
      return reply.status(200).send({ data: order });
    },
  );

  // 5. GET /me/orders — Current User's Orders
  fastify.get(
    '/me/orders',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const userOrders = await commerceService.getUserOrders(user.id);
      return reply.status(200).send({ data: userOrders });
    },
  );

  // 6. GET /me/entitlements — Current User's Active Entitlements
  fastify.get(
    '/me/entitlements',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const userEntitlements = await commerceService.getUserEntitlements(user.id);
      return reply.status(200).send({ data: userEntitlements });
    },
  );

  // 7. POST /payments — Initiate Payment for an Order
  fastify.post(
    '/payments',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const body = InitiatePaymentSchema.parse(request.body);
      const result = await commerceService.initiatePayment(
        user.id,
        body.orderId,
        body.providerCode,
        body.phoneNumber ? { phoneNumber: body.phoneNumber } : undefined,
      );
      return reply.status(201).send({ data: result });
    },
  );

  // 8. GET /payments/:id — Retrieve Payment Status
  fastify.get<{ Params: { id: string } }>(
    '/payments/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const { id } = request.params;
      const payment = await commerceService.getPaymentById(user.id, id);
      return reply.status(200).send({ data: payment });
    },
  );

  // 9. POST /payments/:id/simulate-success — Complete Simulated Payment (Prompt 18 Foundation Path)
  // No client-declared status: uses processPaymentSuccess verification path (Correction 8)
  fastify.post<{ Params: { id: string } }>(
    '/payments/:id/simulate-success',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const { id } = request.params;

      // Verify user owns the payment/order
      await commerceService.getPaymentById(user.id, id);

      // Process payment through provider verification flow
      const result = await commerceService.processPaymentSuccess({
        paymentId: id,
        providerTransactionId: `SIM-TXN-${Date.now()}`,
      });

      return reply.status(200).send({ data: result });
    },
  );

  // 10. POST /payments/mpesa/callback & POST /mpesa/callback — Safaricom Daraja STK Push Callback (Unauthenticated Provider Endpoint)
  const handleMpesaCallback = async (request: any, reply: any) => {
    const response = await commerceService.handleMpesaCallback(request.body);
    return reply.status(200).send(response.ack);
  };

  fastify.post('/payments/mpesa/callback', handleMpesaCallback);
  fastify.post('/mpesa/callback', handleMpesaCallback);
};
