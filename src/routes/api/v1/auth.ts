import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type AuthService,
  defaultAuthService,
  SESSION_COOKIE_NAME,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from '../../../services/auth.service.js';
import type { User, UserSession } from '../../../db/schemas.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    session?: UserSession;
  }
}

export interface AuthRoutesOptions {
  authService?: AuthService;
}

const RegisterBodySchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address format')
    .max(255, 'Email cannot exceed 255 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters'),
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name cannot be empty')
    .max(100, 'Display name cannot exceed 100 characters')
    .optional(),
});

const LoginBodySchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address format'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

/**
 * Extracts session token exclusively from the configured HttpOnly cookie.
 * Per API_SPEC Section 2 and SECURITY_RULES Section 11, session tokens
 * are strictly cookie-based, preventing client-side token persistence (XSS).
 */
export function extractSessionToken(request: FastifyRequest): string | null {
  const cookieToken = request.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  return null;
}

/**
 * Creates a Fastify preHandler hook to enforce valid session authentication.
 * Rejects requests if session is expired, revoked, or account is deleted/suspended.
 */
export function createRequireAuth(service: AuthService) {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const rawToken = extractSessionToken(request);
    if (!rawToken) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
    }

    const validation = await service.validateSession(rawToken);
    if (!validation) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this resource',
          requestId: request.id,
        },
      });
    }

    request.user = validation.user;
    request.session = validation.session;
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  fastify,
  opts,
) => {
  const service = opts.authService ?? defaultAuthService;
  const requireAuth = createRequireAuth(service);

  /**
   * POST /api/v1/auth/register
   * Creates identity.users + auth_identities + user_sessions atomically in single transaction.
   * Race-safe duplicate email handling returns 409 EMAIL_ALREADY_REGISTERED.
   */
  fastify.post('/auth/register', async (request, reply) => {
    const parseResult = RegisterBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST_BODY',
          message:
            parseResult.error.issues[0]?.message ?? 'Invalid registration body',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await service.register({
        email: parseResult.data.email,
        password: parseResult.data.password,
        displayName: parseResult.data.displayName,
        deviceMetadata: {
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
        },
      });

      // Set HttpOnly session cookie without signing secret
      reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: result.expiresAt,
      });

      return reply.status(201).send({
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            displayName: result.user.displayName,
            status: result.user.status,
            createdAt: result.user.createdAt,
          },
          session: {
            expiresAt: result.expiresAt.toISOString(),
          },
        },
      });
    } catch (err: any) {
      if (err instanceof EmailAlreadyRegisteredError) {
        return reply.status(409).send({
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
   * POST /api/v1/auth/login
   * Validates credentials with Argon2id, checks deleted_at IS NULL & status = ACTIVE.
   * Returns generic 401 INVALID_CREDENTIALS on any failure.
   */
  fastify.post('/auth/login', async (request, reply) => {
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST_BODY',
          message:
            parseResult.error.issues[0]?.message ?? 'Invalid login body',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await service.login({
        email: parseResult.data.email,
        password: parseResult.data.password,
        deviceMetadata: {
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
        },
      });

      // Set fresh HttpOnly session cookie (session fixation protection)
      reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: result.expiresAt,
      });

      return reply.status(200).send({
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            displayName: result.user.displayName,
            status: result.user.status,
            createdAt: result.user.createdAt,
          },
          session: {
            expiresAt: result.expiresAt.toISOString(),
          },
        },
      });
    } catch (err: any) {
      if (err instanceof InvalidCredentialsError) {
        return reply.status(401).send({
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
   * POST /api/v1/auth/logout
   * Revokes server-side session and clears the session cookie.
   */
  fastify.post('/auth/logout', async (request, reply) => {
    const rawToken = extractSessionToken(request);
    if (rawToken) {
      await service.logout(rawToken);
    }

    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return reply.status(200).send({
      data: {
        success: true,
        message: 'Logged out successfully',
      },
    });
  });

  /**
   * GET /api/v1/auth/me
   * Returns current authenticated user profile.
   * Requires active session and active/non-deleted user.
   */
  fastify.get('/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user!;

    return reply.status(200).send({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    });
  });
};
