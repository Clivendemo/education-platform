import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  userSessions,
  roles,
  userRoles,
  notifications,
  notificationDeliveries,
} from '../../src/db/schemas.js';
import {
  DefaultNotificationService,
} from '../../src/services/notification.service.js';
import { MockEmailDeliveryProvider } from '../../src/services/notifications/mock-email-provider.js';
import { MockSmsDeliveryProvider } from '../../src/services/notifications/mock-sms-provider.js';
import { SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Notifications Route & Worker Integration Tests', () => {
  let app: FastifyInstance;
  let customMockEmailProvider: MockEmailDeliveryProvider;
  let customMockSmsProvider: MockSmsDeliveryProvider;
  let notificationService: DefaultNotificationService;

  // Test users & tokens
  let userAId: string;
  let userAToken: string;

  let userBId: string;
  let userBToken: string;

  let reviewerId: string;
  let reviewerToken: string;

  let managerId: string;
  let managerToken: string;

  let adminId: string;
  let adminToken: string;

  async function createTestUserWithRole(roleSlug: string): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID();
    const email = `notif-user-${roleSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const token = `token-${crypto.randomUUID()}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await withDbRetry(async () => {
      await db.insert(users).values({
        id,
        email,
        displayName: `Notification User ${roleSlug}`,
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
    });

    return { id, token };
  }

  function getAuthCookie(token: string) {
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    customMockEmailProvider = new MockEmailDeliveryProvider();
    customMockSmsProvider = new MockSmsDeliveryProvider();

    notificationService = new DefaultNotificationService(
      db,
      customMockEmailProvider,
      customMockSmsProvider,
    );

    app = buildApp({
      logger: false,
      services: {
        notificationService,
      },
    });
    await app.ready();

    // Create users
    const uA = await createTestUserWithRole('standard_user');
    userAId = uA.id;
    userAToken = uA.token;

    const uB = await createTestUserWithRole('standard_user');
    userBId = uB.id;
    userBToken = uB.token;

    const uRev = await createTestUserWithRole('content_reviewer');
    reviewerId = uRev.id;
    reviewerToken = uRev.token;

    const uMgr = await createTestUserWithRole('content_manager');
    managerId = uMgr.id;
    managerToken = uMgr.token;

    const uAdm = await createTestUserWithRole('system_admin');
    adminId = uAdm.id;
    adminToken = uAdm.token;
  });

  afterAll(async () => {
    try {
      await app.close();
      const userIds = [userAId, userBId, reviewerId, managerId, adminId].filter(Boolean);
      for (const uid of userIds) {
        await withDbRetry(async () =>
          db.delete(users).where(eq(users.id, uid)),
        );
      }
    } catch {
      // Ignore cleanup error
    }
    await closeDatabase();
  });

  describe('1. Synchronous In-App Notification Delivery & User Inbox', () => {
    let createdNotifId: string;

    it('synchronously records in-app delivery as DELIVERED with attempt_count = 0', async () => {
      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'RESOURCE_APPROVED',
        title: 'Resource Approved!',
        message: 'Your resource version has been approved for publication.',
        channels: ['IN_APP'],
      });

      createdNotifId = notif.id;
      expect(notif.status).toBe('UNREAD');
      expect(notif.readAt).toBeNull();
      expect(notif.archivedAt).toBeNull();

      // Verify delivery record in database
      const [delivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, notif.id))
          .limit(1),
      );

      expect(delivery).toBeDefined();
      expect(delivery.channel).toBe('IN_APP');
      expect(delivery.status).toBe('DELIVERED');
      expect(delivery.provider).toBe('IN_APP_SYSTEM');
      expect(delivery.attemptCount).toBe(0); // Synchronous: no worker attempts
      expect(delivery.nextRetryAt).toBeNull();
      expect(delivery.deliveredAt).toBeDefined();
    });

    it('queries user inbox immediately without background worker execution', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/notifications',
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].id).toBe(createdNotifId);
      expect(body.data.unreadCount).toBe(1);
      expect(body.data.pagination.total).toBe(1);
    });

    it('marks a single notification as READ via POST /me/notifications/:id/read', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/notifications/${createdNotifId}/read`,
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.id).toBe(createdNotifId);
      expect(body.data.status).toBe('READ');
      expect(body.data.readAt).toBeDefined();

      // Check unread count is now 0
      const unreadCount = await notificationService.getUnreadCount(userAId);
      expect(unreadCount).toBe(0);
    });

    it('enforces IDOR defense: User B cannot mark User A notification as read (returns 404)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/notifications/${createdNotifId}/read`,
        headers: {
          cookie: getAuthCookie(userBToken),
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('archives notification via POST /me/notifications/:id/archive preserving read_at', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/notifications/${createdNotifId}/archive`,
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe('ARCHIVED');
      expect(body.data.archivedAt).toBeDefined();
      expect(body.data.readAt).toBeDefined(); // Retains prior readAt!
    });

    it('marks all unread notifications as read via POST /me/notifications/read-all', async () => {
      // Create 2 unread notifications for User A
      await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'ALERT_1',
        title: 'Alert 1',
        message: 'Message 1',
        channels: ['IN_APP'],
      });
      await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'ALERT_2',
        title: 'Alert 2',
        message: 'Message 2',
        channels: ['IN_APP'],
      });

      expect(await notificationService.getUnreadCount(userAId)).toBe(2);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/notifications/read-all',
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.updatedCount).toBe(2);
      expect(await notificationService.getUnreadCount(userAId)).toBe(0);
    });
  });

  describe('2. User Notification Preferences & Optional Suppression', () => {
    it('returns default preferences via GET /me/notification-preferences', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/notification-preferences',
        headers: {
          cookie: getAuthCookie(userBToken),
        },
      });

      expect(res.statusCode).toBe(200);
      const prefs = res.json().data;
      expect(prefs.emailEnabled).toBe(true);
      expect(prefs.marketingEmailEnabled).toBe(false);
      expect(prefs.inAppEnabled).toBe(true);
    });

    it('updates preferences via PATCH /me/notification-preferences', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/notification-preferences',
        headers: {
          cookie: getAuthCookie(userBToken),
        },
        payload: {
          emailEnabled: false,
          inAppEnabled: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json().data;
      expect(updated.emailEnabled).toBe(false);
      expect(updated.inAppEnabled).toBe(false);
    });

    it('suppresses optional in-app and email notifications according to preferences', async () => {
      // User B has emailEnabled = false and inAppEnabled = false
      const notif = await notificationService.dispatch({
        userId: userBId,
        category: 'CURRICULUM_UPDATE',
        notificationType: 'TERM_DATES_CIRCULAR',
        title: 'New Term Dates Circular',
        message: 'Term dates have been published.',
        channels: ['IN_APP', 'EMAIL'],
      });

      // Notification itself is created as ARCHIVED with archived_at populated
      expect(notif.status).toBe('ARCHIVED');
      expect(notif.archivedAt).toBeDefined();

      // Check deliveries: both IN_APP and EMAIL must be SKIPPED
      const deliveries = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, notif.id)),
      );

      expect(deliveries).toHaveLength(2);
      const inAppDelivery = deliveries.find((d) => d.channel === 'IN_APP');
      const emailDelivery = deliveries.find((d) => d.channel === 'EMAIL');

      expect(inAppDelivery?.status).toBe('SKIPPED');
      expect(inAppDelivery?.errorMessage).toContain('in-app');
      expect(emailDelivery?.status).toBe('SKIPPED');
      expect(emailDelivery?.errorMessage).toContain('email');
    });

    it('evaluates marketing_email_enabled as additional gate when email_enabled is true', async () => {
      // Reset User B emailEnabled = true, marketingEmailEnabled = false
      await notificationService.updateUserPreferences(userBId, {
        emailEnabled: true,
        marketingEmailEnabled: false,
        inAppEnabled: true,
      });

      // 1. Dispatch MARKETING notification -> Email must be SKIPPED
      const mktNotif = await notificationService.dispatch({
        userId: userBId,
        category: 'MARKETING',
        notificationType: 'WEEKLY_HIGHLIGHT',
        title: 'Weekly Highlights',
        message: 'Check out new trending resources.',
        channels: ['EMAIL'],
      });

      const [mktDelivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, mktNotif.id)),
      );
      expect(mktDelivery.status).toBe('SKIPPED');
      expect(mktDelivery.errorMessage).toContain('marketing');

      // 2. Dispatch non-marketing EDITORIAL notification -> Email must be PENDING
      const editNotif = await notificationService.dispatch({
        userId: userBId,
        category: 'EDITORIAL',
        notificationType: 'EDITORIAL_FEEDBACK',
        title: 'Editorial Feedback',
        message: 'Review completed.',
        channels: ['EMAIL'],
      });

      const [editDelivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, editNotif.id)),
      );
      expect(editDelivery.status).toBe('PENDING');
    });
  });

  describe('3. Mandatory Category Policy (Opt-Out Bypass)', () => {
    it('bypasses user opt-outs for TRANSACTIONAL and SECURITY notifications', async () => {
      // User B has emailEnabled = false and inAppEnabled = false
      await notificationService.updateUserPreferences(userBId, {
        emailEnabled: false,
        inAppEnabled: false,
      });

      // Dispatch TRANSACTIONAL payment receipt
      const receiptNotif = await notificationService.dispatch({
        userId: userBId,
        category: 'TRANSACTIONAL',
        notificationType: 'COMMERCE_PAYMENT_SUCCESS',
        title: 'Payment Receipt: Grade 8 Mathematics',
        message: 'Thank you for your purchase. Receipt #MPESA12345.',
        channels: ['IN_APP', 'EMAIL'],
      });

      // Mandatory In-App must NOT be suppressed
      expect(receiptNotif.status).toBe('UNREAD');
      expect(receiptNotif.archivedAt).toBeNull();

      const deliveries = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, receiptNotif.id)),
      );

      const inAppDelivery = deliveries.find((d) => d.channel === 'IN_APP');
      const emailDelivery = deliveries.find((d) => d.channel === 'EMAIL');

      // In-App is DELIVERED synchronously
      expect(inAppDelivery?.status).toBe('DELIVERED');
      // Email is QUEUED for worker (not SKIPPED!)
      expect(emailDelivery?.status).toBe('PENDING');
      expect(emailDelivery?.attemptCount).toBe(0);
    });
  });

  describe('4. Deduplication & Idempotency', () => {
    it('returns existing notification on duplicate deduplicationKey without duplicate rows', async () => {
      const dedupKey = `payment-tx-${crypto.randomUUID()}`;

      const notif1 = await notificationService.dispatch({
        userId: userAId,
        category: 'TRANSACTIONAL',
        notificationType: 'PAYMENT_CONFIRMATION',
        title: 'Order Completed',
        message: 'Entitlement granted.',
        deduplicationKey: dedupKey,
        channels: ['IN_APP'],
      });

      const notif2 = await notificationService.dispatch({
        userId: userAId,
        category: 'TRANSACTIONAL',
        notificationType: 'PAYMENT_CONFIRMATION',
        title: 'Duplicate Order Callback',
        message: 'Duplicate payment message.',
        deduplicationKey: dedupKey,
        channels: ['IN_APP'],
      });

      expect(notif1.id).toBe(notif2.id);

      // Verify only 1 notification exists in DB
      const allRows = await withDbRetry(async () =>
        db
          .select()
          .from(notifications)
          .where(
            sql`${notifications.userId} = ${userAId} AND ${notifications.deduplicationKey} = ${dedupKey}`,
          ),
      );
      expect(allRows).toHaveLength(1);
    });
  });

  describe('5. Outbox Worker Claim, Process, and Finalize', () => {
    it('claims pending email delivery, calls provider, and transitions to SENT', async () => {
      // Drain any earlier pending deliveries so outbox is clean for this test
      await notificationService.processPendingDeliveries(100);

      // 1. Dispatch an email notification to User A
      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'REVISION_REQUESTED',
        title: 'Revisions Requested',
        message: 'Please review editorial comments.',
        channels: ['EMAIL'],
      });

      // 2. Run outbox sweeper
      const sweepResult = await notificationService.processPendingDeliveries(10);
      expect(sweepResult.claimedJobs).toBeGreaterThan(0);
      expect(sweepResult.processedJobs).toBeGreaterThan(0);

      // 3. Inspect delivery row
      const [delivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(
            sql`${notificationDeliveries.notificationId} = ${notif.id} AND ${notificationDeliveries.channel} = 'EMAIL'`,
          ),
      );

      expect(delivery.status).toBe('SENT');
      expect(delivery.provider).toBe('MOCK_EMAIL');
      expect(delivery.providerReference).toMatch(/^mock-email-/);
      expect(delivery.sentAt).toBeDefined();
      expect(delivery.attemptCount).toBe(1);
      expect(delivery.lockedAt).toBeNull();
      expect(delivery.lockedBy).toBeNull();
    });
  });

  describe('6. Retry Scheduling & Terminal Failure Backoff', () => {
    it('schedules exponential backoff on simulated transient error', async () => {
      // Drain any earlier pending deliveries so outbox is clean
      await notificationService.processPendingDeliveries(100);

      // Configure mock email to fail once transiently
      customMockEmailProvider.setFailureOptions({
        simulatedFailuresCount: 1,
      });

      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'RETRY_TEST',
        title: 'Retry Test Notice',
        message: 'Simulating transient failure.',
        channels: ['EMAIL'],
      });

      // First sweep: should fail and reschedule
      await notificationService.processPendingDeliveries(10);

      const [deliveryAfterAttempt1] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(
            sql`${notificationDeliveries.notificationId} = ${notif.id} AND ${notificationDeliveries.channel} = 'EMAIL'`,
          ),
      );

      expect(deliveryAfterAttempt1.status).toBe('PENDING');
      expect(deliveryAfterAttempt1.attemptCount).toBe(1);
      expect(deliveryAfterAttempt1.nextRetryAt).toBeDefined();
      expect(deliveryAfterAttempt1.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
      expect(deliveryAfterAttempt1.errorMessage).toContain('Simulated transient SMTP timeout');

      // Reset failure options so subsequent attempt succeeds
      customMockEmailProvider.resetFailures();

      // Force nextRetryAt to past to make it immediately eligible (using DB now() to eliminate any clock skew)
      await withDbRetry(async () =>
        db
          .update(notificationDeliveries)
          .set({ nextRetryAt: sql`now() - INTERVAL '1 minute'` })
          .where(eq(notificationDeliveries.id, deliveryAfterAttempt1.id)),
      );

      // Second sweep: should succeed
      await notificationService.processPendingDeliveries(10);

      const [deliveryAfterAttempt2] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, deliveryAfterAttempt1.id)),
      );

      expect(deliveryAfterAttempt2.status).toBe('SENT');
      expect(deliveryAfterAttempt2.attemptCount).toBe(2);
      expect(deliveryAfterAttempt2.sentAt).toBeDefined();
    });

    it('transitions to FAILED when maximum attempts are exhausted', async () => {
      // Drain any earlier pending deliveries
      await notificationService.processPendingDeliveries(100);

      // Configure mock provider to always fail
      customMockEmailProvider.setFailureOptions({
        alwaysFail: true,
      });

      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'SECURITY',
        notificationType: 'SECURITY_ALERT',
        title: 'Exhaustion Test Alert',
        message: 'Will fail 3 times.',
        channels: ['EMAIL'],
      });

      let [del] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, notif.id)),
      );

      // Sweep 1
      await notificationService.processPendingDeliveries(10);
      // Fast-forward retry 1 (using DB now() to eliminate clock skew)
      await withDbRetry(async () =>
        db
          .update(notificationDeliveries)
          .set({ nextRetryAt: sql`now() - INTERVAL '1 minute'` })
          .where(eq(notificationDeliveries.id, del.id)),
      );

      // Sweep 2
      await notificationService.processPendingDeliveries(10);
      // Fast-forward retry 2 (using DB now() to eliminate clock skew)
      await withDbRetry(async () =>
        db
          .update(notificationDeliveries)
          .set({ nextRetryAt: sql`now() - INTERVAL '1 minute'` })
          .where(eq(notificationDeliveries.id, del.id)),
      );

      // Sweep 3 (final attempt)
      await notificationService.processPendingDeliveries(10);

      const [finalDelivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, del.id)),
      );

      expect(finalDelivery.status).toBe('FAILED');
      expect(finalDelivery.attemptCount).toBe(3);
      expect(finalDelivery.failedAt).toBeDefined();
      expect(finalDelivery.errorMessage).toContain('Simulated permanent SMTP failure');

      customMockEmailProvider.resetFailures();
    });
  });

  describe('7. Stale Lease Recovery & Stale Worker Protection', () => {
    it('recovers an expired lease in PROCESSING status back to PENDING', async () => {
      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'CRASH_RECOVERY_TEST',
        title: 'Crash Recovery',
        message: 'Simulating worker crash during execution.',
        channels: ['EMAIL'],
      });

      const [del] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, notif.id)),
      );

      // Simulate a crashed worker: job left in PROCESSING with locked_at 15 minutes ago
      await withDbRetry(async () =>
        db
          .update(notificationDeliveries)
          .set({
            status: 'PROCESSING',
            lockedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago (> 5 min timeout)
            lockedBy: 'crashed-worker-pid-999',
            attemptCount: 1,
            nextRetryAt: null,
          })
          .where(eq(notificationDeliveries.id, del.id)),
      );

      // Run sweeper: Phase 0 should recover the lease
      const result = await notificationService.processPendingDeliveries(10);
      expect(result.recoveredLeases).toBeGreaterThanOrEqual(1);

      // Verify the delivery was returned to PENDING with next_retry_at scheduled
      const [recovered] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, del.id)),
      );

      expect(recovered.status).toBe('PENDING');
      expect(recovered.lockedAt).toBeNull();
      expect(recovered.lockedBy).toBeNull();
      expect(recovered.errorMessage).toContain('lease expired');
    });

    it('transitions expired lease to FAILED when maximum attempts are exhausted', async () => {
      const notif = await notificationService.dispatch({
        userId: userAId,
        category: 'EDITORIAL',
        notificationType: 'EXHAUSTED_CRASH_TEST',
        title: 'Exhausted Crash Recovery',
        message: 'Simulating worker crash on final attempt.',
        channels: ['EMAIL'],
      });

      const [del] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.notificationId, notif.id)),
      );

      // Simulate a crashed worker on the final attempt (attemptCount = 3, maxAttempts = 3)
      await withDbRetry(async () =>
        db
          .update(notificationDeliveries)
          .set({
            status: 'PROCESSING',
            lockedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago (> 5 min timeout)
            lockedBy: 'crashed-worker-exhausted',
            attemptCount: 3,
            maxAttempts: 3,
            nextRetryAt: null,
          })
          .where(eq(notificationDeliveries.id, del.id)),
      );

      // Run sweeper: Phase 0 identifies lease expired past maxAttempts
      const result = await notificationService.processPendingDeliveries(10);
      expect(result.recoveredLeases).toBeGreaterThanOrEqual(1);

      // Verify the delivery transitioned to terminal FAILED state
      const [failedDelivery] = await withDbRetry(async () =>
        db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, del.id)),
      );

      expect(failedDelivery.status).toBe('FAILED');
      expect(failedDelivery.attemptCount).toBe(3);
      expect(failedDelivery.lockedAt).toBeNull();
      expect(failedDelivery.lockedBy).toBeNull();
      expect(failedDelivery.nextRetryAt).toBeNull();
      expect(failedDelivery.failedAt).toBeDefined();
      expect(failedDelivery.errorMessage).toContain('maximum attempts reached');
    });

    it('manages worker lifecycle: startWorker, isWorkerRunning, stopWorker, and Fastify onClose', async () => {
      expect(notificationService.isWorkerRunning()).toBe(false);

      notificationService.startWorker(5000);
      expect(notificationService.isWorkerRunning()).toBe(true);

      // Calling startWorker again while running is a no-op
      notificationService.startWorker(5000);
      expect(notificationService.isWorkerRunning()).toBe(true);

      notificationService.stopWorker();
      expect(notificationService.isWorkerRunning()).toBe(false);

      // Verify Fastify onClose hook stops active worker
      notificationService.startWorker(5000);
      expect(notificationService.isWorkerRunning()).toBe(true);

      const subApp = buildApp({
        logger: false,
        services: { notificationService },
      });
      await subApp.ready();
      await subApp.close();

      expect(notificationService.isWorkerRunning()).toBe(false);
    });
  });

  describe('8. Staff & RBAC Access Control', () => {
    it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects standard_user from administrative endpoints with 403 FORBIDDEN', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });
      expect(listRes.statusCode).toBe(403);

      const sweepRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/process-pending',
        headers: {
          cookie: getAuthCookie(userAToken),
        },
      });
      expect(sweepRes.statusCode).toBe(403);
    });

    it('permits content_manager to view delivery logs (read-only)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: {
          cookie: getAuthCookie(managerToken),
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(body.data.pagination).toBeDefined();
    });

    it('rejects content_reviewer from triggering outbox sweep (requires notification.admin.manage)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/process-pending',
        headers: {
          cookie: getAuthCookie(reviewerToken),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects content_manager from triggering outbox sweep (requires notification.admin.manage)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/process-pending',
        headers: {
          cookie: getAuthCookie(managerToken),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('permits system_admin to trigger outbox sweep', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/process-pending',
        headers: {
          cookie: getAuthCookie(adminToken),
        },
        payload: {
          batchSize: 25,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.claimedJobs).toBeDefined();
      expect(res.json().data.processedJobs).toBeDefined();
    });
  });
});
