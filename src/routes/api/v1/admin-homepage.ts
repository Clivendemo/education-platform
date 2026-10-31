import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HOMEPAGE_CONFIG_STATUSES,
  HOMEPAGE_SLOT_KEYS,
  HOMEPAGE_SLOT_MODES,
} from '../../../db/schema/homepage.js';
import {
  defaultHomepageAdminService,
  type ConfigurationScopeTarget,
  type HomepageAdminService,
} from '../../../services/homepage-admin.service.js';
import { HomepageError } from '../../../services/homepage.service.js';
import { parseEvaluationTimestamp } from '../../../services/homepage-eligibility.js';
import {
  defaultAuthService,
  type AuthService,
} from '../../../services/auth.service.js';
import {
  defaultRbacService,
  type PermissionAccessResolution,
  type RbacService,
} from '../../../services/rbac.service.js';
import {
  defaultAuditService,
  type ActorSnapshot,
  type AuditService,
} from '../../../services/audit.service.js';
import { createRequireAuth } from './auth.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../../hooks/authorize.js';

export type HomepageAdminOperationCategory =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'C6';

export interface HomepageAdminInstrumentation {
  onOperation?: (
    category: HomepageAdminOperationCategory,
    routeId: string,
  ) => void;
}

export interface AdminHomepageRouteOptions {
  homepageAdminService?: HomepageAdminService;
  authService?: AuthService;
  rbacService?: RbacService;
  auditService?: AuditService;
  instrumentation?: HomepageAdminInstrumentation;
}

const NOT_FOUND_MESSAGE = 'Homepage configuration was not found.';

const UuidParamSchema = z
  .object({
    id: z.string().uuid('Configuration ID parameter must be a valid UUID.'),
  })
  .strict();

const IsoTimestampStringSchema = z
  .string()
  .refine(
    (val) => {
      const res = parseEvaluationTimestamp(val);
      return res.ok;
    },
    { message: 'Timestamp must be a valid ISO-8601 UTC/offset string.' },
  );

const PinnedItemInputSchema = z
  .object({
    position: z.number().int().min(1).max(6),
    entityId: z.string().uuid('entityId must be a valid UUID.'),
    startsAt: IsoTimestampStringSchema.nullable().optional(),
    endsAt: IsoTimestampStringSchema.nullable().optional(),
    pinNote: z.string().max(500).nullable().optional(),
  })
  .strict();

const DraftSlotMutationSchema = z
  .object({
    slotKey: z.enum(HOMEPAGE_SLOT_KEYS),
    mode: z.enum(HOMEPAGE_SLOT_MODES).optional(),
    sectionTitle: z.string().trim().min(1).max(120).optional(),
    sectionSubtitle: z.string().max(240).nullable().optional(),
    maxItems: z.number().int().min(1).max(6).optional(),
    items: z.array(PinnedItemInputSchema).max(6).optional(),
  })
  .strict();

const CreateDraftBodySchema = z
  .object({
    countryId: z.string().uuid('countryId must be a valid UUID.'),
    title: z.string().trim().min(1).max(160),
    notes: z.string().max(2000).nullable().optional(),
    sourceConfigurationId: z.string().uuid().nullable().optional(),
    slots: z.array(DraftSlotMutationSchema).max(6).optional(),
  })
  .strict();

