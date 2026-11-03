import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultQualityGovernanceService,
  type QualityGovernanceService,
  QualityGovernanceError,
} from '../../../services/quality-governance.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import { createRequireAuth } from './auth.js';
import {
  GENERIC_FORBIDDEN_MESSAGE,
  resolveStaffPermissionAccess,
} from '../../hooks/authorize.js';

export interface QualityGovernanceRoutesOptions {
  qualityService?: QualityGovernanceService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const IdParamSchema = z.object({
  id: z.string().uuid('Resource id must be a valid UUID'),
});

const RecordQualityCheckBodySchema = z.object({
  versionId: z.string().uuid('Version id must be a valid UUID'),
  checkTypeCode: z
    .string()
    .min(1, 'checkTypeCode cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'checkTypeCode must be alphanumeric with underscores'),
  status: z.enum(['PASSED', 'FAILED', 'FLAGGED']),
  notes: z.string().nullable().optional(),
});

const VerifyResourceBodySchema = z.object({
  versionId: z.string().uuid('Version id must be a valid UUID'),
  notes: z.string().nullable().optional(),
});

const RevokeVerificationBodySchema = z.object({
  versionId: z.string().uuid('Version id must be a valid UUID').optional(),
  reason: z.string().min(1, 'A non-empty revocation reason is mandatory'),
});

const CheckTypesQuerySchema = z.object({
  countryId: z.string().uuid('Country id must be a valid UUID').optional(),
  includeInactive: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export const qualityGovernanceRoutes: FastifyPluginAsync<
  QualityGovernanceRoutesOptions
> = async (fastify, options) => {
  const qualityService =
    options.qualityService || defaultQualityGovernanceService;
  const authService = options.authService || defaultAuthService;
  const rbacService = options.rbacService || defaultRbacService;

  const requireAuth = createRequireAuth(authService);

  async function verifyResourceCountryScope(
    resourceId: string,
    hasGlobalGrant: boolean,
    allowedCountryIds: string[],
  ): Promise<'OK' | 'NOT_FOUND' | 'FORBIDDEN'> {
    if (hasGlobalGrant) {
      return 'OK';
    }
    if (typeof qualityService.getResourceCountryId !== 'function') {
      return 'FORBIDDEN';
    }
    const resourceCountryId = await qualityService.getResourceCountryId(resourceId);
    if (!resourceCountryId) {
      return 'NOT_FOUND';
    }
    if (!allowedCountryIds.includes(resourceCountryId)) {
      return 'FORBIDDEN';
    }
    return 'OK';
  }

  // 1. GET /admin/quality/check-types
  fastify.get(
    '/admin/quality/check-types',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');

      const access = await resolveStaffPermissionAccess(
        rbacService,
        request.user!.id,
        'quality.read',
      );
      if (!access.granted) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const queryResult = CheckTypesQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: queryResult.error.errors[0]?.message || 'Invalid query parameters',
            requestId: request.id,
          },
        });
      }

      if (
        !access.hasGlobalGrant &&
        queryResult.data.countryId &&
        !access.countryIds.includes(queryResult.data.countryId)
      ) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const types = await qualityService.listCheckTypes({
        countryId: queryResult.data.countryId,
        includeInactive: queryResult.data.includeInactive,
      });

      return reply.status(200).send({ data: types });
    },
  );

  // 2. GET /admin/resources/:id/quality
  fastify.get(
    '/admin/resources/:id/quality',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');

      const access = await resolveStaffPermissionAccess(
        rbacService,
        request.user!.id,
        'quality.read',
      );
      if (!access.granted) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: paramResult.error.errors[0]?.message || 'Invalid resource id',
            requestId: request.id,
          },
        });
      }

      const scopeCheck = await verifyResourceCountryScope(
        paramResult.data.id,
        access.hasGlobalGrant,
        access.countryIds,
      );
      if (scopeCheck === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource '${paramResult.data.id}' not found.`,
            requestId: request.id,
          },
        });
      }
      if (scopeCheck === 'FORBIDDEN') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const query = request.query as { versionId?: string };
      try {
        const qualityDetails = await qualityService.getResourceQuality(
          paramResult.data.id,
          { versionId: query?.versionId },
        );
        return reply.status(200).send({ data: qualityDetails });
      } catch (err) {
        if (err instanceof QualityGovernanceError) {
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

  // 3. POST /admin/resources/:id/quality-checks
  fastify.post(
    '/admin/resources/:id/quality-checks',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');

      const access = await resolveStaffPermissionAccess(
        rbacService,
        request.user!.id,
        'quality.check.create',
      );
      if (!access.granted) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: paramResult.error.errors[0]?.message || 'Invalid resource id',
            requestId: request.id,
          },
        });
      }

      const bodyResult = RecordQualityCheckBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyResult.error.errors[0]?.message || 'Invalid request body',
            requestId: request.id,
          },
        });
      }

      const scopeCheck = await verifyResourceCountryScope(
        paramResult.data.id,
        access.hasGlobalGrant,
        access.countryIds,
      );
      if (scopeCheck === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource '${paramResult.data.id}' not found.`,
            requestId: request.id,
          },
        });
      }
      if (scopeCheck === 'FORBIDDEN') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      try {
        const recorded = await qualityService.recordQualityCheck({
          resourceId: paramResult.data.id,
          versionId: bodyResult.data.versionId,
          checkTypeCode: bodyResult.data.checkTypeCode,
          status: bodyResult.data.status,
          notes: bodyResult.data.notes,
          actorUserId: request.user!.id,
        });

        return reply.status(201).send({ data: recorded });
      } catch (err) {
        if (err instanceof QualityGovernanceError) {
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

  // 4. POST /admin/resources/:id/verify
  fastify.post(
    '/admin/resources/:id/verify',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');

      const access = await resolveStaffPermissionAccess(
        rbacService,
        request.user!.id,
        'quality.verify',
      );
      if (!access.granted) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: paramResult.error.errors[0]?.message || 'Invalid resource id',
            requestId: request.id,
          },
        });
      }

      const bodyResult = VerifyResourceBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyResult.error.errors[0]?.message || 'Invalid request body',
            requestId: request.id,
          },
        });
      }

      const scopeCheck = await verifyResourceCountryScope(
        paramResult.data.id,
        access.hasGlobalGrant,
        access.countryIds,
      );
      if (scopeCheck === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource '${paramResult.data.id}' not found.`,
            requestId: request.id,
          },
        });
      }
      if (scopeCheck === 'FORBIDDEN') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      try {
        const verification = await qualityService.verifyResourceVersion({
          resourceId: paramResult.data.id,
          versionId: bodyResult.data.versionId,
          notes: bodyResult.data.notes,
          actorUserId: request.user!.id,
        });

        return reply.status(200).send({ data: verification });
      } catch (err) {
        if (err instanceof QualityGovernanceError) {
          return reply.status(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details,
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    },
  );

  // 5. POST /admin/resources/:id/revoke-verification
  fastify.post(
    '/admin/resources/:id/revoke-verification',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');

      const access = await resolveStaffPermissionAccess(
        rbacService,
        request.user!.id,
        'quality.revoke',
      );
      if (!access.granted) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      const paramResult = IdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: paramResult.error.errors[0]?.message || 'Invalid resource id',
            requestId: request.id,
          },
        });
      }

      const bodyResult = RevokeVerificationBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyResult.error.errors[0]?.message || 'Invalid request body',
            requestId: request.id,
          },
        });
      }

      const scopeCheck = await verifyResourceCountryScope(
        paramResult.data.id,
        access.hasGlobalGrant,
        access.countryIds,
      );
      if (scopeCheck === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource '${paramResult.data.id}' not found.`,
            requestId: request.id,
          },
        });
      }
      if (scopeCheck === 'FORBIDDEN') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: GENERIC_FORBIDDEN_MESSAGE,
            requestId: request.id,
          },
        });
      }

      try {
        const revoked = await qualityService.revokeResourceVerification({
          resourceId: paramResult.data.id,
          versionId: bodyResult.data.versionId,
          reason: bodyResult.data.reason,
          actorUserId: request.user!.id,
        });

        return reply.status(200).send({ data: revoked });
      } catch (err) {
        if (err instanceof QualityGovernanceError) {
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
