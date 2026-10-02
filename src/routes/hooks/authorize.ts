import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RbacService, ScopeFilter } from '../../services/rbac.service.js';

export interface RequirePermissionOptions {
  scopeResolver?: (request: FastifyRequest) => ScopeFilter | Promise<ScopeFilter>;
}

/**
 * Standard generic error message for 403 Forbidden responses (Prompt 14 Correction 2).
 * Strictly prevents leaking internal permission keys or schema details to clients.
 */
export const GENERIC_FORBIDDEN_MESSAGE =
  'You do not have permission to perform this action.';

/**
 * Creates a reusable Fastify preHandler hook ensuring the authenticated user
 * holds the specified permission (respecting GLOBAL vs scoped semantics).
 */
export function createRequirePermission(
  rbacService: RbacService,
  requiredPermission: string,
  options?: RequirePermissionOptions,
) {
  return async function requirePermission(
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

    let scope: ScopeFilter | undefined;
    if (options?.scopeResolver) {
      scope = await options.scopeResolver(request);
    }

    const authorized = await rbacService.hasPermission(
      request.user.id,
      requiredPermission,
      scope,
    );

    if (!authorized) {
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
