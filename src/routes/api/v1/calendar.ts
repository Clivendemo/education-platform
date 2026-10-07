import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CalendarService,
  defaultCalendarService,
} from '../../../services/calendar/calendar.service.js';
import {
  type CalendarOwnershipContext,
  CalendarError,
} from '../../../services/calendar/calendar.interface.js';
import {
  AuthService,
  defaultAuthService,
  SESSION_COOKIE_NAME,
} from '../../../services/auth.service.js';
import { createRequireAuth } from './auth.js';

export const CALENDAR_SESSION_COOKIE_NAME = 'calendar_session';
const CALENDAR_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface CalendarRouteOptions {
  calendarService?: CalendarService;
  authService?: AuthService;
}

const CreateEventSchema = z.object({
  calendarId: z.string().uuid().optional(),
  eventTypeId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional().nullable(),
});

const UpdateEventSchema = z.object({
  eventTypeId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional().nullable(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
});

const CalendarFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  academicYear: z.string().optional(),
  countryId: z.string().uuid().optional(),
  eventTypeId: z.string().uuid().optional(),
});

const ExportCalendarSchema = z.object({
  format: z.literal('PDF').default('PDF'),
  title: z.string().max(150).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  academicYear: z.string().optional(),
  countryId: z.string().uuid().optional(),
});

