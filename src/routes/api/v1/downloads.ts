import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultDownloadService,
  type DownloadService,
  DownloadError,
} from '../../../services/download.service.js';
import {
  defaultAuthService,
  type AuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';

export interface DownloadRoutesOptions {
  downloadService?: DownloadService;
  authService?: AuthService;
}

const ResourceIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Resource ID must be a valid UUID' }),
});

const DownloadBodySchema = z
  .object({
    fileId: z.string().uuid({ message: 'File ID must be a valid UUID' }).optional(),
  })
  .optional();

export const downloadRoutes: FastifyPluginAsync<DownloadRoutesOptions> = async (
  fastify,
  opts,
) => {
  const downloadService = opts.downloadService || defaultDownloadService;
  const authService = opts.authService || defaultAuthService;

  // Route-scoped error handler for DownloadError and Zod validation errors
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof DownloadError) {
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

  /**
   * POST /api/v1/resources/:id/download
   *
   * Authenticated or anonymous short-lived signed download authorization.
   * Never exposes raw storage metadata, bucket names, object keys, or cloud credentials.
   */
  fastify.post('/resources/:id/download', async (request, reply) => {
    const params = ResourceIdParamSchema.parse(request.params);
    const body = DownloadBodySchema.parse(request.body || undefined);

    // Optional authentication handling (Prompt 16 Correction 3 & Prompt 20):
    // Anonymous visitors are fully permitted for free resources.
    // If a session cookie is present and valid, capture the authenticated user context.
    // If a session cookie is invalid/expired, treat as anonymous without returning 401.
    let authenticatedUserId: string | undefined = (request as any).user?.id;
    if (!authenticatedUserId) {
      const cookieHeader = request.headers.cookie;
      if (cookieHeader) {
        const rawToken =
          request.cookies?.[SESSION_COOKIE_NAME] ||
          cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
        if (rawToken) {
          try {
            const sessionResult = await authService.validateSession(rawToken.trim());
            if (sessionResult) {
              authenticatedUserId = sessionResult.user.id;
            }
          } catch {
            // Non-blocking: continue as anonymous
          }
        }
      }
    }

    const result = await downloadService.generateDownloadUrl({
      resourceId: params.id,
      fileId: body?.fileId,
      userId: authenticatedUserId,
    });

    return reply.status(200).send({
      data: result,
    });
  });
};