const ListConfigurationsQuerySchema = z
  .object({
    countryId: z.string().uuid('countryId must be a valid UUID.').optional(),
    status: z.enum(HOMEPAGE_CONFIG_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const EmptyStrictQuerySchema = z.object({}).strict();

const UpdateDraftBodySchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    notes: z.string().max(2000).nullable().optional(),
    slots: z.array(DraftSlotMutationSchema).max(6).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.title !== undefined || b.notes !== undefined || b.slots !== undefined,
    { message: 'At least one of title, notes, or slots must be provided.' },
  );

const PreviewSlotSchema = z
  .object({
    slotKey: z.enum(HOMEPAGE_SLOT_KEYS),
    mode: z.enum(HOMEPAGE_SLOT_MODES),
    sectionTitle: z.string().trim().min(1).max(120).optional(),
    sectionSubtitle: z.string().max(240).nullable().optional(),
    maxItems: z.number().int().min(1).max(6).optional(),
    items: z.array(PinnedItemInputSchema).max(6).optional(),
  })
  .strict();

const PreviewBodySchema = z
  .object({
    countryId: z.string().uuid('countryId must be a valid UUID.').optional(),
    configurationId: z
      .string()
      .uuid('configurationId must be a valid UUID.')
      .optional(),
    evaluateAt: z.unknown().optional(),
    slots: z.array(PreviewSlotSchema).max(6).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.countryId || b.configurationId), {
    message: 'Either countryId or configurationId must be provided.',
  });

const ScheduleBodySchema = z
  .object({
    action: z.enum(['SCHEDULE', 'UNSCHEDULE', 'CANCEL']).default('SCHEDULE'),
    scheduledStartAt: IsoTimestampStringSchema.optional(),
    scheduledUntilAt: IsoTimestampStringSchema.nullable().optional(),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.action === 'SCHEDULE' && !val.scheduledStartAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scheduledStartAt is required when action is SCHEDULE.',
        path: ['scheduledStartAt'],
      });
    }
    if (val.action === 'CANCEL' && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reason is required when action is CANCEL.',
        path: ['reason'],
      });
    }
  });

const PublishBodySchema = z
  .object({
    scheduledUntilAt: IsoTimestampStringSchema.nullable().optional(),
  })
  .strict();