export const calendarRoutes: FastifyPluginAsync<CalendarRouteOptions> = async (
  fastify,
  opts,
) => {
  const calendarService = opts.calendarService ?? defaultCalendarService;
  const authService = opts.authService ?? defaultAuthService;
  const requireAuth = createRequireAuth(authService);

  // Map Calendar domain errors and Zod validation errors to controlled HTTP error responses
  fastify.setErrorHandler((error: any, request, reply) => {
    if (error instanceof CalendarError) {
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

    // Delegate other errors to default error handler
    throw error;
  });

  /**
   * Helper to resolve request ownership context (authenticated user or anonymous session).
   */
  async function resolveContext(
    request: FastifyRequest,
    reply: FastifyReply,
    autoCreateSession = false,
  ): Promise<CalendarOwnershipContext> {
    // 1. Check authenticated user session
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (sessionToken) {
      const sessionResult = await authService.validateSession(sessionToken);
      if (sessionResult) {
        return {
          userId: sessionResult.user.id,
          isAuthenticated: true,
        };
      }
    }

    // 2. Check anonymous calendar session cookie or header
    let sessionId =
      request.cookies[CALENDAR_SESSION_COOKIE_NAME] ||
      (request.headers['x-calendar-session'] as string | undefined);

    if (!sessionId && autoCreateSession) {
      sessionId = randomUUID();
      reply.setCookie(CALENDAR_SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: CALENDAR_COOKIE_MAX_AGE_SECONDS,
      });
    }

    return {
      sessionId: sessionId || undefined,
      isAuthenticated: false,
    };
  }

  // 1. GET /calendar — Combined Calendar (Official + Personal)
  fastify.get('/calendar', async (request, reply) => {
    const filters = CalendarFilterSchema.parse(request.query);
    const context = await resolveContext(request, reply, false);
    const view = await calendarService.getCombinedCalendar(context, filters);
    return reply.status(200).send({ data: view });
  });

  // 2. GET /calendar/official — Official Platform Calendar Events
  fastify.get('/calendar/official', async (request, reply) => {
    const filters = CalendarFilterSchema.parse(request.query);
    const result = await calendarService.getOfficialCalendar(
      filters.countryId,
      filters.academicYear,
    );
    return reply.status(200).send({ data: result });
  });

  // 3. GET /calendar/event-types — Registry of Event Types
  fastify.get('/calendar/event-types', async (_request, reply) => {
    const types = await calendarService.getEventTypes();
    return reply.status(200).send({ data: types });
  });

  // 4. POST /calendar/session — Initialize or Touch Anonymous Calendar Session
  fastify.post('/calendar/session', async (request, reply) => {
    const context = await resolveContext(request, reply, true);
    if (!context.sessionId) {
      const newSessionId = randomUUID();
      reply.setCookie(CALENDAR_SESSION_COOKIE_NAME, newSessionId, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: CALENDAR_COOKIE_MAX_AGE_SECONDS,
      });
      context.sessionId = newSessionId;
    }
    const cal = await calendarService.getOrCreateAnonymousCalendar(context.sessionId);
    return reply.status(200).send({ data: { calendar: cal, sessionId: context.sessionId } });
  });

  // 5. GET /calendar/session — Retrieve Anonymous Calendar and Events
  fastify.get('/calendar/session', async (request, reply) => {
    const context = await resolveContext(request, reply, false);
    if (!context.sessionId) {
      return reply.status(404).send({
        error: {
          code: 'CALENDAR_SESSION_NOT_FOUND',
          message: 'No active anonymous calendar session found.',
          requestId: request.id,
        },
      });
    }
    const filters = CalendarFilterSchema.parse(request.query);
    const view = await calendarService.getCombinedCalendar(context, filters);
    return reply.status(200).send({ data: view });
  });

  // 6. POST /calendar/session/events — Add Event to Anonymous Calendar
  fastify.post('/calendar/session/events', async (request, reply) => {
    const body = CreateEventSchema.parse(request.body);
    const context = await resolveContext(request, reply, true);
    const event = await calendarService.createEvent(context, body);
    return reply.status(201).send({ data: event });
  });

  // 7. PATCH /calendar/session/events/:id — Update Anonymous Event
  fastify.patch<{ Params: { id: string } }>(
    '/calendar/session/events/:id',
    async (request, reply) => {
      const { id } = request.params;
      const body = UpdateEventSchema.parse(request.body);
      const context = await resolveContext(request, reply, false);
      if (!context.sessionId) {
        return reply.status(403).send({
          error: {
            code: 'UNAUTHORIZED_CALENDAR_ACCESS',
            message: 'Anonymous session required',
            requestId: request.id,
          },
        });
      }
      const updated = await calendarService.updateEvent(context, id, body);
      return reply.status(200).send({ data: updated });
    },
  );

  // 8. DELETE /calendar/session/events/:id — Delete Anonymous Event
  fastify.delete<{ Params: { id: string } }>(
    '/calendar/session/events/:id',
    async (request, reply) => {
      const { id } = request.params;
      const context = await resolveContext(request, reply, false);
      if (!context.sessionId) {
        return reply.status(403).send({
          error: {
            code: 'UNAUTHORIZED_CALENDAR_ACCESS',
            message: 'Anonymous session required',
            requestId: request.id,
          },
        });
      }
      await calendarService.deleteEvent(context, id);
      return reply.status(200).send({ data: { success: true } });
    },
  );

  // 9. POST /calendar/session/transfer — Transfer Anonymous Events to Authenticated Account
  fastify.post(
    '/calendar/session/transfer',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const sessionId =
        request.cookies[CALENDAR_SESSION_COOKIE_NAME] ||
        (request.headers['x-calendar-session'] as string | undefined);

      if (!sessionId) {
        return reply.status(400).send({
          error: {
            code: 'NO_ANONYMOUS_SESSION_TO_TRANSFER',
            message: 'No anonymous calendar session found to transfer.',
            requestId: request.id,
          },
        });
      }

      const result = await calendarService.transferAnonymousSession(user.id, sessionId);
      // Clear anonymous session cookie upon successful transfer
      reply.clearCookie(CALENDAR_SESSION_COOKIE_NAME, { path: '/' });
      return reply.status(200).send({ data: result });
    },
  );

  // 10. GET /me/calendar — Authenticated User's Calendar
  fastify.get('/me/calendar', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = (request as any).user;
    const filters = CalendarFilterSchema.parse(request.query);
    const context: CalendarOwnershipContext = {
      userId: user.id,
      isAuthenticated: true,
    };
    const view = await calendarService.getCombinedCalendar(context, filters);
    return reply.status(200).send({ data: view });
  });

  // 11. POST /me/calendar/events — Create Event in Authenticated User's Calendar
  fastify.post(
    '/me/calendar/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const body = CreateEventSchema.parse(request.body);
      const context: CalendarOwnershipContext = {
        userId: user.id,
        isAuthenticated: true,
      };
      const event = await calendarService.createEvent(context, body);
      return reply.status(201).send({ data: event });
    },
  );

  // 12. PATCH /me/calendar/events/:id — Update Authenticated User's Event
  fastify.patch<{ Params: { id: string } }>(
    '/me/calendar/events/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const { id } = request.params;
      const body = UpdateEventSchema.parse(request.body);
      const context: CalendarOwnershipContext = {
        userId: user.id,
        isAuthenticated: true,
      };
      const updated = await calendarService.updateEvent(context, id, body);
      return reply.status(200).send({ data: updated });
    },
  );

  // 13. DELETE /me/calendar/events/:id — Delete Authenticated User's Event
  fastify.delete<{ Params: { id: string } }>(
    '/me/calendar/events/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = (request as any).user;
      const { id } = request.params;
      const context: CalendarOwnershipContext = {
        userId: user.id,
        isAuthenticated: true,
      };
      await calendarService.deleteEvent(context, id);
      return reply.status(200).send({ data: { success: true } });
    },
  );

  // 14. POST /calendar/export — Request Calendar PDF Export
  fastify.post('/calendar/export', async (request, reply) => {
    const body = ExportCalendarSchema.parse(request.body || {});
    const context = await resolveContext(request, reply, false);
    const exportResult = await calendarService.exportCalendar(context, body);
    return reply.status(200).send({ data: exportResult });
  });

  // 15. GET /calendar/export/:id — Retrieve Calendar Export Status & Download URL
  fastify.get<{ Params: { id: string } }>(
    '/calendar/export/:id',
    async (request, reply) => {
      const { id } = request.params;
      const context = await resolveContext(request, reply, false);
      const result = await calendarService.getExport(context, id);
      return reply.status(200).send({ data: result });
    },
  );
};
