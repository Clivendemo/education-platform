import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  defaultEducationUpdateService,
  type EducationUpdateService,
  EducationUpdateError,
} from '../../../services/education-update.service.js';
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EducationUpdatesRoutesOptions {
  educationUpdateService?: EducationUpdateService;
  authService?: AuthService;
  rbacService?: RbacService;
}

const AttachedResourceInputSchema = z.object({
  resourceId: z.string().uuid(),
  displayOrder: z.number().int().optional(),
});

const CreateUpdateBodySchema = z.object({
  title: z.string().min(1, 'Title cannot be empty'),
  slug: z.string().optional(),
  summary: z.string().nullable().optional(),
  body: z.string().min(1, 'Body content cannot be empty'),
  countryId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  curriculumIds: z.array(z.string().uuid()).optional(),
  resources: z.array(AttachedResourceInputSchema).optional(),
});

const UpdateUpdateBodySchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().optional(),
  summary: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
  countryId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  curriculumIds: z.array(z.string().uuid()).optional(),
  resources: z.array(AttachedResourceInputSchema).optional(),
});

const ListUpdatesQuerySchema = z.object({
  country: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const RelatedUpdatesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(20).optional(),
});

export const updatesRoutes: FastifyPluginAsync<EducationUpdatesRoutesOptions> = async (
  fastify,
  opts,
) => {
  const updateService = opts.educationUpdateService || defaultEducationUpdateService;
  const authService = opts.authService || defaultAuthService;
  const rbacService = opts.rbacService || defaultRbacService;

  const requireAuth = createRequireAuth(authService);

  const sendForbidden = (request: { id: string }, reply: any) =>
    reply.status(403).send({
      error: {
        code: 'FORBIDDEN',
        message: GENERIC_FORBIDDEN_MESSAGE,
        requestId: request.id,
      },
    });

  // Custom error handler for updates routes
  fastify.setErrorHandler((error: any, request, reply) => {
    if (error instanceof EducationUpdateError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          requestId: request.id,
        },
      });
    }

    throw error;
  });

  // -------------------------------------------------------------
  // PUBLIC ENDPOINTS
  // -------------------------------------------------------------

  /**
   * GET /updates/categories
   * Public retrieval of active update categories.
   */
  fastify.get('/updates/categories', async (_request, reply) => {
    const categories = await updateService.listCategories();
    return reply.status(200).send({
      data: categories,
    });
  });

  /**
   * GET /updates
   * Public discovery of published education updates with pagination and filtering.
   */
  fastify.get<{ Querystring: z.infer<typeof ListUpdatesQuerySchema> }>(
    '/updates',
    async (request, reply) => {
      const query = ListUpdatesQuerySchema.parse(request.query || {});
      const result = await updateService.listPublicUpdates(query);
      return reply.status(200).send(result);
    },
  );

  /**
   * GET /updates/:slug
   * Public retrieval of a single published education update by slug.
   */
  fastify.get<{ Params: { slug: string } }>(
    '/updates/:slug',
    async (request, reply) => {
      const { slug } = request.params;
      const update = await updateService.getPublicUpdateBySlug(slug);

      if (!update) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Education update with slug '${slug}' was not found or is not published.`,
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send({
        data: update,
      });
    },
  );

  /**
   * GET /updates/:slug/related
   * Public retrieval of related published education updates.
   */
  fastify.get<{
    Params: { slug: string };
    Querystring: z.infer<typeof RelatedUpdatesQuerySchema>;
  }>(
    '/updates/:slug/related',
    async (request, reply) => {
      const { slug } = request.params;
      const query = RelatedUpdatesQuerySchema.parse(request.query || {});
      const related = await updateService.getRelatedUpdates(slug, query.limit);

      return reply.status(200).send({
        data: related,
      });
    },
  );

  // -------------------------------------------------------------
  // ADMINISTRATIVE ENDPOINTS (Protected)
  // -------------------------------------------------------------

  /**
   * POST /admin/updates
   * Creates a new education update in DRAFT status.
   * Requires permission: update.create (COUNTRY-scoped or GLOBAL)
   */
  fastify.post<{ Body: z.infer<typeof CreateUpdateBodySchema> }>(
    '/admin/updates',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.create',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const body = CreateUpdateBodySchema.parse(request.body);
      if (!access.hasGlobalGrant) {
        if (!body.countryId || !access.countryIds.includes(body.countryId)) {
          return sendForbidden(request, reply);
        }
      }

      const created = await updateService.createUpdate({
        ...body,
        userId: user.id,
      });

      return reply.status(201).send({
        data: created,
      });
    },
  );

  /**
   * PATCH /admin/updates/:id
   * Updates an existing update. Cannot edit archived updates.
   * Requires permission: update.edit (COUNTRY-scoped or GLOBAL)
   */
  fastify.patch<{
    Params: { id: string };
    Body: z.infer<typeof UpdateUpdateBodySchema>;
  }>(
    '/admin/updates/:id',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.edit',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Update ID must be a valid UUID.',
            requestId: request.id,
          },
        });
      }

      const body = UpdateUpdateBodySchema.parse(request.body);

      if (!access.hasGlobalGrant) {
        const existing = await updateService.getAdminUpdateById(id);
        if (!existing) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: `Education update with ID '${id}' was not found.`,
              requestId: request.id,
            },
          });
        }
        if (
          !existing.country?.id ||
          !access.countryIds.includes(existing.country.id)
        ) {
          return sendForbidden(request, reply);
        }
        if (
          body.countryId !== undefined &&
          (body.countryId === null || !access.countryIds.includes(body.countryId))
        ) {
          return sendForbidden(request, reply);
        }
      }

      const updated = await updateService.updateUpdate(id, {
        ...body,
        userId: user.id,
      });

      return reply.status(200).send({
        data: updated,
      });
    },
  );

  /**
   * POST /admin/updates/:id/publish
   * Transitions an update from DRAFT to PUBLISHED.
   * Requires permission: update.publish (COUNTRY-scoped or GLOBAL)
   */
  fastify.post<{ Params: { id: string } }>(
    '/admin/updates/:id/publish',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.publish',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Update ID must be a valid UUID.',
            requestId: request.id,
          },
        });
      }

      if (!access.hasGlobalGrant) {
        const existing = await updateService.getAdminUpdateById(id);
        if (!existing) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: `Education update with ID '${id}' was not found.`,
              requestId: request.id,
            },
          });
        }
        if (
          !existing.country?.id ||
          !access.countryIds.includes(existing.country.id)
        ) {
          return sendForbidden(request, reply);
        }
      }

      const published = await updateService.publishUpdate(id, user.id);

      return reply.status(200).send({
        data: published,
      });
    },
  );

  /**
   * POST /admin/updates/:id/archive
   * Transitions an update from DRAFT or PUBLISHED to ARCHIVED.
   * Requires permission: update.archive (COUNTRY-scoped or GLOBAL)
   */
  fastify.post<{ Params: { id: string } }>(
    '/admin/updates/:id/archive',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.archive',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Update ID must be a valid UUID.',
            requestId: request.id,
          },
        });
      }

      if (!access.hasGlobalGrant) {
        const existing = await updateService.getAdminUpdateById(id);
        if (!existing) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: `Education update with ID '${id}' was not found.`,
              requestId: request.id,
            },
          });
        }
        if (
          !existing.country?.id ||
          !access.countryIds.includes(existing.country.id)
        ) {
          return sendForbidden(request, reply);
        }
      }

      const archived = await updateService.archiveUpdate(id, user.id);

      return reply.status(200).send({
        data: archived,
      });
    },
  );

  /**
   * GET /admin/updates
   * Lists updates across all publication statuses for administrative review.
   * Requires permission: update.read (COUNTRY-scoped or GLOBAL)
   */
  fastify.get<{ Querystring: z.infer<typeof ListUpdatesQuerySchema> }>(
    '/admin/updates',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.read',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const query = ListUpdatesQuerySchema.parse(request.query || {});
      if (!access.hasGlobalGrant) {
        if (query.country) {
          let targetCountryId: string | null = null;
          if (UUID_REGEX.test(query.country.trim())) {
            targetCountryId = query.country.trim();
          } else if (typeof updateService.resolveCountryIdByIdentifier === 'function') {
            targetCountryId = await updateService.resolveCountryIdByIdentifier(
              query.country,
            );
          }
          if (!targetCountryId || !access.countryIds.includes(targetCountryId)) {
            return sendForbidden(request, reply);
          }
        }

        const result = await updateService.listAdminUpdates({
          ...query,
          allowedCountryIds: access.countryIds,
        });
        return reply.status(200).send(result);
      }

      const result = await updateService.listAdminUpdates(query);
      return reply.status(200).send(result);
    },
  );

  /**
   * GET /admin/updates/:id
   * Retrieves single update details for administrative review.
   * Requires permission: update.read (COUNTRY-scoped or GLOBAL)
   */
  fastify.get<{ Params: { id: string } }>(
    '/admin/updates/:id',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const user = request.user!;
      const access = await resolveStaffPermissionAccess(
        rbacService,
        user.id,
        'update.read',
      );
      if (!access.granted) {
        return sendForbidden(request, reply);
      }

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Update ID must be a valid UUID.',
            requestId: request.id,
          },
        });
      }

      const update = await updateService.getAdminUpdateById(id);
      if (!update) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Education update with ID '${id}' was not found.`,
            requestId: request.id,
          },
        });
      }

      if (
        !access.hasGlobalGrant &&
        (!update.country?.id || !access.countryIds.includes(update.country.id))
      ) {
        return sendForbidden(request, reply);
      }

      return reply.status(200).send({
        data: update,
      });
    },
  );
};