const DiscardBodySchema = z
  .object({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

const RollbackBodySchema = z
  .object({
    countryId: z.string().uuid('countryId must be a valid UUID.'),
    targetConfigurationId: z
      .string()
      .uuid('targetConfigurationId must be a valid UUID.'),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

function safeLogError(
  request: FastifyRequest,
  err: unknown,
  msg: string,
): void {
  try {
    request.log.error(err, msg);
  } catch {
    // Guard against secondary structured-logger failures (FM-3b) so HTTP non-disclosure is preserved
  }
}

function sendHiddenConfigurationNotFound(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.status(404).send({
    error: {
      code: 'HOMEPAGE_CONFIGURATION_NOT_FOUND',
      message: NOT_FOUND_MESSAGE,
      requestId: request.id,
    },
  });
}

function sendForbidden(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(403).send({
    error: {
      code: 'FORBIDDEN',
      message: GENERIC_FORBIDDEN_MESSAGE,
      requestId: request.id,
    },
  });
}

export const adminHomepageRoutes: FastifyPluginAsync<
  AdminHomepageRouteOptions
> = async (fastify, opts) => {
  const adminService =
    opts.homepageAdminService ?? defaultHomepageAdminService;
  const authService = opts.authService ?? defaultAuthService;
  const rbacService = opts.rbacService ?? defaultRbacService;
  const auditService = opts.auditService ?? defaultAuditService;
  const instrumentation = opts.instrumentation;

  const track = (
    category: HomepageAdminOperationCategory,
    routeId: string,
  ): void => {
    instrumentation?.onOperation?.(category, routeId);
  };

  const requireAuth = createRequireAuth(authService);

  // Enforce Cache-Control: private, no-store on all 2xx, 4xx, and 5xx admin responses (R17-05)
  fastify.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  fastify.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'private, no-store');

      if (error instanceof HomepageError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        });
      }

      safeLogError(request, error, 'Unhandled error in admin homepage route');
      const anyErr = error as {
        statusCode?: number;
        code?: string;
        message?: string;
      };
      const statusCode =
        typeof anyErr?.statusCode === 'number' &&
        anyErr.statusCode >= 400 &&
        anyErr.statusCode < 600
          ? anyErr.statusCode
          : 500;

      return reply.status(statusCode).send({
        error: {
          code:
            statusCode === 500
              ? 'INTERNAL_SERVER_ERROR'
              : typeof anyErr?.code === 'string'
                ? anyErr.code
                : 'BAD_REQUEST',
          message:
            statusCode === 500
              ? 'An internal server error occurred.'
              : anyErr?.message || 'Request failed.',
          requestId: request.id,
        },
      });
    },
  );

  /**
   * Stage 1 (C4): Best-effort actor snapshot enrichment; degrades cleanly on failure so Stage 2 (C5) still executes.
   */
  const resolveActorSnapshotResilient = async (
    request: FastifyRequest,
    routeId: string,
  ): Promise<ActorSnapshot> => {
    const user = request.user!;
    let emailDomain: string | undefined;
    if (user.email && user.email.includes('@')) {
      emailDomain = user.email.split('@')[1]?.slice(0, 120);
    }

    let actorRole: string | undefined;
    if (typeof rbacService.getUserRoles === 'function') {
      try {
        track('C4', routeId);
        const roles = await rbacService.getUserRoles(user.id);
        if (roles.length > 0) {
          actorRole = Array.from(new Set(roles.map((r) => r.roleSlug)))
            .slice(0, 5)
            .join(',');
        }
      } catch (err) {
        safeLogError(
          request,
          err,
          'Failed to resolve actor roles for homepage audit snapshot; degrading snapshot',
        );
        actorRole = undefined;
      }
    }

    return {
      actorId: user.id,
      actorType: 'AUTHENTICATED',
      actorRole,
      emailDomain,
    };
  };

  /**
   * Two-stage non-disclosing DENIED audit writer (C53 / C55 / C58):
   * - Stage 1 (C4) failure degrades actorSnapshot and STILL attempts Stage 2 (C5).
   * - Stage 2 (C5) failure (and any secondary logger failure FM-3b) is swallowed safely
   *   so the caller's HTTP status/body (403 or hidden-resource 404) never leaks or turns into 500.
   */
  const recordDeniedAudit = async (params: {
    request: FastifyRequest;
    routeId: string;
    action: string;
    entityId: string | null;
    verifiedCountryId: string | null;
    unverifiedCountryId?: string | null;
    denialReason: string;
  }): Promise<void> => {
    const {
      request,
      routeId,
      action,
      entityId,
      verifiedCountryId,
      unverifiedCountryId,
      denialReason,
    } = params;
    if (!request.user) return;

    let effectiveCountryId: string | null = verifiedCountryId;
    const contextPayload: Record<string, unknown> = { denialReason };

    if (!effectiveCountryId && unverifiedCountryId) {
      try {
        track('C3', routeId);
        const exists = await adminService.countryExists(unverifiedCountryId);
        if (exists) {
          effectiveCountryId = unverifiedCountryId;
        } else {
          contextPayload.requestedCountryId = unverifiedCountryId;
        }
      } catch (err) {
        safeLogError(
          request,
          err,
          'Failed C3 country existence probe during denied audit; degrading countryId to null',
        );
        contextPayload.requestedCountryId = unverifiedCountryId;
        effectiveCountryId = null;
      }
    }

    const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);

    try {
      track('C5', routeId);
      await auditService.logEvent({
        action,
        entityType: 'HOMEPAGE_CONFIGURATION',
        entityId,
        actorType: 'AUTHENTICATED',
        actorUserId: request.user.id,
        actorSnapshot,
        outcome: 'DENIED',
        requestId: request.id.slice(0, 64),
        countryId: effectiveCountryId,
        context: contextPayload,
      });
    } catch (err) {
      safeLogError(
        request,
        err,
        'Failed to write DENIED administrative homepage audit log',
      );
    }
  };

  /**
   * Coarse capability check (C1 = 1 via rbacService.resolvePermissionAccess directly; never falls back to hasPermission).
   */
  const requireCoarseCapability = async (
    request: FastifyRequest,
    reply: FastifyReply,
    routeId: string,
    permission: 'homepage.read' | 'homepage.manage' | 'homepage.publish',
    auditAction: string,
  ): Promise<PermissionAccessResolution | null> => {
    track('C1', routeId);
    const access = await rbacService.resolvePermissionAccess(
      request.user!.id,
      permission,
    );

    if (!access.granted) {
      await recordDeniedAudit({
        request,
        routeId,
        action: auditAction,
        entityId: null,
        verifiedCountryId: null,
        denialReason: 'MISSING_PERMISSION_OR_SCOPE',
      });
      sendForbidden(request, reply);
      return null;
    }

    return access;
  };

  /**
   * Opaque-ID scope verification (C49 / C53 / C59):
   * - Nonexistent ID -> 404 HOMEPAGE_CONFIGURATION_NOT_FOUND (no DENIED audit)
   * - Cross-country ID -> DENIED audit + identical 404 HOMEPAGE_CONFIGURATION_NOT_FOUND
   */
  const verifyOpaqueConfigurationScope = async (
    request: FastifyRequest,
    reply: FastifyReply,
    routeId: string,
    configurationId: string,
    access: PermissionAccessResolution,
    auditAction: string,
  ): Promise<ConfigurationScopeTarget | null> => {
    track('C2', routeId);
    const target = await adminService.getConfigurationScopeTarget(
      configurationId,
    );
    if (!target) {
      sendHiddenConfigurationNotFound(request, reply);
      return null;
    }

    const authorizedForCountry =
      access.hasGlobalGrant || access.countryIds.includes(target.countryId);

    if (!authorizedForCountry) {
      await recordDeniedAudit({
        request,
        routeId,
        action: auditAction,
        entityId: target.id,
        verifiedCountryId: target.countryId,
        denialReason: 'COUNTRY_SCOPE_MISMATCH',
      });
      sendHiddenConfigurationNotFound(request, reply);
      return null;
    }

    return target;
  };

  /**
   * Explicit-country scope verification:
   * - Out-of-scope countryId -> C3 FK safety check + DENIED audit + 403 FORBIDDEN
   */
  const verifyExplicitCountryScope = async (
    request: FastifyRequest,
    reply: FastifyReply,
    routeId: string,
    countryId: string,
    access: PermissionAccessResolution,
    auditAction: string,
  ): Promise<boolean> => {
    const authorizedForCountry =
      access.hasGlobalGrant || access.countryIds.includes(countryId);

    if (!authorizedForCountry) {
      await recordDeniedAudit({
        request,
        routeId,
        action: auditAction,
        entityId: null,
        verifiedCountryId: null,
        unverifiedCountryId: countryId,
        denialReason: 'COUNTRY_SCOPE_MISMATCH',
      });
      sendForbidden(request, reply);
      return false;
    }

    return true;
  };

  // A1: POST /api/v1/admin/homepage/drafts (homepage.manage, explicit-country)
  fastify.post(
    '/admin/homepage/drafts',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A1';
      const auditAction = 'homepage.draft.create';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.manage',
        auditAction,
      );
      if (!access) return;

      const parsedBody = CreateDraftBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const okScope = await verifyExplicitCountryScope(
        request,
        reply,
        routeId,
        parsedBody.data.countryId,
        access,
        auditAction,
      );
      if (!okScope) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const created = await adminService.createDraft(parsedBody.data, {
        actorUserId: request.user!.id,
        actorSnapshot,
        requestId: request.id.slice(0, 64),
      });

      return reply.status(201).send({ data: created });
    },
  );

  // A2: GET /api/v1/admin/homepage (homepage.read, explicit-country when countryId supplied)
  fastify.get(
    '/admin/homepage',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A2';
      const auditAction = 'homepage.configuration.list';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.read',
        auditAction,
      );
      if (!access) return;

      const parsedQuery = ListConfigurationsQuerySchema.safeParse(
        request.query ?? {},
      );
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      if (parsedQuery.data.countryId) {
        const okScope = await verifyExplicitCountryScope(
          request,
          reply,
          routeId,
          parsedQuery.data.countryId,
          access,
          auditAction,
        );
        if (!okScope) return;
      }

      track('C6', routeId);
      const result = await adminService.listConfigurations(
        parsedQuery.data,
        access,
      );
      return reply.status(200).send(result);
    },
  );

  // A3: GET /api/v1/admin/homepage/configurations/:id (homepage.read, opaque-ID)
  fastify.get<{ Params: { id: string } }>(
    '/admin/homepage/configurations/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A3';
      const auditAction = 'homepage.configuration.read';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.read',
        auditAction,
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const parsedQuery = EmptyStrictQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const target = await verifyOpaqueConfigurationScope(
        request,
        reply,
        routeId,
        parsedParams.data.id,
        access,
        auditAction,
      );
      if (!target) return;

      track('C6', routeId);
      const detail = await adminService.getConfigurationDetail(target.id);
      return reply.status(200).send({ data: detail });
    },
  );

  // A4: PATCH /api/v1/admin/homepage/drafts/:id (homepage.manage, opaque-ID)
  fastify.patch<{ Params: { id: string } }>(
    '/admin/homepage/drafts/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A4';
      const auditAction = 'homepage.draft.update';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.manage',
        auditAction,
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const parsedBody = UpdateDraftBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const target = await verifyOpaqueConfigurationScope(
        request,
        reply,
        routeId,
        parsedParams.data.id,
        access,
        auditAction,
      );
      if (!target) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const updated = await adminService.updateDraft(
        target.id,
        parsedBody.data,
        {
          actorUserId: request.user!.id,
          actorSnapshot,
          requestId: request.id.slice(0, 64),
        },
      );

      return reply.status(200).send({ data: updated });
    },
  );

  // A5: POST /api/v1/admin/homepage/preview (homepage.read, hybrid: configurationId opaque-ID vs countryId explicit)
  fastify.post(
    '/admin/homepage/preview',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A5';
      const auditAction = 'homepage.configuration.preview';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.read',
        auditAction,
      );
      if (!access) return;

      const rawBody =
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)
          : null;

      // Fail-closed evaluation timestamp check (C61) when evaluateAt key is present
      if (rawBody && Object.prototype.hasOwnProperty.call(rawBody, 'evaluateAt')) {
        const evalCheck = parseEvaluationTimestamp(rawBody.evaluateAt);
        if (!evalCheck.ok) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_EVALUATION_TIMESTAMP',
              message: evalCheck.message,
              requestId: request.id,
            },
          });
        }
      }

      const parsedBody = PreviewBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      if (parsedBody.data.configurationId) {
        const target = await verifyOpaqueConfigurationScope(
          request,
          reply,
          routeId,
          parsedBody.data.configurationId,
          access,
          auditAction,
        );
        if (!target) return;
      } else if (parsedBody.data.countryId) {
        const okScope = await verifyExplicitCountryScope(
          request,
          reply,
          routeId,
          parsedBody.data.countryId,
          access,
          auditAction,
        );
        if (!okScope) return;
      }

      const normalizedSlots = parsedBody.data.slots?.map((s) => ({
        slotKey: s.slotKey,
        mode: s.mode,
        sectionTitle: s.sectionTitle,
        sectionSubtitle: s.sectionSubtitle,
        maxItems: s.maxItems,
        items: s.items?.map((i) => ({
          position: i.position,
          entityId: i.entityId,
          startsAt: i.startsAt ? new Date(i.startsAt) : null,
          endsAt: i.endsAt ? new Date(i.endsAt) : null,
          pinNote: i.pinNote ?? null,
        })),
      }));

      track('C6', routeId);
      const preview = await adminService.previewHomepage({
        countryId: parsedBody.data.countryId,
        configurationId: parsedBody.data.configurationId,
        evaluateAt: parsedBody.data.evaluateAt,
        slots: normalizedSlots,
      });

      return reply.status(200).send({ data: preview });
    },
  );

  // A6: POST /api/v1/admin/homepage/configurations/:id/schedule (homepage.publish, opaque-ID)
  fastify.post<{ Params: { id: string } }>(
    '/admin/homepage/configurations/:id/schedule',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A6';
      const auditAction = 'homepage.configuration.schedule';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.publish',
        auditAction,
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const parsedBody = ScheduleBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const target = await verifyOpaqueConfigurationScope(
        request,
        reply,
        routeId,
        parsedParams.data.id,
        access,
        auditAction,
      );
      if (!target) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const scheduled = await adminService.scheduleConfiguration(
        target.id,
        parsedBody.data,
        {
          actorUserId: request.user!.id,
          actorSnapshot,
          requestId: request.id.slice(0, 64),
        },
      );

      return reply.status(200).send({ data: scheduled });
    },
  );

  // A7: POST /api/v1/admin/homepage/configurations/:id/publish (homepage.publish, opaque-ID)
  fastify.post<{ Params: { id: string } }>(
    '/admin/homepage/configurations/:id/publish',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A7';
      const auditAction = 'homepage.configuration.publish';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.publish',
        auditAction,
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const rawBody =
        request.body === undefined || request.body === null ? {} : request.body;
      const parsedBody = PublishBodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const target = await verifyOpaqueConfigurationScope(
        request,
        reply,
        routeId,
        parsedParams.data.id,
        access,
        auditAction,
      );
      if (!target) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const published = await adminService.publishConfiguration(
        target.id,
        parsedBody.data,
        {
          actorUserId: request.user!.id,
          actorSnapshot,
          requestId: request.id.slice(0, 64),
        },
      );

      return reply.status(200).send({ data: published });
    },
  );

  // A8: POST /api/v1/admin/homepage/drafts/:id/discard (homepage.manage, opaque-ID, DRAFT only)
  fastify.post<{ Params: { id: string } }>(
    '/admin/homepage/drafts/:id/discard',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A8';
      const auditAction = 'homepage.draft.discard';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.manage',
        auditAction,
      );
      if (!access) return;

      const parsedParams = UuidParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedParams.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const parsedBody = DiscardBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const target = await verifyOpaqueConfigurationScope(
        request,
        reply,
        routeId,
        parsedParams.data.id,
        access,
        auditAction,
      );
      if (!target) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const discarded = await adminService.discardDraft(
        target.id,
        parsedBody.data,
        {
          actorUserId: request.user!.id,
          actorSnapshot,
          requestId: request.id.slice(0, 64),
        },
      );

      return reply.status(200).send({ data: discarded });
    },
  );

  // A9: POST /api/v1/admin/homepage/rollback (homepage.publish, explicit-country)
  fastify.post(
    '/admin/homepage/rollback',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const routeId = 'A9';
      const auditAction = 'homepage.configuration.rollback';
      const access = await requireCoarseCapability(
        request,
        reply,
        routeId,
        'homepage.publish',
        auditAction,
      );
      if (!access) return;

      const parsedBody = RollbackBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
            requestId: request.id,
          },
        });
      }

      const okScope = await verifyExplicitCountryScope(
        request,
        reply,
        routeId,
        parsedBody.data.countryId,
        access,
        auditAction,
      );
      if (!okScope) return;

      const actorSnapshot = await resolveActorSnapshotResilient(request, routeId);
      track('C6', routeId);
      const rolledBack = await adminService.rollbackConfiguration(
        parsedBody.data,
        {
          actorUserId: request.user!.id,
          actorSnapshot,
          requestId: request.id.slice(0, 64),
        },
      );

      return reply.status(200).send({ data: rolledBack });
    },
  );
};
