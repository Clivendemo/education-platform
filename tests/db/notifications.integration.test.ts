import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  notifications,
  notificationDeliveries,
  userNotificationPreferences,
} from '../../src/db/schemas.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Notifications Database Layer Integration Tests', () => {
  let testUserId: string;

  beforeAll(async () => {
    testUserId = crypto.randomUUID();
    const email = `notif-db-test-${Date.now()}@example.com`;

    await withDbRetry(async () =>
      db.insert(users).values({
        id: testUserId,
        email,
        displayName: 'Notification DB Tester',
        status: 'ACTIVE',
      }),
    );
  });

  afterAll(async () => {
    try {
      if (testUserId) {
        await withDbRetry(async () =>
          db.delete(users).where(eq(users.id, testUserId)),
        );
      }
    } catch {
      // Ignore cleanup error
    }
    await closeDatabase();
  });

  describe('1. Notifications Table Invariants', () => {
    it('enforces chk_notifications_category on invalid category', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'INVALID_CATEGORY' as any,
            notificationType: 'TEST_ALERT',
            title: 'Test Title',
            message: 'Test Message',
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_notifications_category/i);
    });

    it('enforces chk_notifications_priority on invalid priority', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'TEST_ALERT',
            title: 'Test Title',
            message: 'Test Message',
            priority: 'SUPER_URGENT' as any,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_notifications_priority/i);
    });

    it('enforces chk_notifications_lifecycle: rejects UNREAD with read_at populated', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'TEST_ALERT',
            title: 'Test Title',
            message: 'Test Message',
            status: 'UNREAD',
            readAt: new Date(), // Invalid for UNREAD!
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_notifications_lifecycle/i);
    });

    it('enforces chk_notifications_lifecycle: rejects READ with read_at NULL', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'TEST_ALERT',
            title: 'Test Title',
            message: 'Test Message',
            status: 'READ',
            readAt: null, // Invalid for READ!
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_notifications_lifecycle/i);
    });

    it('enforces chk_notifications_lifecycle: rejects ARCHIVED with archived_at NULL', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'TEST_ALERT',
            title: 'Test Title',
            message: 'Test Message',
            status: 'ARCHIVED',
            archivedAt: null, // Invalid for ARCHIVED!
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_notifications_lifecycle/i);
    });

    it('accepts ARCHIVED notification preserving prior read_at timestamp', async () => {
      const readTime = new Date('2026-10-15T12:00:00Z');
      const archiveTime = new Date('2026-10-16T12:00:00Z');

      const [row] = await withDbRetry(async () =>
        db
          .insert(notifications)
          .values({
            userId: testUserId,
            category: 'EDITORIAL',
            notificationType: 'TEST_ARCHIVED',
            title: 'Archived After Read',
            message: 'Preserves read timestamp',
            status: 'ARCHIVED',
            readAt: readTime,
            archivedAt: archiveTime,
          })
          .returning(),
      );

      expect(row.id).toBeDefined();
      expect(row.readAt).toBeDefined();
      expect(row.archivedAt).toBeDefined();
    });

    it('enforces uq_notifications_user_dedup: prevents duplicate non-null deduplicationKey for same user', async () => {
      const dedupKey = `dedup-test-${crypto.randomUUID()}`;

      // First insert succeeds
      await withDbRetry(async () =>
        db.insert(notifications).values({
          userId: testUserId,
          category: 'TRANSACTIONAL',
          notificationType: 'PAYMENT_RECEIPT',
          title: 'First Receipt',
          message: 'Payment received',
          deduplicationKey: dedupKey,
        }),
      );

      // Second insert with identical key MUST fail with 23505
      let duplicateErr: any;
      try {
        await withDbRetry(async () =>
          db.insert(notifications).values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'PAYMENT_RECEIPT',
            title: 'Second Receipt',
            message: 'Duplicate payment received',
            deduplicationKey: dedupKey,
          }),
        );
      } catch (e: any) {
        duplicateErr = e;
      }

      expect(duplicateErr).toBeDefined();
      const combined = `${duplicateErr?.message || ''} ${duplicateErr?.cause?.message || ''}`;
      expect(combined).toMatch(/uq_notifications_user_dedup|unique constraint|duplicate key/i);
    });

    it('allows multiple notifications with NULL deduplicationKey for the same user', async () => {
      const rows = await withDbRetry(async () =>
        db
          .insert(notifications)
          .values([
            {
              userId: testUserId,
              category: 'EDITORIAL',
              notificationType: 'GENERAL_NOTICE',
              title: 'Notice 1',
              message: 'First null dedup notice',
              deduplicationKey: null,
            },
            {
              userId: testUserId,
              category: 'EDITORIAL',
              notificationType: 'GENERAL_NOTICE',
              title: 'Notice 2',
              message: 'Second null dedup notice',
              deduplicationKey: null,
            },
          ])
          .returning(),
      );

      expect(rows).toHaveLength(2);
    });
  });

  describe('2. Notification Deliveries Table Invariants', () => {
    let testNotificationId: string;

    beforeAll(async () => {
      const [notif] = await withDbRetry(async () =>
        db
          .insert(notifications)
          .values({
            userId: testUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'DELIVERY_TEST',
            title: 'Delivery Invariants Test',
            message: 'Testing delivery constraints',
          })
          .returning(),
      );
      testNotificationId = notif.id;
    });

    it('enforces chk_deliveries_invariants: rejects IN_APP DELIVERED with attempt_count > 0', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'IN_APP',
            status: 'DELIVERED',
            provider: 'IN_APP_SYSTEM',
            deliveredAt: new Date(),
            attemptCount: 1, // Invalid: must be 0 for sync in-app!
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_invariants/i);
    });

    it('enforces chk_deliveries_invariants: rejects SENT with failed_at populated', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'EMAIL',
            status: 'SENT',
            provider: 'MOCK_EMAIL',
            sentAt: new Date(),
            failedAt: new Date(), // Contradictory: cannot have failed_at on SENT!
            attemptCount: 1,
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_invariants/i);
    });

    it('enforces chk_deliveries_invariants: rejects FAILED without error_message', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'EMAIL',
            status: 'FAILED',
            failedAt: new Date(),
            attemptCount: 3,
            maxAttempts: 3,
            errorMessage: null, // Invalid: FAILED must have error_message!
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_invariants/i);
    });

    it('enforces chk_deliveries_invariants: rejects PROCESSING without locked_at or locked_by', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'EMAIL',
            status: 'PROCESSING',
            attemptCount: 1,
            lockedAt: null, // Invalid: PROCESSING must have locked_at!
            lockedBy: 'worker-1',
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_invariants/i);
    });

    it('enforces chk_deliveries_invariants: rejects SKIPPED with attempt_count > 0', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'EMAIL',
            status: 'SKIPPED',
            attemptCount: 1, // Invalid: SKIPPED must have attempt_count = 0!
            errorMessage: 'User opted out',
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_invariants/i);
    });

    it('enforces chk_deliveries_attempts: rejects attempt_count > max_attempts', async () => {
      let err: any;
      try {
        await withDbRetry(async () =>
          db.insert(notificationDeliveries).values({
            notificationId: testNotificationId,
            channel: 'EMAIL',
            status: 'FAILED',
            failedAt: new Date(),
            attemptCount: 4, // Invalid: > maxAttempts (3)
            maxAttempts: 3,
            errorMessage: 'Exceeded attempts',
            nextRetryAt: null,
          }),
        );
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const combined = `${err?.message || ''} ${err?.cause?.message || ''}`;
      expect(combined).toMatch(/chk_deliveries_attempts/i);
    });
  });

  describe('3. Foreign Key Cascades & Cleanup', () => {
    it('cascades deletion of user to notifications, deliveries, and preferences', async () => {
      // 1. Create a user to be deleted
      const tempUserId = crypto.randomUUID();
      await withDbRetry(async () =>
        db.insert(users).values({
          id: tempUserId,
          email: `cascade-test-${Date.now()}@example.com`,
          displayName: 'Cascade Test User',
          status: 'ACTIVE',
        }),
      );

      // 2. Insert preferences
      await withDbRetry(async () =>
        db.insert(userNotificationPreferences).values({
          userId: tempUserId,
          emailEnabled: false,
          inAppEnabled: true,
        }),
      );

      // 3. Insert notification and delivery
      const [tempNotif] = await withDbRetry(async () =>
        db
          .insert(notifications)
          .values({
            userId: tempUserId,
            category: 'TRANSACTIONAL',
            notificationType: 'TEST_CASCADE',
            title: 'Will be deleted',
            message: 'Cascade test message',
          })
          .returning(),
      );

      await withDbRetry(async () =>
        db.insert(notificationDeliveries).values({
          notificationId: tempNotif.id,
          channel: 'IN_APP',
          status: 'DELIVERED',
          provider: 'IN_APP_SYSTEM',
          deliveredAt: new Date(),
          attemptCount: 0,
          nextRetryAt: null,
        }),
      );

      // 4. Delete user
      await withDbRetry(async () =>
        db.delete(users).where(eq(users.id, tempUserId)),
      );

      // 5. Verify all child records were cleanly cascaded
      const remainingNotifs = await withDbRetry(async () =>
        db.select().from(notifications).where(eq(notifications.id, tempNotif.id)),
      );
      expect(remainingNotifs).toHaveLength(0);

      const remainingDeliveries = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, tempNotif.id)),
      );
      expect(remainingDeliveries).toHaveLength(0);

      const remainingPrefs = await withDbRetry(async () =>
        db
          .select()
          .from(userNotificationPreferences)
          .where(eq(userNotificationPreferences.userId, tempUserId)),
      );
      expect(remainingPrefs).toHaveLength(0);
    });
  });
});
