import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  contributorService as defaultContributorService,
  type ContributorService,
  ContributorError,
  ContributorNotFoundError,
  type ContributorStatus,
  type ContributorVerificationStatus,
  type ContributorApplicationStatus,
} from '../../../services/contributor.service.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type RbacService,
} from '../../../services/rbac.service.js';
import { createRequireAuth } from './auth.js';
import { createRequirePermission } from '../../hooks/authorize.js';

export interface ContributorRoutesOptions {
  contributorService?: ContributorService;
  authService?: AuthService;
  rbacService?: RbacService;
}

// ----------------------------------------------------------------------------
// Zod Schemas
// ----------------------------------------------------------------------------

const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const SlugParamSchema = z.object({
  slug: z.string().min(1),
});

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

const ApplicationBodySchema = z.object({
  applicationText: z.string().min(1, 'Application text cannot be empty'),
});

const ApplicationReviewBodySchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  notes: z.string().optional(),
});

const UpdateProfileBodySchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(2000).optional().nullable(),
});

const CreateSubmissionBodySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(4000).optional().nullable(),
  proposedPriceMinor: z.number().int().min(0).optional().nullable(),
  proposedCurrencyCode: z.literal('KES').optional().nullable(),
  resourceId: z.string().uuid().optional().nullable(),
});

const UpdateSubmissionBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).optional().nullable(),
  proposedPriceMinor: z.number().int().min(0).optional().nullable(),
  proposedCurrencyCode: z.literal('KES').optional().nullable(),
});

