import crypto from 'node:crypto';
import { sql, eq, and, desc, count } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  notifications,
  notificationDeliveries,
  userNotificationPreferences,
  users,
  type Notification,
  type NotificationDelivery,
  type UserNotificationPreference,
  type NotificationCategory,
  type NotificationPriority,
  type NotificationStatus,
  type DeliveryChannel,
  type DeliveryStatus,
} from '../db/schemas.js';
import type { NotificationDeliveryProvider } from './notifications/notification-provider.interface.js';
import { MockEmailDeliveryProvider } from './notifications/mock-email-provider.js';
import { MockSmsDeliveryProvider } from './notifications/mock-sms-provider.js';

// Domain Error Classes
export class NotificationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'NOTIFICATION_ERROR',
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

export class NotificationNotFoundError extends NotificationError {
  constructor(id: string) {
    super(`Notification with id '${id}' was not found.`, 404, 'NOTIFICATION_NOT_FOUND');
    this.name = 'NotificationNotFoundError';
  }
}

export interface DispatchNotificationInput {
  userId: string;
  category: NotificationCategory;
  notificationType: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channels?: DeliveryChannel[];
  entityType?: string;
  entityId?: string;
  deduplicationKey?: string | null;
  metadata?: Record<string, unknown>;
  tx?: AppDatabase | any;
}

export interface ListUserNotificationsQuery {
  status?: NotificationStatus;
  category?: NotificationCategory;
  page?: number;
  limit?: number;
}

export interface ListAdminDeliveriesQuery {
  status?: DeliveryStatus;
  channel?: DeliveryChannel;
  notificationId?: string;
  page?: number;
  limit?: number;
}

