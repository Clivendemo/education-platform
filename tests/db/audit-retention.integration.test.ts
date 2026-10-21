import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, getDatabasePool } from '../../src/db/index.js';
import {
  users,
  auditLogs,
  retentionPolicies,
  retentionPolicyVersions,
  dataRetentionActions,
} from '../../src/db/schemas.js';
import { defaultRetentionService } from '../../src/services/retention.service.js';

describe('Audit & Retention Database Integration Tests', () => {
  beforeAll(async () => {
    // Ensure canonical policies are seeded
    await defaultRetentionService.seedInitialPolicies();
  });

  describe('Append-Only Immutability Triggers', () => {
    it('prevents UPDATE operations on governance.audit_logs', async () => {
      const eventId = `test-immut-update-${crypto.randomUUID()}`;
      const [inserted] = await db
        .insert(auditLogs)
        .values({
          eventId,
          action: 'test.immutable',
          entityType: 'test',
          actorType: 'SYSTEM',
          outcome: 'SUCCESS',
          context: { test: true },
        })
        .returning();

      const pool = getDatabasePool();
      const client = await pool.connect();
      try {
        await expect(
          client.query('UPDATE governance.audit_logs SET action = $1 WHERE id = $2', ['tampered.action', inserted.id]),
        ).rejects.toThrow(/governance\.audit_logs is append-only: UPDATE and DELETE operations are forbidden/);
      } finally {
        client.release();
      }
    });

    it('prevents DELETE operations on governance.audit_logs', async () => {
      const eventId = `test-immut-delete-${crypto.randomUUID()}`;
      const [inserted] = await db
        .insert(auditLogs)
        .values({
          eventId,
          action: 'test.immutable',
          entityType: 'test',
          actorType: 'SYSTEM',
          outcome: 'SUCCESS',
        })
        .returning();

      const pool = getDatabasePool();
      const client = await pool.connect();
      try {
        await expect(
          client.query('DELETE FROM governance.audit_logs WHERE id = $1', [inserted.id]),
        ).rejects.toThrow(/governance\.audit_logs is append-only: UPDATE and DELETE operations are forbidden/);
      } finally {
        client.release();
      }
    });

    it('prevents UPDATE and DELETE operations on governance.retention_policy_versions', async () => {
      const [policy] = await db
        .select()
        .from(retentionPolicies)
        .limit(1);

      expect(policy).toBeDefined();

      const [version] = await db
        .select()
        .from(retentionPolicyVersions)
        .where(eq(retentionPolicyVersions.policyId, policy.id))
        .limit(1);

      expect(version).toBeDefined();

      const pool = getDatabasePool();
      const client = await pool.connect();
      try {
        await expect(
          client.query('UPDATE governance.retention_policy_versions SET change_reason = $1 WHERE id = $2', [
            'tampered reason',
            version.id,
          ]),
        ).rejects.toThrow(/governance\.retention_policy_versions is append-only: UPDATE and DELETE operations are forbidden/);

        await expect(
          client.query('DELETE FROM governance.retention_policy_versions WHERE id = $1', [version.id]),
        ).rejects.toThrow(/governance\.retention_policy_versions is append-only: UPDATE and DELETE operations are forbidden/);
      } finally {
        client.release();
      }
    });
  });

  describe('Database Check Constraints', () => {
    it('enforces 4,096-byte octet_length constraint on audit context', async () => {
      const oversizedContext = { data: 'a'.repeat(4100) };
      const pool = getDatabasePool();
      const client = await pool.connect();
      try {
        await expect(
          client.query(
            `INSERT INTO governance.audit_logs (
              event_id, action, entity_type, actor_type, outcome, context
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), 'test.overflow', 'test', 'SYSTEM', 'SUCCESS', JSON.stringify(oversizedContext)],
          ),
        ).rejects.toThrow(/chk_audit_logs_context_bytes/);
      } finally {
        client.release();
      }
    });

    it('enforces 2,048-byte octet_length constraint on actor snapshot', async () => {
      const oversizedSnapshot = { role: 'r'.repeat(2100) };
      const pool = getDatabasePool();
      const client = await pool.connect();
      try {
        await expect(
          client.query(
            `INSERT INTO governance.audit_logs (
              event_id, action, entity_type, actor_type, outcome, actor_snapshot
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), 'test.overflow', 'test', 'SYSTEM', 'SUCCESS', JSON.stringify(oversizedSnapshot)],
          ),
        ).rejects.toThrow(/chk_audit_logs_actor_snapshot_bytes/);
      } finally {
        client.release();
      }
    });
  });

  describe('Actor Identity Retention on User Account Deletion', () => {
    it('preserves immutable actor_snapshot when referenced user row is deleted', async () => {
      const userId = crypto.randomUUID();
      const userEmail = `ephemeral-user-${Date.now()}@example.com`;

      await db.insert(users).values({
        id: userId,
        email: userEmail,
        displayName: 'Temporary Actor',
        status: 'ACTIVE',
      });

      const eventId = `audit-actor-snapshot-${crypto.randomUUID()}`;
      const actorSnapshot = {
        actorId: userId,
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'system_admin',
        emailDomain: 'example.com',
      };

      const [log] = await db
        .insert(auditLogs)
        .values({
          eventId,
          action: 'user.delete_test',
          entityType: 'user',
          entityId: userId,
          actorType: 'AUTHENTICATED',
          actorUserId: userId,
          actorSnapshot,
          outcome: 'SUCCESS',
        })
        .returning();

      expect(log.actorUserId).toBe(userId);

      // Delete the user account
      await db.delete(users).where(eq(users.id, userId));

      // Query audit log directly
      const [afterDelete] = await db.select().from(auditLogs).where(eq(auditLogs.id, log.id)).limit(1);

      // Foreign key nullified gracefully
      expect(afterDelete.actorUserId).toBeNull();
      // Actor snapshot remains permanently preserved
      expect(afterDelete.actorSnapshot).toEqual(actorSnapshot);
    });
  });

  describe('Atomic Business Mutation & Audit Rollback', () => {
    it('rolls back business state mutation if audit insert fails', async () => {
      const testUserId = crypto.randomUUID();
      await db.insert(users).values({
        id: testUserId,
        email: `atomic-rollback-${Date.now()}@example.com`,
        displayName: 'Atomic Test User',
        status: 'ACTIVE',
      });

      try {
        await db.transaction(async (tx) => {
          // Mutate user displayName
          await tx
            .update(users)
            .set({ displayName: 'Changed In Transaction' })
            .where(eq(users.id, testUserId));

          // Deliberately trigger constraint violation in audit write
          const illegalContext = { overflow: 'x'.repeat(5000) };
          await tx.insert(auditLogs).values({
            eventId: crypto.randomUUID(),
            action: 'test.rollback',
            entityType: 'user',
            entityId: testUserId,
            actorType: 'SYSTEM',
            outcome: 'SUCCESS',
            context: illegalContext,
          });
        });
      } catch (err) {
        // Expected transaction rollback
      }

      // Verify user displayName was rolled back to original
      const [revertedUser] = await db.select().from(users).where(eq(users.id, testUserId)).limit(1);
      expect(revertedUser.displayName).toBe('Atomic Test User');

      // Cleanup test user
      await db.delete(users).where(eq(users.id, testUserId));
    });
  });

  describe('Canonical Seed Integrity & Execution Lineage', () => {
    it('verifies all 5 canonical retention policies are present in database', async () => {
      const policies = await db.select().from(retentionPolicies);
      const codes = policies.map((p) => p.policyCode);

      expect(codes).toContain('RET_USER_SESSIONS_30D');
      expect(codes).toContain('RET_ANALYTICS_EVENTS_180D');
      expect(codes).toContain('RET_NOTIF_DELIVERIES_90D');
      expect(codes).toContain('RET_FEEDBACK_ANON_180D');
      expect(codes).toContain('RET_AUDIT_LOGS_7Y');

      const feedbackPolicy = policies.find((p) => p.policyCode === 'RET_FEEDBACK_ANON_180D');
      expect(feedbackPolicy?.status).toBe('INACTIVE');

      const auditPolicy = policies.find((p) => p.policyCode === 'RET_AUDIT_LOGS_7Y');
      expect(auditPolicy?.status).toBe('INACTIVE');
      expect(auditPolicy?.retentionDurationDays).toBe(2555);
    });

    it('enforces execution lineage with resumed_from_execution_id RESTRICT constraint', async () => {
      const [policy] = await db
        .select()
        .from(retentionPolicies)
        .where(eq(retentionPolicies.policyCode, 'RET_USER_SESSIONS_30D'))
        .limit(1);

      const parentExecutionId = `parent-exec-${crypto.randomUUID()}`;
      const [parent] = await db
        .insert(dataRetentionActions)
        .values({
          executionId: parentExecutionId,
          policyId: policy.id,
          policyVersion: policy.version,
          dataCategory: policy.dataCategory,
          action: 'DELETE',
          status: 'PARTIAL',
          cutoffTime: new Date(),
        })
        .returning();

      const childExecutionId = `child-exec-${crypto.randomUUID()}`;
      const [child] = await db
        .insert(dataRetentionActions)
        .values({
          executionId: childExecutionId,
          policyId: policy.id,
          policyVersion: policy.version,
          dataCategory: policy.dataCategory,
          action: 'DELETE',
          status: 'RUNNING',
          cutoffTime: new Date(),
          resumedFromExecutionId: parent.id,
        })
        .returning();

      expect(child.resumedFromExecutionId).toBe(parent.id);

      // Attempting to delete parent execution while child references it must fail due to ON DELETE RESTRICT
      await expect(
        db.delete(dataRetentionActions).where(eq(dataRetentionActions.id, parent.id)),
      ).rejects.toThrow();

      // Clean up child first, then parent
      await db.delete(dataRetentionActions).where(eq(dataRetentionActions.id, child.id));
      await db.delete(dataRetentionActions).where(eq(dataRetentionActions.id, parent.id));
    });
  });
});