const AdminContributorStatusBodySchema = z.object({
  status: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE']),
  reason: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Fastify Plugin
// ----------------------------------------------------------------------------

export const contributorRoutes: FastifyPluginAsync<ContributorRoutesOptions> = async (
  fastify,
  opts,
) => {
  const service = opts.contributorService || defaultContributorService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  const requireAuth = createRequireAuth(authService);
  const requirePermission = (permission: string) =>
    createRequirePermission(rbacService, permission);

  // Error Handler
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ContributorError) {
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
          message: 'Invalid request payload or parameters',
          details: error.errors,
          requestId: request.id,
        },
      });
    }

    throw error;
  });

  // ==========================================================================
  // Public Discovery Endpoints
  // ==========================================================================

  // GET /api/v1/contributors
  fastify.get('/contributors', async (request, reply) => {
    const query = PaginationQuerySchema.parse(request.query);
    const result = await service.listPublicContributors(query);
    return reply.status(200).send(result);
  });

  // GET /api/v1/contributors/:slug
  fastify.get('/contributors/:slug', async (request, reply) => {
    const params = SlugParamSchema.parse(request.params);
    const profile = await service.getPublicProfileBySlug(params.slug);
    if (!profile) {
      throw new ContributorNotFoundError(`Active contributor not found for slug "${params.slug}".`);
    }
    return reply.status(200).send({ data: profile });
  });

  // GET /api/v1/contributors/:slug/resources
  fastify.get('/contributors/:slug/resources', async (request, reply) => {
    const params = SlugParamSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query);
    const result = await service.listContributorPublishedResources(params.slug, query);
    return reply.status(200).send(result);
  });

  // ==========================================================================
  // Application Workflow
  // ==========================================================================

  // POST /api/v1/contributor-applications
  fastify.post(
    '/contributor-applications',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const body = ApplicationBodySchema.parse(request.body);
      const app = await service.submitApplication(request.user!.id, body.applicationText);
      return reply.status(201).send({ data: app });
    },
  );

  // ==========================================================================
  // Contributor Workspace (Authenticated & Contributor)
  // ==========================================================================

  // GET /api/v1/me/contributor
  fastify.get(
    '/me/contributor',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const profile = await service.getMyProfile(request.user!.id);
      return reply.status(200).send({ data: profile });
    },
  );

  // PATCH /api/v1/me/contributor
  fastify.patch(
    '/me/contributor',
    { preHandler: [requireAuth, requirePermission('contributor.profile.update')] },
    async (request, reply) => {
      const body = UpdateProfileBodySchema.parse(request.body);
      const updated = await service.updateMyProfile(request.user!.id, body);
      return reply.status(200).send({ data: updated });
    },
  );

  // GET /api/v1/me/contributor/submissions
  fastify.get(
    '/me/contributor/submissions',
    { preHandler: [requireAuth, requirePermission('contributor.submit')] },
    async (request, reply) => {
      const query = PaginationQuerySchema.parse(request.query);
      const result = await service.listMySubmissions(request.user!.id, query);
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/me/contributor/submissions
  fastify.post(
    '/me/contributor/submissions',
    { preHandler: [requireAuth, requirePermission('contributor.submit')] },
    async (request, reply) => {
      const body = CreateSubmissionBodySchema.parse(request.body);
      const sub = await service.createSubmission(request.user!.id, body);
      return reply.status(201).send({ data: sub });
    },
  );

  // GET /api/v1/me/contributor/submissions/:id
  fastify.get(
    '/me/contributor/submissions/:id',
    { preHandler: [requireAuth, requirePermission('contributor.submit')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const sub = await service.getSubmissionById(request.user!.id, params.id);
      return reply.status(200).send({ data: sub });
    },
  );

  // PATCH /api/v1/me/contributor/submissions/:id
  fastify.patch(
    '/me/contributor/submissions/:id',
    { preHandler: [requireAuth, requirePermission('contributor.submit')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = UpdateSubmissionBodySchema.parse(request.body);
      const updated = await service.updateSubmission(request.user!.id, params.id, body);
      return reply.status(200).send({ data: updated });
    },
  );

  // POST /api/v1/me/contributor/submissions/:id/submit
  fastify.post(
    '/me/contributor/submissions/:id/submit',
    { preHandler: [requireAuth, requirePermission('contributor.submit')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const submitted = await service.submitSubmission(request.user!.id, params.id);
      return reply.status(200).send({ data: submitted });
    },
  );

  // ==========================================================================
  // Administrative & Review Endpoints
  // ==========================================================================

  // GET /api/v1/admin/contributor-applications
  fastify.get(
    '/admin/contributor-applications',
    { preHandler: [requireAuth, requirePermission('contributor.application.review')] },
    async (request, reply) => {
      const query = PaginationQuerySchema.extend({
        status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
      }).parse(request.query);

      const result = await service.listApplications({
        status: query.status as ContributorApplicationStatus | undefined,
        page: query.page,
        limit: query.limit,
      });
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/admin/contributor-applications/:id/review
  fastify.post(
    '/admin/contributor-applications/:id/review',
    { preHandler: [requireAuth, requirePermission('contributor.application.review')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = ApplicationReviewBodySchema.parse(request.body);

      const result = await service.reviewApplication(
        request.user!.id,
        params.id,
        body.action,
        body.notes,
      );
      return reply.status(200).send({ data: result });
    },
  );

  // POST /api/v1/admin/contributor-submissions/:id/review
  fastify.post(
    '/admin/contributor-submissions/:id/review',
    { preHandler: [requireAuth, requirePermission('contributor.application.review')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = ApplicationReviewBodySchema.parse(request.body);

      const result = await service.reviewSubmission(
        request.user!.id,
        params.id,
        body.action,
        body.notes,
      );
      return reply.status(200).send({ data: result });
    },
  );

  // GET /api/v1/admin/contributors
  fastify.get(
    '/admin/contributors',
    { preHandler: [requireAuth, requirePermission('contributor.manage')] },
    async (request, reply) => {
      const query = PaginationQuerySchema.extend({
        status: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE']).optional(),
        verificationStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
      }).parse(request.query);

      const result = await service.listAdminContributors({
        status: query.status as ContributorStatus | undefined,
        verificationStatus: query.verificationStatus as ContributorVerificationStatus | undefined,
        page: query.page,
        limit: query.limit,
      });
      return reply.status(200).send(result);
    },
  );

  // PATCH /api/v1/admin/contributors/:id/status
  fastify.patch(
    '/admin/contributors/:id/status',
    { preHandler: [requireAuth, requirePermission('contributor.manage')] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = AdminContributorStatusBodySchema.parse(request.body);

      const updated = await service.updateContributorStatus(
        request.user!.id,
        params.id,
        body.status,
        body.reason,
      );
      return reply.status(200).send({ data: updated });
    },
  );
};