export interface NotificationService {
  dispatch(input: DispatchNotificationInput): Promise<Notification>;
  dispatchWithTx(input: DispatchNotificationInput, tx: AppDatabase | any): Promise<Notification>;
  listUserNotifications(
    userId: string,
    query?: ListUserNotificationsQuery,
  ): Promise<{
    items: Notification[];
    unreadCount: number;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>;
  getUnreadCount(userId: string): Promise<number>;
  markAsRead(userId: string, notificationId: string): Promise<Notification>;
  markAllAsRead(userId: string): Promise<{ updatedCount: number }>;
  archiveNotification(userId: string, notificationId: string): Promise<Notification>;
  getUserPreferences(userId: string): Promise<UserNotificationPreference>;
  updateUserPreferences(
    userId: string,
    update: {
      emailEnabled?: boolean;
      marketingEmailEnabled?: boolean;
      inAppEnabled?: boolean;
    },
  ): Promise<UserNotificationPreference>;
  processPendingDeliveries(batchSize?: number): Promise<{
    recoveredLeases: number;
    claimedJobs: number;
    processedJobs: number;
  }>;
  listAdminDeliveries(query?: ListAdminDeliveriesQuery): Promise<{
    items: (NotificationDelivery & { notificationTitle?: string; notificationType?: string })[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>;
  startWorker(intervalMs?: number): void;
  stopWorker(): void;
  isWorkerRunning(): boolean;
}

export class DefaultNotificationService implements NotificationService {
  private workerInstanceId: string;
  private emailProvider: NotificationDeliveryProvider;
  private smsProvider: NotificationDeliveryProvider;
  private workerTimer: NodeJS.Timeout | null = null;
  private isSweepRunning = false;

  constructor(
    private db: AppDatabase = defaultDb,
    emailProvider?: NotificationDeliveryProvider,
    smsProvider?: NotificationDeliveryProvider,
  ) {
    this.workerInstanceId = `worker-${crypto.randomUUID().slice(0, 8)}`;
    this.emailProvider = emailProvider ?? new MockEmailDeliveryProvider();
    this.smsProvider = smsProvider ?? new MockSmsDeliveryProvider();
  }

  setEmailProvider(provider: NotificationDeliveryProvider) {
    this.emailProvider = provider;
  }

  setSmsProvider(provider: NotificationDeliveryProvider) {
    this.smsProvider = provider;
  }

  startWorker(intervalMs = 10000): void {
    if (this.workerTimer) {
      return;
    }
    this.workerTimer = setInterval(async () => {
      if (this.isSweepRunning) return;
      this.isSweepRunning = true;
      try {
        await this.processPendingDeliveries();
      } catch {
        // Prevent background sweep error from propagating unhandled
      } finally {
        this.isSweepRunning = false;
      }
    }, intervalMs);

    this.workerTimer.unref();
  }

  stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  isWorkerRunning(): boolean {
    return this.workerTimer !== null;
  }

  async dispatch(input: DispatchNotificationInput): Promise<Notification> {
    if (input.tx) {
      return this.executeDispatch(input, input.tx);
    }
    return await this.db.transaction(async (tx) => {
      return this.executeDispatch(input, tx);
    });
  }

  async dispatchWithTx(
    input: DispatchNotificationInput,
    tx: AppDatabase | any,
  ): Promise<Notification> {
    return this.executeDispatch(input, tx);
  }

  private async executeDispatch(
    input: DispatchNotificationInput,
    tx: AppDatabase | any,
  ): Promise<Notification> {
    const priority = input.priority ?? 'NORMAL';
    const channels = input.channels ?? ['IN_APP', 'EMAIL'];
    const metadata = input.metadata ?? {};
    const isMandatory =
      input.category === 'TRANSACTIONAL' || input.category === 'SECURITY';

    // 1. Fetch user preferences (or defaults if not explicitly stored)
    const [existingPrefs] = await tx
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, input.userId))
      .limit(1);

    const emailEnabled = existingPrefs?.emailEnabled ?? true;
    const marketingEmailEnabled = existingPrefs?.marketingEmailEnabled ?? false;
    const inAppEnabled = existingPrefs?.inAppEnabled ?? true;

    // 2. Determine initial In-App status
    let initialNotificationStatus: NotificationStatus = 'UNREAD';
    let initialArchivedAt: Date | null = null;

    if (!isMandatory && !inAppEnabled) {
      // Optional in-app suppressed -> set ARCHIVED directly with archivedAt populated
      initialNotificationStatus = 'ARCHIVED';
      initialArchivedAt = new Date();
    }

    // 3. Deduplication check before insert for idempotency
    if (input.deduplicationKey) {
      const [existing] = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, input.userId),
            eq(notifications.deduplicationKey, input.deduplicationKey),
          ),
        )
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    // 4. Insert notification row with Idempotency protection
    let insertedNotification: Notification;
    try {
      const [row] = await tx
        .insert(notifications)
        .values({
          userId: input.userId,
          category: input.category,
          notificationType: input.notificationType,
          title: input.title,
          message: input.message,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          priority,
          status: initialNotificationStatus,
          deduplicationKey: input.deduplicationKey ?? null,
          metadata,
          readAt: null,
          archivedAt: initialArchivedAt,
        })
        .onConflictDoNothing()
        .returning();

      if (!row && input.deduplicationKey) {
        const [existing] = await tx
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, input.userId),
              eq(notifications.deduplicationKey, input.deduplicationKey),
            ),
          )
          .limit(1);

        if (existing) {
          return existing;
        }
      }

      if (!row) {
        throw new NotificationError('Failed to create notification', 500);
      }

      insertedNotification = row;
    } catch (err: any) {
      const isDedupConstraint =
        (err?.code === '23505' || err?.cause?.code === '23505') &&
        (err?.constraint === 'uq_notifications_user_dedup' ||
          err?.cause?.constraint === 'uq_notifications_user_dedup' ||
          err?.message?.includes('uq_notifications_user_dedup') ||
          err?.cause?.message?.includes('uq_notifications_user_dedup'));

      if (isDedupConstraint && input.deduplicationKey) {
        const [existing] = await this.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, input.userId),
              eq(notifications.deduplicationKey, input.deduplicationKey),
            ),
          )
          .limit(1);

        if (existing) {
          return existing;
        }
      }
      throw err;
    }

    // 4. Create delivery records for each requested channel
    for (const channel of channels) {
      if (channel === 'IN_APP') {
        if (isMandatory || inAppEnabled) {
          // Synchronous In-App Delivery: immediately marked DELIVERED in same transaction
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'IN_APP',
            status: 'DELIVERED',
            provider: 'IN_APP_SYSTEM',
            providerReference: `in-app-${insertedNotification.id}`,
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: null,
            deliveredAt: new Date(),
            sentAt: null,
            failedAt: null,
            errorMessage: null,
          });
        } else {
          // In-App suppressed by preference -> SKIPPED
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'IN_APP',
            status: 'SKIPPED',
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: null,
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
            errorMessage: 'User opted out of in-app notifications',
          });
        }
      } else if (channel === 'EMAIL') {
        if (isMandatory) {
          // Mandatory email: always queued for worker
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'EMAIL',
            status: 'PENDING',
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: new Date(Date.now() - 30000),
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
          });
        } else if (!emailEnabled) {
          // Optional email suppressed by master switch
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'EMAIL',
            status: 'SKIPPED',
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: null,
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
            errorMessage: 'User opted out of email notifications',
          });
        } else if (
          input.category === 'MARKETING' &&
          !marketingEmailEnabled
        ) {
          // Marketing email suppressed by specific marketing opt-in
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'EMAIL',
            status: 'SKIPPED',
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: null,
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
            errorMessage: 'User opted out of marketing emails',
          });
        } else {
          // Optional email permitted: queue for worker
          await tx.insert(notificationDeliveries).values({
            notificationId: insertedNotification.id,
            channel: 'EMAIL',
            status: 'PENDING',
            attemptCount: 0,
            maxAttempts: 3,
            nextRetryAt: new Date(Date.now() - 30000),
            sentAt: null,
            deliveredAt: null,
            failedAt: null,
          });
        }
      } else if (channel === 'SMS') {
        // SMS channel queued for worker
        await tx.insert(notificationDeliveries).values({
          notificationId: insertedNotification.id,
          channel: 'SMS',
          status: 'PENDING',
          attemptCount: 0,
          maxAttempts: 3,
          nextRetryAt: new Date(Date.now() - 30000),
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
        });
      }
    }

    return insertedNotification;
  }

  /**
   * Four-Phase Outbox Sweeper: Recovers expired leases, claims eligible jobs, calls providers, and finalizes.
   */
  async processPendingDeliveries(batchSize = 50): Promise<{
    recoveredLeases: number;
    claimedJobs: number;
    processedJobs: number;
  }> {
    let recoveredLeases = 0;
    let claimedJobs = 0;
    let processedJobs = 0;

    // --- PHASE 0: RECOVER EXPIRED LEASES ---
    await this.db.transaction(async (tx) => {
      const expiredLeases = await tx
        .select({
          id: notificationDeliveries.id,
          attemptCount: notificationDeliveries.attemptCount,
          maxAttempts: notificationDeliveries.maxAttempts,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.status, 'PROCESSING'),
            sql`${notificationDeliveries.lockedAt} < now() - INTERVAL '5 minutes'`,
          ),
        )
        .orderBy(notificationDeliveries.lockedAt)
        .limit(batchSize)
        .for('update', { skipLocked: true });

      for (const lease of expiredLeases) {
        if (lease.attemptCount >= lease.maxAttempts) {
          // Terminal failure: lease expired after exhausting attempts
          await tx
            .update(notificationDeliveries)
            .set({
              status: 'FAILED',
              failedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              nextRetryAt: null,
              errorMessage:
                'Worker lease expired after maximum attempts reached',
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, lease.id));
        } else {
          // Re-queue with exponential backoff: 30s * 2^(attemptCount - 1)
          const delaySeconds = 30 * Math.pow(2, lease.attemptCount - 1);
          const nextRetry = new Date(Date.now() + delaySeconds * 1000);

          await tx
            .update(notificationDeliveries)
            .set({
              status: 'PENDING',
              nextRetryAt: nextRetry,
              lockedAt: null,
              lockedBy: null,
              errorMessage:
                'Worker lease expired; returned to queue for retry',
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, lease.id));
        }
        recoveredLeases++;
      }
    });

    // --- PHASE 1: CLAIM ELIGIBLE JOBS ---
    type ClaimedJob = {
      id: string;
      notificationId: string;
      channel: DeliveryChannel;
      attemptCount: number;
      maxAttempts: number;
      lockedAt: Date;
    };

    let claimed: ClaimedJob[] = [];

    await this.db.transaction(async (tx) => {
      const eligible = await tx
        .select({
          id: notificationDeliveries.id,
          notificationId: notificationDeliveries.notificationId,
          channel: notificationDeliveries.channel,
          attemptCount: notificationDeliveries.attemptCount,
          maxAttempts: notificationDeliveries.maxAttempts,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.status, 'PENDING'),
            sql`${notificationDeliveries.nextRetryAt} <= now() + INTERVAL '10 seconds'`,
            sql`${notificationDeliveries.lockedAt} IS NULL`,
            sql`${notificationDeliveries.attemptCount} < ${notificationDeliveries.maxAttempts}`,
          ),
        )
        .orderBy(notificationDeliveries.nextRetryAt)
        .limit(batchSize)
        .for('update', { skipLocked: true });

      if (eligible.length === 0) {
        return;
      }

      const claimTime = new Date();
      for (const job of eligible) {
        const nextAttempt = job.attemptCount + 1;
        await tx
          .update(notificationDeliveries)
          .set({
            status: 'PROCESSING',
            lockedAt: claimTime,
            lockedBy: this.workerInstanceId,
            attemptCount: nextAttempt,
            nextRetryAt: null,
            updatedAt: claimTime,
          })
          .where(eq(notificationDeliveries.id, job.id));

        claimed.push({
          id: job.id,
          notificationId: job.notificationId,
          channel: job.channel as DeliveryChannel,
          attemptCount: nextAttempt,
          maxAttempts: job.maxAttempts,
          lockedAt: claimTime,
        });
      }
      claimedJobs = claimed.length;
    });

    // --- PHASE 2 & 3: PROCESS AND FINALIZE (Outside DB Transaction) ---
    for (const job of claimed) {
      // Lookup notification and user details
      const [notif] = await this.db
        .select({
          id: notifications.id,
          userId: notifications.userId,
          title: notifications.title,
          message: notifications.message,
          metadata: notifications.metadata,
          deduplicationKey: notifications.deduplicationKey,
          email: users.email,
          phone: users.phone,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notifications.id, job.notificationId))
        .limit(1);

      if (!notif) {
        // Parent notification deleted or missing -> mark terminal failure
        await this.db
          .update(notificationDeliveries)
          .set({
            status: 'FAILED',
            failedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            errorMessage: 'Parent notification or user no longer exists',
            updatedAt: new Date(),
          })
          .where(eq(notificationDeliveries.id, job.id));
        continue;
      }

      const provider =
        job.channel === 'EMAIL' ? this.emailProvider : this.smsProvider;

      let result;
      try {
        result = await provider.send({
          deliveryId: job.id,
          notificationId: notif.id,
          userId: notif.userId,
          recipientEmail: notif.email,
          recipientPhone: notif.phone,
          title: notif.title,
          message: notif.message,
          metadata: notif.metadata as Record<string, unknown>,
          deduplicationKey: notif.deduplicationKey,
        });
      } catch (err: any) {
        result = {
          success: false,
          provider: provider.providerName,
          errorMessage: err?.message || 'Unexpected provider error',
          isRetryable: true,
        };
      }

      // --- PHASE 3: FINALIZE RESULT WITH LEASE OWNERSHIP CHECK ---
      await this.db.transaction(async (tx) => {
        if (result.success) {
          await tx
            .update(notificationDeliveries)
            .set({
              status: 'SENT',
              provider: result.provider,
              providerReference: result.providerReference ?? null,
              sentAt: new Date(),
              failedAt: null,
              errorMessage: null,
              lockedAt: null,
              lockedBy: null,
              nextRetryAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(notificationDeliveries.id, job.id),
                eq(notificationDeliveries.lockedBy, this.workerInstanceId),
                eq(notificationDeliveries.status, 'PROCESSING'),
              ),
            );
        } else {
          // Failure handling
          const isRetryable = result.isRetryable !== false;
          if (job.attemptCount < job.maxAttempts && isRetryable) {
            // Schedule exponential backoff retry: 30s * 2^(attemptCount - 1)
            const delaySeconds = 30 * Math.pow(2, job.attemptCount - 1);
            const nextRetry = new Date(Date.now() + delaySeconds * 1000);

            await tx
              .update(notificationDeliveries)
              .set({
                status: 'PENDING',
                nextRetryAt: nextRetry,
                errorMessage: result.errorMessage ?? 'Delivery failed',
                lockedAt: null,
                lockedBy: null,
                sentAt: null,
                failedAt: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(notificationDeliveries.id, job.id),
                  eq(notificationDeliveries.lockedBy, this.workerInstanceId),
                  eq(notificationDeliveries.status, 'PROCESSING'),
                ),
              );
          } else {
            // Terminal failure
            await tx
              .update(notificationDeliveries)
              .set({
                status: 'FAILED',
                failedAt: new Date(),
                errorMessage:
                  result.errorMessage ?? 'Delivery failed permanently',
                lockedAt: null,
                lockedBy: null,
                nextRetryAt: null,
                sentAt: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(notificationDeliveries.id, job.id),
                  eq(notificationDeliveries.lockedBy, this.workerInstanceId),
                  eq(notificationDeliveries.status, 'PROCESSING'),
                ),
              );
          }
        }
      });

      processedJobs++;
    }

    return {
      recoveredLeases,
      claimedJobs,
      processedJobs,
    };
  }

  async listUserNotifications(
    userId: string,
    query: ListUserNotificationsQuery = {},
  ): Promise<{
    items: Notification[];
    unreadCount: number;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(notifications.userId, userId)];

    if (query.status) {
      conditions.push(eq(notifications.status, query.status));
    }
    if (query.category) {
      conditions.push(eq(notifications.category, query.category));
    }

    const whereClause = and(...conditions);

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(whereClause);

    const total = Number(totalRow?.count ?? 0);
    const totalPages = Math.ceil(total / limit) || 1;

    const items = await this.db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const unreadCount = await this.getUnreadCount(userId);

    return {
      items,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.status, 'UNREAD'),
        ),
      );

    return Number(row?.count ?? 0);
  }

  async markAsRead(userId: string, notificationId: string): Promise<Notification> {
    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotificationNotFoundError(notificationId);
    }

    if (existing.status === 'READ') {
      return existing;
    }

    const [updated] = await this.db
      .update(notifications)
      .set({
        status: 'READ',
        readAt: existing.readAt ?? new Date(),
        archivedAt: null,
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();

    return updated;
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const now = new Date();
    const rows = await this.db
      .update(notifications)
      .set({
        status: 'READ',
        readAt: now,
        archivedAt: null,
      })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.status, 'UNREAD'),
        ),
      )
      .returning();

    return { updatedCount: rows.length };
  }

  async archiveNotification(
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotificationNotFoundError(notificationId);
    }

    if (existing.status === 'ARCHIVED') {
      return existing;
    }

    const [updated] = await this.db
      .update(notifications)
      .set({
        status: 'ARCHIVED',
        archivedAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();

    return updated;
  }

  async getUserPreferences(userId: string): Promise<UserNotificationPreference> {
    const [existing] = await this.db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Insert default preference record
    const [created] = await this.db
      .insert(userNotificationPreferences)
      .values({
        userId,
        emailEnabled: true,
        marketingEmailEnabled: false,
        inAppEnabled: true,
      })
      .returning();

    return created;
  }

  async updateUserPreferences(
    userId: string,
    update: {
      emailEnabled?: boolean;
      marketingEmailEnabled?: boolean;
      inAppEnabled?: boolean;
    },
  ): Promise<UserNotificationPreference> {
    const [existing] = await this.db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId))
      .limit(1);

    const now = new Date();
    if (existing) {
      const [updated] = await this.db
        .update(userNotificationPreferences)
        .set({
          emailEnabled: update.emailEnabled ?? existing.emailEnabled,
          marketingEmailEnabled:
            update.marketingEmailEnabled ?? existing.marketingEmailEnabled,
          inAppEnabled: update.inAppEnabled ?? existing.inAppEnabled,
          updatedAt: now,
        })
        .where(eq(userNotificationPreferences.userId, userId))
        .returning();

      return updated;
    }

    const [created] = await this.db
      .insert(userNotificationPreferences)
      .values({
        userId,
        emailEnabled: update.emailEnabled ?? true,
        marketingEmailEnabled: update.marketingEmailEnabled ?? false,
        inAppEnabled: update.inAppEnabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  }

  async listAdminDeliveries(query: ListAdminDeliveriesQuery = {}): Promise<{
    items: (NotificationDelivery & {
      notificationTitle?: string;
      notificationType?: string;
    })[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status) {
      conditions.push(eq(notificationDeliveries.status, query.status));
    }
    if (query.channel) {
      conditions.push(eq(notificationDeliveries.channel, query.channel));
    }
    if (query.notificationId) {
      conditions.push(
        eq(notificationDeliveries.notificationId, query.notificationId),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(notificationDeliveries)
      .where(whereClause);

    const total = Number(totalRow?.count ?? 0);
    const totalPages = Math.ceil(total / limit) || 1;

    const rows = await this.db
      .select({
        id: notificationDeliveries.id,
        notificationId: notificationDeliveries.notificationId,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        provider: notificationDeliveries.provider,
        providerReference: notificationDeliveries.providerReference,
        attemptCount: notificationDeliveries.attemptCount,
        maxAttempts: notificationDeliveries.maxAttempts,
        nextRetryAt: notificationDeliveries.nextRetryAt,
        lockedAt: notificationDeliveries.lockedAt,
        lockedBy: notificationDeliveries.lockedBy,
        sentAt: notificationDeliveries.sentAt,
        deliveredAt: notificationDeliveries.deliveredAt,
        failedAt: notificationDeliveries.failedAt,
        errorMessage: notificationDeliveries.errorMessage,
        createdAt: notificationDeliveries.createdAt,
        updatedAt: notificationDeliveries.updatedAt,
        notificationTitle: notifications.title,
        notificationType: notifications.notificationType,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notifications,
        eq(notifications.id, notificationDeliveries.notificationId),
      )
      .where(whereClause)
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows as any,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

export const defaultNotificationService = new DefaultNotificationService();
