import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import { env } from '../config/env.js';
import { defaultAuthService, type AuthService, type SafeUser } from '../services/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SafeUser | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  authService?: AuthService;
}

async function authPluginAsync(fastify: FastifyInstance, opts: AuthPluginOptions = {}) {
  const authService = opts.authService ?? defaultAuthService;

  // 1. Register Fastify Cookie plugin without signing (token itself is cryptographically secure)
  await fastify.register(cookie);

  // 2. Decorate Fastify request with user property
  fastify.decorateRequest('user', null);

  // 3. Global preHandler hook to parse session cookie and resolve request.user
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const sessionToken = request.cookies[env.SESSION_COOKIE_NAME];
    if (sessionToken && typeof sessionToken === 'string') {
      try {
        const user = await authService.validateSession(sessionToken);
        request.user = user;
      } catch {
        request.user = null;
      }
    } else {
      request.user = null;
    }
  });

  // 4. Decorate authenticate method for route-level authorization gates
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required. Please sign in to access this resource.',
            requestId: request.id,
          },
        });
      }
    },
  );
}

export const authPlugin = fp(authPluginAsync, {
  name: 'auth-plugin',
  fastify: '5.x',
});
