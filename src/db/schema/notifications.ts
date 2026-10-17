import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { identitySchema } from '../logical-schemas.js';
import { users } from './identity.js';

export const NOTIFICATION_CATEGORIES = [
  'TRANSACTIONAL',
  'SECURITY',
  'EDITORIAL',
  'CONTRIBUTOR',
  'CURRICULUM_UPDATE',
  'MARKETING',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_STATUSES = ['UNREAD', 'READ', 'ARCHIVED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const DELIVERY_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * 25.1 identity.notifications
 * Centralized user notification records.
 */
export const notifications = identitySchema.table(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 32 }).notNull(),
    notificationType: varchar('notification_type', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    entityType: varchar('entity_type', { length: 64 }),
    entityId: uuid('entity_id'),
    priority: varchar('priority', { length: 20 }).notNull().default('NORMAL'),
    status: varchar('status', { length: 20 }).notNull().default('UNREAD'),
    deduplicationKey: varchar('deduplication_key', { length: 128 }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'chk_notifications_category',
      sql`${table.category} IN ('TRANSACTIONAL', 'SECURITY', 'EDITORIAL', 'CONTRIBUTOR', 'CURRICULUM_UPDATE', 'MARKETING')`,
    ),
    check(
      'chk_notifications_priority',
      sql`${table.priority} IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')`,
    ),
    check(
      'chk_notifications_status',
      sql`${table.status} IN ('UNREAD', 'READ', 'ARCHIVED')`,
    ),
    check(
      'chk_notifications_lifecycle',
      sql`(${table.status} = 'UNREAD' AND ${table.readAt} IS NULL AND ${table.archivedAt} IS NULL) OR (${table.status} = 'READ' AND ${table.readAt} IS NOT NULL AND ${table.archivedAt} IS NULL) OR (${table.status} = 'ARCHIVED' AND ${table.archivedAt} IS NOT NULL)`,
    ),
    check(
      'chk_notifications_title_len',
      sql`length(trim(${table.title})) > 0 AND length(${table.title}) <= 255`,
    ),
    check(
      'chk_notifications_msg_len',
      sql`length(trim(${table.message})) > 0 AND length(${table.message}) <= 5000`,
    ),
    index('idx_notifications_user_inbox').on(table.userId, table.status, table.createdAt),
    uniqueIndex('uq_notifications_user_dedup')
      .on(table.userId, table.deduplicationKey)
      .where(sql`${table.deduplicationKey} IS NOT NULL`),
    index('idx_notifications_entity').on(table.entityType, table.entityId),
  ],
);

/**
 * 25.2 identity.notification_deliveries
 * Transactional outbox and delivery tracking ledger.
 */
export const notificationDeliveries = identitySchema.table(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    provider: varchar('provider', { length: 64 }),
    providerReference: varchar('provider_reference', { length: 255 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 64 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_deliveries_channel',
      sql`${table.channel} IN ('IN_APP', 'EMAIL', 'SMS')`,
    ),
    check(
      'chk_deliveries_status',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED')`,
    ),
    check(
      'chk_deliveries_attempts',
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check(
      'chk_deliveries_invariants',
      sql`(${table.status} = 'PENDING' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.nextRetryAt} IS NOT NULL AND ${table.attemptCount} < ${table.maxAttempts} AND ${table.sentAt} IS NULL AND ${table.deliveredAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'PROCESSING' AND ${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL AND ${table.nextRetryAt} IS NULL AND ${table.attemptCount} >= 1 AND ${table.attemptCount} <= ${table.maxAttempts} AND ${table.sentAt} IS NULL AND ${table.deliveredAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'SENT' AND ${table.channel} IN ('EMAIL', 'SMS') AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.nextRetryAt} IS NULL AND ${table.sentAt} IS NOT NULL AND ${table.failedAt} IS NULL AND ${table.attemptCount} >= 1 AND ${table.attemptCount} <= ${table.maxAttempts} AND ${table.errorMessage} IS NULL) OR (${table.status} = 'DELIVERED' AND ${table.channel} = 'IN_APP' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.nextRetryAt} IS NULL AND ${table.deliveredAt} IS NOT NULL AND ${table.failedAt} IS NULL AND ${table.sentAt} IS NULL AND ${table.attemptCount} = 0 AND ${table.errorMessage} IS NULL) OR (${table.status} = 'FAILED' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.nextRetryAt} IS NULL AND ${table.failedAt} IS NOT NULL AND ${table.sentAt} IS NULL AND ${table.deliveredAt} IS NULL AND ${table.attemptCount} >= 1 AND ${table.errorMessage} IS NOT NULL) OR (${table.status} = 'SKIPPED' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.nextRetryAt} IS NULL AND ${table.sentAt} IS NULL AND ${table.deliveredAt} IS NULL AND ${table.failedAt} IS NULL AND ${table.attemptCount} = 0 AND ${table.errorMessage} IS NOT NULL)`,
    ),
    index('idx_deliveries_queue')
      .on(table.status, table.nextRetryAt)
      .where(sql`${table.status} = 'PENDING'`),
    index('idx_deliveries_notification').on(table.notificationId),
  ],
);

/**
 * 19.1 identity.user_notification_preferences
 * User notification delivery channel opt-in / opt-out preferences.
 */
export const userNotificationPreferences = identitySchema.table(
  'user_notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    marketingEmailEnabled: boolean('marketing_email_enabled').notNull().default(false),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_notification_preferences_user').on(table.userId),
  ],
);

// Relations
export const notificationsRelations = relations(notifications, ({ one, many }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  deliveries: many(notificationDeliveries),
}));

export const notificationDeliveriesRelations = relations(notificationDeliveries, ({ one }) => ({
  notification: one(notifications, {
    fields: [notificationDeliveries.notificationId],
    references: [notifications.id],
  }),
}));

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

// Inferred Types
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type NewUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;
