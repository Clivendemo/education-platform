import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import {
  users,
  userSessions,
  roles,
  userRoles,
} from '../../src/db/schemas.js';
import { SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';

describe('Analytics Route Integration Tests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let standardToken: string;

  async function createTestUserWithRole(roleSlug: string): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID();
    const email = `analytics-test-${roleSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const token = `token-${crypto.randomUUID()}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.insert(users).values({
      id,
      email,
      displayName: `Analytics User ${roleSlug}`,
      status: 'ACTIVE',
    });

    await db.insert(userSessions).values({
      id: crypto.randomUUID(),
      userId: id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug)).limit(1);
    if (role) {
      await db.insert(userRoles).values({
        userId: id,
        roleId: role.id,
        status: 'ACTIVE',
      });
    }

    return { id, token };
  }

  function getAuthCookie(token: string) {
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const admin = await createTestUserWithRole('system_admin');
    adminToken = admin.token;

    const manager = await createTestUserWithRole('content_manager');
    managerToken = manager.token;

    const standard = await createTestUserWithRole('standard_user');
    standardToken = standard.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/analytics/events (Public Ingestion)', () => {
    it('successfully records a valid anonymous view event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-anonymous-session-id': 'client-anon-test-session',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/123e4567-e89b-12d3-a456-426614174000',
            referrer_type: 'search',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.status).toBe('RECORDED');
      expect(body.data.eventId).toBeDefined();
    });

    it('successfully records a valid authenticated view event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          cookie: getAuthCookie(standardToken),
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/123e4567-e89b-12d3-a456-426614174000',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.status).toBe('RECORDED');
    });

    it('deduplicates events with identical idempotencyKey', async () => {
      const key = `route-idemp-${Date.now()}`;
      const payload = {
        eventCode: 'view',
        idempotencyKey: key,
        anonymousSessionId: 'sess-123',
        context: {
          entity_type: 'resource',
          entity_id: '123e4567-e89b-12d3-a456-426614174000',
          path: '/resources/123',
        },
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        payload,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().data.status).toBe('RECORDED');

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        payload,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().data.status).toBe('DEDUPLICATED');
    });

    it('rejects events with unknown context fields (strict allowlist enforcement)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-anonymous-session-id': 'sess-fail',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/test',
            unauthorized_field: 'leak_data',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects events with invalid path traversal in context', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-anonymous-session-id': 'sess-traversal',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/%2e%2e%2fadmin',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('isolates rate limits by trusted-proxy client IP (X-Forwarded-For)', async () => {
      const spoofedIp1 = '198.51.100.1';
      const spoofedIp2 = '198.51.100.2';

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-forwarded-for': `${spoofedIp1}, 10.0.0.1`,
          'x-anonymous-session-id': 'sess-proxy-1',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/123',
          },
        },
      });

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-forwarded-for': `${spoofedIp2}, 10.0.0.1`,
          'x-anonymous-session-id': 'sess-proxy-2',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/resources/123',
          },
        },
      });

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(res1.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res2.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('persists Unicode and multilingual context properly', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers: {
          'x-anonymous-session-id': 'sess-unicode',
        },
        payload: {
          eventCode: 'view',
          context: {
            entity_type: 'resource',
            entity_id: '123e4567-e89b-12d3-a456-426614174000',
            path: '/ke/elimu/kiswahili-darasa-la-nne',
            referrer_type: 'direct',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('RECORDED');
    });
  });

  describe('GET /api/v1/admin/analytics/overview (RBAC & Reporting)', () => {
    it('returns 401 for unauthenticated request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/overview?startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-02T00:00:00.000Z',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for standard user without analytics.read permission', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/overview?startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-02T00:00:00.000Z',
        headers: {
          cookie: getAuthCookie(standardToken),
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 for content_manager with analytics.read permission', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/overview?startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-02T00:00:00.000Z',
        headers: {
          cookie: getAuthCookie(managerToken),
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.metrics).toBeDefined();
      expect(body.data.metrics.actionCount).toBeDefined();
      expect(body.data.metrics.authenticatedUsers).toBeDefined();
      expect(body.data.metrics.pureAnonymousSessions).toBeDefined();
      expect(body.data.metrics.estimatedActorCount).toBeDefined();
    });

    it('returns 200 for system_admin with analytics.read permission', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/overview?startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-02T00:00:00.000Z',
        headers: {
          cookie: getAuthCookie(adminToken),
        },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Event Type Management (RBAC & Invalidation)', () => {
    it('allows system_admin to list and update event types', async () => {
      // List
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/event-types',
        headers: {
          cookie: getAuthCookie(adminToken),
        },
      });
      expect(listRes.statusCode).toBe(200);
      const list = listRes.json().data;
      expect(list.length).toBeGreaterThan(0);

      const target = list[0];

      // Update status
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/analytics/event-types/${target.id}`,
        headers: {
          cookie: getAuthCookie(adminToken),
        },
        payload: {
          status: 'ACTIVE',
        },
      });
      expect(patchRes.statusCode).toBe(200);
    });

    it('returns 403 when content_manager tries to manage event types', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/analytics/event-types',
        headers: {
          cookie: getAuthCookie(managerToken),
        },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
