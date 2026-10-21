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
  retentionPolicies,
  dataRetentionActions,
} from '../../src/db/schemas.js';
import { SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { defaultRetentionService } from '../../src/services/retention.service.js';

describe('Audit & Retention Route Integration Tests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let standardToken: string;
  let activePolicyId: string;
  let inactivePolicyId: string;

  async function createTestUserWithRole(roleSlug: string): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID();
    const email = `audit-test-${roleSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const token = `token-${crypto.randomUUID()}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.insert(users).values({
      id,
      email,
      displayName: `Audit User ${roleSlug}`,
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

    await defaultRetentionService.seedInitialPolicies();

    const admin = await createTestUserWithRole('system_admin');
    adminToken = admin.token;

    const manager = await createTestUserWithRole('content_manager');
    managerToken = manager.token;

    const standard = await createTestUserWithRole('standard_user');
    standardToken = standard.token;

    const [activePolicy] = await db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.policyCode, 'RET_USER_SESSIONS_30D'))
      .limit(1);
    activePolicyId = activePolicy.id;

    const [inactivePolicy] = await db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.policyCode, 'RET_FEEDBACK_ANON_180D'))
      .limit(1);
    inactivePolicyId = inactivePolicy.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication Enforcement', () => {
    it('returns 401 when no session cookie is provided', async () => {
      const auditRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
      });
      expect(auditRes.statusCode).toBe(401);

      const policiesRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/policies',
      });
      expect(policiesRes.statusCode).toBe(401);

      const dryRunRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/dry-run',
        payload: { policyId: activePolicyId },
      });
      expect(dryRunRes.statusCode).toBe(401);
    });
  });

  describe('Audit Logs Endpoints & RBAC (audit.read)', () => {
    it('allows system_admin to query audit logs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs?pageSize=10',
        headers: { cookie: getAuthCookie(adminToken) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it('denies content_manager and standard_user from querying audit logs (403)', async () => {
      const managerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
        headers: { cookie: getAuthCookie(managerToken) },
      });
      expect(managerRes.statusCode).toBe(403);

      const standardRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
        headers: { cookie: getAuthCookie(standardToken) },
      });
      expect(standardRes.statusCode).toBe(403);
    });
  });

  describe('Retention Policy Endpoints & RBAC (retention.read & retention.manage)', () => {
    it('allows content_manager and system_admin to read retention policies', async () => {
      const managerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/policies',
        headers: { cookie: getAuthCookie(managerToken) },
      });
      expect(managerRes.statusCode).toBe(200);
      const managerBody = managerRes.json();
      expect(managerBody.success).toBe(true);
      expect(managerBody.data.length).toBeGreaterThanOrEqual(5);

      const adminRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/policies',
        headers: { cookie: getAuthCookie(adminToken) },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('denies standard_user from reading retention policies (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/policies',
        headers: { cookie: getAuthCookie(standardToken) },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows system_admin to create a retention policy', async () => {
      const policyCode = `RET_TEST_${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/policies',
        headers: { cookie: getAuthCookie(adminToken) },
        payload: {
          policyCode,
          name: 'Integration Test Policy',
          description: 'Testing creation via API',
          dataCategory: 'USER_SESSIONS',
          targetIdentifier: 'identity.user_sessions',
          referencePoint: 'expires_at',
          retentionDurationDays: 60,
          disposition: 'DELETE',
          legalBasis: 'Test basis',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.policyCode).toBe(policyCode);
      expect(body.data.version).toBe(1);
    });

    it('denies content_manager from creating a retention policy (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/policies',
        headers: { cookie: getAuthCookie(managerToken) },
        payload: {
          policyCode: `RET_DENIED_${Date.now()}`,
          name: 'Denied Policy',
          dataCategory: 'USER_SESSIONS',
          targetIdentifier: 'identity.user_sessions',
          referencePoint: 'expires_at',
          retentionDurationDays: 60,
          disposition: 'DELETE',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows system_admin to update a retention policy with mandatory changeReason', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/retention/policies/${activePolicyId}`,
        headers: { cookie: getAuthCookie(adminToken) },
        payload: {
          name: 'Updated Session Policy Title',
          changeReason: 'Clarified title in compliance review',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Updated Session Policy Title');
      expect(body.data.version).toBeGreaterThan(1);
    });
  });

  describe('Dry-Run & Live Execution Endpoints (retention.execute)', () => {
    it('executes point-in-time dry run successfully for content_manager and system_admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/dry-run',
        headers: { cookie: getAuthCookie(managerToken) },
        payload: { policyId: activePolicyId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.isDryRun).toBe(true);
      expect(typeof body.data.pointInTimeEstimatedCount).toBe('number');
      expect(body.data.cutoffTime).toBeDefined();
    });

    it('rejects live execution for content_manager (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/execute',
        headers: { cookie: getAuthCookie(managerToken) },
        payload: { policyId: activePolicyId },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects live execution of an INACTIVE policy (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/execute',
        headers: { cookie: getAuthCookie(adminToken) },
        payload: { policyId: inactivePolicyId },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Only ACTIVE policies can be executed/);
    });

    it('initiates live asynchronous execution for system_admin (202 Accepted)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/execute',
        headers: { cookie: getAuthCookie(adminToken) },
        payload: { policyId: activePolicyId },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('RUNNING');
      expect(body.data.executionId).toBeDefined();
      expect(body.data.pollUrl).toBeDefined();

      // Poll execution status
      const pollRes = await app.inject({
        method: 'GET',
        url: body.data.pollUrl,
        headers: { cookie: getAuthCookie(adminToken) },
      });
      expect(pollRes.statusCode).toBe(200);
      const pollBody = pollRes.json();
      expect(pollBody.success).toBe(true);
      expect(pollBody.data.executionId).toBe(body.data.executionId);
    });

    it('rejects resuming already COMPLETED execution', async () => {
      // Create a dummy completed action
      const completedExecId = `completed-${crypto.randomUUID()}`;
      await db.insert(dataRetentionActions).values({
        executionId: completedExecId,
        policyId: activePolicyId,
        policyVersion: 1,
        dataCategory: 'USER_SESSIONS',
        action: 'DELETE',
        status: 'COMPLETED',
        cutoffTime: new Date(),
        completedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/executions/${completedExecId}/recover`,
        headers: { cookie: getAuthCookie(adminToken) },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/already COMPLETED and cannot be resumed/);
    });
  });
});
